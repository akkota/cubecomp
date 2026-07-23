'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { PlusCircle, Trophy, Users, Calendar, ArrowRight, CuboidIcon as CubeIcon } from 'lucide-react';
import type { Competition } from '@/types/database';

const STATUS_VARIANTS: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  upcoming: 'default',
  ongoing: 'destructive',
  completed: 'secondary',
  cancelled: 'outline',
};

export default function DashboardPage() {
  const [myCompetitions, setMyCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setUser(user);

      const { data: competitions } = await supabase
        .from('competitions')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      setMyCompetitions(competitions ?? []);
      setLoading(false);
    };
    fetchData();
  }, [router]);

  return (
    <div>
      {/* Page header */}
      <div className="mb-8 rounded-xl border border-border/50 bg-gradient-to-br from-background to-cube-blue/5 p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}
            </p>
          </div>
          <Link href="/competitions/new">
            <Button className="gap-2 shadow-md shadow-cube-blue/20 dark:shadow-cube-blue/10">
              <PlusCircle className="h-4 w-4" />
              New Competition
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <div className="rounded-lg bg-cube-blue/10 p-2">
              <Trophy className="h-5 w-5 text-cube-blue" />
            </div>
            <span className="text-2xl font-bold">{loading ? '...' : myCompetitions.length}</span>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Live</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <div className="rounded-lg bg-cube-green/10 p-2">
              <Users className="h-5 w-5 text-cube-green" />
            </div>
            <span className="text-2xl font-bold">
              {loading ? '...' : myCompetitions.filter(c => c.status === 'ongoing').length}
            </span>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Completed</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <div className="rounded-lg bg-cube-orange/10 p-2">
              <Calendar className="h-5 w-5 text-cube-orange" />
            </div>
            <span className="text-2xl font-bold">
              {loading ? '...' : myCompetitions.filter(c => c.status === 'completed').length}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* My Competitions */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5 text-cube-blue" />
            My Competitions
          </CardTitle>
          <CardDescription>
            Competitions you&apos;ve created
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-border/50 p-4 animate-pulse">
                  <div className="space-y-2">
                    <div className="h-4 w-40 rounded bg-muted" />
                    <div className="h-3 w-24 rounded bg-muted" />
                  </div>
                  <div className="h-8 w-20 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : myCompetitions.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-10">
              <CubeIcon className="h-10 w-10 text-muted-foreground/40" />
              <div className="text-center">
                <p className="font-medium">No competitions yet</p>
                <p className="text-sm text-muted-foreground">Create your first competition to get started</p>
              </div>
              <Link href="/competitions/new">
                <Button variant="outline" size="sm" className="gap-2">
                  <PlusCircle className="h-4 w-4" />
                  Create Competition
                </Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border/50 rounded-lg border border-border/50">
              {myCompetitions.map(comp => (
                <Link
                  key={comp.id}
                  href={`/competitions/${comp.id}`}
                  className="group flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-muted/50 first:rounded-t-lg last:rounded-b-lg"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium group-hover:text-cube-blue transition-colors">
                      {comp.name}
                    </h3>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {new Date(comp.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={STATUS_VARIANTS[comp.status] ?? 'outline'}>
                      {comp.status}
                    </Badge>
                    <Link href={`/competitions/${comp.id}/admin`}>
                      <Button variant="ghost" size="sm" className="text-xs">
                        Manage
                      </Button>
                    </Link>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:opacity-100" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
