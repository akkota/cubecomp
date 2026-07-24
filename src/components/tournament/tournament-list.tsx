'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import {
  Trophy, Users, Swords, ArrowRight, Plus, CheckCircle2, Play, XCircle
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

export function TournamentList({ competitionId }: { competitionId: string }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchTournaments = async () => {
      const { data } = await supabase
        .from('tournaments')
        .select('*')
        .eq('competition_id', competitionId)
        .order('created_at', { ascending: false });

      if (data) setTournaments(data);
      setLoading(false);
    };
    fetchTournaments();
  }, [competitionId]);

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'default' | 'destructive' | 'secondary' | 'outline'; label: string }> = {
      draft: { variant: 'outline', label: 'Draft' },
      ready: { variant: 'default', label: 'Ready' },
      active: { variant: 'destructive', label: 'Active' },
      completed: { variant: 'secondary', label: 'Completed' },
      cancelled: { variant: 'outline', label: 'Cancelled' },
    };
    const m = map[status] ?? { variant: 'outline', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  if (loading) {
    return <div className="h-20 animate-pulse rounded-lg bg-surface-hover" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Swords className="h-5 w-5 text-cube-blue" />
          Head-to-Head Tournaments
        </h3>
        <Link href={`/competitions/${competitionId}/tournaments/new`}>
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            New Tournament
          </Button>
        </Link>
      </div>

      {tournaments.length === 0 ? (
        <Card className="border-dashed bg-surface">
          <CardContent className="flex flex-col items-center gap-3 py-8">
            <Swords className="h-8 w-8 text-text-tertiary/30" />
            <p className="text-sm text-text-secondary">No tournaments yet.</p>
            <Link href={`/competitions/${competitionId}/tournaments/new`}>
              <Button variant="outline" size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> Create Tournament
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tournaments.map(t => (
            <Link key={t.id} href={`/competitions/${competitionId}/tournaments/${t.id}`} className="group block">
              <Card className="transition-all duration-200 hover:shadow-md hover:-translate-y-1">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base line-clamp-1 group-hover:text-cube-blue transition-colors">
                      {t.name}
                    </CardTitle>
                    <div className="flex gap-1 shrink-0">
                      {statusBadge(t.status)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2 pt-0 text-xs text-text-secondary">
                  <span className="flex items-center gap-1">
                    <Trophy className="h-3 w-3" />
                    {t.tournament_type === 'double' ? 'Double Elim' : 'Single Elim'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {t.competitor_count} players
                  </span>
                  <span className="ml-auto">
                    {t.match_format === 'bo3' ? 'Bo3' : 'Bo5'}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
