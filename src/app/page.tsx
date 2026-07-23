'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { Calendar, Trophy } from 'lucide-react';
import type { Competition } from '@/types/database';

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
      <div className="mb-12 text-center">
        <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
          Online Rubik&apos;s Cube Competitions
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Create competitions with any of the 17 official WCA events.
          Multi-round formats, official scrambles, live leaderboards.
        </p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <Link href="/competitions/new">
            <Button size="lg" className="gap-2">
              <Trophy className="h-5 w-5" />
              Create Competition
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" size="lg">
              View Dashboard
            </Button>
          </Link>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-2xl font-semibold">Recent Competitions</h2>
        {loading ? (
          <p className="text-muted-foreground">Loading competitions...</p>
        ) : competitions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No competitions yet.{' '}
              <Link href="/competitions/new" className="text-primary hover:underline">
                Create the first one!
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {competitions.map(comp => (
              <Link key={comp.id} href={`/competitions/${comp.id}`}>
                <Card className="h-full transition-colors hover:bg-accent/50">
                  <CardHeader>
                    <CardTitle className="text-lg">{comp.name}</CardTitle>
                    <CardDescription className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(comp.created_at).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Badge variant={
                      comp.status === 'upcoming' ? 'default' :
                      comp.status === 'ongoing' ? 'destructive' :
                      'secondary'
                    }>
                      {comp.status}
                    </Badge>
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
