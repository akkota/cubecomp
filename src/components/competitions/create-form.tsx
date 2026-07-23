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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { createClient } from '@/lib/supabase/client';
import { WCA_EVENTS, type WcaEventKey } from '@/lib/wca-events';
import { toast } from 'sonner';
import { ChevronRight } from 'lucide-react';

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
      if (existing) {
        return prev.filter(e => e.key !== eventKey);
      }
      const event = WCA_EVENTS.find(e => e.key === eventKey);
      return [...prev, { key: eventKey, roundCount: event?.solveCount === 3 ? 1 : 1 }];
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
      if (!user) {
        toast.error('You must be logged in');
        router.push('/login');
        return;
      }

      // 1. Create competition
      const { data: comp, error: compError } = await supabase
        .from('competitions')
        .insert({
          name: data.name,
          description: data.description || '',
          created_by: user.id,
        })
        .select()
        .single();

      if (compError) throw compError;

      // 2. Create competition_events entries
      const eventInserts = selectedEvents.map(evt => ({
        competition_id: comp.id,
        event_key: evt.key,
        round_count: evt.roundCount,
        event_format: WCA_EVENTS.find(e => e.key === evt.key)?.format || 'average',
      }));

      const { error: eventsError } = await supabase
        .from('competition_events')
        .insert(eventInserts);

      if (eventsError) throw eventsError;

      // 3. Create rounds for each event
      const { data: compEvents } = await supabase
        .from('competition_events')
        .select('id, round_count')
        .eq('competition_id', comp.id);

      const roundInserts: any[] = [];
      for (const ce of (compEvents ?? [])) {
        for (let r = 1; r <= ce.round_count; r++) {
          roundInserts.push({
            competition_event_id: ce.id,
            round_number: r,
            advance_count: r < ce.round_count ? null : null, // configurable later
          });
        }
      }

      if (roundInserts.length > 0) {
        await supabase.from('rounds').insert(roundInserts);
      }

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
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Competition Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Competition Name *</Label>
            <Input
              id="name"
              placeholder="e.g. CubeComp Summer 2026"
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Optional competition description, rules, etc."
              rows={3}
              {...form.register('description')}
            />
          </div>
        </CardContent>
      </Card>

      {/* Event Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Select the official WCA events for this competition.
            {selectedEvents.length > 0 && (
              <span className="ml-2 font-medium text-primary">
                {selectedEvents.length} selected
              </span>
            )}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {WCA_EVENTS.map(event => (
              <div
                key={event.key}
                className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
                  isSelected(event.key)
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-accent/50'
                }`}
                onClick={() => toggleEvent(event.key)}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span>{event.icon}</span>
                    <span className="font-medium text-sm">{event.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {event.format === 'average' ? 'Average of 5' : 'Mean of 3'}
                  </p>
                </div>
                <Switch checked={isSelected(event.key)} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Round Configuration */}
      {selectedEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Round Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedEvents.map(evt => {
              const wcaEvent = WCA_EVENTS.find(e => e.key === evt.key);
              return (
                <div key={evt.key} className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{wcaEvent?.icon}</span>
                    <div>
                      <p className="font-medium">{wcaEvent?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {wcaEvent?.format === 'average' ? 'Average of 5' : 'Mean of 3'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Rounds:</span>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map(n => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => updateRoundCount(evt.key, n)}
                          className={`flex h-8 w-8 items-center justify-center rounded text-sm font-medium transition-colors ${
                            evt.roundCount >= n
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
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
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? (
            'Creating...'
          ) : (
            <>
              Create Competition <ChevronRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
