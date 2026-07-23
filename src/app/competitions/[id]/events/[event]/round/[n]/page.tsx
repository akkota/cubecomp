'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { getEventByKey } from '@/lib/wca-events';
import { RoundLeaderboard } from '@/components/competitions/leaderboard';
import {
  CubeTimer,
  type TimerResult,
  type TimerState,
} from '@/components/competitions/cube-timer';
import { submitTimesAction } from '@/actions/submitTimes';
import {
  buildSolveInputs,
  formatAttemptValue,
  isAttemptValid,
  nextSolveIndex,
  type AttemptDrafts,
  type SolvePenalty,
} from '@/lib/solve-results';
import { toast } from 'sonner';
import { Clock, Lock, Send, AlertTriangle, CuboidIcon as CubeIcon, Trophy, Timer, ShuffleIcon, Video, CheckCircle2, TimerOff, type LucideIcon } from 'lucide-react';

type ScrambleEntry = { id: string; scramble_number: number; scramble: string };
type AccessState = 'loading' | 'granted' | 'blocked_registration' | 'blocked_qualification' | 'blocked_round_locked';
type CompetitionEventData = { id: string; event_format: 'average' | 'mean' };
type RoundData = {
  id: string;
  status: 'pending' | 'active' | 'completed';
  round_format: 'average' | 'mean' | null;
};
type CompetitionData = {
  name: string;
  created_by: string;
  allow_spectators: boolean;
  generate_scrambles: boolean;
  require_verified_solves: boolean;
};

