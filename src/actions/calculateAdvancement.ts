'use server';

import { createClient } from '@/lib/supabase/server';
import { calculateResult } from '@/lib/wca-events';
import { getEventByKey } from '@/lib/wca-events';

export async function calculateAdvancementAction(roundId: string) {
  const supabase = await createClient();

  // 1. Verify user is the competition creator
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: round } = await supabase
    .from('rounds')
    .select('*, competition_event:competition_event_id!inner(*)')
    .eq('id', roundId)
    .single();

  if (!round) throw new Error('Round not found');
  if (!round.advance_count) throw new Error('Advance count not set for this round');

  const { data: comp } = await supabase
    .from('competitions')
    .select('created_by')
    .eq('id', round.competition_event.competition_id)
    .single();

  if (!comp || comp.created_by !== user.id) {
    throw new Error('Only the competition creator can calculate advancement');
  }

  // 2. Verify round is completed
  if (round.status !== 'completed') {
    throw new Error('Previous round must be completed before calculating advancement');
  }

  // 3. Get the next round
  const { data: nextRound } = await supabase
    .from('rounds')
    .select('*')
    .eq('competition_event_id', round.competition_event_id)
    .eq('round_number', round.round_number + 1)
    .single();

  if (!nextRound) {
    throw new Error('No next round to advance to');
  }

  // 4. Fetch all solves for this round
  const { data: solves } = await supabase
    .from('solves')
    .select('*, competitor:competitor_id!inner(*)')
    .eq('round_id', roundId);

  if (!solves || solves.length === 0) {
    throw new Error('No solves submitted for this round');
  }

  // 5. Group solves by competitor and calculate results
  const eventKey = round.competition_event.event_key;
  const wcaEvent = getEventByKey(eventKey);
  const format = round.competition_event.event_format as 'average' | 'mean';
  const solveCount = wcaEvent?.solveCount ?? 5;

  const competitorResults = new Map<string, { competitor_id: string; times: (number | null)[] }>();

  for (const solve of solves as any[]) {
    const cId = solve.competitor_id;
    if (!competitorResults.has(cId)) {
      competitorResults.set(cId, { competitor_id: cId, times: [] });
    }
    const time = solve.penalty === 'DNF' ? null
      : solve.penalty === '+2' && solve.time_ms !== null ? solve.time_ms + 2000
      : solve.penalty === 'DNS' ? null
      : solve.time_ms;
    competitorResults.get(cId)!.times.push(time);
  }

  // 6. Sort by result (best first)
  const sorted = Array.from(competitorResults.values()).sort((a, b) => {
    const resA = calculateResult(a.times, format);
    const resB = calculateResult(b.times, format);
    if (resA === 'DNF' && resB === 'DNF') return 0;
    if (resA === 'DNF') return 1;
    if (resB === 'DNF') return -1;
    if (resA === null) return 1;
    if (resB === null) return -1;
    return (resA as number) - (resB as number);
  });

  // 7. Apply advance_count cutoff with tie handling
  const advanceCount = round.advance_count;
  const advancing: string[] = [];

  // Take first N competitors
  for (let i = 0; i < Math.min(advanceCount, sorted.length); i++) {
    advancing.push(sorted[i].competitor_id);
  }

  // Handle ties at the cutoff boundary
  if (advanceCount <= sorted.length) {
    const cutoffResult = calculateResult(sorted[advanceCount - 1].times, format);
    // Walk forward: anyone tied with the cutoff person also advances
    for (let i = advanceCount; i < sorted.length; i++) {
      const res = calculateResult(sorted[i].times, format);
      if (res === cutoffResult) {
        advancing.push(sorted[i].competitor_id);
      } else {
        break; // sorted, so no more ties after this
      }
    }
  }

  // 8. Insert into round_participants for the next round
  const inserts = advancing.map(competitor_id => ({
    round_id: nextRound.id,
    competitor_id,
  }));

  const { error } = await supabase
    .from('round_participants')
    .insert(inserts);

  if (error) throw new Error(`Failed to advance competitors: ${error.message}`);

  return {
    advanced: advancing.length,
    total: sorted.length,
    roundNumber: round.round_number,
    nextRoundNumber: nextRound.round_number,
  };
}
