'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { WCA_EVENTS } from '@/lib/wca-events';
import { generateScramblesAction } from '@/actions/generateScrambles';
import { calculateAdvancementAction } from '@/actions/calculateAdvancement';
import { toast } from 'sonner';
import { ArrowUp, Play, Square, ShuffleIcon, Users, Trophy, CheckCircle2, CuboidIcon as CubeIcon, Shield } from 'lucide-react';

const V: Record<string,'default'|'destructive'|'secondary'|'outline'>={upcoming:'default',ongoing:'destructive',completed:'secondary',cancelled:'outline'};

export default function CompetitionAdminPage() {
  const { id } = useParams<{ id: string }>();
  const [competition,setCompetition] = useState<any>(null);
  const [events,setEvents] = useState<any[]>([]);
  const [allRounds,setAllRounds] = useState<any[]>([]);
  const [scrambles,setScrambles] = useState<Record<string,any[]>>({});
  const [isOwner,setIsOwner] = useState(false);
  const [isRegistered,setIsRegistered] = useState(false);
  const [loading,setLoading] = useState(true);
  const [generating,setGenerating] = useState<Record<string,boolean>>({});
  const [calculating,setCalculating] = useState<Record<string,boolean>>({});
  const [startingRound,setStartingRound] = useState<string|null>(null);
  const [endingRound,setEndingRound] = useState<string|null>(null);
  const [registering,setRegistering] = useState(false);
  const genRef = useRef<Set<string>>(new Set());
  const startRef = useRef<string|null>(null);
  const endRef = useRef<string|null>(null);
  const regRef = useRef(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(()=>{const f=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user){router.push('/login');return}
    const{data:comp}=await supabase.from('competitions').select('*').eq('id',id).single();
    if(!comp||comp.created_by!==user.id){toast.error('Not authorized');router.push('/');return}
    setCompetition(comp);setIsOwner(true);
    const{data:reg}=await supabase.from('competitors').select('id').eq('competition_id',id).eq('user_id',user.id).maybeSingle();
    setIsRegistered(!!reg);
    const{data:ce}=await supabase.from('competition_events').select('*').eq('competition_id',id).order('event_key');
    setEvents(ce??[]);
    if(ce){const eids=ce.map(e=>e.id);const{data:rds}=await supabase.from('rounds').select('*').in('competition_event_id',eids).order('round_number');setAllRounds(rds??[]);
    const rids=(rds??[]).map(r=>r.id);
    if(rids.length>0){const{data:s}=await supabase.from('scrambles').select('*').in('round_id',rids).order('scramble_number');
    const g:Record<string,any[]>={};for(const sc of(s??[])){if(!g[sc.round_id])g[sc.round_id]=[];g[sc.round_id].push(sc)}setScrambles(g);}
    }
    setLoading(false);
  };f();},[id]);

  const grf = (eid:string)=>allRounds.filter(r=>r.competition_event_id===eid);
  const we = (k:string)=>WCA_EVENTS.find(e=>e.key===k);

  const hgs = async (r:any,ek:string,sc:number)=>{if(genRef.current.has(r.id))return;genRef.current.add(r.id);setGenerating(p=>({...p,[r.id]:true}));
  try{await Promise.race([generateScramblesAction(r.id,ek,sc),new Promise<never>((_,rj)=>setTimeout(()=>rj(new Error('Timed out')),25000))]);
  const{data:f}=await supabase.from('scrambles').select('*').eq('round_id',r.id).order('scramble_number');setScrambles(p=>({...p,[r.id]:f??[]}));toast.success(`Scrambles generated`)}
  catch(e:any){toast.error(e.message)}finally{setGenerating(p=>({...p,[r.id]:false}));genRef.current.delete(r.id)}};

  const hsr = async (rid:string)=>{if(startRef.current)return;startRef.current=rid;setStartingRound(rid);
  const{error}=await supabase.from('rounds').update({status:'active',started_at:new Date().toISOString()}).eq('id',rid);
  if(error){toast.error(error.message)}else{toast.success('Round started!');setAllRounds(p=>p.map(r=>r.id===rid?{...r,status:'active',started_at:new Date().toISOString()}:r))}
  setStartingRound(null);startRef.current=null};

  const her = async (rid:string)=>{if(endRef.current)return;endRef.current=rid;setEndingRound(rid);
  const{error}=await supabase.from('rounds').update({status:'completed',ended_at:new Date().toISOString()}).eq('id',rid);
  if(error){toast.error(error.message)}else{toast.success('Round ended!');setAllRounds(p=>p.map(r=>r.id===rid?{...r,status:'completed',ended_at:new Date().toISOString()}:r))}
  setEndingRound(null);endRef.current=null};

  const hca = async (r:any)=>{setCalculating(p=>({...p,[r.id]:true}));
  try{const res=await calculateAdvancementAction(r.id);
  if(!res.success)toast.error(res.error);else if(res.alreadyCalculated)toast.success(`Already calculated — ${res.advanced} advanced`);else if(res.advanced===0)toast.warning(`No one advanced`);else toast.success(`${res.advanced} of ${res.total} advanced`)}
  catch(e:any){toast.error(e.message)}finally{setCalculating(p=>({...p,[r.id]:false}))}};

  const hrc=async()=>{if(regRef.current)return;regRef.current=true;setRegistering(true);const{data:{user}}=await supabase.auth.getUser();if(!user){toast.error('Login required');regRef.current=false;setRegistering(false);return}
  const{error}=await supabase.from('competitors').insert({competition_id:id,user_id:user.id});
  if(error){if(error.code==='23505')toast.success('Already registered!');else toast.error(error.message)}else{toast.success('Registered as competitor!');setIsRegistered(true)}
  setRegistering(false);regRef.current=false};

  if(loading)return<div className="flex items-center justify-center py-20"><CubeIcon className="h-8 w-8 text-text-tertiary/30 animate-pulse"/></div>;
  if(!competition)return<div className="text-center py-20 text-text-secondary">Not found.</div>;

  return <div className="space-y-8">
    <div className="rounded-xl border border-border/30 bg-surface p-6 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-cube-orange/10 p-2"><Shield className="h-5 w-5 text-cube-orange"/></div>
          <div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{competition.name}</h1><p className="text-sm text-text-secondary">Manage rounds, scrambles, and cutoffs</p></div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline">{competition.status}</Badge>
          {isRegistered?<Badge variant="secondary" className="gap-1.5"><CheckCircle2 className="h-3 w-3 text-cube-green"/>Competing</Badge>:<Button variant="outline" size="sm" onClick={hrc} disabled={registering} className="gap-2"><Trophy className="h-4 w-4"/>{registering?'…':'Compete as Competitor'}</Button>}
        </div>
      </div>
    </div>

    <div className="grid gap-6">
      {events.map(ce=>{const ei=we(ce.event_key);const ers=grf(ce.id);const sc=ei?.solveCount??5;
      return<Card key={ce.id} className="border-border/30 overflow-hidden">
        <CardHeader className="border-b border-border/30 bg-surface-hover/20 pb-3"><CardTitle className="text-lg flex items-center gap-2">{ei?.icon} {ei?.name}<Badge variant="outline" className="ml-auto text-xs">{ce.round_count} rounds</Badge></CardTitle></CardHeader>
        <CardContent className="p-0 divide-y divide-border/30">
          {ers.map(r=>{const rs=scrambles[r.id]||[];const hs=rs.length>0;const hnr=r.round_number<ce.round_count;
          return<div key={r.id} className="px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3"><h3 className="font-semibold">Round {r.round_number}</h3><Badge variant={V[r.status]??'outline'}>{r.status}</Badge></div>
              <div className="flex flex-wrap items-center gap-2">
                {r.status==='pending'&&<>
                  <Button variant="outline" size="sm" disabled={generating[r.id]||hs} onClick={()=>hgs(r,ce.event_key,sc)} className="gap-1.5"><ShuffleIcon className="h-3.5 w-3.5"/>{generating[r.id]?'Generating…':hs?'Has Scrambles':'Generate Scrambles'}</Button>
                  {hs&&<Button variant="default" size="sm" disabled={!!startingRound} onClick={()=>hsr(r.id)} className="gap-1.5"><Play className="h-3.5 w-3.5"/>{startingRound===r.id?'Starting…':'Start'}</Button>}
                </>}
                {r.status==='active'&&<Button variant="destructive" size="sm" disabled={!!endingRound} onClick={()=>her(r.id)} className="gap-1.5"><Square className="h-3.5 w-3.5"/>{endingRound===r.id?'Ending…':'End Round'}</Button>}
                {r.status==='completed'&&hnr&&<Button variant="default" size="sm" disabled={calculating[r.id]} onClick={()=>hca(r)} className="gap-1.5"><ArrowUp className="h-3.5 w-3.5"/>{calculating[r.id]?'Calculating…':'Calculate Advancement'}</Button>}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {r.round_number<ce.round_count&&<div className="flex items-center gap-2 text-sm"><Users className="h-4 w-4 text-text-tertiary"/><span className="text-text-secondary">Advance top:</span><Input type="number" className="w-20 h-8" min={1} value={r.advance_count??''} onChange={e=>supabase.from('rounds').update({advance_count:parseInt(e.target.value||'0')}).eq('id',r.id).then(()=>setAllRounds(p=>p.map(x=>x.id===r.id?{...x,advance_count:parseInt(e.target.value||'0')}:x)))}/><span className="text-xs text-text-tertiary">to round {r.round_number+1}</span></div>}
              {hs&&<div className="flex flex-wrap gap-1.5">{rs.map(s=><span key={s.id} className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-2 py-1 text-xs font-mono"><span className="font-bold text-cube-blue">{s.scramble_number}</span>{s.scramble}</span>)}</div>}
            </div>
          </div>})}
        </CardContent>
      </Card>})}
    </div>
  </div>;
}
