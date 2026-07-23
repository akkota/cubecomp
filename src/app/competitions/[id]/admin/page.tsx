'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';
import { WCA_EVENTS } from '@/lib/wca-events';
import { generateScramblesAction } from '@/actions/generateScrambles';
import { calculateAdvancementAction } from '@/actions/calculateAdvancement';
import { toast } from 'sonner';
import { ArrowUp, Play, Square, ShuffleIcon, Users, Trophy, CheckCircle2 } from 'lucide-react';

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

      // Check if admin is also registered as a competitor
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

        // Fetch existing scrambles for all rounds
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
    setGenerating(prev => ({ ...prev, [round.id]: true }));
    try {
      await Promise.race([
        generateScramblesAction(round.id, eventKey, solveCount),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Scramble generation timed out. Vercel serverless functions have a 10s limit — try again or upgrade to Pro.')), 25000)
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
    }
  };

  const handleStartRound = async (roundId: string) => {
    const { error } = await supabase
      .from('rounds')
      .update({ status: 'active', started_at: new Date().toISOString() })
      .eq('id', roundId);

    if (error) { toast.error(error.message); return; }
    toast.success('Round started!');
    setAllRounds(prev =>
      prev.map(r => r.id === roundId ? { ...r, status: 'active', started_at: new Date().toISOString() } : r)
    );
  };

  const handleEndRound = async (roundId: string) => {
    const { error } = await supabase
      .from('rounds')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('id', roundId);

    if (error) { toast.error(error.message); return; }
    toast.success('Round ended!');
    setAllRounds(prev =>
      prev.map(r => r.id === roundId ? { ...r, status: 'completed', ended_at: new Date().toISOString() } : r)
    );
  };

  const handleSetAdvanceCount = async (roundId: string, count: number) => {
    const { error } = await supabase
      .from('rounds')
      .update({ advance_count: count })
      .eq('id', roundId);

    if (error) { toast.error(error.message); return; }
    toast.success('Cutoff set');
    setAllRounds(prev =>
      prev.map(r => r.id === roundId ? { ...r, advance_count: count } : r)
    );
  };

  const handleCalculateAdvancement = async (round: any) => {
    setCalculating(prev => ({ ...prev, [round.id]: true }));
    try {
      const result = await calculateAdvancementAction(round.id);
      toast.success(
        `${result.advanced} of ${result.total} advanced to Round ${result.nextRoundNumber}`
      );
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCalculating(prev => ({ ...prev, [round.id]: false }));
    }
  };

  const handleRegisterAsCompetitor = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('competitors').insert({
      competition_id: id,
      user_id: user.id,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Registered as competitor!');
      setIsRegistered(true);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading admin panel...</p>;
  if (!competition) return <p>Competition not found.</p>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin: {competition.name}</h1>
          <p className="text-muted-foreground">Manage rounds, scrambles, and cutoffs</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline">{competition.status}</Badge>
          {isRegistered ? (
            <Badge variant="secondary">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Competing
            </Badge>
          ) : (
            <Button variant="outline" size="sm" onClick={handleRegisterAsCompetitor}>
              <Trophy className="mr-1 h-3 w-3" /> Compete as competitor
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6">
        {events.map(cEvent => {
          const eventInfo = wcaEvent(cEvent.event_key);
          const eventRounds = getRoundsForEvent(cEvent.id);
          const solveCount = eventInfo?.solveCount ?? 5;

          return (
            <Card key={cEvent.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <span>{eventInfo?.icon}</span>
                  {eventInfo?.name}
                  <Badge variant="outline" className="ml-2">
                    {cEvent.round_count} rounds
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {eventRounds.map(round => {
                  const roundScrambles = scrambles[round.id] || [];
                  const hasScrambles = roundScrambles.length > 0;
                  const hasNextRound = round.round_number < cEvent.round_count;

                  return (
                    <div key={round.id} className="rounded-lg border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold">Round {round.round_number}</h3>
                          <Badge variant={
                            round.status === 'completed' ? 'secondary' :
                            round.status === 'active' ? 'destructive' :
                            'outline'
                          }>
                            {round.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {round.status === 'pending' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={generating[round.id] || hasScrambles}
                                onClick={() => handleGenerateScrambles(round, cEvent.event_key, solveCount)}
                              >
                                <ShuffleIcon className="mr-1 h-3 w-3" />
                                {generating[round.id] ? 'Generating...' : hasScrambles ? 'Has Scrambles' : 'Generate Scrambles'}
                              </Button>
                              {hasScrambles && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => handleStartRound(round.id)}
                                >
                                  <Play className="mr-1 h-3 w-3" /> Start
                                </Button>
                              )}
                            </>
                          )}
                          {round.status === 'active' && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleEndRound(round.id)}
                            >
                              <Square className="mr-1 h-3 w-3" /> End Round
                            </Button>
                          )}
                          {round.status === 'completed' && hasNextRound && (
                            <Button
                              variant="default"
                              size="sm"
                              disabled={calculating[round.id]}
                              onClick={() => handleCalculateAdvancement(round)}
                            >
                              <ArrowUp className="mr-1 h-3 w-3" />
                              {calculating[round.id] ? 'Calculating...' : 'Calculate Advancement'}
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Advance cutoff */}
                      {round.round_number < cEvent.round_count && (
                        <div className="mb-3 flex items-center gap-3">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Advance top:</span>
                          <Input
                            type="number"
                            className="w-20 h-8"
                            placeholder="Auto"
                            min={1}
                            value={round.advance_count ?? ''}
                            onChange={e => handleSetAdvanceCount(round.id, parseInt(e.target.value || '0'))}
                          />
                          <span className="text-xs text-muted-foreground">
                            to round {round.round_number + 1}
                          </span>
                        </div>
                      )}

                      {/* Scrambles display */}
                      {hasScrambles && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Scrambles:</p>
                          <div className="rounded bg-muted p-3 text-xs">
                            {roundScrambles.map(s => (
                              <div key={s.id} className="flex gap-2">
                                <span className="font-mono font-bold text-muted-foreground w-4">
                                  {s.scramble_number}.
                                </span>
                                <span className="font-mono">{s.scramble}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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
