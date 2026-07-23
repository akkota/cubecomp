'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { PlusCircle, Trophy, Users } from 'lucide-react';
import type { Competition } from '@/types/database';

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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome{user?.email ? `, ${user.email}` : ''}
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/competitions/new">
            <Button className="gap-2">
              <PlusCircle className="h-4 w-4" />
              New Competition
            </Button>
          </Link>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            My Competitions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : myCompetitions.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground">
              <p className="mb-4">You haven&apos;t created any competitions yet.</p>
              <Link href="/competitions/new">
                <Button>Create Your First Competition</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {myCompetitions.map(comp => (
                <Link key={comp.id} href={`/competitions/${comp.id}`}>
                  <Card className="transition-colors hover:bg-accent/50">
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <h3 className="font-semibold">{comp.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {new Date(comp.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={
                          comp.status === 'upcoming' ? 'default' :
                          comp.status === 'ongoing' ? 'destructive' :
                          'secondary'
                        }>
                          {comp.status}
                        </Badge>
                        <Link href={`/competitions/${comp.id}/admin`}>
                          <Button variant="ghost" size="sm">Manage</Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
