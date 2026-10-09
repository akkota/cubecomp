'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { fetchAllPages } from '@/lib/pagination';
import type { Tournament, TournamentMatch } from '@/types/database';
import { BracketView } from '@/components/tournament/bracket-view';
import { ScrambleCard } from '@/components/competitions/scramble-card';
import {
  generateBracketAction, activateTournamentAction, cancelTournamentAction,
  submitSolveResultAction,
  reSolveAction, ensureActiveMatchPlayableAction, makeMatchLiveAction,
} from '@/actions/tournament';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import {
  ArrowLeft, Play, XCircle,
  Swords, Timer, AlertTriangle
} from 'lucide-react';
import { formatTime } from '@/lib/wca-events';


interface DetailProps {
  competitionId: string;
  tournamentId: string;
}

type FullMatch = TournamentMatch;

interface FullSet {
  id: string;
  match_id: string;
  set_number: number;
  competitor1_solve_wins: number;
  competitor2_solve_wins: number;
  winner_id: string | null;
  status: string;
}

interface FullSolve {
  id: string;
  set_id: string;
  solve_number: number;
  re_solve_attempt: number;
  scramble: string | null;
  competitor1_time_ms: number | null;
  competitor1_penalty: string;
  competitor1_adjusted_ms: number | null;
  competitor2_time_ms: number | null;
  competitor2_penalty: string;
  competitor2_adjusted_ms: number | null;
  winner_id: string | null;
  status: string;
  created_at: string | null;
}

interface FullParticipant {
  id: string;
  display_name_snapshot: string;
  seed: number | null;
  initial_slot: number;
}

