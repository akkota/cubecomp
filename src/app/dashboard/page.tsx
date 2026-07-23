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

const V: Record<string, 'default'|'destructive'|'secondary'|'outline'> = { upcoming:'default',ongoing:'destructive',completed:'secondary',cancelled:'outline' };

export default function DashboardPage() {
  const [my, setMy] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const go = async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }
      setUser(u);
      const { data } = await supabase.from('competitions').select('*').eq('created_by', u.id).order('created_at', { ascending: false });
      setMy(data ?? []);
      setLoading(false);
    };
    go();
  }, [router]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="rounded-xl border border-border/30 bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dashboard</h1>
            <p className="mt-1 text-sm text-text-secondary">Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}</p>
          </div>
          <Link href="/competitions/new">
            <Button className="gap-2 shadow-md shadow-cube-blue/20"><PlusCircle className="h-4 w-4" />New Competition</Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label:'Total', value:loading?'…':my.length, icon:Trophy, color:'text-cube-blue bg-cube-blue/10' },
          { label:'Live', value:loading?'…':my.filter(c=>c.status==='ongoing').length, icon:Users, color:'text-cube-green bg-cube-green/10' },
          { label:'Completed', value:loading?'…':my.filter(c=>c.status==='completed').length, icon:Calendar, color:'text-cube-orange bg-cube-orange/10' },
        ].map(s => (
          <Card key={s.label} className="border-border/30">
            <CardContent className="flex items-center gap-3 p-5">
              <div className={`rounded-lg p-2 ${s.color}`}><s.icon className="h-5 w-5"/></div>
              <div><p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">{s.label}</p><p className="text-2xl font-bold">{s.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* My competitions */}
      <Card className="border-border/30">
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Trophy className="h-5 w-5 text-cube-blue"/>My Competitions</CardTitle><CardDescription>Competitions you&apos;ve created</CardDescription></CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">{[1,2].map(i=><div key={i} className="flex items-center justify-between rounded-lg border border-border/30 p-4 animate-pulse"><div className="space-y-2"><div className="h-4 w-40 rounded bg-surface-hover"/><div className="h-3 w-24 rounded bg-surface-hover"/></div><div className="h-8 w-20 rounded bg-surface-hover"/></div>)}</div>
          ) : my.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-10">
              <CubeIcon className="h-10 w-10 text-text-tertiary/30"/>
              <p className="font-medium">No competitions yet</p>
              <p className="text-sm text-text-secondary">Create your first competition to get started</p>
              <Link href="/competitions/new"><Button variant="outline" size="sm" className="gap-2"><PlusCircle className="h-4 w-4"/>Create Competition</Button></Link>
            </div>
          ) : (
            <div className="divide-y divide-border/30 rounded-lg border border-border/30">
              {my.map(c=>(
                <Link key={c.id} href={`/competitions/${c.id}`} className="group flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-surface-hover/50 first:rounded-t-lg last:rounded-b-lg">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium group-hover:text-cube-blue transition-colors">{c.name}</h3>
                    <p className="flex items-center gap-2 text-xs text-text-secondary"><Calendar className="h-3 w-3"/>{new Date(c.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={V[c.status]??'outline'}>{c.status}</Badge>
                    <Link href={`/competitions/${c.id}/admin`}><Button variant="ghost" size="sm" className="text-xs">Manage</Button></Link>
                    <ArrowRight className="h-4 w-4 text-text-tertiary opacity-0 transition-all group-hover:opacity-100"/>
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
