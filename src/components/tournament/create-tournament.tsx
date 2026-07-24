'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { BracketView } from '@/components/tournament/bracket-view';
import { generateBracket } from '@/lib/tournament/bracket-engine';
import { createTournamentAction, setParticipantsAction, generateBracketAction } from '@/actions/tournament';
import { ArrowLeft, ChevronRight, Trophy, Users, Swords } from 'lucide-react';

export function CreateTournamentWizard({ competitionId }: { competitionId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(0);
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [qualAverages, setQualAverages] = useState<Record<string, string>>({});
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);

  // Config
  const [name, setName] = useState('');
  const [tournamentType, setTournamentType] = useState<'single' | 'double'>('single');
  const [seedingType, setSeedingType] = useState<'seeded' | 'unseeded'>('unseeded');
  const [matchFormat, setMatchFormat] = useState<'bo3' | 'bo5'>('bo3');
  const [scrambleSource, setScrambleSource] = useState<'generated' | 'external'>('generated');
  const [eventKey, setEventKey] = useState('333');

  // Bracket preview
  const [preview, setPreview] = useState<any>(null);

  useEffect(() => {
    supabase.from('competitors').select('id, user_id, competition_id')
      .eq('competition_id', competitionId).then(({ data }) => {
        if (data) {
          // Fetch profiles for each competitor
          const userIds = data.map(c => c.user_id);
          supabase.from('profiles').select('id, display_name, username')
            .in('id', userIds).then(({ data: profiles }) => {
              const profileMap = new Map((profiles || []).map(p => [p.id, p]));
              setCompetitors(data.map(c => ({
                ...c,
                profile: profileMap.get(c.user_id) || { display_name: 'Unknown', username: 'unknown' },
              })));
            });
        }
      });
  }, [competitionId]);

  const toggleSelected = (id: string) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const sortedSelected = seedingType === 'seeded'
    ? [...selected].sort((a, b) => {
        const avgA = Number(qualAverages[a] || 999999);
        const avgB = Number(qualAverages[b] || 999999);
        return avgA - avgB;
      })
    : selected;

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
      const result = await createTournamentAction(competitionId, name, {
        eventKey: scrambleSource === 'generated' ? eventKey : null,
        tournamentType,
        seedingType,
        matchFormat,
        scrambleSource,
      });
      if (!result.success) { setError(result.error); setGenerating(false); return; }
      setTournamentId(result.data.id);

      // Insert participants
      const tid = result.data.id;
      const inserts = selected.map((cid, i) => ({
        competitor_id: cid,
        seed: i + 1,
        qualifying_average: seedingType === 'seeded' ? Number(qualAverages[cid] || 0) : null,
        initial_slot: i + 1,
      }));

      const { data: profiles } = await supabase.from('profiles')
        .select('id, display_name')
        .in('id', (await supabase.from('competitors').select('user_id').in('id', selected).then(r => r.data ?? []))
          .map((c: any) => c.user_id));
      const nameMap = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name || 'Unknown']));

      for (const pi of inserts) {
        const { data: comp } = await supabase.from('competitors').select('user_id').eq('id', pi.competitor_id).single();
        await supabase.from('tournament_participants').insert({
          tournament_id: tid,
          competitor_id: pi.competitor_id,
          display_name_snapshot: nameMap.get(comp?.user_id ?? '') || 'Unknown',
          seed: pi.seed,
          qualifying_average: pi.qualifying_average,
          initial_slot: pi.initial_slot,
        });
      }

      setStep(3);
    } finally { setGenerating(false); }
  };

  const handleGenerate = async () => {
    if (!tournamentId) return;
    setGenerating(true);
    try {
      const result = await generateBracketAction(tournamentId);
      if (!result.success) { setError(result.error); setGenerating(false); return; }
      router.push(`/competitions/${competitionId}/tournaments/${tournamentId}`);
    } finally { setGenerating(false); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">New Tournament</h1>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2 text-sm">
        {['Config', 'Participants', 'Seeds', 'Preview'].map((s, i) => (
          <div key={s} className={`flex items-center gap-1 ${i === step ? 'text-cube-blue font-semibold' : 'text-text-secondary'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${i === step ? 'bg-cube-blue/20' : 'bg-surface-hover'}`}>{i + 1}</span>
            {s} {i < 3 && <ChevronRight className="h-3 w-3" />}
          </div>
        ))}
      </div>

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">{error}</div>}

      {/* Step 0: Configuration */}
      {step === 0 && (
        <Card>
          <CardHeader><CardTitle>Tournament Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 3x3 Head-to-Head" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <select className="w-full rounded-lg border border-border bg-input-bg p-2 text-sm" value={tournamentType} onChange={e => setTournamentType(e.target.value as any)}>
                  <option value="single">Single Elimination</option>
                  <option value="double">Double Elimination</option>
                </select>
              </div>
              <div>
                <Label>Match Format</Label>
                <select className="w-full rounded-lg border border-border bg-input-bg p-2 text-sm" value={matchFormat} onChange={e => setMatchFormat(e.target.value as any)}>
                  <option value="bo3">Best of 3 (first to 2 sets)</option>
                  <option value="bo5">Best of 5 (first to 3 sets)</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Seeding</Label>
                <select className="w-full rounded-lg border border-border bg-input-bg p-2 text-sm" value={seedingType} onChange={e => setSeedingType(e.target.value as any)}>
                  <option value="unseeded">Unseeded (random)</option>
                  <option value="seeded">Seeded (by qualifying average)</option>
                </select>
              </div>
              <div>
                <Label>Scrambles</Label>
                <select className="w-full rounded-lg border border-border bg-input-bg p-2 text-sm" value={scrambleSource} onChange={e => setScrambleSource(e.target.value as any)}>
                  <option value="generated">Generated (requires event)</option>
                  <option value="external">External (admin enters)</option>
                </select>
              </div>
            </div>
            {scrambleSource === 'generated' && (
              <div>
                <Label>WCA Event</Label>
                <select className="w-full rounded-lg border border-border bg-input-bg p-2 text-sm" value={eventKey} onChange={e => setEventKey(e.target.value)}>
                  <option value="333">3x3x3</option>
                  <option value="222">2x2x2</option>
                  <option value="444">4x4x4</option>
                  <option value="555">5x5x5</option>
                  <option value="333bf">3x3x3 Blindfolded</option>
                  <option value="333oh">3x3x3 One-Handed</option>
                  <option value="pyra">Pyraminx</option>
                  <option value="skewb">Skewb</option>
                  <option value="clock">Clock</option>
                  <option value="mega">Megaminx</option>
                  <option value="sq1">Square-1</option>
                </select>
              </div>
            )}
            <Button className="w-full" onClick={() => setStep(1)} disabled={!name.trim()}>
              Next: Select Participants <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Participant Selection */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Select Competitors</span>
              <Badge variant="secondary">{selected.length} selected</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {competitors.map(c => (
              <label key={c.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selected.includes(c.id) ? 'border-cube-blue bg-cube-blue/5' : 'border-border hover:bg-surface-hover'}`}>
                <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleSelected(c.id)} className="rounded" />
                <span className="flex-1 font-medium">{c.profile?.display_name || c.profile?.username || 'Unknown'}</span>
              </label>
            ))}
            {competitors.length === 0 && <p className="text-sm text-text-secondary">No competitors registered yet.</p>}
            <Button className="w-full" onClick={() => setStep(2)} disabled={selected.length < 2}>
              {selected.length >= 2 ? `Next: ${seedingType === 'seeded' ? 'Enter Qualifying Averages' : 'Preview Bracket'}` : 'Select at least 2 competitors'} <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Seeds */}
      {step === 2 && seedingType === 'seeded' && (
        <Card>
          <CardHeader><CardTitle>Qualifying Averages</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {sortedSelected.map((id, i) => {
              const c = competitors.find(x => x.id === id);
              return (
                <div key={id} className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary w-6">#{i + 1}</span>
                  <span className="flex-1 font-medium text-sm">{c?.profile?.display_name || 'Unknown'}</span>
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
            <Button className="w-full" onClick={() => { updatePreview(); setStep(3); }}>
              Preview Bracket <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && seedingType === 'unseeded' && (
        <Card>
          <CardHeader><CardTitle>Preview Bracket</CardTitle></CardHeader>
          <CardContent>
            {(() => { updatePreview(); return null; })()}
            {preview && (
              <div className="text-sm space-y-2 mb-4">
                <p><strong>Bracket Size:</strong> {preview.bracketSize}</p>
                <p><strong>Matches:</strong> {preview.matches.length}</p>
                <p><strong>Byes:</strong> {preview.bracketSize - selected.length}</p>
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={handleCreate} disabled={!name.trim() || generating}>
                {generating ? 'Creating...' : 'Create & Continue'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Create & Generate */}
      {step === 3 && tournamentId && (
        <Card>
          <CardHeader><CardTitle>Tournament Created</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-text-secondary">Tournament "{name}" is ready. Generate the bracket now or edit settings first.</p>
            {preview && (
              <div className="border rounded-lg p-3 bg-surface-hover">
                <div className="text-xs text-text-secondary mb-2">Bracket Preview:</div>
                <p className="text-sm">Size: {preview.bracketSize} · {preview.tournamentType === 'double' ? 'Double Elim' : 'Single Elim'}</p>
                <p className="text-sm">{selected.length} competitors · {preview.bracketSize - selected.length} byes</p>
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => router.push(`/competitions/${competitionId}/tournaments/${tournamentId}`)}>
                Edit Settings
              </Button>
              <Button onClick={handleGenerate} disabled={generating}>
                {generating ? 'Generating...' : 'Generate Bracket & Start'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
