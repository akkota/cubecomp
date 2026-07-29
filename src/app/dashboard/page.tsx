'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { deriveCompetitionStatus } from '@/lib/competition-status';
import { PlusCircle, Trophy, Calendar, ArrowRight, CuboidIcon as CubeIcon, Shield, UserCheck, Play, CheckCircle2, Lock } from 'lucide-react';
import type { Competition } from '@/types/database';

const STATUS_VARIANTS: Record<string, 'default'|'destructive'|'secondary'> = { upcoming:'default',ongoing:'destructive',completed:'secondary' };
const STATUS_LABELS: Record<string, string> = { upcoming:'Upcoming',ongoing:'Live',completed:'Completed' };

type CompWithStatus = Competition & { _displayStatus: ReturnType<typeof deriveCompetitionStatus> };

function CompetitionList({
  list,
  emptyMsg,
  emptyAction,
  manageLabel,
}: {
  list: CompWithStatus[];
  emptyMsg: string;
  emptyAction?: React.ReactNode;
  manageLabel?: boolean;
}) {
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted px-4 py-12">
        <CubeIcon className="h-8 w-8 text-text-tertiary/30" />
        <p className="text-sm text-text-secondary">{emptyMsg}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5 sm:gap-3">
      {list.map(c => (
        <li key={c.id}>
          <div className="group flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-4 transition-all duration-200 hover:bg-surface-hover hover:shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-4">
            <Link href={`/competitions/${c.id}`} className="min-w-0 flex-1 space-y-1.5">
              <h3 className="truncate text-base font-semibold tracking-tight text-foreground transition-colors group-hover:text-cube-blue">
                {c.name}
              </h3>
              <p className="flex items-center gap-1.5 text-xs text-text-tertiary">
                <Calendar className="h-3 w-3 shrink-0" />
                {new Date(c.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </Link>

            <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end sm:gap-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant={STATUS_VARIANTS[c._displayStatus] ?? 'outline'}
                  className="h-6 px-2.5 text-[11px] font-medium"
                >
                  {STATUS_LABELS[c._displayStatus] || c._displayStatus}
                </Badge>
                {c.visibility === 'private' && (
                  <Badge variant="outline" className="h-6 gap-1 border-cube-orange/40 px-2 text-[11px] font-medium text-cube-orange">
                    <Lock className="h-3 w-3" /> Private
                  </Badge>
                )}
                {manageLabel && (
                  <Link href={`/competitions/${c.id}/admin`}>
                    <Button variant="outline" size="sm" className="h-7 cursor-pointer px-2.5 text-xs">
                      Manage
                    </Button>
                  </Link>
                )}
              </div>
              <Link
                href={`/competitions/${c.id}`}
                aria-label={`Open ${c.name}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-all group-hover:bg-cube-blue/10 group-hover:text-cube-blue"
              >
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const [created, setCreated] = useState<CompWithStatus[]>([]);
  const [adminOf, setAdminOf] = useState<CompWithStatus[]>([]);
  const [competing, setCompeting] = useState<CompWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const go = async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }

      const { data: prof } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', u.id)
        .maybeSingle();
      setUsername(prof?.username ?? null);

      // ── 1. Competitions I created ──
      const { data: createdComps } = await supabase
        .from('competitions').select('*').eq('created_by', u.id).order('created_at', { ascending: false });
      const createdList = createdComps ?? [];

      // ── 2. Competitions I'm admin for ──
      const { data: adminRows } = await supabase
        .from('competition_admins').select('competition_id').eq('user_id', u.id);
      const adminCompIds = (adminRows ?? []).map(r => r.competition_id);
      let adminList: any[] = [];
      if (adminCompIds.length > 0) {
        const { data: adComps } = await supabase
          .from('competitions').select('*').in('id', adminCompIds).order('created_at', { ascending: false });
        adminList = adComps ?? [];
      }

      // ── 3. Competitions I'm competing in ──
      const { data: competitorRows } = await supabase
        .from('competitors').select('competition_id').eq('user_id', u.id);
      const compCompIds = (competitorRows ?? []).map(r => r.competition_id);
      let competingList: any[] = [];
      if (compCompIds.length > 0) {
        const { data: coComps } = await supabase
          .from('competitions').select('*').in('id', compCompIds).order('created_at', { ascending: false });
        competingList = coComps ?? [];
      }

      // ── Derive status for all competitions ──
      const allCompIds = [...new Set([...createdList.map(c => c.id), ...adminList.map(c => c.id), ...competingList.map(c => c.id)])];

      const { data: allEvents } = await supabase
        .from('competition_events').select('id, competition_id').in('competition_id', allCompIds);
      const eventIds = (allEvents ?? []).map(e => e.id);
      const { data: allRounds } = await supabase
        .from('rounds').select('id, status, competition_event_id')
        .in('competition_event_id', eventIds.length > 0 ? eventIds : ['00000000-0000-0000-0000-000000000000']);

      const roundsByComp = new Map<string, Array<{ status: string }>>();
      for (const cId of allCompIds) roundsByComp.set(cId, []);
      for (const r of (allRounds ?? [])) {
        const evt = (allEvents ?? []).find(e => e.id === r.competition_event_id);
        if (evt) { const entry = roundsByComp.get(evt.competition_id); if (entry) entry.push(r); }
      }

      const attachStatus = (list: any[]) =>
        list.map(c => ({
          ...c,
          _displayStatus: deriveCompetitionStatus(roundsByComp.get(c.id) ?? [], {
            status: c.status,
            startsAt: c.starts_at,
            endsAt: c.ends_at,
            competitionType: c.competition_type,
          }),
        })) as CompWithStatus[];

      // Filter out created comps from admin list (no duplicates)
      const adminFiltered = adminList.filter(a => !createdList.some(c => c.id === a.id));

      setCreated(attachStatus(createdList));
      setAdminOf(attachStatus(adminFiltered));
      setCompeting(attachStatus(competingList));
      setLoading(false);
    };
    go();
  }, [router]);

  if (loading) return (
    <div className="space-y-8">
      <div className="rounded-xl border border-border bg-surface p-6 sm:p-8 animate-pulse">
        <div className="h-8 w-48 rounded bg-surface-hover" />
        <div className="mt-2 h-4 w-64 rounded bg-surface-hover" />
      </div>
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {[1,2,3,4].map(i => <div key={i} className="h-24 rounded-lg border border-border bg-surface animate-pulse" />)}
      </div>
    </div>
  );

  const liveCount = created.filter(c => c._displayStatus === 'ongoing').length;
  const competingLive = competing.filter(c => c._displayStatus === 'ongoing').length;
  const competingUpcoming = competing.filter(c => c._displayStatus === 'upcoming').length;
  const competingCompleted = competing.filter(c => c._displayStatus === 'completed').length;
  const adminCount = created.length + adminOf.length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dashboard</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Welcome back{username ? `, @${username}` : ''}
            </p>
          </div>
          <Link href="/competitions/new">
            <Button className="gap-2 shadow-md shadow-cube-blue/20"><PlusCircle className="h-4 w-4" />New Competition</Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {[
          { label:'Created', value:created.length, icon:Trophy, color:'text-cube-blue bg-cube-blue/10' },
          { label:'Live', value:liveCount, icon:Play, color:'text-cube-green bg-cube-green/10' },
          { label:'Admin', value:adminCount, icon:Shield, color:'text-cube-orange bg-cube-orange/10' },
          { label:'Competing', value:competing.length, icon:UserCheck, color:'text-cube-yellow bg-cube-yellow/10' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4 sm:p-5">
              <div className={`rounded-lg p-2 ${s.color}`}><s.icon className="h-5 w-5"/></div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">{s.label}</p>
                <p className="text-xl sm:text-2xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Sections */}
      <div className="space-y-6 sm:space-y-8">
        <Card>
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="h-5 w-5 text-cube-blue" /> My Competitions
            </CardTitle>
            <CardDescription>Competitions you&apos;ve created</CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            <CompetitionList
              list={created}
              emptyMsg="Create your first competition to get started"
              emptyAction={
                <Link href="/competitions/new">
                  <Button variant="outline" size="sm" className="gap-2">
                    <PlusCircle className="h-4 w-4" />Create Competition
                  </Button>
                </Link>
              }
              manageLabel
            />
          </CardContent>
        </Card>

        {adminOf.length > 0 && (
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5 text-cube-orange" /> Admin Of
              </CardTitle>
              <CardDescription>Competitions you help manage</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <CompetitionList list={adminOf} emptyMsg="" manageLabel />
            </CardContent>
          </Card>
        )}

        {competingUpcoming > 0 && (
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5 text-cube-blue" /> Upcoming Competitions
              </CardTitle>
              <CardDescription>Competitions you&apos;re registered for that haven&apos;t started yet</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <CompetitionList
                list={competing.filter(c => c._displayStatus === 'upcoming')}
                emptyMsg=""
              />
            </CardContent>
          </Card>
        )}

        {competingLive > 0 && (
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Play className="h-5 w-5 text-cube-green" /> Currently Competing
              </CardTitle>
              <CardDescription>Active competitions you&apos;re registered for</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <CompetitionList
                list={competing.filter(c => c._displayStatus === 'ongoing')}
                emptyMsg=""
              />
            </CardContent>
          </Card>
        )}

        {competingCompleted > 0 && (
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-text-secondary" /> Completed Competitions
              </CardTitle>
              <CardDescription>Competitions you&apos;ve finished competing in</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <CompetitionList
                list={competing.filter(c => c._displayStatus === 'completed')}
                emptyMsg=""
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
