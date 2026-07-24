'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { hasTournamentWizardDraft } from '@/components/tournament/create-tournament';
import {
  Trophy, Users, Swords, Plus, Play, ArrowRight,
} from 'lucide-react';

interface Tournament {
  id: string;
  competition_id: string;
  name: string;
  description: string;
  tournament_type: 'single' | 'double';
  seeding_type: 'seeded' | 'unseeded';
  match_format: 'bo3' | 'bo5';
  scramble_source: 'generated' | 'external';
  status: string;
  competitor_count: number;
  champion_id: string | null;
  created_at: string;
}

export function TournamentList({
  competitionId,
  isAdmin = false,
}: {
  competitionId: string;
  isAdmin?: boolean;
}) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardDraft, setWizardDraft] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    if (isAdmin) {
      setWizardDraft(hasTournamentWizardDraft(competitionId));
    }

    const fetchTournament = async () => {
      const { data } = await supabase
        .from('tournaments')
        .select('*')
        .eq('competition_id', competitionId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setTournament(data ?? null);
      setLoading(false);
    };
    void fetchTournament();
  }, [competitionId, isAdmin]);

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'default' | 'destructive' | 'secondary' | 'outline'; label: string }> = {
      draft: { variant: 'outline', label: 'Draft' },
      ready: { variant: 'default', label: 'Bracket Ready' },
      active: { variant: 'destructive', label: 'Live' },
      completed: { variant: 'secondary', label: 'Completed' },
      cancelled: { variant: 'outline', label: 'Cancelled' },
    };
    const m = map[status] ?? { variant: 'outline', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  if (loading) {
    return <div className="h-20 animate-pulse rounded-lg bg-surface-hover" />;
  }

  const setupHref =
    tournament?.status === 'draft'
      ? `/competitions/${competitionId}/tournaments/new?resume=${tournament.id}`
      : wizardDraft && !tournament
        ? `/competitions/${competitionId}/tournaments/new`
        : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Swords className="h-5 w-5 text-cube-blue" />
          Head-to-Head Tournament
        </h3>
        {isAdmin && !tournament && (
          <Link href={`/competitions/${competitionId}/tournaments/new?fresh=1`}>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              Set up tournament
            </Button>
          </Link>
        )}
      </div>

      {!tournament && !wizardDraft ? (
        <Card className="border-dashed bg-surface">
          <CardContent className="flex flex-col items-center gap-3 py-8">
            <Swords className="h-8 w-8 text-text-tertiary/30" />
            <p className="text-sm text-text-secondary text-center max-w-sm">
              {isAdmin
                ? 'This competition has one head-to-head tournament. Set it up when competitors are ready.'
                : 'No tournament yet. Check back once the organizer sets it up.'}
            </p>
            {isAdmin && (
              <Link href={`/competitions/${competitionId}/tournaments/new?fresh=1`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <Plus className="h-4 w-4" /> Set up tournament
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : !tournament && wizardDraft ? (
        <Card className="border-dashed bg-surface">
          <CardContent className="flex flex-col items-center gap-3 py-8">
            <Swords className="h-8 w-8 text-cube-blue/40" />
            <p className="text-sm text-text-secondary">You have an unfinished tournament draft.</p>
            <Link href={`/competitions/${competitionId}/tournaments/new`}>
              <Button size="sm" className="gap-2">
                <Play className="h-4 w-4" /> Continue setup
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : tournament ? (
        <Link
          href={
            tournament.status === 'draft' && setupHref
              ? setupHref
              : `/competitions/${competitionId}/tournaments/${tournament.id}`
          }
          className="group block"
        >
          <Card className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base line-clamp-1 group-hover:text-cube-blue transition-colors">
                    {tournament.name}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {tournament.status === 'draft'
                      ? 'Setup in progress — finish the bracket when ready.'
                      : tournament.status === 'ready'
                        ? 'Bracket is locked. Start the tournament when everyone is ready.'
                        : tournament.status === 'active'
                          ? 'Tournament is live.'
                          : 'Tournament finished.'}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {statusBadge(tournament.status)}
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3 pt-0 text-xs text-text-secondary">
              <span className="flex items-center gap-1">
                <Trophy className="h-3 w-3" />
                {tournament.tournament_type === 'double' ? 'Double Elim' : 'Single Elim'}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {tournament.competitor_count} players
              </span>
              <span className="ml-auto">{tournament.match_format === 'bo3' ? 'Bo3' : 'Bo5'}</span>
              {isAdmin && tournament.status === 'draft' && (
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground">
                  <Play className="h-3.5 w-3.5" />
                  Continue setup
                </span>
              )}
            </CardContent>
          </Card>
        </Link>
      ) : null}
    </div>
  );
}
