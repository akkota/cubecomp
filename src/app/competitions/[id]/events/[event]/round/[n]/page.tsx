'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';
import { getEventByKey, formatTime } from '@/lib/wca-events';
import { RoundLeaderboard } from '@/components/competitions/leaderboard';
import { toast } from 'sonner';
import { Clock, Send } from 'lucide-react';

type ScrambleEntry = { id: string; scramble_number: number; scramble: string };
type SolveEntry = { solve_number: number; time_ms: number | null; penalty: string };

export default function RoundPage() {
  const params = useParams<{ id: string; event: string; n: string }>();
  const [compEvent, setCompEvent] = useState<any>(null);
  const [round, setRound] = useState<any>(null);
  const [competition, setCompetition] = useState<any>(null);
  const [scrambles, setScrambles] = useState<ScrambleEntry[]>([]);
  const [existingSolves, setExistingSolves] = useState<SolveEntry[]>([]);
  const [times, setTimes] = useState<Record<number, string>>({});
  const [penalties, setPenalties] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isCompetitor, setIsCompetitor] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const fetch = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      // Get round from round number + event key + competition
      const { data: cEvent } = await supabase
        .from('competition_events')
        .select('*')
        .eq('competition_id', params.id)
        .eq('event_key', params.event)
        .single();

      if (!cEvent) { toast.error('Event not found'); return; }
      setCompEvent(cEvent);

      const { data: r } = await supabase
        .from('rounds')
        .select('*')
        .eq('competition_event_id', cEvent.id)
        .eq('round_number', parseInt(params.n))
        .single();

      if (!r) { toast.error('Round not found'); return; }
      setRound(r);

      const { data: comp } = await supabase
        .from('competitions')
        .select('*')
        .eq('id', params.id)
        .single();
      setCompetition(comp);

      // Fetch scrambles
      const { data: sc } = await supabase
        .from('scrambles')
        .select('*')
        .eq('round_id', r.id)
        .order('scramble_number');
      setScrambles(sc ?? []);

      // Check if user is registered
      if (user) {
        const { data: competitor } = await supabase
          .from('competitors')
          .select('id')
          .eq('competition_id', params.id)
          .eq('user_id', user.id)
          .maybeSingle();
        setIsCompetitor(!!competitor);

        // Fetch existing solves for this user
        if (competitor) {
          const { data: sol } = await supabase
            .from('solves')
            .select('*')
            .eq('round_id', r.id)
            .eq('competitor_id', competitor.id)
            .order('solve_number');
          if (sol) {
            const solveEntries = sol.map(s => ({
              solve_number: s.solve_number,
              time_ms: s.time_ms,
              penalty: s.penalty,
            }));
            setExistingSolves(solveEntries);
            const timeMap: Record<number, string> = {};
            const penaltyMap: Record<number, string> = {};
            for (const s of solveEntries) {
              if (s.time_ms !== null) timeMap[s.solve_number] = (s.time_ms / 1000).toFixed(2);
              penaltyMap[s.solve_number] = s.penalty === 'none' ? '' : s.penalty;
            }
            setTimes(timeMap);
            setPenalties(penaltyMap);
          }
        }
      }

      setLoading(false);
    };
    fetch();
  }, [params.id, params.event, params.n]);

  const wcaEvent = getEventByKey(params.event);
  const solveCount = wcaEvent?.solveCount ?? 5;

  const handleSubmit = async () => {
    if (!user || !isCompetitor) {
      toast.error('You need to register for this competition first');
      return;
    }

    const { data: competitor } = await supabase
      .from('competitors')
      .select('id')
      .eq('competition_id', params.id)
      .eq('user_id', user.id)
      .single();

    if (!competitor) { toast.error('Not registered'); return; }

    setSubmitting(true);

    // Delete existing solves for this user/round
    await supabase
      .from('solves')
      .delete()
      .eq('round_id', round.id)
      .eq('competitor_id', competitor.id);

    const solvesToInsert = [];
    for (let i = 1; i <= solveCount; i++) {
      const raw = times[i]?.trim();
      const penalty = penalties[i] || 'none';

      if (!raw) {
        // No time entered — skip this solve
        continue;
      }

      if (raw.toUpperCase() === 'DNF') {
        solvesToInsert.push({
          round_id: round.id,
          competitor_id: competitor.id,
          solve_number: i,
          time_ms: null,
          penalty: 'DNF',
          submitted_by: user.id,
        });
        continue;
      }

      const seconds = parseFloat(raw);
      if (isNaN(seconds) || seconds < 0) {
        toast.error(`Invalid time for solve ${i}`);
        setSubmitting(false);
        return;
      }

      solvesToInsert.push({
        round_id: round.id,
        competitor_id: competitor.id,
        solve_number: i,
        time_ms: Math.round(seconds * 1000),
        penalty,
        submitted_by: user.id,
      });
    }

    if (solvesToInsert.length === 0) {
      toast.error('Enter at least one time');
      setSubmitting(false);
      return;
    }

    const { error } = await supabase.from('solves').insert(solvesToInsert);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Times submitted!');
    }

    setSubmitting(false);
  };

  if (loading) return <p className="text-muted-foreground">Loading round...</p>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">
          {competition?.name}
        </h1>
        <p className="text-muted-foreground">
          {wcaEvent?.icon} {wcaEvent?.name} — Round {params.n}
          {round && (
            <Badge className="ml-2" variant={
              round.status === 'active' ? 'destructive' :
              round.status === 'completed' ? 'secondary' : 'outline'
            }>
              {round.status}
            </Badge>
          )}
        </p>
      </div>

      {/* Scrambles */}
      {scrambles.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Scrambles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {scrambles.map(s => (
                <div key={s.id} className="flex gap-2 rounded bg-muted p-2 text-sm">
                  <span className="w-5 font-bold text-muted-foreground">{s.scramble_number}.</span>
                  <span className="font-mono">{s.scramble}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Time Entry */}
      {round?.status === 'active' && isCompetitor && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" />
              Enter Times
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: solveCount }, (_, i) => i + 1).map(sn => (
                <div key={sn} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Solve {sn}
                    </label>
                    <Input
                      type="text"
                      placeholder="12.34 or DNF"
                      value={times[sn] ?? ''}
                      onChange={e => setTimes(prev => ({ ...prev, [sn]: e.target.value }))}
                    />
                  </div>
                  <div className="w-20">
                    <Select
                      value={penalties[sn] ?? 'none'}
                      onValueChange={v => setPenalties(prev => ({ ...prev, [sn]: v as string }))}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Penalty" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="+2">+2</SelectItem>
                        <SelectItem value="DNF">DNF</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSubmit} disabled={submitting}>
                <Send className="mr-2 h-4 w-4" />
                {submitting ? 'Saving...' : 'Submit Times'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leaderboard</CardTitle>
        </CardHeader>
        <CardContent>
          <RoundLeaderboard
            roundId={round.id}
            eventKey={params.event}
            format={compEvent?.event_format ?? 'average'}
            solveCount={solveCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
