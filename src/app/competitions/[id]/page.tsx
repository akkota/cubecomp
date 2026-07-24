'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { deriveCompetitionStatus, competitionRegistrationOpen } from '@/lib/competition-status';
import { registerForCompetitionAction, checkCompetitionUnlockAction } from '@/actions/competitionPrivacy';
import { WCA_EVENTS } from '@/lib/wca-events';
import { toast } from 'sonner';
import { CompetitionSection } from '@/components/tournament/competition-section';
import { Trophy, Users, Lock, Calendar, ArrowRight, CuboidIcon as CubeIcon, UserPlus, Globe, Swords } from 'lucide-react';

export default function CompetitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [competition, setCompetition] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [roundParticipation, setRoundParticipation] = useState<Set<string>>(new Set());
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isH2H, setH2H] = useState(false);
  const [tournamentStatuses, setTournamentStatuses] = useState<string[]>([]);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registrationLocked, setRegistrationLocked] = useState(false);
  const [hasUnlock, setHasUnlock] = useState(false);
  const [competitorCount, setCompetitorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [registering, setRegistering] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      const { data: comp } = await supabase
        .from('competitions')
        .select('id, created_by, name, description, status, visibility, competition_type, created_at, updated_at, generate_scrambles, allow_spectators, require_verified_solves, starts_at, ends_at')
        .eq('id', id)
        .single();

      if (!comp) {
        setLoading(false);
        return;
      }
      setCompetition(comp);
      setIsOwner(user?.id === comp.created_by);
      setIsAdmin(user?.id === comp.created_by);
      const isH2H = comp.competition_type === 'head_to_head';
      setH2H(isH2H);

      if (isH2H) {
        const { data: ts } = await supabase
          .from('tournaments')
          .select('id, status')
          .eq('competition_id', id)
          .neq('status', 'cancelled');
        const statuses = (ts ?? []).map(t => t.status as string);
        setTournamentStatuses(statuses);
        setRegistrationLocked(statuses.some(s => s === 'ready' || s === 'active' || s === 'completed'));
      } else {
        setTournamentStatuses([]);
        setRegistrationLocked(false);
      }

      if (user && user.id !== comp.created_by) {
        const { data: adminRow } = await supabase
          .from('competition_admins')
          .select('id')
          .eq('competition_id', id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (adminRow) setIsAdmin(true);
      }

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
          .in('competition_event_id', eventIds.length > 0 ? eventIds : ['00000000-0000-0000-0000-000000000000'])
          .order('round_number');
        setRounds(allRounds ?? []);
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

        const unlock = await checkCompetitionUnlockAction(id);
        setHasUnlock(unlock.unlocked);

        if (reg) {
          const { data: parts } = await supabase
            .from('round_participants')
            .select('round_id')
            .eq('competitor_id', reg.id);
          setRoundParticipation(new Set((parts ?? []).map(p => p.round_id)));
        }
      }

      setLoading(false);
    };
    fetchData();
  }, [id]);

  const handleRegisterClick = () => {
    if (!competition) return;
    if (competition.visibility === 'private' && !hasUnlock && !isOwner) {
      setPassword('');
      setPasswordOpen(true);
      return;
    }
    void submitRegistration();
  };

  const submitRegistration = async (pwd?: string) => {
    setRegistering(true);
    try {
      const result = await registerForCompetitionAction(id, pwd ?? null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Registered!');
      setIsRegistered(true);
      setHasUnlock(true);
      setCompetitorCount(c => c + 1);
      setPasswordOpen(false);
      setPassword('');
    } finally {
      setRegistering(false);
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

  const displayStatus = deriveCompetitionStatus(rounds, {
    competitionType: competition.competition_type,
    tournamentStatuses,
    status: competition.status,
    startsAt: competition.starts_at,
    endsAt: competition.ends_at,
  });
  const registrationOpen = competitionRegistrationOpen({
    status: competition.status,
    competitionType: competition.competition_type,
    startsAt: competition.starts_at,
    endsAt: competition.ends_at,
    rounds,
    tournamentStatuses,
  });
  const isPrivate = competition.visibility === 'private';

  const getRoundAccess = (round: any): { clickable: boolean; badge: { label: string; variant: string } } => {
    if (isOwner || isAdmin) {
      return {
        clickable: true,
        badge: {
          label: round.status,
          variant: round.status === 'active' ? 'destructive' : round.status === 'completed' ? 'secondary' : 'outline',
        },
      };
    }
    // Completed rounds stay open for viewing results even after registration closes
    if (round.status === 'completed' && (isRegistered || competition.allow_spectators)) {
      return { clickable: true, badge: { label: 'Completed', variant: 'secondary' } };
    }
    if (!registrationOpen && round.status !== 'completed') {
      return {
        clickable: false,
        badge: { label: 'Closed', variant: 'secondary' },
      };
    }
    if (!isRegistered) return round.round_number === 1
      ? { clickable: true, badge: { label: isPrivate && !hasUnlock ? 'Password required' : 'Register to compete', variant: 'outline' } }
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
      <div className="mb-8 rounded-xl border border-border bg-gradient-to-br from-background to-cube-blue/5 p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{competition.name}</h1>
              <Badge variant={
                displayStatus === 'upcoming' ? 'default' :
                displayStatus === 'ongoing' ? 'destructive' :
                'secondary'
              } className="shrink-0">
                {displayStatus === 'upcoming' ? 'Upcoming' :
                  displayStatus === 'ongoing' ? 'Live' :
                  displayStatus === 'cancelled' ? 'Cancelled' : 'Completed'}
              </Badge>
              {isPrivate ? (
                <Badge variant="outline" className="gap-1 border-cube-orange/40 text-cube-orange">
                  <Lock className="h-3 w-3" /> Private
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-border text-text-secondary">
                  <Globe className="h-3 w-3" /> Public
                </Badge>
              )}
              {isH2H && (
                <Badge className="gap-1 bg-cube-blue/10 text-cube-blue border-cube-blue/30">
                  <Swords className="h-3 w-3" /> Head-to-Head
                </Badge>
              )}
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
            {!isOwner && !isRegistered && registrationOpen && (
              <Button onClick={handleRegisterClick} className="gap-2" size="sm" disabled={registering}>
                {isPrivate && !hasUnlock ? <Lock className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {registering ? 'Registering…' : isPrivate && !hasUnlock ? 'Unlock & Register' : 'Register'}
              </Button>
            )}
            {isRegistered && !isOwner && (
              <Badge variant="outline" className="gap-1.5 border-cube-green/30 text-cube-green">
                <Users className="h-3 w-3" /> Registered
              </Badge>
            )}
            {!isOwner && !isRegistered && !registrationOpen && (
              <Badge variant="secondary" className="gap-1.5">
                {registrationLocked ? 'Registration closed (bracket locked)' : 'Registration closed'}
              </Badge>
            )}
            {(isOwner || isAdmin) && (
              <Button variant="outline" size="sm" onClick={() => window.location.href = `/competitions/${id}/admin`}>
                Manage Competition
              </Button>
            )}
          </div>
        </div>
      </div>

      {isH2H ? (
        <CompetitionSection competitionId={id} isAdmin={isAdmin} />
      ) : (
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
                  <Card key={cEvent.id} className="overflow-hidden">
                    <CardHeader className="border-b border-border bg-muted pb-3">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <span className="text-xl">{wcaEvent?.icon}</span>
                        {wcaEvent?.name}
                        <Badge variant="outline" className="ml-auto text-xs">
                          {cEvent.round_count} round{cEvent.round_count > 1 ? 's' : ''}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      {eventRounds.map((round, index) => {
                        const access = getRoundAccess(round);
                        return (
                          <div
                            key={round.id}
                            className={`group flex items-center justify-between gap-4 px-4 py-4 sm:px-5 sm:py-4 ${
                              index > 0 ? 'border-t border-border' : ''
                            } ${
                              access.clickable
                                ? 'cursor-pointer transition-colors hover:bg-surface-hover/40'
                                : 'opacity-60'
                            }`}
                            onClick={() => {
                              if (!access.clickable) return;
                              if (!isRegistered && !isOwner) {
                                handleRegisterClick();
                                return;
                              }
                              window.location.href =
                                `/competitions/${id}/events/${cEvent.event_key}/round/${round.round_number}`;
                            }}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="text-sm font-semibold tracking-tight">Round {round.round_number}</span>
                              {!access.clickable && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                            </div>
                            <div className="flex shrink-0 items-center gap-2.5">
                              <Badge variant={access.badge.variant as any}>
                                {access.badge.label}
                              </Badge>
                              {access.clickable && (
                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-cube-blue" />
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
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <Users className={`h-10 w-10 ${competitorCount === 0 ? 'text-muted-foreground/40' : 'text-cube-blue'}`} />
                <div className="text-center">
                  {competitorCount === 0 ? (
                    <>
                      <p className="font-medium">No competitors registered yet</p>
                      {!isRegistered && !isOwner && registrationOpen && (
                        <Button onClick={handleRegisterClick} variant="outline" size="sm" className="mt-3 gap-2" disabled={registering}>
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
      )}

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-cube-orange" /> Private competition
            </DialogTitle>
            <DialogDescription>
              Enter the competition password to unlock registration. Knowing the password alone does not grant scramble access or allow submitting times — you must register after unlocking.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="join-password">Password</Label>
            <Input
              id="join-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitRegistration(password);
                }
              }}
              placeholder="Competition password"
              className="h-10"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)} disabled={registering}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitRegistration(password)}
              disabled={registering || password.trim().length === 0}
              className="gap-2"
            >
              {registering ? 'Verifying…' : 'Unlock & Register'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
