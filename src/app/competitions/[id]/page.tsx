'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@/lib/supabase/client';
import { WCA_EVENTS } from '@/lib/wca-events';
import { toast } from 'sonner';
import { Trophy, Users, Clock, Lock, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';

export default function CompetitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [competition, setCompetition] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [roundParticipation, setRoundParticipation] = useState<Set<string>>(new Set());
  const [isOwner, setIsOwner] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [competitorCount, setCompetitorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      const { data: comp } = await supabase
        .from('competitions')
        .select('*')
        .eq('id', id)
        .single();

      if (!comp) return;
      setCompetition(comp);
      setIsOwner(user?.id === comp.created_by);

      const { data: compEvents } = await supabase
        .from('competition_events')
        .select('*')
        .eq('competition_id', id)
        .order('event_key');
      setEvents(compEvents ?? []);

      if (compEvents) {
        const eventIds = compEvents.map(e => e.id);
        const { data: allRounds } = await supabase
          .from('rounds')
          .select('*')
          .in('competition_event_id', eventIds)
          .order('round_number');
        setRounds(allRounds ?? []);

        // Fetch round_participants for the current user (to show eligibility)
        if (user) {
          const { data: competitor } = await supabase
            .from('competitors')
            .select('id')
            .eq('competition_id', id)
            .eq('user_id', user.id)
            .maybeSingle();

          if (competitor) {
            const roundIds = (allRounds ?? []).map(r => r.id);
            const { data: participants } = await supabase
              .from('round_participants')
              .select('round_id')
              .in('round_id', roundIds)
              .eq('competitor_id', competitor.id);
            const qualifiedRounds = new Set((participants ?? []).map(p => p.round_id));
            setRoundParticipation(qualifiedRounds);
          }
        }
      }

      const { count } = await supabase
        .from('competitors')
        .select('*', { count: 'exact', head: true })
        .eq('competition_id', id);
      setCompetitorCount(count ?? 0);

      if (user) {
        const { data: reg } = await supabase
          .from('competitors')
          .select('id')
          .eq('competition_id', id)
          .eq('user_id', user.id)
          .maybeSingle();
        setIsRegistered(!!reg);
      }

      setLoading(false);
    };
    fetchData();
  }, [id]);

  const handleRegister = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Login required'); return; }

    const { error } = await supabase.from('competitors').insert({
      competition_id: id,
      user_id: user.id,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Registered!');
      setIsRegistered(true);
      setCompetitorCount(c => c + 1);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!competition) return <p>Competition not found.</p>;

  const getRoundsForEvent = (eventId: string) =>
    rounds.filter(r => r.competition_event_id === eventId);

  const getRoundAccess = (round: any): { clickable: boolean; badge: { label: string; variant: string } } => {
    // Owner always has access
    if (isOwner) {
      return { clickable: true, badge: { label: round.status, variant: round.status === 'active' ? 'destructive' : round.status === 'completed' ? 'secondary' : 'outline' } };
    }

    // Not registered — can only see round 1 (to prompt registration)
    if (!isRegistered) {
      if (round.round_number === 1) {
        return { clickable: true, badge: { label: 'Register to compete', variant: 'outline' } };
      }
      return { clickable: false, badge: { label: 'Locked', variant: 'secondary' } };
    }

    // Round is pending (not yet started)
    if (round.status === 'pending') {
      if (round.round_number === 1) {
        return { clickable: false, badge: { label: 'Not started', variant: 'outline' } };
      }
      return { clickable: false, badge: { label: 'Locked', variant: 'secondary' } };
    }

    // Round 1: always accessible to registered competitors
    if (round.round_number === 1) {
      return { clickable: true, badge: { label: round.status === 'active' ? 'Open' : 'Completed', variant: round.status === 'active' ? 'destructive' : 'secondary' } };
    }

    // Round 2+: check qualification
    if (roundParticipation.has(round.id)) {
      return { clickable: true, badge: { label: 'Qualified ✓', variant: 'default' } };
    }

    return { clickable: false, badge: { label: 'Not qualified', variant: 'secondary' } };
  };

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">{competition.name}</h1>
            <p className="mt-1 text-muted-foreground">{competition.description}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={
              competition.status === 'upcoming' ? 'default' :
              competition.status === 'ongoing' ? 'destructive' :
              'secondary'
            }>
              {competition.status}
            </Badge>
            {!isOwner && !isRegistered && (
              <Button onClick={handleRegister}>Register</Button>
            )}
            {isRegistered && !isOwner && (
              <Badge variant="outline">Registered</Badge>
            )}
            {isOwner && (
              <Button variant="outline" onClick={() => window.location.href = `/competitions/${id}/admin`}>
                Manage
              </Button>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-1"><Trophy className="h-4 w-4" /> {events.length} events</span>
          <span className="flex items-center gap-1"><Users className="h-4 w-4" /> {competitorCount} competitors</span>
          <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {new Date(competition.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="competitors">Competitors</TabsTrigger>
        </TabsList>
        <TabsContent value="events" className="mt-4">
          <div className="grid gap-4">
            {events.map(cEvent => {
              const wcaEvent = WCA_EVENTS.find(e => e.key === cEvent.event_key);
              const eventRounds = getRoundsForEvent(cEvent.id);
              return (
                <Card key={cEvent.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <span>{wcaEvent?.icon}</span>
                      {wcaEvent?.name}
                      <Badge variant="outline" className="ml-2">
                        {cEvent.round_count} round{cEvent.round_count > 1 ? 's' : ''}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {eventRounds.map(round => {
                        const access = getRoundAccess(round);
                        return (
                          <div
                            key={round.id}
                            className={`flex items-center justify-between rounded border p-3 ${
                              access.clickable
                                ? 'cursor-pointer hover:bg-muted/50 transition-colors'
                                : 'opacity-60'
                            }`}
                            onClick={() => {
                              if (access.clickable) {
                                window.location.href =
                                  `/competitions/${id}/events/${cEvent.event_key}/round/${round.round_number}`;
                              }
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-medium">
                                Round {round.round_number}
                              </span>
                              {!access.clickable && (
                                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </div>
                            <Badge variant={
                              access.badge.variant as any === 'destructive' ? 'destructive' :
                              access.badge.variant as any === 'default' ? 'default' :
                              'outline'
                            }>
                              {access.badge.label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
        <TabsContent value="competitors" className="mt-4">
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {competitorCount === 0
                ? 'No competitors registered yet.'
                : `${competitorCount} competitor${competitorCount > 1 ? 's' : ''} registered.`}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
