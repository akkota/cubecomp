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
import { createClient } from '@/lib/supabase/client';
import { WCA_EVENTS, type WcaEventKey } from '@/lib/wca-events';
import { toast } from 'sonner';
import { ChevronRight, Trophy, ArrowLeft, Layers, ShuffleIcon } from 'lucide-react';

const formSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100),
  description: z.string().max(500).optional(),
});

type SelectedEvent = {
  key: WcaEventKey;
  roundCount: number;
};

export function CreateCompetitionForm() {
  const [selectedEvents, setSelectedEvents] = useState<SelectedEvent[]>([]);
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
      return [...prev, { key: eventKey, roundCount: 1 }];
    });
  };

  const updateRoundCount = (eventKey: WcaEventKey, count: number) => {
    setSelectedEvents(prev =>
      prev.map(e => e.key === eventKey ? { ...e, roundCount: Math.min(Math.max(count, 1), 5) } : e)
    );
  };

  const isSelected = (key: string) => selectedEvents.some(e => e.key === key);

  const handleSubmit = async (data: { name: string; description?: string }) => {
    if (selectedEvents.length === 0) {
      toast.error('Select at least one event');
      return;
    }
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('You must be logged in'); router.push('/login'); return; }

      const generateScrambles = (document.getElementById('generate-scrambles') as HTMLInputElement)?.checked ?? true;
      const allowSpectators = (document.getElementById('allow-spectators') as HTMLInputElement)?.checked ?? false;
      const { data: comp, error: compError } = await supabase
        .from('competitions')
        .insert({ name: data.name, description: data.description || '', created_by: user.id, generate_scrambles: generateScrambles, allow_spectators: allowSpectators })
        .select().single();

      if (compError) throw compError;

      const eventInserts = selectedEvents.map(evt => ({
        competition_id: comp.id,
        event_key: evt.key,
        round_count: evt.roundCount,
        event_format: WCA_EVENTS.find(e => e.key === evt.key)?.format || 'average',
      }));

      const { error: eventsError } = await supabase.from('competition_events').insert(eventInserts);
      if (eventsError) throw eventsError;

      const { data: compEvents } = await supabase
        .from('competition_events')
        .select('id, round_count')
        .eq('competition_id', comp.id);

      const roundInserts: any[] = [];
      for (const ce of (compEvents ?? [])) {
        for (let r = 1; r <= ce.round_count; r++) {
          roundInserts.push({ competition_event_id: ce.id, round_number: r, advance_count: null });
        }
      }
      if (roundInserts.length > 0) await supabase.from('rounds').insert(roundInserts);

      toast.success('Competition created!');
      router.push(`/competitions/${comp.id}`);
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create competition');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      {/* Back link */}
      <a href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </a>

      <h1 className="mb-8 text-2xl font-bold tracking-tight sm:text-3xl">
        Create Competition
      </h1>

      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Basic Info */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Trophy className="h-5 w-5 text-cube-blue" />
              Competition Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
            <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
              <div className="space-y-0.5">
                <Label htmlFor="generate-scrambles" className="flex items-center gap-2 text-sm font-medium">
                  <ShuffleIcon className="h-4 w-4 text-cube-blue" />
                  Generate Scrambles
                </Label>
                <p className="text-xs text-muted-foreground">Auto-generate WCA scrambles for every round. Turn off to only record times without scrambles.</p>
              </div>
              <Switch id="generate-scrambles" defaultChecked />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
              <div className="space-y-0.5">
                <Label htmlFor="allow-spectators" className="flex items-center gap-2 text-sm font-medium">
                  <Trophy className="h-4 w-4 text-cube-green" />
                  Allow Spectators
                </Label>
                <p className="text-xs text-muted-foreground">Let non-registered users view scrambles and leaderboards without competing.</p>
              </div>
              <Switch id="allow-spectators" />
            </div>
          </CardContent>
        </Card>

        {/* Event Selection */}
        <Card className="border-border/50">
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
                    </Badge>
                  );
                })}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {WCA_EVENTS.map(event => (
                <div
                  key={event.key}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-all duration-200 ${
                    isSelected(event.key)
                      ? 'border-cube-blue/50 bg-cube-blue/5 shadow-sm'
                      : 'border-border/50 hover:border-border hover:bg-accent/50'
                  }`}
                  onClick={() => toggleEvent(event.key)}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">{event.icon}</span>
                    <div>
                      <p className="text-sm font-medium">{event.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.format === 'average' ? 'Ao5' : 'Mo3'}
                      </p>
                    </div>
                  </div>
                  <Switch checked={isSelected(event.key)} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Round Configuration */}
        {selectedEvents.length > 0 && (
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Layers className="h-5 w-5 text-cube-orange" />
                Round Configuration
              </CardTitle>
              <CardDescription>Set the number of rounds per event.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border/30">
              {selectedEvents.map(evt => {
                const wcaEvent = WCA_EVENTS.find(e => e.key === evt.key);
                return (
                  <div key={evt.key} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{wcaEvent?.icon}</span>
                      <div>
                        <p className="text-sm font-medium">{wcaEvent?.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {wcaEvent?.format === 'average' ? 'Average of 5' : 'Mean of 3'}
                        </p>
                      </div>
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
                );
              })}
            </CardContent>
          </Card>
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
