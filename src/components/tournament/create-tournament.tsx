'use client';

import { useState, useEffect, useCallback, type ComponentType } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { generateBracket } from '@/lib/tournament/bracket-engine';
import { BracketView } from '@/components/tournament/bracket-view';
import {
  createTournamentAction,
  updateTournamentConfigAction,
  setParticipantsAction,
  generateBracketAction,
} from '@/actions/tournament';
import { registerForCompetitionAction } from '@/actions/competitionPrivacy';
import { WCA_EVENTS } from '@/lib/wca-events';
import { toast } from 'sonner';
import {
  ArrowLeft, ChevronRight, Users, UserPlus, RefreshCw, ExternalLink, Swords,
  Copy, Check, Lock, Shuffle, GitBranch, Target, Dices,
} from 'lucide-react';

function OptionButton({
  selected,
  onClick,
  title,
  description,
  icon: Icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all ${
        selected
          ? 'border-primary/50 bg-primary/10 shadow-sm'
          : 'border-border bg-surface hover:border-border hover:bg-surface-hover'
      }`}
    >
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          selected ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

type WizardDraft = {
  step: number;
  furthestStep: number;
  name: string;
  tournamentType: 'single' | 'double';
  seedingType: 'seeded' | 'unseeded';
  matchFormat: 'bo3' | 'bo5';
  scrambleSource: 'generated' | 'external';
  eventKey: string;
  selected: string[];
  qualAverages: Record<string, string>;
  tournamentId: string | null;
};

function draftKey(competitionId: string) {
  return `cubecomp-tournament-draft:${competitionId}`;
}

function readDraft(competitionId: string): WizardDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(draftKey(competitionId));
    if (!raw) return null;
    return JSON.parse(raw) as WizardDraft;
  } catch {
    return null;
  }
}

function writeDraft(competitionId: string, draft: WizardDraft) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(draftKey(competitionId), JSON.stringify(draft));
  } catch {
    /* ignore quota */
  }
}

function clearDraft(competitionId: string) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(draftKey(competitionId));
  } catch {
    /* ignore */
  }
}

/** True when the organizer has an unfinished wizard draft in this browser tab session. */
export function hasTournamentWizardDraft(competitionId: string): boolean {
  const draft = readDraft(competitionId);
  if (!draft) return false;
  return Boolean(draft.name?.trim() || draft.step > 0 || draft.tournamentId);
}

export function CreateTournamentWizard({ competitionId }: { competitionId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const forceFresh = searchParams.get('fresh') === '1';
  const resumeId = searchParams.get('resume');

  const [draftReady, setDraftReady] = useState(false);
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [qualAverages, setQualAverages] = useState<Record<string, string>>({});
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [registeringSelf, setRegisteringSelf] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Config
  const [name, setName] = useState('');
  const [tournamentType, setTournamentType] = useState<'single' | 'double'>('single');
  const [seedingType, setSeedingType] = useState<'seeded' | 'unseeded'>('unseeded');
  const [matchFormat, setMatchFormat] = useState<'bo3' | 'bo5'>('bo3');
  const [scrambleSource, setScrambleSource] = useState<'generated' | 'external'>('generated');
  const [eventKey, setEventKey] = useState('333');

  const [preview, setPreview] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Only competition admins may use this wizard (defense in depth with server page guard)
  useEffect(() => {
    const client = createClient();
    const check = async () => {
      const { data: { user } } = await client.auth.getUser();
      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(`/competitions/${competitionId}/tournaments/new`)}`);
        return;
      }
      const { data: comp } = await client
        .from('competitions')
        .select('created_by, competition_type')
        .eq('id', competitionId)
        .maybeSingle();
      if (!comp || comp.competition_type !== 'head_to_head') {
        router.replace(`/competitions/${competitionId}`);
        return;
      }
      if (comp.created_by !== user.id) {
        const { data: adminRow } = await client
          .from('competition_admins')
          .select('id')
          .eq('competition_id', competitionId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (!adminRow) {
          router.replace(`/competitions/${competitionId}`);
          return;
        }
      }
      setAuthChecked(true);
    };
    void check();
  }, [competitionId, router]);

  // Restore draft after mount to avoid SSR/client hydration mismatch
  useEffect(() => {
    if (!authChecked) return;
    const client = createClient();

    const restore = async () => {
      if (forceFresh) {
        clearDraft(competitionId);
        setStep(0);
        setFurthestStep(0);
        setName('');
        setTournamentType('single');
        setSeedingType('unseeded');
        setMatchFormat('bo3');
        setScrambleSource('generated');
        setSelected([]);
        setQualAverages({});
        setTournamentId(null);
        setPreview(null);
        setError('');
        setDraftReady(true);
        router.replace(`/competitions/${competitionId}/tournaments/new`);
        return;
      }

      const loadTournament = async (tournamentIdToLoad: string) => {
        const { data: existing } = await client
          .from('tournaments')
          .select('id, name, tournament_type, seeding_type, match_format, scramble_source, event_key, status')
          .eq('id', tournamentIdToLoad)
          .eq('competition_id', competitionId)
          .maybeSingle();

        if (!existing || existing.status !== 'draft') return false;

        setTournamentId(existing.id);
        setName(existing.name ?? '');
        setTournamentType(existing.tournament_type === 'double' ? 'double' : 'single');
        setSeedingType(existing.seeding_type === 'seeded' ? 'seeded' : 'unseeded');
        setMatchFormat(existing.match_format === 'bo5' ? 'bo5' : 'bo3');
        setScrambleSource(existing.scramble_source === 'external' ? 'external' : 'generated');
        if (existing.event_key) setEventKey(existing.event_key);

        const { data: parts } = await client
          .from('tournament_participants')
          .select('competitor_id, qualifying_average')
          .eq('tournament_id', existing.id)
          .order('initial_slot');

        if (parts && parts.length > 0) {
          setSelected(parts.map(p => p.competitor_id));
          const avgs: Record<string, string> = {};
          for (const p of parts) {
            if (p.qualifying_average != null) avgs[p.competitor_id] = String(p.qualifying_average);
          }
          setQualAverages(avgs);
          setStep(3);
          setFurthestStep(3);
        } else {
          setStep(1);
          setFurthestStep(1);
        }
        return true;
      };

      if (resumeId) {
        await loadTournament(resumeId);
        setDraftReady(true);
        router.replace(`/competitions/${competitionId}/tournaments/new`);
        return;
      }

      const saved = readDraft(competitionId);
      if (saved && (saved.name?.trim() || saved.step > 0 || saved.tournamentId)) {
        const restoredStep = saved.step ?? 0;
        setStep(restoredStep);
        setFurthestStep(Math.max(saved.furthestStep ?? 0, restoredStep));
        setName(saved.name ?? '');
        setTournamentType(saved.tournamentType ?? 'single');
        setSeedingType(saved.seedingType ?? 'unseeded');
        setMatchFormat(saved.matchFormat ?? 'bo3');
        setScrambleSource(saved.scrambleSource ?? 'generated');
        setEventKey(saved.eventKey ?? '333');
        setSelected(saved.selected ?? []);
        setQualAverages(saved.qualAverages ?? {});
        setTournamentId(saved.tournamentId ?? null);
        setDraftReady(true);

        if (saved.tournamentId) {
          const { data } = await client
            .from('tournaments')
            .select('id, status')
            .eq('id', saved.tournamentId)
            .maybeSingle();
          if (!data || data.status !== 'draft') {
            setTournamentId(null);
            if (restoredStep >= 3) {
              setStep(2);
              setFurthestStep(prev => Math.max(prev, 2));
            }
          }
        }
        return;
      }

      setDraftReady(true);
    };

    void restore();
  }, [authChecked, competitionId, forceFresh, resumeId, router]);

  // Rebuild bracket preview after draft restore / selection changes
  useEffect(() => {
    if (!draftReady || selected.length < 2) return;
    setPreview(generateBracket({
      participantCount: selected.length,
      tournamentType,
      seedingType,
    }));
  }, [draftReady, selected.length, tournamentType, seedingType]);

  // Persist incomplete wizard so leaving to invite people (or refresh) doesn't wipe progress
  useEffect(() => {
    if (!draftReady) return;
    writeDraft(competitionId, {
      step,
      furthestStep,
      name,
      tournamentType,
      seedingType,
      matchFormat,
      scrambleSource,
      eventKey,
      selected,
      qualAverages,
      tournamentId,
    });
  }, [
    draftReady,
    competitionId,
    step,
    furthestStep,
    name,
    tournamentType,
    seedingType,
    matchFormat,
    scrambleSource,
    eventKey,
    selected,
    qualAverages,
    tournamentId,
  ]);

  const openCompetitionPage = () => {
    window.open(`/competitions/${competitionId}`, '_blank', 'noopener,noreferrer');
  };

  const goToStep = (next: number) => {
    setStep(next);
    setFurthestStep(prev => Math.max(prev, next));
  };

  const handleStartOver = () => {
    clearDraft(competitionId);
    setStep(0);
    setFurthestStep(0);
    setName('');
    setTournamentType('single');
    setSeedingType('unseeded');
    setMatchFormat('bo3');
    setScrambleSource('generated');
    setSelected([]);
    setQualAverages({});
    setTournamentId(null);
    setPreview(null);
    setError('');
  };

  const loadCompetitors = useCallback(async () => {
    const client = createClient();
    const { data } = await client
      .from('competitors')
      .select('id, user_id, competition_id')
      .eq('competition_id', competitionId);

    if (!data || data.length === 0) {
      setCompetitors([]);
      return;
    }

    const userIds = data.map(c => c.user_id);
    const { data: profiles } = await client
      .from('profiles')
      .select('id, display_name, username')
      .in('id', userIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    setCompetitors(data.map(c => ({
      ...c,
      profile: profileMap.get(c.user_id) || { display_name: 'Unknown', username: 'unknown' },
    })));
  }, [competitionId]);

  useEffect(() => {
    void loadCompetitors();

    const client = createClient();
    client.from('competition_events').select('event_key')
      .eq('competition_id', competitionId)
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.event_key) setEventKey(data[0].event_key);
      });
  }, [competitionId, loadCompetitors]);

  const toggleSelected = (id: string) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleRegisterSelf = async () => {
    setRegisteringSelf(true);
    setError('');
    try {
      const result = await registerForCompetitionAction(competitionId);
      if (!result.success) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success('You are registered for this competition');
      await loadCompetitors();
    } finally {
      setRegisteringSelf(false);
    }
  };

  const competitionUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/competitions/${competitionId}`
      : `/competitions/${competitionId}`;

  const handleCopyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(competitionUrl);
      setCopiedLink(true);
      toast.success('Competition link copied — share it so others can register');
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  };

  const handleRefreshCompetitors = async () => {
    setRefreshing(true);
    try {
      await loadCompetitors();
      toast.success('Competitor list refreshed');
    } finally {
      setRefreshing(false);
    }
  };

  const sortedSelected = seedingType === 'seeded'
    ? [...selected].sort((a, b) => {
        const avgA = Number(qualAverages[a] || 999999);
        const avgB = Number(qualAverages[b] || 999999);
        return avgA - avgB;
      })
    : selected;

  const previewMatches = preview?.matches?.map((m: any, i: number) => ({
    id: `preview-${i}`,
    bracket_type: m.bracketType,
    bracket_round: m.bracketRound,
    match_number: m.matchNumber,
    competitor1_id: m.slot1Seed != null ? `seed-${m.slot1Seed}` : null,
    competitor2_id: m.slot2Seed != null ? `seed-${m.slot2Seed}` : null,
    competitor1_sets_won: 0,
    competitor2_sets_won: 0,
    winner_id: m.isBye
      ? (m.slot1Seed != null && m.slot2Seed == null
        ? `seed-${m.slot1Seed}`
        : m.slot2Seed != null && m.slot1Seed == null
          ? `seed-${m.slot2Seed}`
          : null)
      : null,
    status: m.isBye ? 'completed' : 'pending',
    auto_advance: m.isBye,
  })) ?? [];

  const previewParticipants = sortedSelected.map((id, i) => {
    const c = competitors.find(x => x.id === id);
    return {
      id: `seed-${i + 1}`,
      seed: i + 1,
      display_name_snapshot: c?.profile?.username
        ? `@${c.profile.username}`
        : `Seed ${i + 1}`,
    };
  });

  const updatePreview = () => {
    if (selected.length < 2) return;
    const def = generateBracket({
      participantCount: selected.length,
      tournamentType,
      seedingType,
    });
    setPreview(def);
  };

  const handleCreate = async () => {
    setError('');
    setGenerating(true);
    try {
      const config = {
        eventKey: scrambleSource === 'generated' ? eventKey : null,
        tournamentType,
        seedingType,
        matchFormat,
        scrambleSource,
      };

      let id = tournamentId;
      if (id) {
        const updated = await updateTournamentConfigAction(id, { name, ...config });
        if (!updated.success) { setError(updated.error); return; }
      } else {
        const result = await createTournamentAction(competitionId, name, config);
        if (!result.success) { setError(result.error); return; }
        const created = result.data as { id: string } | undefined;
        if (!created?.id) { setError('Tournament created but no id returned'); return; }
        id = created.id;
        setTournamentId(id);
      }

      const qualAvgs: Record<string, number> = {};
      for (const cid of selected) {
        const raw = qualAverages[cid];
        if (raw == null || raw === '') continue;
        const v = Number(raw);
        if (Number.isFinite(v) && v > 0) qualAvgs[cid] = v;
      }
      const pResult = await setParticipantsAction(id, selected, qualAvgs);
      if (!pResult.success) { setError(pResult.error); return; }

      updatePreview();
      goToStep(3);
    } finally { setGenerating(false); }
  };

  const handleGenerate = async () => {
    if (!tournamentId) return;
    setGenerating(true);
    try {
      const result = await generateBracketAction(tournamentId);
      if (!result.success) { setError(result.error); setGenerating(false); return; }
      clearDraft(competitionId);
      router.push(`/competitions/${competitionId}/tournaments/${tournamentId}`);
    } finally { setGenerating(false); }
  };

  const steps = ['Config', 'Participants', 'Seeds', 'Preview'] as const;
  const canVisitStep = (i: number) => {
    if (i === step) return true;
    // Keep any previously reached step clickable when backtracking
    if (i > furthestStep) return false;
    if (i === 0) return true;
    if (i === 1) return name.trim().length > 0;
    if (i === 2) return selected.length >= 2;
    if (i === 3) return !!tournamentId;
    return false;
  };

  if (!authChecked || !draftReady) {
    return <div className="mx-auto h-64 max-w-3xl animate-pulse rounded-lg bg-surface-hover" />;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/competitions/${competitionId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Swords className="h-5 w-5 text-cube-blue" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">{tournamentId ? 'Continue Tournament Setup' : 'New Tournament'}</h1>
          {name.trim() && (
            <p className="truncate text-sm text-muted-foreground">{name}</p>
          )}
        </div>
        {(name.trim() || step > 0 || tournamentId) && (
          <Button type="button" variant="ghost" size="sm" onClick={handleStartOver}>
            Start over
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-text-secondary">
        {steps.map((s, i) => {
          const active = i === step;
          const reachable = canVisitStep(i);
          return (
            <button
              key={s}
              type="button"
              disabled={!reachable}
              onClick={() => reachable && goToStep(i)}
              className={`flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
                active
                  ? 'text-cube-blue font-semibold'
                  : reachable
                    ? 'hover:text-foreground cursor-pointer'
                    : 'opacity-50 cursor-not-allowed'
              }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${active ? 'bg-cube-blue/20' : 'bg-surface-hover'}`}>
                {i + 1}
              </span>
              {s}
              {i < steps.length - 1 && <ChevronRight className="h-3 w-3" />}
            </button>
          );
        })}
      </div>

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">{error}</div>}

      {step === 0 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Swords className="h-5 w-5 text-cube-blue" />
              Tournament Settings
            </CardTitle>
            <CardDescription>
              Configure bracket style and match rules. You&apos;ll pick competitors next.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="tournament-name">Tournament name</Label>
              <Input
                id="tournament-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. 3x3 Finals Bracket"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label>Bracket type</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <OptionButton
                  selected={tournamentType === 'single'}
                  onClick={() => setTournamentType('single')}
                  icon={GitBranch}
                  title="Single Elimination"
                  description="One loss and you're out"
                />
                <OptionButton
                  selected={tournamentType === 'double'}
                  onClick={() => setTournamentType('double')}
                  icon={Swords}
                  title="Double Elimination"
                  description="Losers bracket until two losses"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Match format</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <OptionButton
                  selected={matchFormat === 'bo3'}
                  onClick={() => setMatchFormat('bo3')}
                  icon={Target}
                  title="Best of 3"
                  description="First to win 2 sets"
                />
                <OptionButton
                  selected={matchFormat === 'bo5'}
                  onClick={() => setMatchFormat('bo5')}
                  icon={Target}
                  title="Best of 5"
                  description="First to win 3 sets"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Seeding</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <OptionButton
                  selected={seedingType === 'unseeded'}
                  onClick={() => setSeedingType('unseeded')}
                  icon={Dices}
                  title="Unseeded"
                  description="Random bracket placement"
                />
                <OptionButton
                  selected={seedingType === 'seeded'}
                  onClick={() => setSeedingType('seeded')}
                  icon={Users}
                  title="Seeded"
                  description="Order by qualifying average"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Scrambles</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <OptionButton
                  selected={scrambleSource === 'generated'}
                  onClick={() => setScrambleSource('generated')}
                  icon={Shuffle}
                  title="Generated"
                  description="Auto WCA scrambles from the event"
                />
                <OptionButton
                  selected={scrambleSource === 'external'}
                  onClick={() => setScrambleSource('external')}
                  icon={Lock}
                  title="External"
                  description="Admin enters scrambles manually"
                />
              </div>
            </div>

            {scrambleSource === 'generated' && (
              <div className="space-y-2">
                <Label>WCA event</Label>
                <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3">
                  <span className="text-2xl leading-none">
                    {WCA_EVENTS.find(e => e.key === eventKey)?.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {WCA_EVENTS.find(e => e.key === eventKey)?.name ?? eventKey}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Locked to this competition&apos;s single event
                    </p>
                  </div>
                  <Badge variant="outline" className="gap-1 shrink-0">
                    <Lock className="h-3 w-3" /> Locked
                  </Badge>
                </div>
              </div>
            )}

            <Button
              type="button"
              size="lg"
              className="w-full gap-2"
              onClick={() => goToStep(1)}
              disabled={!name.trim()}
            >
              {tournamentId ? 'Save & Continue' : 'Next: Select Participants'}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Select Competitors</span>
              <Badge variant="secondary">{selected.length} selected</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {competitors.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
                <Users className="h-10 w-10 text-muted-foreground/50" />
                <div className="space-y-1">
                  <p className="font-medium">No competitors registered yet</p>
                  <p className="text-sm text-text-secondary max-w-sm">
                    A tournament needs at least 2 registered competitors. Register yourself, invite others on the competition page, then refresh this list.
                  </p>
                </div>
                <div className="flex w-full max-w-sm flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    className="flex-1 gap-2"
                    onClick={handleRegisterSelf}
                    disabled={registeringSelf}
                  >
                    <UserPlus className="h-4 w-4" />
                    {registeringSelf ? 'Registering…' : 'Register myself'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={handleCopyInviteLink}
                  >
                    {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedLink ? 'Copied' : 'Copy invite link'}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  onClick={openCompetitionPage}
                >
                  <ExternalLink className="h-4 w-4" />
                  Open competition page
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  onClick={handleRefreshCompetitors}
                  disabled={refreshing}
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                  Refresh list
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {competitors.length < 2 && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleCopyInviteLink}
                      >
                        {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedLink ? 'Copied' : 'Copy invite link'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={openCompetitionPage}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open competition
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                    onClick={handleRefreshCompetitors}
                    disabled={refreshing}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                {competitors.map(c => (
                  <label
                    key={c.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selected.includes(c.id)
                        ? 'border-cube-blue bg-cube-blue/5'
                        : 'border-border hover:bg-surface-hover'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(c.id)}
                      onChange={() => toggleSelected(c.id)}
                      className="rounded"
                    />
                    <span className="flex-1 font-medium">
                      {c.profile?.username ? `@${c.profile.username}` : 'Unknown'}
                    </span>
                  </label>
                ))}
                {competitors.length < 2 && (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-sm text-text-secondary">
                    Only {competitors.length} competitor{competitors.length === 1 ? '' : 's'} registered.
                    Copy the invite link and send it to others — they sign in, open the link, click{' '}
                    <span className="font-medium text-foreground">Register</span>, then come back here and hit Refresh.
                  </div>
                )}
              </>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => goToStep(0)}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (selected.length < 2) {
                    toast.error(
                      competitors.length < 2
                        ? 'Register at least 2 competitors before continuing'
                        : 'Select at least 2 competitors to continue',
                    );
                    return;
                  }
                  if (seedingType === 'unseeded') updatePreview();
                  goToStep(2);
                }}
                disabled={selected.length < 2}
              >
                {selected.length >= 2
                  ? `Next: ${seedingType === 'seeded' ? 'Enter Qualifying Averages' : 'Preview Bracket'}`
                  : competitors.length < 2
                    ? 'Need 2+ registered competitors'
                    : `Select ${2 - selected.length} more`}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && seedingType === 'seeded' && (
        <Card>
          <CardHeader><CardTitle>Qualifying Averages</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {sortedSelected.map((id, i) => {
              const c = competitors.find(x => x.id === id);
              return (
                <div key={id} className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary w-6">#{i + 1}</span>
                  <span className="flex-1 font-medium text-sm">
                    {c?.profile?.username ? `@${c.profile.username}` : 'Unknown'}
                  </span>
                  <Input
                    type="number"
                    placeholder="Avg (ms)"
                    className="w-28"
                    value={qualAverages[id] || ''}
                    onChange={e => setQualAverages(prev => ({ ...prev, [id]: e.target.value }))}
                  />
                </div>
              );
            })}
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => goToStep(1)}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleCreate}
                disabled={!name.trim() || generating}
              >
                {generating
                  ? 'Saving…'
                  : tournamentId
                    ? 'Save & Preview'
                    : 'Create & Preview'}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && seedingType === 'unseeded' && (
        <Card>
          <CardHeader>
            <CardTitle>Preview Bracket</CardTitle>
            <CardDescription>
              {preview
                ? `${preview.bracketSize}-player bracket · ${preview.matches.length} matches · ${preview.bracketSize - selected.length} byes`
                : 'Review who faces whom before creating the draft.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview && previewMatches.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <BracketView
                  matches={previewMatches}
                  participants={previewParticipants}
                  tournamentType={tournamentType}
                />
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => goToStep(1)}>Back</Button>
              <Button onClick={handleCreate} disabled={!name.trim() || generating}>
                {generating
                  ? 'Saving…'
                  : tournamentId
                    ? 'Save & Continue'
                    : 'Create & Continue'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && tournamentId && (
        <Card>
          <CardHeader>
            <CardTitle>Tournament Ready</CardTitle>
            <CardDescription>
              Tournament &quot;{name}&quot; is saved as a draft. Use the steps above to edit, or generate the live bracket.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview && previewMatches.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="mb-3 text-xs text-muted-foreground">
                  Size {preview.bracketSize} · {preview.tournamentType === 'double' ? 'Double Elim' : 'Single Elim'} · {selected.length} competitors · {preview.bracketSize - selected.length} byes
                </div>
                <BracketView
                  matches={previewMatches}
                  participants={previewParticipants}
                  tournamentType={tournamentType}
                />
              </div>
            )}
            <Button className="w-full" onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate Bracket'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
