'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { calculateResult, formatTime, getAverageExcludedIndices } from '@/lib/wca-events';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CuboidIcon as CubeIcon, Trophy, Medal, Award, Radio, Clock, CheckCircle2, XCircle } from 'lucide-react';

interface Props { roundId:string;eventKey:string;format:'average'|'mean';solveCount:number }

type LeaderboardRow = { competitor_id:string;username:string;display_name:string|null;solves:(number|null)[] };

export function RoundLeaderboard({ roundId,eventKey,format,solveCount }:Props) {
  const [solves,setSolves] = useState<LeaderboardRow[]>([]);
  const [loading,setLoading] = useState(true);
  const [live,setLive] = useState(false);
  const [verificationMap,setVerificationMap] = useState<Map<string,string>|null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const{data}=await supabase.from('solves').select('*,competitor:competitor_id(*,user:user_id(id,username,display_name))').eq('round_id',roundId).order('competitor_id').order('solve_number');
    if(!data){setLoading(false);return}
    const g=new Map<string,(number|null)[]>();const m=new Map<string,{username:string;display_name:string|null}>();
    for(const s of data as any[]){const cId=s.competitor_id;if(!m.has(cId))m.set(cId,{username:s.competitor?.user?.username??'?',display_name:s.competitor?.user?.display_name??null});if(!g.has(cId))g.set(cId,[]);
      const t=s.penalty==='DNF'?null:s.penalty==='+2'&&s.time_ms!==null?s.time_ms+2000:s.penalty==='DNS'?null:s.time_ms;g.get(cId)!.push(t)}
    const rows:LeaderboardRow[]=[];
    for(const[cId,s] of g){rows.push({competitor_id:cId,...m.get(cId)!,solves:s})}
    rows.sort((a,b)=>{const ra=calculateResult(a.solves,format);const rb=calculateResult(b.solves,format);if(ra==='DNF'&&rb==='DNF')return 0;if(ra==='DNF')return 1;if(rb==='DNF')return -1;if(ra===null)return 1;if(rb===null)return -1;return(ra as number)-(rb as number)});
    setSolves(rows);setLoading(false);

    // Fetch verification status
    const{data:subs}=await supabase.from('round_submissions').select('competitor_id,verification_status').eq('round_id',roundId);
    const vm=new Map<string,string>();
    for(const s of(subs??[])){if(s.verification_status!=='none'&&s.verification_status!=='verified'||s.verification_status==='verified')vm.set(s.competitor_id,s.verification_status);}
    setVerificationMap(vm);
  }, [roundId, format]);

  // Initial fetch
  useEffect(() => { fetchData(); }, [fetchData]);

  // Supabase Realtime subscription for live updates
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`leaderboard-${roundId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'solves', filter: `round_id=eq.${roundId}` },
        () => {
          // Debounce rapid-fire changes
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = setTimeout(() => {
            fetchData();
            setLive(true);
          }, 300);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLive(true);
      });

    return () => {
      supabase.removeChannel(channel);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [roundId, fetchData]);

  if(loading)return<div className="flex items-center justify-center py-8"><CubeIcon className="h-6 w-6 text-text-tertiary/30 animate-pulse"/></div>;
  if(solves.length===0)return<div className="flex flex-col items-center gap-2 py-8"><CubeIcon className="h-8 w-8 text-text-tertiary/30"/><p className="text-sm text-text-secondary">No times submitted yet.</p></div>;

  const topColors=['border-cube-yellow/30 bg-cube-yellow/5','border-border bg-surface-hover','border-cube-orange/30 bg-cube-orange/5'];
  const topIcons=[<Trophy key={0} className="h-3 w-3 text-cube-yellow"/>,<Medal key={1} className="h-3 w-3 text-text-secondary"/>,<Award key={2} className="h-3 w-3 text-cube-orange"/>];
  const topLabels=['1st','2nd','3rd'];

  return <div className="overflow-x-auto">
    {live && (
      <div className="mb-3 flex items-center gap-1.5">
        <Badge variant="outline" className="gap-1 border-cube-green/30 text-cube-green text-[10px]">
          <Radio className="h-2.5 w-2.5 animate-pulse" /> Live
        </Badge>
      </div>
    )}
    <Table>
      <TableHeader><TableRow className="hover:bg-transparent border-border/30">
        <TableHead className="w-10 text-xs uppercase tracking-wider text-text-tertiary">#</TableHead>
        <TableHead className="text-xs uppercase tracking-wider text-text-tertiary">Competitor</TableHead>
        {Array.from({length:solveCount},(_,i)=><TableHead key={i} className="text-center text-xs uppercase tracking-wider text-text-tertiary w-16">S{i+1}</TableHead>)}
        <TableHead className="text-right text-xs uppercase tracking-wider text-text-tertiary">Result</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {solves.map((row,idx)=>{
          const r=calculateResult(row.solves,format);
          const excluded = format === 'average' ? getAverageExcludedIndices(row.solves) : new Set<number>();
          return<TableRow key={row.competitor_id} className={`${idx<3?'bg-surface-hover/30 border-border/30':'border-border/30'} transition-colors duration-300`}>
          <TableCell className="font-mono text-sm font-bold">
            {idx<3?<span className={`inline-flex items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs ${topColors[idx]}`}>{topIcons[idx]}{topLabels[idx]}</span>:<span className="text-text-tertiary">{idx+1}</span>}
          </TableCell>
          <TableCell className="font-medium">
            <div className="flex items-center gap-2">
              <span>{row.display_name||row.username}</span>
              {verificationMap?.has(row.competitor_id) && (
                verificationMap.get(row.competitor_id) === 'verified'
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-cube-green shrink-0" aria-label="Verified" />
                  : verificationMap.get(row.competitor_id) === 'rejected'
                    ? <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" aria-label="Rejected" />
                    : <Clock className="h-3.5 w-3.5 text-cube-yellow shrink-0" aria-label="Pending verification" />
              )}
            </div>
          </TableCell>
          {Array.from({length:solveCount},(_,i)=>{
            if (i >= row.solves.length) {
              return <TableCell key={i} className="text-center font-mono text-xs"><span className="text-text-tertiary/30">—</span></TableCell>;
            }
            const solve = row.solves[i];
            const label = formatTime(solve);
            const isDnf = solve === null;
            const isExcluded = excluded.has(i);
            return (
              <TableCell key={i} className="text-center font-mono text-xs">
                <span className={isDnf ? 'text-destructive' : isExcluded ? 'text-text-tertiary' : ''}>
                  {isExcluded ? `(${label})` : label}
                </span>
              </TableCell>
            );
          })}
          <TableCell className="text-right font-mono text-sm font-bold">{r===null?<span className="text-text-tertiary/30">—</span>:r==='DNF'?<span className="text-destructive">DNF</span>:formatTime(r)}</TableCell>
        </TableRow>})}
      </TableBody>
    </Table>
  </div>;
}
