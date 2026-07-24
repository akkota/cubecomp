'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { configureCompetitionVisibilityAction } from '@/actions/competitionPrivacy';
import { WCA_EVENTS, type WcaEventKey } from '@/lib/wca-events';
import { toast } from 'sonner';
import { ChevronRight, Trophy, ArrowLeft, Layers, ShuffleIcon, Lock, Globe, Swords } from 'lucide-react';

const formSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100),
  description: z.string().max(500).optional(),
});

type EventFormat = 'average' | 'mean';

type SelectedEvent = {
  key: WcaEventKey;
  roundCount: number;
  format: EventFormat;
};

function formatLabel(format: EventFormat) {
  return format === 'average' ? 'Ao5' : 'Mo3';
}

function formatDescription(format: EventFormat) {
  return format === 'average' ? 'Average of 5' : 'Mean of 3';
}

function defaultFormatForEvent(eventKey: WcaEventKey): EventFormat {
  return WCA_EVENTS.find(e => e.key === eventKey)?.format ?? 'average';
}

export function CreateCompetitionForm() {
  const [selectedEvents, setSelectedEvents] = useState<SelectedEvent[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [competitionPassword, setCompetitionPassword] = useState('');
  const [competitionType, setCompetitionType] = useState<'standard' | 'head_to_head'>('standard');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', description: '' },
  });

  const toggleEvent = (eventKey: WcaEventKey) => {
    setSelectedEvents(prev => {
      const existing = prev.find(e => e.key === eventKey);
      if (existing) return prev.filter(e => e.key !== eventKey);
      return [...prev, {
        key: eventKey,
        roundCount: 1,
        format: defaultFormatForEvent(eventKey),
      }];
    });
  };

  const updateRoundCount = (eventKey: WcaEventKey, count: number) => {
    setSelectedEvents(prev =>
      prev.map(e => e.key === eventKey ? { ...e, roundCount: Math.min(Math.max(count, 1), 5) } : e)
    );
  };

  const updateEventFormat = (eventKey: WcaEventKey, format: EventFormat) => {
    setSelectedEvents(prev =>
      prev.map(e => e.key === eventKey ? { ...e, format } : e)
    );
  };

  const handleSubmit = async (data: { name: string; description?: string }) => {
    if (selectedEvents.length === 0) {
      toast.error('Select at least one event');
      return;
    }

    const missingFormat = selectedEvents.find(
      evt => evt.format !== 'average' && evt.format !== 'mean'
    );
    if (missingFormat) {
      toast.error('Choose Mo3 or Ao5 for every selected event');
      return;
    }

    if (visibility === 'private' && competitionPassword.trim().length < 4) {
      toast.error('Private competitions require a password of at least 4 characters');
      return;
    }

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('You must be logged in'); router.push('/login'); return; }

      const generateScrambles = (document.getElementById('generate-scrambles') as HTMLInputElement)?.checked ?? true;
      const allowSpectators = (document.getElementById('allow-spectators') as HTMLInputElement)?.checked ?? false;
      const requireVerified = (document.getElementById('require-verified') as HTMLInputElement)?.checked ?? false;
      const { data: comp, error: compError } = await supabase
        .from('competitions')
        .insert({
          name: data.name,
          description: data.description || '',
          created_by: user.id,
          competition_type: competitionType,
          generate_scrambles: competitionType === 'head_to_head' ? true : generateScrambles,
          allow_spectators: allowSpectators,
          require_verified_solves: requireVerified,
          visibility,
        })
        .select('id, name, visibility, competition_type')
        .single();

      if (compError) throw compError;

      if (visibility === 'private') {
        const privacy = await configureCompetitionVisibilityAction(
          comp.id,
          'private',
          competitionPassword.trim(),
        );
        if (!privacy.success) {
          // Roll back the competition if password setup fails
          await supabase.from('competitions').delete().eq('id', comp.id);
          throw new Error(privacy.error);
        }
      }

      const eventInserts = selectedEvents.map(evt => ({
        competition_id: comp.id,
        event_key: evt.key,
        round_count: evt.roundCount,
        event_format: evt.format,
      }));

      const { error: eventsError } = await supabase.from('competition_events').insert(eventInserts);
      if (eventsError) throw eventsError;

      const { data: compEvents, error: fetchEventsError } = await supabase
        .from('competition_events')
        .select('id, round_count, event_format')
        .eq('competition_id', comp.id);

      if (fetchEventsError) throw fetchEventsError;

      const roundInserts: {
        competition_event_id: string;
        round_number: number;
        advance_count: null;
        round_format: EventFormat;
      }[] = [];

      for (const ce of (compEvents ?? [])) {
        const roundFormat = (ce.event_format === 'mean' ? 'mean' : 'average') as EventFormat;
        for (let r = 1; r <= ce.round_count; r++) {
          roundInserts.push({
            competition_event_id: ce.id,
            round_number: r,
            advance_count: null,
            round_format: roundFormat,
          });
        }
      }
      if (roundInserts.length > 0) {
        const { error: roundsError } = await supabase.from('rounds').insert(roundInserts);
        if (roundsError) throw roundsError;
      }

      toast.success('Competition created!');
      if (comp.competition_type === 'head_to_head') {
        router.push(`/competitions/${comp.id}/setup`);
      } else {
        router.push(`/competitions/${comp.id}`);
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create competition');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <a href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </a>

      <h1 className="mb-8 text-2xl font-bold tracking-tight sm:text-3xl">
        Create Competition
      </h1>

      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Trophy className="h-5 w-5 text-cube-blue" />
              Competition Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 rounded-lg border border-border p-4">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <Trophy className="h-4 w-4 text-cube-blue" />
                Competition Type
              </Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCompetitionType('standard')}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                    competitionType === 'standard'
                      ? 'border-cube-blue/40 bg-cube-blue/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent/40'
                  }`}
                >
                  <Layers className="h-4 w-4" /> Standard
                </button>
                <button
                  type="button"
                  onClick={() => setCompetitionType('head_to_head')}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                    competitionType === 'head_to_head'
                      ? 'border-cube-blue/40 bg-cube-blue/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent/40'
                  }`}
                >
                  <Swords className="h-4 w-4" /> Head-to-Head
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {competitionType === 'standard'
                  ? 'WCA-format with multi-round events, leaderboards, and advancement.'
                  : 'Bracket tournament with single/double elimination, best-of-3/5 sets, and head-to-head matches.'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Competition Name *</Label>
              <Input id="name" placeholder="e.g. CubeComp Summer 2026" {...form.register('name')} className="h-10" />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" placeholder="Optional description, rules, etc." rows={3} {...form.register('description')} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="generate-scrambles" className="flex items-center gap-2 text-sm font-medium">
                  <ShuffleIcon className="h-4 w-4 text-cube-blue" />
                  Generate Scrambles
                </Label>
                <p className="text-xs text-muted-foreground">Auto-generate WCA scrambles for every round. Turn off to only record times without scrambles.</p>
              </div>
              <Switch id="generate-scrambles" defaultChecked />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="allow-spectators" className="flex items-center gap-2 text-sm font-medium">
                  <Trophy className="h-4 w-4 text-cube-green" />
                  Allow Spectators
                </Label>
                <p className="text-xs text-muted-foreground">Let non-registered users view scrambles and leaderboards without competing.</p>
              </div>
              <Switch id="allow-spectators" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="require-verified" className="flex items-center gap-2 text-sm font-medium">
                  <Trophy className="h-4 w-4 text-cube-red" />
                  Require Verified Solves
                </Label>
                <p className="text-xs text-muted-foreground">Competitors must upload an unlisted YouTube video showing all solves. Only verified solves qualify for advancement.</p>
              </div>
              <Switch id="require-verified" />
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  {visibility === 'private' ? <Lock className="h-4 w-4 text-cube-orange" /> : <Globe className="h-4 w-4 text-cube-blue" />}
                  Visibility
                </Label>
                <p className="text-xs text-muted-foreground">
                  Public competitions allow anyone to register. Private competitions require a password before registration.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setVisibility('public')}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                    visibility === 'public'
                      ? 'border-cube-blue/40 bg-cube-blue/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent/40'
                  }`}
                >
                  <Globe className="h-4 w-4" /> Public
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility('private')}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                    visibility === 'private'
                      ? 'border-cube-orange/40 bg-cube-orange/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent/40'
                  }`}
                >
                  <Lock className="h-4 w-4" /> Private
                </button>
              </div>
              {visibility === 'private' && (
                <div className="space-y-2">
                  <Label htmlFor="competition-password">Competition password *</Label>
                  <Input
                    id="competition-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 4 characters"
                    value={competitionPassword}
                    onChange={e => setCompetitionPassword(e.target.value)}
                    className="h-10"
                  />
                  <p className="text-xs text-muted-foreground">
                    Stored as a hash. Users must enter this before they can register. Scrambles and time submission still require registration.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {competitionType === 'standard' && (<>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Layers className="h-5 w-5 text-cube-green" />
              Events
            </CardTitle>
            <CardDescription>Select the official WCA events for this competition.</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedEvents.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {selectedEvents.map(evt => {
                  const wcaEvent = WCA_EVENTS.find(e => e.key === evt.key);
                  return (
                    <Badge key={evt.key} variant="secondary" className="gap-1.5 text-xs">
                      {wcaEvent?.icon} {wcaEvent?.name}
                      <span className="text-muted-foreground">· {formatLabel(evt.format)}</span>
                    </Badge>
                  );
                })}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {WCA_EVENTS.map(event => {
                const selected = selectedEvents.find(e => e.key === event.key);
                return (
                  <div
                    key={event.key}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-all duration-200 ${
                      selected
                        ? 'border-cube-blue/50 bg-cube-blue/5 shadow-sm'
                        : 'border-border hover:border-border hover:bg-accent/50'
                    }`}
                    onClick={() => toggleEvent(event.key)}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg">{event.icon}</span>
                      <div>
                        <p className="text-sm font-medium">{event.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {selected
                            ? formatLabel(selected.format)
                            : `WCA default ${formatLabel(event.format)}`}
                        </p>
                      </div>
                    </div>
                    <Switch checked={!!selected} />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {selectedEvents.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Layers className="h-5 w-5 text-cube-orange" />
                Format & Rounds
              </CardTitle>
              <CardDescription>
                Choose Mo3 or Ao5 for each event, then set how many rounds to run. This format is used for attempts, scrambles, timer, results, and rankings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedEvents.map(evt => {
                const wcaEvent = WCA_EVENTS.find(e => e.key === evt.key);
                return (
                  <div
                    key={evt.key}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-muted p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-lg">{wcaEvent?.icon}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold tracking-tight">{wcaEvent?.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDescription(evt.format)} · {evt.format === 'average' ? '5' : '3'} attempts per round
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">Format:</span>
                        <Select
                          value={evt.format}
                          onValueChange={value => {
                            if (value === 'average' || value === 'mean') {
                              updateEventFormat(evt.key, value);
                            }
                          }}
                        >
                          <SelectTrigger
                            className="h-8 w-[7.5rem] text-xs"
                            onClick={event => event.stopPropagation()}
                          >
                            <SelectValue placeholder="Required" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="average">Ao5</SelectItem>
                            <SelectItem value="mean">Mo3</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Rounds:</span>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map(n => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => updateRoundCount(evt.key, n)}
                              className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-medium transition-all ${
                                evt.roundCount >= n
                                  ? 'bg-primary text-primary-foreground shadow-sm'
                                  : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
        </>
        )}

        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={loading} className="gap-2 shadow-lg shadow-cube-blue/20 dark:shadow-cube-blue/10">
            {loading ? 'Creating...' : (
              <>
                Create Competition <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
