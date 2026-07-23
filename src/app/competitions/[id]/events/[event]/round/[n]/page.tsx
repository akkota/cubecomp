'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { getEventByKey } from '@/lib/wca-events';
import { RoundLeaderboard } from '@/components/competitions/leaderboard';
import { CubeTimer } from '@/components/competitions/cube-timer';
import { submitTimesAction } from '@/actions/submitTimes';
import { toast } from 'sonner';
import { Clock, Lock, Send, AlertTriangle, CuboidIcon as CubeIcon, Trophy, Timer, ShuffleIcon, Video, CheckCircle2, TimerOff } from 'lucide-react';

type ScrambleEntry = { id: string; scramble_number: number; scramble: string };
type AccessState = 'loading' | 'granted' | 'blocked_registration' | 'blocked_qualification' | 'blocked_round_locked';

export default function RoundPage() {
  const params = useParams<{ id: string; event: string; n: string }>();
  const [compEvent, setCompEvent] = useState<any>(null);
  const [round, setRound] = useState<any>(null);
  const [competition, setCompetition] = useState<any>(null);
  const [scrambles, setScrambles] = useState<ScrambleEntry[]>([]);
  const [times, setTimes] = useState<Record<number, string>>({});
  const [penalties, setPenalties] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [accessState, setAccessState] = useState<AccessState>('loading');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoSubmitted, setVideoSubmitted] = useState(false);
  const [useTimer, setUseTimer] = useState(true);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const submittingRef = useRef(false);
  const supabase = createClient();

  useEffect(() => { const run = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: cEvent } = await supabase.from('competition_events').select('*').eq('competition_id', params.id).eq('event_key', params.event).single();
    if (!cEvent) { toast.error('Event not found'); return; }
    setCompEvent(cEvent);
    const { data: r } = await supabase.from('rounds').select('*').eq('competition_event_id', cEvent.id).eq('round_number', parseInt(params.n)).single();
    if (!r) { toast.error('Round not found'); return; }
    setRound(r);
    const { data: comp } = await supabase.from('competitions').select('*').eq('id', params.id).single();
    setCompetition(comp);
    // Access check
    const isSpectator = comp?.allow_spectators === true;
    if (!user) {
      // Not logged in: only view if spectator mode is on and round is active/completed
      if (isSpectator && r.status !== 'pending') { setAccessState('granted'); }
      else { setAccessState('blocked_registration'); }
    } else if (user.id === comp?.created_by) {
      // Owner always has full access
      setAccessState('granted');
    } else {
      const { data: competitor } = await supabase.from('competitors').select('id').eq('competition_id', params.id).eq('user_id', user.id).maybeSingle();
      if (!competitor) {
        // Not registered: spectator if allowed and round is active/completed
        if (isSpectator && r.status !== 'pending') { setAccessState('granted'); }
        else { setAccessState('blocked_registration'); }
      }
      else if (r.status === 'pending') { setAccessState('blocked_round_locked'); }
      else if (parseInt(params.n) > 1) {
        const { data: p } = await supabase.from('round_participants').select('id').eq('round_id', r.id).eq('competitor_id', competitor.id).maybeSingle();
        setAccessState(p ? 'granted' : 'blocked_qualification');
      } else { setAccessState('granted'); }
      // Load existing solves
      if (competitor) {
        const { data: sol } = await supabase.from('solves').select('*').eq('round_id', r.id).eq('competitor_id', competitor.id).order('solve_number');
        if (sol && sol.length > 0) {
          setAlreadySubmitted(true);
          const tm: Record<number,string>={}; const pm: Record<number,string>={};
          for (const s of sol) { tm[s.solve_number] = s.time_ms!==null ? (s.time_ms/1000).toFixed(2):''; pm[s.solve_number]=s.penalty==='none'?'':s.penalty; }
          setTimes(tm); setPenalties(pm);
        }
      }
    }
    const { data: sc } = await supabase.from('scrambles').select('*').eq('round_id', r.id).order('scramble_number');
    setScrambles(sc ?? []);

    // Load existing video submission if req
    if (comp?.require_verified_solves && user) {
      const { data: videoComp } = await supabase.from('competitors').select('id').eq('competition_id', params.id).eq('user_id', user.id).maybeSingle();
      if (videoComp) {
        const { data: sub } = await supabase.from('round_submissions').select('*').eq('round_id', r.id).eq('competitor_id', videoComp.id).maybeSingle();
        if (sub) {
          setVideoUrl(sub.video_url || '');
          setVideoSubmitted(!!sub.video_url);
        }
      }
    }
    setLoading(false);
  }; run(); }, [params.id, params.event, params.n]);

  const wcaEvent = getEventByKey(params.event);
  // Per-round format: round_format overrides event-level format
  const roundFormat = ((round as any)?.round_format || compEvent?.event_format) as 'average' | 'mean';
  const solveCount = roundFormat === 'mean' ? 3 : 5;

  // Timer auto-fills the next solve
  const handleTimerResult = (timeMs: number, penalty: string) => {
    const solveNum = timesFilledCount + 1;
    if (solveNum > solveCount) return;
    const timeStr = timeMs > 0 ? (timeMs / 1000).toFixed(2) : '';
    setTimes(p => ({ ...p, [solveNum]: timeStr }));
    setPenalties(p => ({ ...p, [solveNum]: penalty || 'none' }));
    toast.success(`${penalty === 'DNF' ? 'DNF' : timeStr}s for solve ${solveNum}`);
  };

  const timesFilledCount = Object.keys(times).length;

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true);
    const solves: {solve_number:number;time_ms:number|null;penalty:string}[] = [];
    for (let i=1;i<=solveCount;i++) {
      const raw = times[i]?.trim(); const p = penalties[i]||'none';
      if (!raw) continue;
      if (raw.toUpperCase()==='DNF') { solves.push({solve_number:i,time_ms:null,penalty:'DNF'}); continue; }
      const s = parseFloat(raw);
      if (isNaN(s)||s<0) { toast.error(`Invalid time for solve ${i}`); setSubmitting(false);submittingRef.current=false; return; }
      solves.push({solve_number:i,time_ms:Math.round(s*1000),penalty:p});
    }
    if (solves.length===0) { toast.error('Enter at least one time'); setSubmitting(false);submittingRef.current=false; return; }

    // Save video URL if required
    if (competition?.require_verified_solves && videoUrl.trim()) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: comp } = await supabase.from('competitors').select('id').eq('competition_id',params.id).eq('user_id',user!.id).single();
      if (comp) {
        await supabase.from('round_submissions').upsert({
          round_id: round.id,
          competitor_id: comp.id,
          video_url: videoUrl.trim(),
          verification_status: 'pending',
        }, { onConflict: 'round_id,competitor_id' });
        setVideoSubmitted(true);
      }
    }

    try {
      const r = await submitTimesAction(round.id, params.id, solves);
      if (!r.success) { toast.error(r.error); return; }
      toast.success('Times submitted!');
      // Refresh
      const {data:{user}} = await supabase.auth.getUser();
      const {data:comp} = await supabase.from('competitors').select('id').eq('competition_id',params.id).eq('user_id',user!.id).single();
      if (comp) {
        const {data:sol} = await supabase.from('solves').select('*').eq('round_id',round.id).eq('competitor_id',comp.id).order('solve_number');
        if (sol) { const tm:Record<number,string>={};const pm:Record<number,string>={};for(const s of sol){tm[s.solve_number]=s.time_ms!==null?(s.time_ms/1000).toFixed(2):'';pm[s.solve_number]=s.penalty==='none'?'':s.penalty;}setTimes(tm);setPenalties(pm);}
      }
    } catch(e:any){ toast.error(e.message||'Failed'); }
    finally { setSubmitting(false); submittingRef.current = false; }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><CubeIcon className="h-8 w-8 text-text-tertiary/30 animate-pulse"/></div>;

  const Blocked = ({icon:Icon,title,desc,color}:{icon:any;title:string;desc:string;color:string})=>(
    <Card className={`mb-6 border-l-4 ${color}`}><CardContent className="flex items-start gap-3 py-4"><Icon className={`h-5 w-5 shrink-0 mt-0.5 ${color.replace('bg-','text-').replace('border-','text-')}`}/><div><p className="font-medium">{title}</p><p className="text-sm text-text-secondary">{desc}</p></div></CardContent></Card>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{competition?.name}</h1>
          <p className="flex items-center gap-2 text-sm text-text-secondary mt-0.5">
            <span>{wcaEvent?.icon}</span> {wcaEvent?.name} — Round {params.n}
            {round && <Badge variant={round.status==='active'?'destructive':round.status==='completed'?'secondary':'outline'}>{round.status}</Badge>}
          </p>
        </div>
        {accessState==='granted'&&round?.status==='active'&&<Button onClick={handleSubmit} disabled={submitting} size="sm" className="gap-2"><Send className="h-4 w-4"/>{submitting?'Saving…':'Submit Times'}</Button>}
      </div>

      {/* Blocked states */}
      {accessState==='blocked_registration'&&<Blocked icon={AlertTriangle} title="Not registered" desc="Register for this competition to view scrambles and submit times." color="border-cube-yellow/50 bg-cube-yellow/5"/>}
      {accessState==='blocked_qualification'&&<Blocked icon={Lock} title="Not qualified" desc="You didn't place high enough in the previous round to qualify." color="border-cube-red/30 bg-cube-red/5"/>}
      {accessState==='blocked_round_locked'&&<Blocked icon={Clock} title="Round not yet open" desc="This round hasn't started. Check back after advancement is calculated." color="border-cube-blue/30 bg-cube-blue/5"/>}

      {/* Scrambles */}
      {accessState==='granted'&&competition?.generate_scrambles!==false&&scrambles.length>0&&(
        <Card className="border-border/30">
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><CubeIcon className="h-4 w-4 text-cube-blue"/>Scrambles</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {scrambles.map(s=><div key={s.id} className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-surface-hover/30 p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-cube-blue/10 text-xs font-bold text-cube-blue">{s.scramble_number}</span><code className="font-mono text-xs leading-relaxed break-all">{s.scramble}</code></div>)}
            </div>
          </CardContent>
        </Card>
      )}
      {/* Times-only mode notice */}
      {accessState==='granted'&&competition?.generate_scrambles===false&&(
        <Card className="border-border/30 border-dashed">
          <CardContent className="flex items-center gap-3 py-4">
            <ShuffleIcon className="h-5 w-5 text-text-tertiary" />
            <div>
              <p className="text-sm font-medium">Times-only mode</p>
              <p className="text-xs text-text-secondary">Scrambles are not generated for this competition. Record your solving times directly below.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Already submitted notice */}
      {accessState==='granted'&&round?.status==='active'&&alreadySubmitted&&(
        <Card className="border-border/30 border-dashed">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle2 className="h-5 w-5 text-cube-green" />
            <div>
              <p className="text-sm font-medium">Times already submitted</p>
              <p className="text-xs text-text-secondary">You&apos;ve already submitted your times for this round. Resubmission is not allowed. Contact an admin if you need corrections.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mode toggle: Timer vs Manual */}
      {accessState==='granted'&&round?.status==='active'&&!alreadySubmitted&&(
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border/30 p-0.5 bg-surface-hover/30">
            <button
              onClick={() => setUseTimer(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                useTimer ? 'bg-surface shadow-sm text-foreground' : 'text-text-secondary hover:text-foreground'
              }`}
            >
              <Timer className="h-3.5 w-3.5" /> Timer
            </button>
            <button
              onClick={() => setUseTimer(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                !useTimer ? 'bg-surface shadow-sm text-foreground' : 'text-text-secondary hover:text-foreground'
              }`}
            >
              <TimerOff className="h-3.5 w-3.5" /> Manual Entry
            </button>
          </div>
        </div>
      )}

      {/* Stackmat Timer */}
      {accessState==='granted'&&round?.status==='active'&&!alreadySubmitted&&useTimer&&(
        <CubeTimer
          solveIndex={timesFilledCount}
          solveCount={solveCount}
          onTimeRecorded={handleTimerResult}
        />
      )}

      {/* Time Entry */}
      {accessState==='granted'&&round?.status==='active'&&!alreadySubmitted&&(
        <Card className="border-border/30">
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Timer className="h-4 w-4 text-cube-green"/>{useTimer ? 'Review & Submit Times' : 'Enter Times'}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({length:solveCount},(_,i)=>i+1).map(sn=><div key={sn} className="flex items-end gap-2"><div className="flex-1 space-y-1"><label className="text-xs font-medium text-text-secondary">Solve {sn}</label><Input type="text" placeholder="12.34 or DNF" value={times[sn]??''} onChange={e=>setTimes(p=>({...p,[sn]:e.target.value}))} className="h-10 font-mono"/></div><div className="w-20"><Select value={penalties[sn]??'none'} onValueChange={v=>setPenalties(p=>({...p,[sn]:v??'none'}))}><SelectTrigger className="h-10"><SelectValue placeholder="—"/></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="+2">+2</SelectItem><SelectItem value="DNF">DNF</SelectItem></SelectContent></Select></div></div>)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Video submission — required for verified solves */}
      {accessState==='granted'&&round?.status==='active'&&competition?.require_verified_solves&&(
        <Card className="border-border/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Video className="h-4 w-4 text-cube-red"/>Video Verification</CardTitle>
            <CardDescription>Upload an unlisted YouTube video showing all {solveCount} solves for this round. Only verified solves qualify for advancement.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Input
                  type="url"
                  placeholder="https://youtu.be/…"
                  value={videoUrl}
                  onChange={e => setVideoUrl(e.target.value)}
                  className="h-10 font-mono"
                />
              </div>
              {videoSubmitted && (
                <Badge variant="secondary" className="gap-1 shrink-0">
                  <CheckCircle2 className="h-3.5 w-3.5 text-cube-green" /> Submitted
                </Badge>
              )}
            </div>
            {videoSubmitted && !videoUrl && (
              <p className="mt-2 text-xs text-text-secondary">Previous video saved. Submit again to update.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Leaderboard */}
      <Card className="border-border/30">
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4 text-cube-yellow"/>Leaderboard</CardTitle></CardHeader>
        <CardContent><RoundLeaderboard roundId={round.id} eventKey={params.event} format={roundFormat} solveCount={solveCount}/></CardContent>
      </Card>
    </div>
  );
}