export function TournamentDetailView({ competitionId, tournamentId }: DetailProps) {
  const router = useRouter();
  const supabase = createSupabaseClient();
  const [undoing, setUndoing] = useState<string | null>(null);
  const [reSolving, setReSolving] = useState<string | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [participants, setParticipants] = useState<FullParticipant[]>([]);
  const [matches, setMatches] = useState<FullMatch[]>([]);
  const [sets, setSets] = useState<FullSet[]>([]);
  const [solves, setSolves] = useState<FullSolve[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ solveId: null as string | null, c1Time: '', c1Penalty: 'none', c2Time: '', c2Penalty: 'none' });
  const [submitting, setSubmitting] = useState(false);
  const [makingLive, setMakingLive] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const requestNumber = useRef(0);
  const fetchAll = useCallback(async () => {
    const request = ++requestNumber.current;
    const { data: t, error } = await supabase.from('tournaments').select('*').eq('id', tournamentId).eq('competition_id', competitionId).single();
    if (error || !t) throw new Error(error?.message ?? 'Tournament not found');
    const p = await fetchAllPages((from, to) => supabase.from('tournament_participants').select('*')
      .eq('tournament_id', tournamentId).order('initial_slot').order('id').range(from, to));
    const m = await fetchAllPages((from, to) => supabase.from('tournament_matches').select('*')
      .eq('tournament_id', tournamentId).order('bracket_index').order('id').range(from, to));
    const ss: FullSet[] = [];
    const sv: FullSolve[] = [];
    // Bound IN-list URLs as well as response pages for large brackets.
    for (let i = 0; i < m.length; i += 100) {
      ss.push(...await fetchAllPages<FullSet>((from, to) => supabase.from('tournament_match_sets').select('*')
        .in('match_id', m.slice(i, i + 100).map(match => match.id)).order('id').range(from, to)));
    }
    for (let i = 0; i < ss.length; i += 100) {
      sv.push(...await fetchAllPages<FullSolve>((from, to) => supabase.from('tournament_match_solves').select('*')
        .in('set_id', ss.slice(i, i + 100).map(set => set.id)).order('id').range(from, to)));
    }
    const { data: admin, error: adminError } = await supabase.rpc('user_is_tournament_admin', { p_tournament_id: tournamentId });
    if (adminError) throw new Error(adminError.message);
    if (request !== requestNumber.current) return;
    setTournament(t); setParticipants(p); setMatches(m);
    setSets(ss.sort((a, b) => a.set_number - b.set_number));
    setSolves(sv.sort((a, b) => a.solve_number - b.solve_number || a.re_solve_attempt - b.re_solve_attempt));
    setIsAdmin(admin === true); setLoading(false);
  }, [competitionId, tournamentId, supabase]);

  useEffect(() => {
    const refresh = () => void fetchAll().catch(e => setError(e.message)).finally(() => setLoading(false));
    const initial = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 10_000);
    window.addEventListener('focus', refresh);
    const channel = supabase.channel(`tournament-${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${tournamentId}` }, refresh).subscribe();
    return () => { clearTimeout(initial); clearInterval(interval); window.removeEventListener('focus', refresh); void supabase.removeChannel(channel); };
  }, [fetchAll, supabase, tournamentId]);

  const activeMatch = matches.find(m => m.id === selectedMatchId)
    ?? matches.find(m => m.status === 'active' && !m.auto_advance)
    ?? matches.find(m => m.status === 'pending' && !m.auto_advance && m.competitor1_id && m.competitor2_id)
    ?? matches[0] ?? null;
  const matchSets = sets.filter(s => s.match_id === activeMatch?.id);
  const activeSet = matchSets.find(s => s.status === 'active') ?? matchSets.at(-1) ?? null;
  const activeSolve = solves.filter(s => s.set_id === activeSet?.id && ['pending', 'active', 'tied'].includes(s.status))
    .sort((a, b) => b.solve_number - a.solve_number || b.re_solve_attempt - a.re_solve_attempt)[0] ?? null;

  // Bind entered values to their attempt, including changes from another admin.
  const currentDraft = draft.solveId === activeSolve?.id ? draft : { c1Time: '', c1Penalty: 'none', c2Time: '', c2Penalty: 'none' };
  const { c1Time, c1Penalty, c2Time, c2Penalty } = currentDraft;
  const editDraft = (field: 'c1Time' | 'c1Penalty' | 'c2Time' | 'c2Penalty', value: string) => {
    setDraft(previous => ({ ...(previous.solveId === activeSolve?.id ? previous : { c1Time: '', c1Penalty: 'none', c2Time: '', c2Penalty: 'none' }), solveId: activeSolve?.id ?? null, [field]: value }));
  };
  const setC1Time = (value: string) => editDraft('c1Time', value);
  const setC1Penalty = (value: string) => editDraft('c1Penalty', value);
  const setC2Time = (value: string) => editDraft('c2Time', value);
  const setC2Penalty = (value: string) => editDraft('c2Penalty', value);

  // Backfill set/solve for already-started matches that were activated without them
  useEffect(() => {
    if (!isAdmin || tournament?.status !== 'active' || !activeMatch) return;
    if (activeMatch.auto_advance || activeMatch.status !== 'active') return;
    if (activeSet && activeSolve && (tournament.scramble_source === 'external' || activeSolve.scramble)) return;

    let cancelled = false;
    void (async () => {
      const result = await ensureActiveMatchPlayableAction(tournamentId, activeMatch.id);
      if (!cancelled) {
        if (result.success) await fetchAll();
        else setError(result.error);
      }
    })().catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [isAdmin, tournament?.status, tournament?.scramble_source, activeMatch, activeSet, activeSolve, tournamentId, fetchAll]);

  const selectMatch = (match: Pick<FullMatch, 'id'>) => {
    setSelectedMatchId(match.id);
    setC1Time('');
    setC1Penalty('none');
    setC2Time('');
    setC2Penalty('none');
    setError('');
  };

  const handleMakeLive = async () => {
    if (!activeMatch) return;
    setMakingLive(true);
    setError('');
    try {
      const result = await makeMatchLiveAction(tournamentId, activeMatch.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      await fetchAll();
    } finally {
      setMakingLive(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-surface-hover" />;

  const getPName = (id: string | null) => {
    if (!id) return '—';
    return participants.find(p => p.id === id)?.display_name_snapshot ?? 'Unknown';
  };

  const liveMatches = matches.filter(m => m.status === 'active' && !m.auto_advance);
  const canMakeLive =
    isAdmin &&
    tournament?.status === 'active' &&
    activeMatch &&
    activeMatch.status === 'pending' &&
    !activeMatch.auto_advance &&
    !!activeMatch.competitor1_id &&
    !!activeMatch.competitor2_id;

  const activeSolvesInSet = solves.filter(s => s.set_id === activeSet?.id);
  const handleSubmit = async () => {
    if (!activeMatch || !activeSet || !activeSolve) return;
    if (tournament?.scramble_source === 'generated' && !activeSolve.scramble) { setError('Wait for the scramble before entering results'); return; }
    setSubmitting(true);
    setError('');

    const c1Ms = c1Penalty === 'DNF' || c1Penalty === 'DNS' ? null : Math.round(Number(c1Time) * 1000);
    const c2Ms = c2Penalty === 'DNF' || c2Penalty === 'DNS' ? null : Math.round(Number(c2Time) * 1000);

    const result = await submitSolveResultAction(
      tournamentId, activeMatch.id, activeSet.id, activeSolve.id,
      activeSet.set_number, activeSolve.solve_number,
      c1Ms, c1Penalty, c2Ms, c2Penalty,
    );

    if (result.success) {
      setC1Time('');
      setC1Penalty('none');
      setC2Time('');
      setC2Penalty('none');
      await fetchAll();
    } else {
      setError(result.error);
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">{tournament?.name}</h1>
            <div className="flex gap-2 mt-1">
              <Badge variant={tournament?.status === 'active' ? 'destructive' : 'default'}>
                {tournament?.status}
              </Badge>
              <Badge variant="outline">
                {tournament?.tournament_type === 'double' ? 'Double Elim' : 'Single Elim'}
              </Badge>
              <Badge variant="outline">
                {tournament?.match_format === 'bo3' ? 'Bo3' : 'Bo5'}
              </Badge>
            </div>
          </div>
        </div>

        {/* Admin Actions */}
        {isAdmin && (
          <div className="flex gap-2">
            {tournament?.status === 'draft' && matches.length === 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(`/competitions/${competitionId}/tournaments/new?resume=${tournamentId}`)}
                >
                  Continue setup
                </Button>
                <Button size="sm" onClick={async () => {
                  const result = await generateBracketAction(tournamentId);
                  if (!result.success) setError(result.error);
                  await fetchAll();
                }}>
                  <Swords className="h-4 w-4 mr-1" /> Generate Bracket
                </Button>
              </>
            )}
            {tournament?.status === 'ready' && (
              <Button size="sm" onClick={async () => {
                const result = await activateTournamentAction(tournamentId);
                if (!result.success) setError(result.error);
                else await fetchAll();
              }}>
                <Play className="h-4 w-4 mr-1" /> Start Tournament
              </Button>
            )}
            {(tournament?.status === 'ready' || tournament?.status === 'active') && (
              <Button size="sm" variant="outline" onClick={async () => {
                const result = await cancelTournamentAction(tournamentId);
                if (!result.success) setError(result.error);
                else await fetchAll();
              }}>
                <XCircle className="h-4 w-4 mr-1" /> Cancel
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Bracket View */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-muted/30 pb-3">
          <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            Bracket
          </CardTitle>
          {tournament?.status === 'ready' && (
            <p className="text-xs text-muted-foreground">
              Bracket is locked. Registration is closed until you cancel. Start when ready.
            </p>
          )}
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          {tournament?.status === 'active' && isAdmin && (
            <p className="text-xs text-muted-foreground">
              Click a matchup to select it. Multiple matches can be live — use <span className="font-medium text-foreground">Make live</span> on pending ones that have both players.
            </p>
          )}
          <BracketView
            matches={matches}
            participants={participants}
            tournamentType={tournament?.tournament_type ?? 'single'}
            selectedMatchId={selectedMatchId}
            onMatchClick={(m) => selectMatch(m)}
          />
          {liveMatches.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live now</span>
              {liveMatches.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => selectMatch(m)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    selectedMatchId === m.id
                      ? 'border-primary bg-primary/15 text-foreground'
                      : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {getPName(m.competitor1_id)} vs {getPName(m.competitor2_id)}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scoreboard / Result Entry */}
      {tournament?.status === 'active' &&
        activeMatch &&
        !activeMatch.auto_advance &&
        activeMatch.competitor1_id &&
        activeMatch.competitor2_id && (
        <Card className="border-primary/30 overflow-hidden">
          <CardHeader className="border-b border-border bg-muted/20 px-4 py-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-semibold">
                <Timer className="h-4 w-4 text-primary" />
                {getPName(activeMatch.competitor1_id)}
                <span className="text-muted-foreground font-normal">vs</span>
                {getPName(activeMatch.competitor2_id)}
              </span>
              <Badge variant="outline" className="font-normal">
                {activeMatch.status === 'active' && activeSet && activeSolve
                  ? `Set ${activeSet.set_number} · Solve ${activeSolve.solve_number}${activeSolve.re_solve_attempt > 0 ? ` r${activeSolve.re_solve_attempt}` : ''}`
                  : activeMatch.status === 'active'
                    ? 'Live'
                    : activeMatch.status === 'completed'
                      ? 'Completed'
                      : 'Pending'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {(!activeSet || !activeSolve) && activeMatch.status === 'active' ? (
              <p className="text-sm text-muted-foreground">
                Setting up the first set and scramble…
              </p>
            ) : canMakeLive ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground max-w-md">
                  This matchup is ready but not live yet. Make it live to enter times — other live matches stay active.
                </p>
                <Button onClick={handleMakeLive} disabled={makingLive} className="gap-2">
                  <Play className="h-4 w-4" />
                  {makingLive ? 'Starting…' : 'Make live'}
                </Button>
              </div>
            ) : activeMatch.status === 'pending' ? (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-center text-sm text-muted-foreground">
                {!activeMatch.competitor1_id || !activeMatch.competitor2_id
                  ? 'Waiting for both competitors to advance into this match.'
                  : 'Select Make live when you are ready to run this match.'}
              </p>
            ) : activeMatch.status === 'completed' ? (
              <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-center text-sm text-muted-foreground">
                This match is completed.
              </p>
            ) : activeMatch.status === 'active' && activeSet && activeSolve ? (
              <>
            {activeSolve.scramble ? (
              <ScrambleCard
                eventKey={tournament.event_key ?? '333'}
                scramble={activeSolve.scramble}
              />
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-1.5 text-center text-xs text-muted-foreground">
                {tournament.scramble_source === 'generated' ? 'Preparing the next scramble…' : 'Use your external scramble, then enter times for both competitors.'}
              </div>
            )}

            {/* Dominant scoreboard */}
            <div className="rounded-xl border border-border bg-surface px-4 py-4">
              <div className="flex items-center justify-center gap-4 sm:gap-8">
                <div className="min-w-[4.5rem] text-center">
                  <div className="text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
                    {activeSet.competitor1_solve_wins}
                  </div>
                  <div className="mt-1 truncate text-xs font-medium text-muted-foreground">
                    {getPName(activeMatch.competitor1_id)}
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-2xl font-light text-muted-foreground">–</span>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Solves
                  </span>
                </div>
                <div className="min-w-[4.5rem] text-center">
                  <div className="text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
                    {activeSet.competitor2_solve_wins}
                  </div>
                  <div className="mt-1 truncate text-xs font-medium text-muted-foreground">
                    {getPName(activeMatch.competitor2_id)}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-center gap-2 border-t border-border pt-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sets</span>
                <span className="text-xl font-bold tabular-nums">
                  {activeMatch.competitor1_sets_won}
                  <span className="mx-1 font-light text-muted-foreground">–</span>
                  {activeMatch.competitor2_sets_won}
                </span>
              </div>
            </div>

            {isAdmin ? (
              <>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <CompetitorResultCard
                name={getPName(activeMatch.competitor1_id)}
                time={c1Time}
                onTimeChange={setC1Time}
                penalty={c1Penalty}
                onPenaltyChange={setC1Penalty}
                disabled={submitting}
              />
              <CompetitorResultCard
                name={getPName(activeMatch.competitor2_id)}
                time={c2Time}
                onTimeChange={setC2Time}
                penalty={c2Penalty}
                onPenaltyChange={setC2Penalty}
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <Button
              className="w-full disabled:border disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
              onClick={handleSubmit}
              disabled={
                submitting || (tournament.scramble_source === 'generated' && !activeSolve.scramble) ||
                ((c1Penalty === 'none' || c1Penalty === '+2') && !c1Time.trim()) ||
                ((c2Penalty === 'none' || c2Penalty === '+2') && !c2Time.trim())
              }
            >
              {submitting ? 'Submitting…' : 'Submit Result'}
            </Button>
              </>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-center text-sm text-muted-foreground">
                Waiting for an organizer to enter results.
              </p>
            )}

            {activeSolvesInSet.filter(s => s.status === 'completed' || s.status === 'tied').length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Previous solves</div>
                {activeSolvesInSet
                  .filter(s => s.status === 'completed' || s.status === 'tied')
                  .sort((a, b) => b.created_at?.localeCompare(a.created_at ?? '') ?? 0)
                  .slice(0, 5)
                  .map(s => (
                    <div key={s.id} className="flex items-center justify-between gap-1 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                      <span className="text-muted-foreground">#{s.solve_number}{s.re_solve_attempt > 0 ? `r${s.re_solve_attempt}` : ''}</span>
                      <span className={s.winner_id === activeMatch.competitor1_id ? 'font-medium text-cube-green' : 'text-muted-foreground'}>
                        {s.competitor1_time_ms !== null ? formatTime(s.competitor1_time_ms) : s.competitor1_penalty}
                        {s.competitor1_penalty === '+2' ? '+2' : ''}
                      </span>
                      <span className="text-muted-foreground">vs</span>
                      <span className={s.winner_id === activeMatch.competitor2_id ? 'font-medium text-cube-green' : 'text-muted-foreground'}>
                        {s.competitor2_time_ms !== null ? formatTime(s.competitor2_time_ms) : s.competitor2_penalty}
                        {s.competitor2_penalty === '+2' ? '+2' : ''}
                      </span>
                      <Badge variant={s.status === 'tied' ? 'outline' : 'secondary'} className="text-[10px]">
                        {s.status === 'tied' ? 'Tied' : 'Done'}
                      </Badge>
                      {s.status === 'tied' && isAdmin && (
                        <button
                          className="shrink-0 rounded bg-cube-blue/20 px-1.5 py-0.5 text-[10px] text-cube-blue hover:bg-cube-blue/30 disabled:opacity-50"
                          disabled={reSolving === s.id}
                          onClick={async () => {
                            setReSolving(s.id);
                            try {
                              const result = await reSolveAction(tournamentId, s.id);
                              if (result.success) { await fetchAll(); } else { setError(result.error); }
                            } catch { setError('Failed to re-solve'); }
                            setReSolving(null);
                          }}
                        >{reSolving === s.id ? '...' : 'Re-solve'}</button>
                      )}
                      {s.status === 'completed' && isAdmin && activeSolvesInSet.filter(x => x.status === 'completed' && x.created_at && s.created_at && x.created_at > s.created_at).length === 0 && (
                        <button
                          className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/30 disabled:opacity-50"
                          disabled={undoing === s.id}
                          onClick={async () => {
                            if (!confirm('Undo this solve? Set/match progression will be reverted.')) return;
                            setUndoing(s.id);
                            try {
                              const { error: rpcErr } = await supabase.rpc('undo_tournament_solve', {
                                p_tournament_id: tournamentId, p_solve_id: s.id,
                              });
                              if (rpcErr) { setError(rpcErr.message); } else { await fetchAll(); }
                            } catch { setError('Failed to undo'); }
                            setUndoing(null);
                          }}
                        >{undoing === s.id ? '...' : 'Undo'}</button>
                      )}
                    </div>
                  ))}
              </div>
            )}
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const PENALTIES = [
  { value: 'none', label: 'OK' },
  { value: '+2', label: '+2' },
  { value: 'DNF', label: 'DNF' },
  { value: 'DNS', label: 'DNS' },
] as const;

function CompetitorResultCard({
  name,
  time,
  onTimeChange,
  penalty,
  onPenaltyChange,
  disabled,
}: {
  name: string;
  time: string;
  onTimeChange: (v: string) => void;
  penalty: string;
  onPenaltyChange: (v: string) => void;
  disabled?: boolean;
}) {
  const timeDisabled = disabled || penalty === 'DNF' || penalty === 'DNS';

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2.5">
      <div className="truncate text-sm font-semibold">{name}</div>
      <Input
        type="text"
        inputMode="decimal"
        placeholder={timeDisabled ? penalty : '12.43'}
        value={timeDisabled ? '' : time}
        onChange={e => onTimeChange(e.target.value)}
        disabled={timeDisabled}
        className="h-10 text-center font-mono text-base tabular-nums disabled:border-border disabled:bg-muted/60 disabled:text-muted-foreground disabled:opacity-100"
      />
      <div className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-surface p-0.5">
        {PENALTIES.map(p => {
          const selected = penalty === p.value;
          return (
            <button
              key={p.value}
              type="button"
              disabled={disabled}
              onClick={() => {
                onPenaltyChange(p.value);
                if (p.value === 'DNF' || p.value === 'DNS') onTimeChange('');
              }}
              className={`rounded-md px-1 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? p.value === 'DNF' || p.value === 'DNS'
                    ? 'bg-destructive/20 text-destructive'
                    : p.value === '+2'
                      ? 'bg-cube-orange/20 text-cube-orange'
                      : 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
