'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@/lib/supabase/client';
import { WCA_EVENTS } from '@/lib/wca-events';
import { formatTime } from '@/lib/wca-events';
import { toast } from 'sonner';
import type { User as AuthUser } from '@supabase/supabase-js';
import type { Profile, Solve, Round, CompetitionEvent, Competition } from '@/types/database';
import { User, Award, Trophy, Bell, History, Save, Loader2 } from 'lucide-react';

type PBRecord = {
  event_key: string;
  event_name: string;
  event_icon: string;
  format: 'average' | 'mean';
  best_single: number | null;
  best_average: number | null;
  solve_count: number;
};

type SolveEntry = {
  id: string;
  competition_name: string;
  competition_id: string;
  event_key: string;
  event_name: string;
  event_icon: string;
  round_number: number;
  solve_number: number;
  time_ms: number | null;
  penalty: string;
  submitted_at: string;
};

export default function ProfilePage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pbs, setPbs] = useState<PBRecord[]>([]);
  const [history, setHistory] = useState<SolveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [wcaId, setWcaId] = useState('');
  const [notifyRoundStart, setNotifyRoundStart] = useState(true);
  const [notifyAdvancement, setNotifyAdvancement] = useState(true);
  const [notifyPbBeaten, setNotifyPbBeaten] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const go = async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }
      setUser(u);

      // Fetch or create profile
      const { data: prof, error: profileError } = await supabase.from('profiles').select('*').eq('id', u.id).single();
      if (profileError) throw new Error(profileError.message);
      if (prof) {
        setProfile(prof);
        setDisplayName(prof.display_name || '');
        setWcaId(prof.wca_id || '');
        setNotifyRoundStart(prof.notify_round_start ?? true);
        setNotifyAdvancement(prof.notify_advancement ?? true);
        setNotifyPbBeaten(prof.notify_pb_beaten ?? false);
      }

      const { data: stats, error: statsError } = await supabase.rpc('get_my_personal_bests');
      if (statsError) throw new Error(statsError.message);
      const records = (stats ?? []) as Array<Omit<PBRecord, 'event_name' | 'event_icon'>>;
      setPbs(records.map(record => {
        const event = WCA_EVENTS.find(e => e.key === record.event_key);
        return { ...record, event_name: event?.name ?? record.event_key, event_icon: event?.icon ?? '?' };
      }).sort((a, b) => a.event_name.localeCompare(b.event_name)));

      // History is a deliberately bounded recent view; lifetime PBs come from SQL.
      const { data: competitorRecords, error: competitorError } = await supabase
        .from('competitors').select('id').eq('user_id', u.id);
      if (competitorError) throw new Error(competitorError.message);
      const competitorIds = (competitorRecords ?? []).map(c => c.id);
      if (competitorIds.length) {
        const { data, error } = await supabase.from('solves')
          .select('*, round:round_id(round_number, competition_event:competition_event_id(event_key, competition:competition_id(name, id)))')
          .in('competitor_id', competitorIds).order('submitted_at', { ascending: false }).order('id').limit(50);
        if (error) throw new Error(error.message);
        type HistorySolve = Solve & { round: Pick<Round, 'round_number'> & {
          competition_event: Pick<CompetitionEvent, 'event_key'> & { competition: Pick<Competition, 'id' | 'name'> };
        } };
        setHistory((data as unknown as HistorySolve[] ?? []).map(s => {
          const evt = s.round?.competition_event;
          const event = WCA_EVENTS.find(e => e.key === evt?.event_key);
          return { id: s.id, competition_name: evt?.competition?.name ?? '?',
            competition_id: evt?.competition?.id ?? '', event_key: evt?.event_key ?? '',
            event_name: event?.name ?? '?', event_icon: event?.icon ?? '?',
            round_number: s.round?.round_number ?? 1, solve_number: s.solve_number,
            time_ms: s.penalty === 'DNF' || s.penalty === 'DNS' ? null :
              s.penalty === '+2' && s.time_ms !== null ? s.time_ms + 2000 : s.time_ms,
            penalty: s.penalty, submitted_at: s.submitted_at };
        }));
      }
      setLoading(false);
    };
    void go().catch(error => toast.error(error.message)).finally(() => setLoading(false));
  }, [router, supabase]);

  const handleSave = async () => {
    if (!profile?.username) {
      toast.error('Username is required. Sign up again if your profile is missing.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').update({
        display_name: displayName.trim(), wca_id: wcaId.trim() || null,
        notify_round_start: notifyRoundStart, notify_advancement: notifyAdvancement, notify_pb_beaten: notifyPbBeaten,
      }).eq('id', user!.id).select('id').single();
      if (error) throw new Error(error.message);
      toast.success('Profile saved!');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save profile'); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-cube-blue/40" />
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-cube-blue/10">
            <User className="h-7 w-7 text-cube-blue" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {displayName || (profile?.username ? `@${profile.username}` : 'Profile')}
            </h1>
            {profile?.username && (
              <p className="text-sm text-text-secondary">@{profile.username}</p>
            )}
            {wcaId && (
              <Badge variant="outline" className="mt-1 gap-1">
                <Award className="h-3 w-3 text-cube-yellow" /> {wcaId}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="pbs">
        <TabsList className="mb-6">
          <TabsTrigger value="pbs" className="gap-2"><Trophy className="h-4 w-4" /> Personal Bests</TabsTrigger>
          <TabsTrigger value="history" className="gap-2"><History className="h-4 w-4" /> Recent Solves</TabsTrigger>
          <TabsTrigger value="settings" className="gap-2"><Bell className="h-4 w-4" /> Settings</TabsTrigger>
        </TabsList>

        {/* Personal Bests */}
        <TabsContent value="pbs">
          {pbs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <Trophy className="h-10 w-10 text-text-tertiary/30" />
                <p className="text-sm text-text-secondary">No solves recorded yet. Compete in a competition to see your stats here!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {pbs.map(pb => (
                <Card key={`${pb.event_key}-${pb.format}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className="text-xl">{pb.event_icon}</span> {pb.event_name}
                      <Badge variant="outline" className="ml-auto text-xs">{pb.format === 'mean' ? 'Mo3' : 'Ao5'}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-surface-hover p-3 text-center">
                        <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">Best Single</p>
                        <p className="mt-1 font-mono text-lg font-bold">
                          {pb.best_single !== null ? formatTime(pb.best_single) : <span className="text-text-tertiary/40">—</span>}
                        </p>
                      </div>
                      <div className="rounded-lg bg-surface-hover p-3 text-center">
                        <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">Best {pb.format === 'mean' ? 'Mo3' : 'Ao5'}</p>
                        <p className="mt-1 font-mono text-lg font-bold">
                          {pb.best_average !== null ? formatTime(pb.best_average) : <span className="text-text-tertiary/40">—</span>}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-text-tertiary">{pb.solve_count} solve{pb.solve_count !== 1 ? 's' : ''} recorded</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Solve History */}
        <TabsContent value="history">
          {history.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <History className="h-10 w-10 text-text-tertiary/30" />
                <p className="text-sm text-text-secondary">No solves yet.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-3 sm:p-4">
                <ul className="flex flex-col gap-2">
                  {history.slice(0, 50).map(s => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted px-4 py-3.5 transition-colors hover:border-border hover:bg-muted sm:px-5"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="truncate text-sm font-semibold tracking-tight">
                          <span>{s.event_icon}</span> {s.event_name}
                          <span className="font-medium text-text-secondary"> — R{s.round_number} S{s.solve_number}</span>
                        </p>
                        <p className="truncate text-xs text-text-tertiary">
                          {s.competition_name} · {new Date(s.submitted_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-sm font-bold tabular-nums">
                          {s.time_ms !== null ? formatTime(s.time_ms) : <span className="text-destructive">DNF</span>}
                        </p>
                        {s.penalty !== 'none' && s.penalty !== 'DNF' && (
                          <p className="text-xs text-cube-orange">{s.penalty}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Settings */}
        <TabsContent value="settings">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><User className="h-5 w-5 text-cube-blue" /> Profile Info</CardTitle>
                <CardDescription>Your public display information.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={profile?.username ? `@${profile.username}` : ''}
                    readOnly
                    className="h-10 font-mono bg-muted"
                  />
                  <p className="text-xs text-text-secondary">
                    Your public identity on CubeComp. Email is only used to sign in.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="display-name">Display Name</Label>
                  <Input id="display-name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Optional friendly name" className="h-10" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wca-id" className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-cube-yellow" /> WCA ID
                  </Label>
                  <Input id="wca-id" value={wcaId} onChange={e => setWcaId(e.target.value)} placeholder="e.g. 2024SMIT01" className="h-10 font-mono" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Bell className="h-5 w-5 text-cube-green" /> Notifications</CardTitle>
                <CardDescription>Choose which events you want to be notified about in the app.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium">Round starts</p>
                    <p className="text-xs text-text-secondary">When a new round opens in a competition you&apos;re registered for</p>
                  </div>
                  <Switch checked={notifyRoundStart} onCheckedChange={setNotifyRoundStart} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium">Advancement results</p>
                    <p className="text-xs text-text-secondary">When you qualify (or don&apos;t) for the next round</p>
                  </div>
                  <Switch checked={notifyAdvancement} onCheckedChange={setNotifyAdvancement} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium">Personal best beaten</p>
                    <p className="text-xs text-text-secondary">When someone (or you) beats your personal best time</p>
                  </div>
                  <Switch checked={notifyPbBeaten} onCheckedChange={setNotifyPbBeaten} />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
