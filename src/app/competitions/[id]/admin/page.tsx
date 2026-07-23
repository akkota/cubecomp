'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { WCA_EVENTS } from '@/lib/wca-events';
import { generateScramblesAction } from '@/actions/generateScrambles';
import { calculateAdvancementAction } from '@/actions/calculateAdvancement';
import { toast } from 'sonner';
import { ArrowUp, Play, Square, ShuffleIcon, Users, Trophy, CheckCircle2, CuboidIcon as CubeIcon, Shield } from 'lucide-react';

export default function CompetitionAdminPage() {
  const { id } = useParams<{ id: string }>();
  const [competition, setCompetition] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [allRounds, setAllRounds] = useState<any[]>([]);
  const [scrambles, setScrambles] = useState<Record<string, any[]>>({});
  const [isOwner, setIsOwner] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [calculating, setCalculating] = useState<Record<string, boolean>>({});
  const [startingRound, setStartingRound] = useState<string | null>(null);
  const [endingRound, setEndingRound] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const generatingRef = useRef<Set<string>>(new Set());
  const startingRef = useRef<string | null>(null);
  const endingRef = useRef<string | null>(null);
  const registeringRef = useRef(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const { data: comp } = await supabase
        .from('competitions')
        .select('*')
        .eq('id', id)
        .single();

      if (!comp || comp.created_by !== user.id) {
        toast.error('Not authorized');
        router.push('/');
        return;
      }
      setCompetition(comp);
      setIsOwner(true);

      const { data: existingReg } = await supabase
        .from('competitors')
        .select('id')
        .eq('competition_id', id)
        .eq('user_id', user.id)
        .maybeSingle();
      setIsRegistered(!!existingReg);

      const { data: compEvents } = await supabase
        .from('competition_events')
        .select('*')
        .eq('competition_id', id)
        .order('event_key');
      setEvents(compEvents ?? []);

      if (compEvents) {
        const eventIds = compEvents.map(e => e.id);
        const { data: rounds } = await supabase
          .from('rounds')
          .select('*')
          .in('competition_event_id', eventIds)
          .order('round_number');
        setAllRounds(rounds ?? []);

        const roundIds = (rounds ?? []).map(r => r.id);
        if (roundIds.length > 0) {
          const { data: s } = await supabase
            .from('scrambles')
            .select('*')
            .in('round_id', roundIds)
            .order('scramble_number');
          const grouped: Record<string, any[]> = {};
          for (const sc of (s ?? [])) {
            if (!grouped[sc.round_id]) grouped[sc.round_id] = [];
            grouped[sc.round_id].push(sc);
          }
          setScrambles(grouped);
        }
      }

      setLoading(false);
    };
    fetchData();
  }, [id]);

  const getRoundsForEvent = (eventId: string) =>
    allRounds.filter(r => r.competition_event_id === eventId);

  const wcaEvent = (key: string) => WCA_EVENTS.find(e => e.key === key);

  const handleGenerateScrambles = async (round: any, eventKey: string, solveCount: number) => {
    if (generatingRef.current.has(round.id)) return;
    generatingRef.current.add(round.id);
    setGenerating(prev => ({ ...prev, [round.id]: true }));
    try {
      await Promise.race([
        generateScramblesAction(round.id, eventKey, solveCount),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Scramble generation timed out. Try again.')), 25000)
        ),
      ]);
      const { data: freshScrambles } = await supabase
        .from('scrambles')
        .select('*')
        .eq('round_id', round.id)
        .order('scramble_number');
      setScrambles(prev => ({ ...prev, [round.id]: freshScrambles ?? [] }));
      toast.success(`Scrambles generated for Round ${round.round_number}`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(prev => ({ ...prev, [round.id]: false }));
      generatingRef.current.delete(round.id);
    }
  };

  const handleStartRound = async (roundId: string) => {
    if (startingRef.current) return;
    startingRef.current = roundId;
    setStartingRound(roundId);
    const { error } = await supabase.from('rounds')
      .update({ status: 'active', started_at: new Date().toISOString() })
      .eq('id', roundId);
    if (error) { toast.error(error.message); } else {
      toast.success('Round started!');
      setAllRounds(prev => prev.map(r => r.id === roundId ? { ...r, status: 'active', started_at: new Date().toISOString() } : r));
    }
    setStartingRound(null);
    startingRef.current = null;
  };

  const handleEndRound = async (roundId: string) => {
    if (endingRef.current) return;
    endingRef.current = roundId;
    setEndingRound(roundId);
    const { error } = await supabase.from('rounds')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('id', roundId);
    if (error) { toast.error(error.message); } else {
      toast.success('Round ended!');
      setAllRounds(prev => prev.map(r => r.id === roundId ? { ...r, status: 'completed', ended_at: new Date().toISOString() } : r));
    }
    setEndingRound(null);
    endingRef.current = null;
  };

  const handleSetAdvanceCount = async (roundId: string, count: number) => {
    const { error } = await supabase.from('rounds')
      .update({ advance_count: count })
      .eq('id', roundId);
    if (error) { toast.error(error.message); return; }
    setAllRounds(prev => prev.map(r => r.id === roundId ? { ...r, advance_count: count } : r));
  };

  const handleCalculateAdvancement = async (round: any) => {
    setCalculating(prev => ({ ...prev, [round.id]: true }));
    try {
      const result = await calculateAdvancementAction(round.id);
      if (!result.success) {
        toast.error(result.error);
      } else if (result.alreadyCalculated) {
        toast.success(`Already calculated — ${result.advanced} advanced to Round ${result.nextRoundNumber}`);
      } else if (result.advanced === 0) {
        toast.warning(`No one advanced to Round ${result.nextRoundNumber}. ${result.total} submitted${result.dnfCount ? ` (${result.dnfCount} DNF'd)` : ''}`);
      } else {
        toast.success(`${result.advanced} of ${result.total} advanced to Round ${result.nextRoundNumber}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong');
    } finally {
      setCalculating(prev => ({ ...prev, [round.id]: false }));
    }
  };

  const handleRegisterAsCompetitor = async () => {
    if (registeringRef.current) return;
    registeringRef.current = true;
    setRegistering(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Login required'); registeringRef.current = false; setRegistering(false); return; }
    const { error } = await supabase.from('competitors').insert({ competition_id: id, user_id: user.id });
    if (error) {
      if (error.code === '23505') { toast.success('Already registered!'); } else { toast.error(error.message); }
    } else {
      toast.success('Registered as competitor!');
      setIsRegistered(true);
    }
    setRegistering(false);
    registeringRef.current = false;
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-pulse text-center">
        <CubeIcon className="mx-auto h-8 w-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">Loading admin panel...</p>
      </div>
    </div>
  );
  if (!competition) return <p className="text-center text-muted-foreground py-20">Competition not found.</p>;

  return (
    <div>
      {/* Header */}
      <div className="mb-8 rounded-xl border border-border/50 bg-gradient-to-br from-background to-cube-orange/5 p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cube-orange/10 p-2">
              <Shield className="h-5 w-5 text-cube-orange" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{competition.name}</h1>
              <p className="text-sm text-muted-foreground">Manage rounds, scrambles, and cutoffs</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline">{competition.status}</Badge>
            {isRegistered ? (
              <Badge variant="secondary" className="gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-cube-green" /> Competing
              </Badge>
            ) : (
              <Button variant="outline" size="sm" onClick={handleRegisterAsCompetitor} disabled={registering} className="gap-2">
                <Trophy className="h-4 w-4" /> {registering ? 'Registering...' : 'Compete as Competitor'}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6">
        {events.map(cEvent => {
          const eventInfo = wcaEvent(cEvent.event_key);
          const eventRounds = getRoundsForEvent(cEvent.id);
          const solveCount = eventInfo?.solveCount ?? 5;

          return (
            <Card key={cEvent.id} className="border-border/50 overflow-hidden">
              <CardHeader className="border-b border-border/30 bg-muted/20 pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <span>{eventInfo?.icon}</span>
                  {eventInfo?.name}
                  <Badge variant="outline" className="ml-auto text-xs">{cEvent.round_count} rounds</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 divide-y divide-border/30">
                {eventRounds.map(round => {
                  const roundScrambles = scrambles[round.id] || [];
                  const hasScrambles = roundScrambles.length > 0;
                  const hasNextRound = round.round_number < cEvent.round_count;

                  return (
                    <div key={round.id} className="px-4 py-4 sm:px-6">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold">Round {round.round_number}</h3>
                          <Badge variant={
                            round.status === 'completed' ? 'secondary' :
                            round.status === 'active' ? 'destructive' : 'outline'
                          }>{round.status}</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {round.status === 'pending' && (
                            <>
                              <Button variant="outline" size="sm"
                                disabled={generating[round.id] || hasScrambles}
                                onClick={() => handleGenerateScrambles(round, cEvent.event_key, solveCount)}
                                className="gap-1.5"
                              >
                                <ShuffleIcon className="h-3.5 w-3.5" />
                                {generating[round.id] ? 'Generating...' : hasScrambles ? 'Has Scrambles' : 'Generate Scrambles'}
                              </Button>
                              {hasScrambles && (
                                <Button variant="default" size="sm"
                                  disabled={!!startingRound}
                                  onClick={() => handleStartRound(round.id)}
                                  className="gap-1.5"
                                >
                                  <Play className="h-3.5 w-3.5" /> {startingRound === round.id ? 'Starting...' : 'Start'}
                                </Button>
                              )}
                            </>
                          )}
                          {round.status === 'active' && (
                            <Button variant="destructive" size="sm"
                              disabled={!!endingRound}
                              onClick={() => handleEndRound(round.id)}
                              className="gap-1.5"
                            >
                              <Square className="h-3.5 w-3.5" /> {endingRound === round.id ? 'Ending...' : 'End Round'}
                            </Button>
                          )}
                          {round.status === 'completed' && hasNextRound && (
                            <Button variant="default" size="sm"
                              disabled={calculating[round.id]}
                              onClick={() => handleCalculateAdvancement(round)}
                              className="gap-1.5"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                              {calculating[round.id] ? 'Calculating...' : 'Calculate Advancement'}
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Advance cutoff + scrambles row */}
                      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        {round.round_number < cEvent.round_count && (
                          <div className="flex items-center gap-2 text-sm">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Advance top:</span>
                            <Input type="number" className="w-20 h-8" placeholder="Auto" min={1}
                              value={round.advance_count ?? ''}
                              onChange={e => handleSetAdvanceCount(round.id, parseInt(e.target.value || '0'))} />
                            <span className="text-xs text-muted-foreground">to round {round.round_number + 1}</span>
                          </div>
                        )}

                        {hasScrambles && (
                          <div className="flex flex-wrap gap-1.5">
                            {roundScrambles.map(s => (
                              <span key={s.id} className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1 text-xs font-mono">
                                <span className="font-bold text-cube-blue">{s.scramble_number}</span>
                                {s.scramble}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
