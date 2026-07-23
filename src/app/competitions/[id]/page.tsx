'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@/lib/supabase/client';
import { WCA_EVENTS } from '@/lib/wca-events';
import { toast } from 'sonner';
import { Trophy, Users, Clock, Lock, Calendar, ArrowRight, CuboidIcon as CubeIcon, UserPlus } from 'lucide-react';

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
      competition_id: id, user_id: user.id,
    });
    if (error) {
      if (error.code === '23505') { toast.success('Already registered!'); setIsRegistered(true); return; }
      toast.error(error.message);
    } else {
      toast.success('Registered!');
      setIsRegistered(true);
      setCompetitorCount(c => c + 1);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-pulse text-center">
        <CubeIcon className="mx-auto h-8 w-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">Loading competition...</p>
      </div>
    </div>
  );
  if (!competition) return (
    <div className="flex flex-col items-center gap-3 py-20">
      <CubeIcon className="h-10 w-10 text-muted-foreground/40" />
      <p className="text-muted-foreground">Competition not found.</p>
    </div>
  );

  const getRoundsForEvent = (eventId: string) =>
    rounds.filter(r => r.competition_event_id === eventId);

  const getRoundAccess = (round: any): { clickable: boolean; badge: { label: string; variant: string } } => {
    if (isOwner) return { clickable: true, badge: { label: round.status, variant: round.status === 'active' ? 'destructive' : round.status === 'completed' ? 'secondary' : 'outline' } };
    if (!isRegistered) return round.round_number === 1
      ? { clickable: true, badge: { label: 'Register to compete', variant: 'outline' } }
      : { clickable: false, badge: { label: 'Locked', variant: 'secondary' } };
    if (round.status === 'pending') return round.round_number === 1
      ? { clickable: false, badge: { label: 'Not started', variant: 'outline' } }
      : { clickable: false, badge: { label: 'Locked', variant: 'secondary' } };
    if (round.round_number === 1) return { clickable: true, badge: { label: round.status === 'active' ? 'Open' : 'Completed', variant: round.status === 'active' ? 'destructive' : 'secondary' } };
    if (roundParticipation.has(round.id)) return { clickable: true, badge: { label: 'Qualified ✓', variant: 'default' } };
    return { clickable: false, badge: { label: 'Not qualified', variant: 'secondary' } };
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8 rounded-xl border border-border/50 bg-gradient-to-br from-background to-cube-blue/5 p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{competition.name}</h1>
              <Badge variant={
                competition.status === 'upcoming' ? 'default' :
                competition.status === 'ongoing' ? 'destructive' :
                'secondary'
              } className="shrink-0">
                {competition.status}
              </Badge>
            </div>
            {competition.description && (
              <p className="mt-2 text-sm text-muted-foreground">{competition.description}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-cube-blue" /> {events.length} events
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-cube-green" /> {competitorCount} competitor{competitorCount !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-cube-orange" /> {new Date(competition.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {!isOwner && !isRegistered && (
              <Button onClick={handleRegister} className="gap-2" size="sm">
                <UserPlus className="h-4 w-4" />
                Register
              </Button>
            )}
            {isRegistered && !isOwner && (
              <Badge variant="outline" className="gap-1.5 border-cube-green/30 text-cube-green">
                <Users className="h-3 w-3" /> Registered
              </Badge>
            )}
            {isOwner && (
              <Button variant="outline" size="sm" onClick={() => window.location.href = `/competitions/${id}/admin`}>
                Manage Competition
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="events">
        <TabsList className="mb-6">
          <TabsTrigger value="events" className="gap-2">
            <Trophy className="h-4 w-4" /> Events
          </TabsTrigger>
          <TabsTrigger value="competitors" className="gap-2">
            <Users className="h-4 w-4" /> Competitors
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          <div className="grid gap-4">
            {events.map(cEvent => {
              const wcaEvent = WCA_EVENTS.find(e => e.key === cEvent.event_key);
              const eventRounds = getRoundsForEvent(cEvent.id);
              return (
                <Card key={cEvent.id} className="border-border/50 overflow-hidden">
                  <CardHeader className="border-b border-border/30 bg-muted/20 pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <span className="text-xl">{wcaEvent?.icon}</span>
                      {wcaEvent?.name}
                      <Badge variant="outline" className="ml-auto text-xs">
                        {cEvent.round_count} round{cEvent.round_count > 1 ? 's' : ''}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 divide-y divide-border/30">
                    {eventRounds.map(round => {
                      const access = getRoundAccess(round);
                      return (
                        <div
                          key={round.id}
                          className={`flex items-center justify-between px-4 py-3.5 ${
                            access.clickable
                              ? 'cursor-pointer hover:bg-muted/30 transition-colors'
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
                            <span className="font-medium text-sm">Round {round.round_number}</span>
                            {!access.clickable && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={access.badge.variant as any}>
                              {access.badge.label}
                            </Badge>
                            {access.clickable && (
                              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
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
        </TabsContent>

        <TabsContent value="competitors">
          <Card className="border-border/50">
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <Users className={`h-10 w-10 ${competitorCount === 0 ? 'text-muted-foreground/40' : 'text-cube-blue'}`} />
              <div className="text-center">
                {competitorCount === 0 ? (
                  <>
                    <p className="font-medium">No competitors registered yet</p>
                    {!isRegistered && !isOwner && (
                      <Button onClick={handleRegister} variant="outline" size="sm" className="mt-3 gap-2">
                        <UserPlus className="h-4 w-4" /> Be the first to register
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{competitorCount}</span> competitor{competitorCount !== 1 ? 's' : ''} registered
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
