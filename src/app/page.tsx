'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { RotatingCube } from '@/components/cube/rotating-cube';
import type { Competition } from '@/types/database';
import {
  ArrowRight, Trophy, UserPlus, Layers, Timer, Upload, BarChart3,
  Calendar, Sparkles, Zap
} from 'lucide-react';

const STATUS_VARIANTS: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  upcoming: 'default', ongoing: 'destructive', completed: 'secondary', cancelled: 'outline',
};

export default function HomePage() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchCompetitions = async () => {
      const { data } = await supabase
        .from('competitions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      setCompetitions(data ?? []);
      setLoading(false);
    };
    fetchCompetitions();
  }, []);

  return (
    <div className="space-y-24 pb-16">
      {/* ═══════ HERO ═══════ */}
      <HeroSection />

      {/* ═══════ HOW IT WORKS ═══════ */}
      <HowItWorksSection />

      {/* ═══════ FEATURED ═══════ */}
      <FeaturedSection competitions={competitions} loading={loading} />
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────── */
function HeroSection() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/30 bg-surface">
      {/* Glow blobs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-cube-blue/6 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-cube-red/5 blur-3xl" />
        <div className="absolute top-1/2 left-1/3 h-64 w-64 rounded-full bg-cube-green/4 blur-3xl" />
      </div>
      {/* Grid overlay */}
      <div className="pointer-events-none absolute inset-0 bg-cube-grid opacity-[0.06] dark:opacity-[0.03]" />

      <div className="relative z-10 flex flex-col items-center gap-12 px-6 py-16 sm:px-12 sm:py-20 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:px-16 lg:py-24">
        {/* Left — text */}
        <div className="max-w-xl text-center lg:text-left">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cube-blue/20 bg-cube-blue/5 px-3 py-1 text-xs font-medium text-cube-blue">
            <Zap className="h-3 w-3" />
            17 WCA events · multi-round · live leaderboards
          </div>

          <h1 className="mb-4 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            Compete.<br />
            <span className="text-gradient">Solve.</span>{' '}
            <span className="text-cube-red">Climb.</span>
          </h1>

          <p className="mb-8 text-base leading-relaxed text-text-secondary sm:text-lg">
            Create and join online Rubik&apos;s Cube competitions with official
            WCA-format events, instant scrambles, and real-time leaderboards.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link href="/competitions/new">
              <Button size="lg" className="gap-2 shadow-md shadow-cube-blue/20">
                <Trophy className="h-5 w-5" />
                Create Competition
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="outline" size="lg" className="gap-2">
                <BarChart3 className="h-5 w-5" />
                Dashboard
              </Button>
            </Link>
          </div>
        </div>

        {/* Right — 3D cube */}
        <div className="flex-shrink-0">
          <div className="relative">
            <div className="absolute inset-0 scale-150 rounded-full bg-cube-blue/10 blur-3xl" />
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
    {
      step: '01',
      icon: Layers,
      title: 'Pick your events',
      desc: 'Choose from all 17 official WCA events. Set up multiple rounds with automatic advancement.',
      color: 'bg-cube-blue/10 text-cube-blue border-cube-blue/20',
    },
    {
      step: '02',
      icon: Timer,
      title: 'Submit your solves',
      desc: 'Get instant scrambles generated per round. Enter your times or mark DNFs right from the timer screen.',
      color: 'bg-cube-green/10 text-cube-green border-cube-green/20',
    },
    {
      step: '03',
      icon: BarChart3,
      title: 'Climb the ranks',
      desc: 'Live leaderboards update instantly with Ao5/Mo3 calculations. Top competitors advance each round.',
      color: 'bg-cube-orange/10 text-cube-orange border-cube-orange/20',
    },
  ];

  return (
    <section>
      <div className="mb-8 text-center">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-cube-blue">How It Works</p>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Run a competition in three steps
        </h2>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <div
            key={s.step}
            className="animate-slide-up group relative rounded-xl border border-border/40 bg-surface p-6 transition-all duration-300 hover:border-border hover:shadow-md hover:-translate-y-1"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            {/* Step number */}
            <span className="mb-4 block font-mono text-4xl font-bold text-text-tertiary/30 group-hover:text-text-tertiary/50 transition-colors">
              {s.step}
            </span>
            {/* Icon badge */}
            <div className={`mb-3 inline-flex rounded-lg border p-2.5 ${s.color}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">{s.title}</h3>
            <p className="text-sm leading-relaxed text-text-secondary">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Featured Competitions ──────────────────────────── */
function FeaturedSection({ competitions, loading }: { competitions: Competition[]; loading: boolean }) {
  return (
    <section>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-cube-blue">Featured</p>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Recent Competitions</h2>
        </div>
        <Link href="/competitions/new"
          className="hidden items-center gap-1 text-sm font-medium text-cube-blue hover:underline sm:flex">
          Create new <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse border-border/30">
              <CardContent className="p-6">
                <div className="mb-3 h-5 w-3/4 rounded bg-surface-hover" />
                <div className="mb-4 h-3 w-1/2 rounded bg-surface-hover" />
                <div className="h-6 w-20 rounded bg-surface-hover" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : competitions.length === 0 ? (
        <Card className="border-dashed border-border/30 bg-surface">
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <Trophy className="h-10 w-10 text-text-tertiary/30" />
            <p className="text-sm text-text-secondary">No competitions yet — be the first to create one.</p>
            <Link href="/competitions/new">
              <Button variant="outline" size="sm" className="gap-2">
                <Sparkles className="h-4 w-4" /> Create Competition
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {competitions.slice(0, 6).map(comp => (
            <Link key={comp.id} href={`/competitions/${comp.id}`} className="group block">
              <Card className="h-full border-border/30 transition-all duration-300 hover:border-cube-blue/20 hover:shadow-md hover:-translate-y-1 hover:shadow-glow-blue/20">
                <CardHeader className="pb-3">
                  <CardTitle className="line-clamp-1 text-lg group-hover:text-cube-blue transition-colors">
                    {comp.name}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1 text-xs">
                    <Calendar className="h-3 w-3" />
                    {new Date(comp.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                  <Badge variant={STATUS_VARIANTS[comp.status] ?? 'outline'}>
                    {comp.status}
                  </Badge>
                  <ArrowRight className="h-4 w-4 text-text-tertiary opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0.5" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