function BlockedNotice({ icon: Icon, title, desc, color }: {
  icon: LucideIcon;
  title: string;
  desc: string;
  color: string;
}) {
  return (
    <Card className={`mb-6 border-l-4 ${color}`}>
      <CardContent className="flex items-start gap-3 py-4">
        <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${color.replace('bg-', 'text-').replace('border-', 'text-')}`} />
        <div><p className="font-medium">{title}</p><p className="text-sm text-text-secondary">{desc}</p></div>
      </CardContent>
    </Card>
  );
}

export default function RoundPage() {
  const params = useParams<{ id: string; event: string; n: string }>();
  const [compEvent, setCompEvent] = useState<CompetitionEventData | null>(null);
  const [round, setRound] = useState<RoundData | null>(null);
  const [competition, setCompetition] = useState<CompetitionData | null>(null);
  const [scrambles, setScrambles] = useState<ScrambleEntry[]>([]);
  const [attempts, setAttempts] = useState<AttemptDrafts>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accessState, setAccessState] = useState<AccessState>('loading');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoSubmitted, setVideoSubmitted] = useState(false);
  const [useTimer, setUseTimer] = useState(true);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const attemptsRef = useRef<AttemptDrafts>({});
  const submittingRef = useRef(false);
  const supabase = useMemo(() => createClient(), []);

  const replaceAttempts = useCallback((next: AttemptDrafts) => {
    attemptsRef.current = next;
    setAttempts(next);
  }, []);

  const updateAttempts = useCallback((update: (current: AttemptDrafts) => AttemptDrafts) => {
    const next = update(attemptsRef.current);
    replaceAttempts(next);
  }, [replaceAttempts]);

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
    let competitorId: string | null = null;
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
      if (competitor) competitorId = competitor.id;
    }

    // Also fetch competitor for owner (who may also be registered)
    if (!competitorId && user && user.id === comp?.created_by) {
      const { data: ownerComp } = await supabase.from('competitors').select('id').eq('competition_id', params.id).eq('user_id', user.id).maybeSingle();
      if (ownerComp) competitorId = ownerComp.id;
    }

    // Load existing solves (for ALL users including owner)
    if (competitorId) {
      const { data: sol } = await supabase.from('solves').select('*').eq('round_id', r.id).eq('competitor_id', competitorId).order('solve_number');
      if (sol && sol.length > 0) {
        setAlreadySubmitted(true);
        const loadedAttempts: AttemptDrafts = {};
        for (const s of sol) {
          const penalty = s.penalty as SolvePenalty;
          loadedAttempts[s.solve_number] = {
            value: formatAttemptValue(s.time_ms, penalty),
            penalty,
            ...(s.time_ms !== null ? { timeMs: s.time_ms } : {}),
          };
        }
        replaceAttempts(loadedAttempts);
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
  }; run(); }, [params.id, params.event, params.n, replaceAttempts, supabase]);

  const wcaEvent = getEventByKey(params.event);
  // Per-round format: round_format overrides event-level format
  const roundFormat = round?.round_format || compEvent?.event_format || 'average';
  const solveCount = roundFormat === 'mean' ? 3 : 5;

  const timerSolveIndex = nextSolveIndex(attempts, solveCount);
  const validation = buildSolveInputs(attempts, solveCount);
  const timerBusy = useTimer && (timerState === 'inspection' || timerState === 'running');
  const canSubmit = validation.success && !timerBusy && !submitting && !alreadySubmitted;

  const handleTimerResult = useCallback((result: TimerResult): boolean => {
    const expectedSolveNumber = nextSolveIndex(attemptsRef.current, solveCount) + 1;
    if (
      result.solveNumber !== expectedSolveNumber
      || result.solveNumber > solveCount
      || (result.penalty !== 'DNF' && result.timeMs <= 0)
      || isAttemptValid(attemptsRef.current[result.solveNumber])
    ) {
      return false;
    }

    updateAttempts(current => ({
      ...current,
      [result.solveNumber]: {
        value: formatAttemptValue(
          result.penalty === 'DNF' ? null : result.timeMs,
          result.penalty,
        ),
        penalty: result.penalty,
        // Always keep the raw timer time; +2 is applied at display/scoring time.
        ...(result.penalty === 'DNF' ? {} : { timeMs: result.timeMs }),
      },
    }));
    const label = result.penalty === 'DNF'
      ? 'DNF'
      : result.penalty === '+2'
        ? `${formatAttemptValue(result.timeMs, '+2')}+`
        : `${formatAttemptValue(result.timeMs, 'none')}s`;
    toast.success(`${label} for solve ${result.solveNumber}`);
    return true;
  }, [solveCount, updateAttempts]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || alreadySubmitted || timerBusy) return;
    const activeRound = round;
    if (!activeRound) {
      setSubmitError('Round not found');
      return;
    }

    const currentValidation = buildSolveInputs(attemptsRef.current, solveCount);
    if (!currentValidation.success) {
      setSubmitError(currentValidation.error);
      toast.error(currentValidation.error);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    try {
      // Save video URL if required
      if (competition?.require_verified_solves && videoUrl.trim()) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');
        const { data: comp } = await supabase.from('competitors').select('id').eq('competition_id',params.id).eq('user_id',user.id).single();
        if (comp) {
          const { error: videoError } = await supabase.from('round_submissions').upsert({
            round_id: activeRound.id,
            competitor_id: comp.id,
            video_url: videoUrl.trim(),
            verification_status: 'pending',
          }, { onConflict: 'round_id,competitor_id' });
          if (videoError) throw new Error(`Failed to save video: ${videoError.message}`);
          setVideoSubmitted(true);
        }
      }

      const result = await submitTimesAction(activeRound.id, params.id, currentValidation.solves);
      if (!result.success) {
        setSubmitError(result.error);
        toast.error(result.error);
        return;
      }

      const submittedAttempts: AttemptDrafts = {};
      for (const solve of result.solves) {
        submittedAttempts[solve.solve_number] = {
          value: formatAttemptValue(solve.time_ms, solve.penalty),
          penalty: solve.penalty,
          ...(solve.time_ms !== null ? { timeMs: solve.time_ms } : {}),
        };
      }
      replaceAttempts(submittedAttempts);
      toast.success('Times submitted!');
      setAlreadySubmitted(true);
      setTimerState('idle');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit times';
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><CubeIcon className="h-8 w-8 text-text-tertiary/30 animate-pulse"/></div>;
  if (!round) return <div className="py-20 text-center text-sm text-destructive">Round not found.</div>;

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
        {accessState==='granted'&&round?.status==='active'&&(
          <Button
            type="submit"
            form="round-results-form"
            disabled={!canSubmit}
            size="sm"
            className="gap-2"
          >
            {alreadySubmitted ? <CheckCircle2 className="h-4 w-4 text-cube-green"/> : <Send className="h-4 w-4"/>}
            {alreadySubmitted ? 'Submitted' : submitting ? 'Saving…' : 'Submit Times'}
          </Button>
        )}
      </div>

      {/* Blocked states */}
      {accessState==='blocked_registration'&&<BlockedNotice icon={AlertTriangle} title="Not registered" desc="Register for this competition to view scrambles and submit times." color="border-cube-yellow/50 bg-cube-yellow/5"/>}
      {accessState==='blocked_qualification'&&<BlockedNotice icon={Lock} title="Not qualified" desc="You didn't place high enough in the previous round to qualify." color="border-cube-red/30 bg-cube-red/5"/>}
      {accessState==='blocked_round_locked'&&<BlockedNotice icon={Clock} title="Round not yet open" desc="This round hasn't started. Check back after advancement is calculated." color="border-cube-blue/30 bg-cube-blue/5"/>}

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

      <form id="round-results-form" onSubmit={handleSubmit} className="space-y-6">
        {submitError && !alreadySubmitted && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {submitError}
          </div>
        )}

        {/* Mode toggle: Timer vs Manual */}
        {accessState==='granted'&&round?.status==='active'&&!alreadySubmitted&&(
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border/30 p-0.5 bg-surface-hover/30">
              <button
                type="button"
                onClick={() => {
                  setUseTimer(true);
                  setTimerState('idle');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  useTimer ? 'bg-surface shadow-sm text-foreground' : 'text-text-secondary hover:text-foreground'
                }`}
              >
                <Timer className="h-3.5 w-3.5" /> Timer
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseTimer(false);
                  setTimerState('idle');
                }}
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
            solveIndex={timerSolveIndex}
            solveCount={solveCount}
            onTimeRecorded={handleTimerResult}
            onStateChange={setTimerState}
          />
        )}

        {/* Time Entry */}
        {accessState==='granted'&&round?.status==='active'&&(
          <Card className={alreadySubmitted ? 'border-cube-green/30 bg-cube-green/5' : 'border-border/30'}>
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Timer className="h-4 w-4 text-cube-green"/>{alreadySubmitted ? 'Submitted Times' : useTimer ? 'Review & Submit Times' : 'Enter Times'}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({length:solveCount},(_,i)=>i+1).map(sn => (
                  <div key={sn} className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs font-medium text-text-secondary">Solve {sn}</label>
                      <Input
                        type="text"
                        placeholder="12.34 or DNF"
                        value={attempts[sn]?.value ?? ''}
                        disabled={alreadySubmitted}
                        onChange={event => updateAttempts(current => {
                          const penalty = current[sn]?.penalty ?? 'none';
                          const value = event.target.value;
                          const seconds = Number(value.trim());
                          // Timer-filled +2 shows the adjusted time; keep raw ms in sync.
                          if (
                            penalty === '+2'
                            && current[sn]?.timeMs !== undefined
                            && Number.isFinite(seconds)
                            && seconds > 0
                          ) {
                            return {
                              ...current,
                              [sn]: {
                                value,
                                penalty,
                                timeMs: Math.max(1, Math.round(seconds * 1000) - 2000),
                              },
                            };
                          }
                          return {
                            ...current,
                            [sn]: {
                              value,
                              penalty,
                              ...(Number.isFinite(seconds) && seconds > 0
                                ? { timeMs: Math.round(seconds * 1000) }
                                : {}),
                            },
                          };
                        })}
                        className={`h-10 font-mono ${alreadySubmitted ? 'border-cube-green/30 bg-cube-green/5' : ''}`}
                      />
                    </div>
                    <div className="w-20">
                      <Select
                        value={attempts[sn]?.penalty ?? 'none'}
                        disabled={alreadySubmitted}
                        onValueChange={value => updateAttempts(current => {
                          const penalty = (value ?? 'none') as SolvePenalty;
                          const prev = current[sn];
                          const rawMs = prev?.timeMs ?? (
                            prev?.value && Number.isFinite(Number(prev.value)) && Number(prev.value) > 0
                              ? Math.round(Number(prev.value) * 1000)
                              : null
                          );
                          // If leaving +2 and the field still shows the adjusted time without raw ms,
                          // prefer existing timeMs when present.
                          return {
                            ...current,
                            [sn]: {
                              value: formatAttemptValue(rawMs, penalty),
                              penalty,
                              ...(rawMs !== null && penalty !== 'DNF' ? { timeMs: rawMs } : {}),
                            },
                          };
                        })}
                      >
                        <SelectTrigger className={`h-10 ${alreadySubmitted ? 'border-cube-green/30 bg-cube-green/5' : ''}`}><SelectValue placeholder="—"/></SelectTrigger>
                        <SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="+2">+2</SelectItem><SelectItem value="DNF">DNF</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      {/* Video submission — required for verified solves */}
      {accessState==='granted'&&round?.status==='active'&&!alreadySubmitted&&competition?.require_verified_solves&&(
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
      </form>

      {/* Leaderboard */}
      <Card className="border-border/30">
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4 text-cube-yellow"/>Leaderboard</CardTitle></CardHeader>
        <CardContent><RoundLeaderboard roundId={round.id} eventKey={params.event} format={roundFormat} solveCount={solveCount}/></CardContent>
      </Card>
    </div>
  );
}
