'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@/lib/supabase/client';
import { deriveCompetitionStatus, type CompetitionDisplayStatus } from '@/lib/competition-status';
import type { Competition } from '@/types/database';
import {
  Calendar, Sparkles, Search, Clock, CheckCircle2, Play, Lock, Swords, Trophy,
} from 'lucide-react';

const STATUS_UI: Record<string, { variant: 'default' | 'destructive' | 'secondary' | 'outline'; label: string; icon: typeof Clock }> = {
  upcoming: { variant: 'default', label: 'Upcoming', icon: Clock },
  ongoing: { variant: 'destructive', label: 'Live', icon: Play },
  completed: { variant: 'secondary', label: 'Completed', icon: CheckCircle2 },
};

type CompWithStatus = Competition & {
  displayStatus: CompetitionDisplayStatus;
  competition_type?: string;
};

async function loadCompetitions(supabase: ReturnType<typeof createClient>): Promise<CompWithStatus[]> {
  const { data: comps } = await supabase
    .from('competitions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!comps?.length) return [];

  const compIds = comps.map(c => c.id);
  const { data: events } = await supabase
    .from('competition_events')
    .select('id, competition_id')
    .in('competition_id', compIds);

  const eventIds = (events ?? []).map(e => e.id);
  const { data: allRounds } = await supabase
    .from('rounds')
    .select('id, status, competition_event_id')
    .in('competition_event_id', eventIds.length > 0 ? eventIds : ['00000000-0000-0000-0000-000000000000']);

  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('competition_id, status')
    .in('competition_id', compIds)
    .neq('status', 'cancelled');

  const roundsByComp = new Map<string, Array<{ status: string }>>();
  const tournamentsByComp = new Map<string, string[]>();
  for (const cId of compIds) {
    roundsByComp.set(cId, []);
    tournamentsByComp.set(cId, []);
  }
  for (const r of allRounds ?? []) {
    const event = (events ?? []).find(e => e.id === r.competition_event_id);
    if (event) roundsByComp.get(event.competition_id)?.push(r);
  }
  for (const t of tournaments ?? []) {
    tournamentsByComp.get(t.competition_id)?.push(t.status);
  }

  return comps.map(c => ({
    ...c,
    displayStatus: deriveCompetitionStatus(roundsByComp.get(c.id) ?? [], {
      competitionType: c.competition_type,
      tournamentStatuses: tournamentsByComp.get(c.id) ?? [],
    }),
  }));
}

export function CompetitionBrowser({
  title = 'Browse competitions',
  showCreateLink = true,
}: {
  title?: string;
  showCreateLink?: boolean;
}) {
  const [competitions, setCompetitions] = useState<CompWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | CompetitionDisplayStatus>('all');
  useEffect(() => {
    const client = createClient();
    void loadCompetitions(client).then(list => {
      setCompetitions(list);
      setActiveTab(list.some(c => c.displayStatus === 'ongoing') ? 'ongoing' : 'all');
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    let list = competitions;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q),
      );
    }
    if (activeTab !== 'all') {
      list = list.filter(c => c.displayStatus === activeTab);
    }
    return list;
  }, [competitions, search, activeTab]);

  const counts = useMemo(() => ({
    all: competitions.length,
    upcoming: competitions.filter(c => c.displayStatus === 'upcoming').length,
    ongoing: competitions.filter(c => c.displayStatus === 'ongoing').length,
    completed: competitions.filter(c => c.displayStatus === 'completed').length,
  }), [competitions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search upcoming, live, and completed competitions.
          </p>
        </div>
        {showCreateLink && (
          <Link href="/competitions/new">
            <Button className="gap-2">
              <Sparkles className="h-4 w-4" />
              Create competition
            </Button>
          </Link>
        )}
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search by name or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-10 pl-9"
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (typeof value === 'string') setActiveTab(value as typeof activeTab);
        }}
      >
        <TabsList className="mb-4 flex h-auto flex-wrap gap-1">
          <TabsTrigger value="all" className="gap-1.5">
            All
            <Badge variant="secondary" className="text-xs">{counts.all}</Badge>
          </TabsTrigger>
          <TabsTrigger value="upcoming" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Upcoming
            <Badge variant="secondary" className="text-xs">{counts.upcoming}</Badge>
          </TabsTrigger>
          <TabsTrigger value="ongoing" className="gap-1.5">
            <Play className="h-3.5 w-3.5 text-cube-green" />
            Live
            <Badge variant="destructive" className="text-xs">{counts.ongoing}</Badge>
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Completed
            <Badge variant="secondary" className="text-xs">{counts.completed}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-0">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-6">
                    <div className="mb-3 h-5 w-3/4 rounded bg-surface-hover" />
                    <div className="mb-4 h-3 w-1/2 rounded bg-surface-hover" />
                    <div className="h-6 w-20 rounded bg-surface-hover" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="border-dashed bg-surface">
              <CardContent className="flex flex-col items-center gap-4 py-16">
                <Trophy className="h-10 w-10 text-text-tertiary/30" />
                <p className="text-sm text-text-secondary text-center">
                  {search
                    ? `No competitions match “${search}”.`
                    : activeTab === 'all'
                      ? 'No competitions yet.'
                      : `No ${activeTab === 'ongoing' ? 'live' : activeTab} competitions.`}
                </p>
                {!search && (
                  <Link href="/competitions/new">
                    <Button variant="outline" size="sm" className="gap-2">
                      <Sparkles className="h-4 w-4" /> Create competition
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(comp => {
                const Icon = STATUS_UI[comp.displayStatus]?.icon || Clock;
                const isH2H = comp.competition_type === 'head_to_head';
                return (
                  <Link key={comp.id} href={`/competitions/${comp.id}`} className="group block">
                    <Card className="h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="line-clamp-1 text-lg transition-colors group-hover:text-cube-blue">
                            {comp.name}
                          </CardTitle>
                          <div className={`shrink-0 rounded-md p-1.5 ${
                            comp.displayStatus === 'ongoing' ? 'bg-cube-green/10 text-cube-green' :
                            comp.displayStatus === 'completed' ? 'bg-surface-hover text-text-tertiary' :
                            'bg-cube-blue/10 text-cube-blue'
                          }`}>
                            <Icon className="h-4 w-4" />
                          </div>
                        </div>
                        <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(comp.created_at).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                            })}
                          </span>
                          {comp.visibility === 'private' && (
                            <span className="inline-flex items-center gap-1 text-cube-orange">
                              <Lock className="h-3 w-3" /> Private
                            </span>
                          )}
                          {isH2H && (
                            <span className="inline-flex items-center gap-1 text-cube-blue">
                              <Swords className="h-3 w-3" /> Head-to-Head
                            </span>
                          )}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {comp.description && (
                          <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{comp.description}</p>
                        )}
                        <Badge variant={STATUS_UI[comp.displayStatus]?.variant ?? 'outline'}>
                          {STATUS_UI[comp.displayStatus]?.label ?? comp.displayStatus}
                        </Badge>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
