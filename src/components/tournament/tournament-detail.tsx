'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { BracketView } from '@/components/tournament/bracket-view';
import {
  generateBracketAction, activateTournamentAction, cancelTournamentAction,
  submitSolveResultAction, adminResolveTieAction,
} from '@/actions/tournament';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import {
  ArrowLeft, Play, XCircle, CheckCircle2, Trophy, RotateCcw,
  Swords, Timer, AlertTriangle
} from 'lucide-react';
import { formatTime } from '@/lib/wca-events';
import { effectiveTimeMs } from '@/lib/solve-results';

interface DetailProps {
  competitionId: string;
  tournamentId: string;
}

interface FullMatch {
  id: string;
  bracket_type: string;
  bracket_round: number;
  match_number: number;
  competitor1_id: string | null;
  competitor2_id: string | null;
  competitor1_sets_won: number;
  competitor2_sets_won: number;
  winner_id: string | null;
  status: string;
  auto_advance: boolean;
  next_match_id: string | null;
  loser_next_match_id: string | null;
}

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
  const [tournament, setTournament] = useState<any>(null);
  const [participants, setParticipants] = useState<FullParticipant[]>([]);
  const [matches, setMatches] = useState<FullMatch[]>([]);
  const [sets, setSets] = useState<FullSet[]>([]);
  const [solves, setSolves] = useState<FullSolve[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeMatch, setActiveMatch] = useState<FullMatch | null>(null);
  const [activeSet, setActiveSet] = useState<FullSet | null>(null);
  const [activeSolve, setActiveSolve] = useState<FullSolve | null>(null);
  const [c1Time, setC1Time] = useState('');
  const [c1Penalty, setC1Penalty] = useState('none');
  const [c2Time, setC2Time] = useState('');
  const [c2Penalty, setC2Penalty] = useState('none');
  const [submitting, setSubmitting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchAll = useCallback(async () => {
    const { data: t } = await supabase.from('tournaments').select('*').eq('id', tournamentId).single();
    if (!t) { setLoading(false); return; }
    setTournament(t);

    const { data: p } = await supabase.from('tournament_participants').select('*')
      .eq('tournament_id', tournamentId).order('initial_slot');
    setParticipants(p ?? []);

    const { data: m } = await supabase.from('tournament_matches').select('*')
      .eq('tournament_id', tournamentId).order('bracket_index');
    setMatches(m ?? []);

    const mids = (m ?? []).map(mm => mm.id);
    if (mids.length > 0) {
      const { data: ss } = await supabase.from('tournament_match_sets').select('*')
        .in('match_id', mids).order('set_number');
      setSets(ss ?? []);

      const sids = (ss ?? []).map(s => s.id);
      if (sids.length > 0) {
        const { data: sv } = await supabase.from('tournament_match_solves').select('*')
          .in('set_id', sids).order('solve_number').order('re_solve_attempt');
        setSolves(sv ?? []);
      }
    }

    // Check admin
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: comp } = await supabase.from('competitions').select('created_by').eq('id', competitionId).single();
      if (comp?.created_by === user.id) setIsAdmin(true);
      else {
        const { data: adminRow } = await supabase.from('competition_admins').select('id')
          .eq('competition_id', competitionId).eq('user_id', user.id).maybeSingle();
        setIsAdmin(!!adminRow);
      }
    }

    setLoading(false);
  }, [competitionId, tournamentId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-select active match/set/solve
  useEffect(() => {
    const activeMatchItem = matches.find(m => m.status === 'active') ??
      matches.find(m => m.status === 'pending' && !m.auto_advance);
    if (activeMatchItem) setActiveMatch(activeMatchItem);
    else setActiveMatch(matches[0] ?? null);
  }, [matches]);

  useEffect(() => {
    if (!activeMatch) { setActiveSet(null); setActiveSolve(null); return; }
    const ms = sets.filter(s => s.match_id === activeMatch.id);
    const activeSetItem = ms.find(s => s.status === 'active') ?? ms[ms.length - 1];
    setActiveSet(activeSetItem ?? null);
  }, [activeMatch, sets]);

  useEffect(() => {
    if (!activeSet) { setActiveSolve(null); return; }
    const svs = solves.filter(s => s.set_id === activeSet.id);
    const pendingSolve = svs.find(s => s.status === 'pending' || s.status === 'active');
    setActiveSolve(pendingSolve ?? null);
  }, [activeSet, solves]);

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-surface-hover" />;

  const getPName = (id: string | null) => {
    if (!id) return '—';
    return participants.find(p => p.id === id)?.display_name_snapshot ?? 'Unknown';
  };

  const activeSolvesInSet = solves.filter(s => s.set_id === activeSet?.id);
  const c1Adj = activeSolve ? effectiveTimeMs(
    Number(c1Time) * 1000 || 0,
    c1Penalty as any
  ) : null;
  const c2Adj = activeSolve ? effectiveTimeMs(
    Number(c2Time) * 1000 || 0,
    c2Penalty as any
  ) : null;

  const handleSubmit = async () => {
    if (!activeMatch || !activeSet || !activeSolve) return;
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
            {tournament?.status === 'draft' && (
              <Button size="sm" onClick={async () => {
                await generateBracketAction(tournamentId);
                await fetchAll();
              }}>
                <Swords className="h-4 w-4 mr-1" /> Generate Bracket
              </Button>
            )}
            {tournament?.status === 'ready' && (
              <Button size="sm" onClick={async () => {
                await activateTournamentAction(tournamentId);
                await fetchAll();
              }}>
                <Play className="h-4 w-4 mr-1" /> Start
              </Button>
            )}
            {(tournament?.status === 'ready' || tournament?.status === 'active') && (
              <Button size="sm" variant="outline" onClick={async () => {
                await cancelTournamentAction(tournamentId);
                await fetchAll();
              }}>
                <XCircle className="h-4 w-4 mr-1" /> Cancel
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Bracket View */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Bracket</CardTitle>
        </CardHeader>
        <CardContent>
          <BracketView
            matches={matches}
            participants={participants}
            tournamentType={tournament?.tournament_type ?? 'single'}
            onMatchClick={(m) => setActiveMatch(m)}
          />
        </CardContent>
      </Card>

      {/* Scoreboard / Result Entry */}
      {activeMatch && activeSet && activeSolve && !activeMatch.auto_advance && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              <span>
                Match: {getPName(activeMatch.competitor1_id)} vs {getPName(activeMatch.competitor2_id)}
              </span>
              <span className="text-text-secondary">
                Set {activeSet.set_number} — Solve {activeSolve.solve_number}
                {activeSolve.re_solve_attempt > 0 ? ` (Re-solve #${activeSolve.re_solve_attempt})` : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Scramble display */}
            {activeSolve.scramble && (
              <div className="rounded-lg bg-surface-hover p-3 text-center font-mono text-sm">
                {activeSolve.scramble}
              </div>
            )}

            {/* Score display */}
            <div className="flex items-center justify-center gap-6">
              <div className="text-center">
                <div className="text-lg font-bold">{activeSet.competitor1_solve_wins}</div>
                <div className="text-xs text-text-secondary">solves</div>
              </div>
              <div className="text-lg font-bold text-text-tertiary">–</div>
              <div className="text-center">
                <div className="text-lg font-bold">{activeSet.competitor2_solve_wins}</div>
                <div className="text-xs text-text-secondary">solves</div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-4 text-xs text-text-secondary">
              <span>Sets: {activeMatch.competitor1_sets_won}–{activeMatch.competitor2_sets_won}</span>
            </div>

            {/* Result entry */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{getPName(activeMatch.competitor1_id)}</label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="12.43"
                    value={c1Time}
                    onChange={e => setC1Time(e.target.value)}
                    disabled={submitting || (c1Penalty === 'DNF' || c1Penalty === 'DNS')}
                  />
                  <Select
                    value={c1Penalty}
                    onValueChange={(v) => v !== null && setC1Penalty(v)}
                    disabled={submitting}
                  >
                    <option value="none">Normal</option>
                    <option value="+2">+2</option>
                    <option value="DNF">DNF</option>
                    <option value="DNS">DNS</option>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{getPName(activeMatch.competitor2_id)}</label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="12.43"
                    value={c2Time}
                    onChange={e => setC2Time(e.target.value)}
                    disabled={submitting || (c2Penalty === 'DNF' || c2Penalty === 'DNS')}
                  />
                  <Select
                    value={c2Penalty}
                    onValueChange={(v) => v !== null && setC2Penalty(v)}
                    disabled={submitting}
                  >
                    <option value="none">Normal</option>
                    <option value="+2">+2</option>
                    <option value="DNF">DNF</option>
                    <option value="DNS">DNS</option>
                  </Select>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting || !c1Time}
            >
              {submitting ? 'Submitting...' : 'Submit Result'}
            </Button>

            {/* Previous solves in this set */}
            {activeSolvesInSet.length > 0 && (
              <div className="space-y-1 mt-4">
                <div className="text-xs font-semibold text-text-secondary uppercase">Previous Solves</div>
                {activeSolvesInSet
                  .filter(s => s.status === 'completed' || s.status === 'tied')
                  .sort((a, b) => b.created_at?.localeCompare(a.created_at ?? '') ?? 0)
                  .slice(0, 5)
                  .map(s => (
                    <div key={s.id} className="flex items-center justify-between text-xs p-1.5 rounded bg-surface-hover gap-1">
                      <span className="text-text-secondary">#{s.solve_number}{s.re_solve_attempt > 0 ? `r${s.re_solve_attempt}` : ''}</span>
                      <span className={s.winner_id === activeMatch.competitor1_id ? 'text-cube-green' : 'text-text-secondary'}>
                        {s.competitor1_time_ms !== null ? formatTime(s.competitor1_time_ms) : s.competitor1_penalty}
                        {s.competitor1_penalty === '+2' ? '+2' : ''}
                      </span>
                      <span>vs</span>
                      <span className={s.winner_id === activeMatch.competitor2_id ? 'text-cube-green' : 'text-text-secondary'}>
                        {s.competitor2_time_ms !== null ? formatTime(s.competitor2_time_ms) : s.competitor2_penalty}
                        {s.competitor2_penalty === '+2' ? '+2' : ''}
                      </span>
                      <Badge variant={s.status === 'tied' ? 'outline' : 'secondary'} className="text-[10px]">
                        {s.status === 'tied' ? 'Tied' : 'Done'}
                      </Badge>
                      {s.status === 'tied' && isAdmin && (
                        <button
                          className="text-[10px] px-1.5 py-0.5 rounded bg-cube-blue/20 text-cube-blue hover:bg-cube-blue/30 disabled:opacity-50 shrink-0"
                          disabled={reSolving === s.id}
                          onClick={async () => {
                            setReSolving(s.id);
                            try {
                              const scramble = tournament?.scramble_source === 'generated' && tournament?.event_key
                                ? await fetch('/api/generate-scramble?' + new URLSearchParams({ eventKey: tournament.event_key })).then(r => r.json()).then(r => r.scramble).catch(() => null)
                                : null;
                              const { error: rpcErr } = await supabase.rpc('re_solve_tournament_tie', {
                                p_tournament_id: tournamentId, p_solve_id: s.id, p_scramble: scramble,
                              });
                              if (rpcErr) { setError(rpcErr.message); } else { await fetchAll(); }
                            } catch { setError('Failed to re-solve'); }
                            setReSolving(null);
                          }}
                        >{reSolving === s.id ? '...' : 'Re-solve'}</button>
                      )}
                      {s.status === 'completed' && isAdmin && activeSolvesInSet.filter(x => x.status === 'completed' && x.created_at && s.created_at && x.created_at > s.created_at).length === 0 && (
                        <button
                          className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive hover:bg-destructive/30 disabled:opacity-50 shrink-0"
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
