'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { ArrowRight, Trophy, Users, Sparkles, Calendar, BarChart3, CuboidIcon as CubeIcon } from 'lucide-react';
import type { Competition } from '@/types/database';

const STATUS_VARIANTS: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  upcoming: 'default',
  ongoing: 'destructive',
  completed: 'secondary',
  cancelled: 'outline',
};

function HeroSection() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-background via-background to-cube-blue/5 dark:to-cube-blue/[0.03]">
      {/* Decorative cube grid pattern */}
      <div className="absolute inset-0 bg-cube-grid-light dark:bg-cube-grid opacity-40" />
      {/* Accent blobs */}
      <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-cube-blue/5 blur-3xl" />
      <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-cube-red/5 blur-3xl" />

      <div className="relative z-10 px-6 py-16 sm:px-10 sm:py-20 lg:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cube-blue/20 bg-cube-blue/5 px-4 py-1.5 text-xs font-medium text-cube-blue">
            <Sparkles className="h-3 w-3" />
            Online WCA-style competitions
          </div>

          <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            <span className="text-cube-blue">Cube</span>
            <span className="text-cube-red">Comp</span>
            <span className="text-foreground"> — Run &amp; Compete</span>
            <br />
            <span className="bg-gradient-to-r from-cube-blue via-cube-green to-cube-yellow bg-clip-text text-transparent">
              in Rubik&apos;s Cube Events
            </span>
          </h1>

          <p className="mx-auto mb-8 max-w-xl text-lg text-muted-foreground">
            Create multi-round competitions with any of the 17 official WCA events.
            Generate scrambles, submit times, and track live leaderboards — all online.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/competitions/new">
              <Button size="lg" className="gap-2 shadow-lg shadow-cube-blue/20 dark:shadow-cube-blue/10">
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
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    {
      icon: Trophy,
      title: 'All WCA Events',
      description: 'Supports all 17 official events — from 2x2 to Multi-Blind, with proper notation.',
      color: 'text-cube-blue',
      bg: 'bg-cube-blue/10',
    },
    {
      icon: Users,
      title: 'Multi-Round Format',
      description: 'Set up qualification rounds with automated advancement and tie handling.',
      color: 'text-cube-green',
      bg: 'bg-cube-green/10',
    },
    {
      icon: Sparkles,
      title: 'Instant Scrambles',
      description: 'Generate scramble sequences for every event in under a millisecond.',
      color: 'text-cube-yellow',
      bg: 'bg-cube-yellow/10',
    },
    {
      icon: BarChart3,
      title: 'Live Leaderboards',
      description: 'Real-time results with average-of-5 and mean-of-3 calculations.',
      color: 'text-cube-red',
      bg: 'bg-cube-red/10',
    },
  ];

  return (
    <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {features.map((f, i) => (
        <Card key={i} className="group border-border/50 transition-all duration-300 hover:border-border hover:shadow-md hover:-translate-y-0.5">
          <CardHeader>
            <div className={`mb-2 inline-flex rounded-lg p-2.5 ${f.bg}`}>
              <f.icon className={`h-5 w-5 ${f.color}`} />
            </div>
            <CardTitle className="text-base">{f.title}</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              {f.description}
            </CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

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
    <div>
      <HeroSection />
      <FeaturesSection />

      {/* Recent Competitions */}
      <div className="mt-16">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Recent Competitions</h2>
          <Link href="/competitions/new" className="text-sm font-medium text-cube-blue hover:underline">
            View all &rarr;
          </Link>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => (
              <Card key={i} className="animate-pulse border-border/50">
                <CardContent className="p-6">
                  <div className="mb-3 h-5 w-3/4 rounded bg-muted" />
                  <div className="mb-4 h-3 w-1/2 rounded bg-muted" />
                  <div className="h-6 w-20 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : competitions.length === 0 ? (
          <Card className="border-dashed border-border/50">
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <CubeIcon className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-muted-foreground">No competitions yet.</p>
              <Link href="/competitions/new">
                <Button variant="outline" size="sm" className="gap-2">
                  <Trophy className="h-4 w-4" />
                  Create the first one
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {competitions.map(comp => (
              <Link key={comp.id} href={`/competitions/${comp.id}`} className="group block">
                <Card className="h-full border-border/50 transition-all duration-300 hover:border-border hover:shadow-md hover:-translate-y-0.5">
                  <CardHeader>
                    <CardTitle className="text-base group-hover:text-cube-blue transition-colors">
                      {comp.name}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-1 text-xs">
                      <Calendar className="h-3 w-3" />
                      {new Date(comp.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between">
                    <Badge variant={STATUS_VARIANTS[comp.status] ?? 'outline'}>
                      {comp.status}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0.5" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
