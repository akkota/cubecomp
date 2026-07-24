'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@/lib/supabase/client';
import { deriveCompetitionStatus } from '@/lib/competition-status';
import { RotatingCube } from '@/components/cube/rotating-cube';
import type { Competition } from '@/types/database';
import {
  ArrowRight, Trophy, Layers, Timer, BarChart3,
  Calendar, Sparkles, Zap, Search, Clock, CheckCircle2, Play, Lock, Swords
} from 'lucide-react';

const STATUS_UI: Record<string, { variant: 'default'|'destructive'|'secondary'|'outline'; label: string; icon: any }> = {
  upcoming: { variant: 'default', label: 'Upcoming', icon: Clock },
  ongoing: { variant: 'destructive', label: 'Live', icon: Play },
  completed: { variant: 'secondary', label: 'Completed', icon: CheckCircle2 },
};

type CompWithStatus = Competition & { displayStatus: ReturnType<typeof deriveCompetitionStatus> };

export default function HomePage() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('upcoming');
  const supabase = createClient();

  useEffect(() => {
    const fetchAll = async () => {
      // Fetch competitions with their events and rounds so we can derive status
      const { data: comps } = await supabase
        .from('competitions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!comps) { setLoading(false); return; }

      // Fetch rounds for all competitions at once to derive status
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

      // Group rounds by competition_id via events
      const roundsByComp = new Map<string, Array<{ status: string }>>();
      // Store all rounds data with empty arrays for comps with no events/rounds
      for (const cId of compIds) roundsByComp.set(cId, []);
      // Append rounds for each competition
      for (const r of (allRounds ?? [])) {
        const event = (events ?? []).find(e => e.id === r.competition_event_id);
        if (event) {
          const entry = roundsByComp.get(event.competition_id);
          if (entry) entry.push(r);
        }
      }

      // Derive display status from rounds
      const enriched: CompWithStatus[] = comps.map(c => ({
        ...c,
        displayStatus: deriveCompetitionStatus(roundsByComp.get(c.id) ?? []),
      }));

      setCompetitions(enriched);
      setActiveTab(enriched.some(c => c.displayStatus === 'ongoing') ? 'ongoing' : 'upcoming');
      setLoading(false);
    };
    fetchAll();
  }, []);

  // Filter by search query (case-insensitive)
  const filtered = useMemo(() => {
    if (!search.trim()) return competitions as CompWithStatus[];
    const q = search.toLowerCase();
    return (competitions as CompWithStatus[]).filter(c => c.name.toLowerCase().includes(q));
  }, [competitions, search]);

  const upcoming = filtered.filter(c => c.displayStatus === 'upcoming');
  const ongoing = filtered.filter(c => c.displayStatus === 'ongoing');
  const completed = filtered.filter(c => c.displayStatus === 'completed');

  return (
    <div className="space-y-24 pb-16">
      <HeroSection />
      <HowItWorksSection />

      {/* Competitions section */}
      <section>
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Competitions</h2>
          <Link href="/competitions/new"
            className="hidden items-center gap-1 text-sm font-medium text-cube-blue hover:underline sm:flex">
            Create new <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            type="text"
            placeholder="Search competitions by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-10 max-w-md"
          />
        </div>

        {/* Tab sections */}
        <Tabs value={activeTab} onValueChange={(value) => {
          if (typeof value === 'string') setActiveTab(value);
        }}>
          <TabsList className="mb-6">
            <TabsTrigger value="upcoming" className="gap-2">
              <Clock className="h-4 w-4" />
              Upcoming
              <Badge variant="secondary" className="ml-1 text-xs">{upcoming.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="ongoing" className="gap-2">
              <Play className="h-4 w-4 text-cube-green" />
              Live
              <Badge variant="destructive" className="ml-1 text-xs">{ongoing.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="completed" className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Completed
              <Badge variant="secondary" className="ml-1 text-xs">{completed.length}</Badge>
            </TabsTrigger>
          </TabsList>

          {(['upcoming', 'ongoing', 'completed'] as const).map(tab => {
            const list = { upcoming, ongoing, completed }[tab];
            return (
              <TabsContent key={tab} value={tab}>
                {loading ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map(i => (
                      <Card key={i} className="animate-pulse">
                        <CardContent className="p-6">
                          <div className="mb-3 h-5 w-3/4 rounded bg-surface-hover" />
                          <div className="mb-4 h-3 w-1/2 rounded bg-surface-hover" />
                          <div className="h-6 w-20 rounded bg-surface-hover" />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : list.length === 0 ? (
                  <Card className="border-dashed bg-surface">
                    <CardContent className="flex flex-col items-center gap-4 py-16">
                      <Trophy className="h-10 w-10 text-text-tertiary/30" />
                      <p className="text-sm text-text-secondary">
                        {search ? `No "${search}" matches in ${tab}` : `No ${tab} competitions.`}
                      </p>
                      {!search && tab === 'upcoming' && (
                        <Link href="/competitions/new">
                          <Button variant="outline" size="sm" className="gap-2">
                            <Sparkles className="h-4 w-4" /> Create Competition
                          </Button>
                        </Link>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map(comp => {
                      const Icon = STATUS_UI[comp.displayStatus]?.icon || Clock;
                      return (
                      <Link key={comp.id} href={`/competitions/${comp.id}`} className="group block">
                        <Card className="h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1.5">
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between gap-2">
                              <CardTitle className="line-clamp-1 text-lg group-hover:text-cube-blue transition-colors">
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
                            <CardDescription className="flex items-center gap-1.5 text-xs">
                              <Calendar className="h-3 w-3" />
                              {new Date(comp.created_at).toLocaleDateString('en-US', {
                                month: 'short', day: 'numeric', year: 'numeric',
                              })}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="flex items-center justify-between gap-2 pt-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant={STATUS_UI[comp.displayStatus].variant} className="transition-colors">
                                {STATUS_UI[comp.displayStatus].label}
                              </Badge>
                              {comp.visibility === 'private' && (
                                <Badge variant="outline" className="gap-1 border-cube-orange/40 text-cube-orange">
                                  <Lock className="h-3 w-3" /> Private
                                </Badge>
                              )}
                              {comp.competition_type === 'head_to_head' && (
                                <Badge variant="outline" className="gap-1 border-cube-blue/40 text-cube-blue">
                                  <Swords className="h-3 w-3" /> H2H
                                </Badge>
                              )}
                            </div>
                            <ArrowRight className="h-4 w-4 shrink-0 text-text-tertiary opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-1" />
                          </CardContent>
                        </Card>
                      </Link>
                    )})}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </section>
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────── */
function HeroSection() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-cube-blue/6 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-cube-red/5 blur-3xl" />
        <div className="absolute top-1/2 left-1/3 h-64 w-64 rounded-full bg-cube-green/4 blur-3xl" />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-cube-grid opacity-[0.06] dark:opacity-[0.03]" />

      <div className="relative z-10 flex flex-col items-center gap-10 px-6 py-16 sm:px-12 sm:py-24 lg:flex-row lg:items-center lg:justify-between lg:gap-20 lg:px-16 lg:py-28">
        <div className="max-w-xl text-center lg:text-left">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cube-blue/20 bg-cube-blue/5 px-4 py-1.5 text-xs font-medium text-cube-blue">
            <Zap className="h-3 w-3" />
            <span>17 WCA events · multi-round · live leaderboards</span>
          </div>
          <h1 className="mb-5 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-7xl">
            Compete.<br />
            <span className="text-gradient">Solve.</span>{' '}
            <span className="text-cube-red">Climb.</span>
          </h1>
          <p className="mb-8 max-w-md text-base leading-relaxed text-text-secondary sm:text-lg lg:text-xl">
            Run and join online Rubik&apos;s Cube competitions with official
            WCA-format events, instant scrambles, and real-time leaderboards.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link href="/competitions/new">
              <Button size="lg" className="gap-2 shadow-md shadow-cube-blue/20 h-12 px-6 text-base">
                <Trophy className="h-5 w-5" />
                Create Competition
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline" size="lg" className="gap-2 h-12 px-6 text-base">
                <BarChart3 className="h-5 w-5" />
                Browse Events
              </Button>
            </Link>
          </div>
        </div>
        <div className="flex-shrink-0">
          <div className="relative">
            <div className="absolute inset-0 -inset-4 rounded-full bg-cube-blue/10 blur-3xl" />
            <div className="absolute -inset-8 rounded-full bg-cube-green/5 blur-2xl" />
            <RotatingCube className="relative z-10" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── How It Works ──────────────────────────────────── */
function HowItWorksSection() {
  const steps = [
    { step: '01', icon: Layers, title: 'Pick your events', desc: 'Choose from all 17 official WCA events. Set up multiple rounds with automatic advancement.', color: 'bg-cube-blue/10 text-cube-blue border-cube-blue/20' },
    { step: '02', icon: Timer, title: 'Submit your solves', desc: 'Instant scrambles per round. Enter your times or mark DNFs right from the timer screen.', color: 'bg-cube-green/10 text-cube-green border-cube-green/20' },
    { step: '03', icon: BarChart3, title: 'Climb the ranks', desc: 'Live leaderboards update instantly with Ao5/Mo3 calculations. Top competitors advance each round.', color: 'bg-cube-orange/10 text-cube-orange border-cube-orange/20' },
  ];

  return (
    <section>
      <div className="mb-8 text-center">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-cube-blue">How It Works</p>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Run a competition in three steps</h2>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.step} className="animate-slide-up group relative rounded-xl border border-border bg-surface p-6 transition-all duration-300 hover:border-border hover:shadow-md hover:-translate-y-1" style={{ animationDelay: `${i * 100}ms` }}>
            <span className="mb-4 block font-mono text-4xl font-bold text-text-tertiary/30 group-hover:text-text-tertiary/50 transition-colors">{s.step}</span>
            <div className={`mb-3 inline-flex rounded-lg border p-2.5 ${s.color}`}><s.icon className="h-5 w-5" /></div>
            <h3 className="mb-2 text-lg font-semibold">{s.title}</h3>
            <p className="text-sm leading-relaxed text-text-secondary">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
