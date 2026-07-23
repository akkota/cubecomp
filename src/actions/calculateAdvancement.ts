'use server';

import { createClient } from '@/lib/supabase/server';
import { calculateResult } from '@/lib/wca-events';
import { getEventByKey } from '@/lib/wca-events';

export type AdvancementResult = {
  success: boolean;
  error?: string;
  /** Number of competitors who advanced */
  advanced?: number;
  /** Total competitors who submitted times */
  total?: number;
  /** Total registered competitors */
  registered?: number;
  /** Number who DNF'd all solves */
  dnfCount?: number;
  roundNumber?: number;
  nextRoundNumber?: number;
  /** True if advancement was already calculated before this call */
  alreadyCalculated?: boolean;
};

export async function calculateAdvancementAction(roundId: string): Promise<AdvancementResult> {
  const supabase = await createClient();

  // 1. Auth + ownership
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: round } = await supabase
    .from('rounds')
    .select('*, competition_event:competition_event_id!inner(*)')
    .eq('id', roundId)
    .single();

  if (!round) return { success: false, error: 'Round not found' };

  const { data: comp } = await supabase
    .from('competitions')
    .select('created_by')
    .eq('id', round.competition_event.competition_id)
    .single();

  if (!comp || comp.created_by !== user.id) {
    return { success: false, error: 'Only the competition creator can calculate advancement' };
  }

  // 2. Validate state
  if (round.status !== 'completed') {
    return { success: false, error: 'The round must be completed before calculating advancement' };
  }

  if (!round.advance_count || round.advance_count < 1) {
    return { success: false, error: 'Set an advance count (e.g. top 3) before calculating advancement' };
  }

  // 3. Get the next round
  const { data: nextRound } = await supabase
    .from('rounds')
    .select('*')
    .eq('competition_event_id', round.competition_event_id)
    .eq('round_number', round.round_number + 1)
    .single();

  if (!nextRound) {
    return { success: false, error: 'No next round exists to advance competitors to' };
  }

  // 4. Idempotency guard — if round_participants already exist for the next round,
  //    advancement was already calculated. Return the existing state.
  const { count: existingCount } = await supabase
    .from('round_participants')
    .select('*', { count: 'exact', head: true })
    .eq('round_id', nextRound.id);

  if (existingCount && existingCount > 0) {
    return {
      success: true,
      advanced: existingCount,
      total: existingCount,
      roundNumber: round.round_number,
      nextRoundNumber: nextRound.round_number,
      alreadyCalculated: true,
    };
  }

  // 5. Count registered competitors for context
  const { count: registeredCount } = await supabase
    .from('competitors')
    .select('*', { count: 'exact', head: true })
    .eq('competition_id', round.competition_event.competition_id);

  // 6. Fetch all solves for this round
  const { data: solves } = await supabase
    .from('solves')
    .select('*, competitor:competitor_id!inner(*)')
    .eq('round_id', roundId);

  const hasSolves = solves && solves.length > 0;

  // Edge case: no solves at all
  if (!hasSolves) {
    return {
      success: true,
      advanced: 0,
      total: 0,
      registered: registeredCount ?? 0,
      roundNumber: round.round_number,
      nextRoundNumber: nextRound.round_number,
    };
  }

  // 7. Group solves by competitor and calculate results
  const eventKey = round.competition_event.event_key;
  const wcaEvent = getEventByKey(eventKey);
  const format = round.competition_event.event_format as 'average' | 'mean';

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

  // 8. Sort by result (best first), separate DNF vs valid
  const sorted = Array.from(competitorResults.values()).sort((a, b) => {
    const resA = calculateResult(a.times, format);
    const resB = calculateResult(b.times, format);
    // Valid results before DNF; DNF sorted together; empty after DNF
    if (resA === null && resB === null) return 0;
    if (resA === null) return 1;
    if (resB === null) return -1;
    if (resA === 'DNF' && resB === 'DNF') return 0;
    if (resA === 'DNF') return 1;
    if (resB === 'DNF') return -1;
    return (resA as number) - (resB as number);
  });

  // 9. Count competitors with valid results vs DNF
  let dnfCount = 0;
  let validCount = 0;
  for (const c of sorted) {
    const res = calculateResult(c.times, format);
    if (res === 'DNF') dnfCount++;
    else if (res !== null) validCount++;
  }

  // 10. Apply advance_count cutoff with tie handling
  const advanceCount = round.advance_count;
  const advancing: string[] = [];

  // Only advance competitors with valid results
  const validCompetitors = sorted.filter(c => {
    const res = calculateResult(c.times, format);
    return res !== null && res !== 'DNF';
  });

  // Edge case: zero valid results (everyone DNF'd)
  if (validCompetitors.length === 0) {
    return {
      success: true,
      advanced: 0,
      total: sorted.length,
      registered: registeredCount ?? 0,
      dnfCount,
      roundNumber: round.round_number,
      nextRoundNumber: nextRound.round_number,
    };
  }

  // Take first N valid competitors (or all if fewer than the cutoff)
  for (let i = 0; i < Math.min(advanceCount, validCompetitors.length); i++) {
    advancing.push(validCompetitors[i].competitor_id);
  }

  // Handle ties at the cutoff boundary
  if (advanceCount <= validCompetitors.length) {
    const cutoffResult = calculateResult(validCompetitors[advanceCount - 1].times, format);
    for (let i = advanceCount; i < validCompetitors.length; i++) {
      const res = calculateResult(validCompetitors[i].times, format);
      if (res === cutoffResult) {
        advancing.push(validCompetitors[i].competitor_id);
      } else {
        break;
      }
    }
  }

  // 11. Insert into round_participants for the next round
  const inserts = advancing.map(competitor_id => ({
    round_id: nextRound.id,
    competitor_id,
  }));

  const { error } = await supabase
    .from('round_participants')
    .insert(inserts);

  if (error) {
    // Handle unique constraint violation (re-insert race)
    if (error.code === '23505') {
      return {
        success: true,
        advanced: advancing.length,
        total: sorted.length,
        registered: registeredCount ?? 0,
        dnfCount,
        roundNumber: round.round_number,
        nextRoundNumber: nextRound.round_number,
        alreadyCalculated: true,
      };
    }
    return { success: false, error: `Failed to advance competitors: ${error.message}` };
  }

  return {
    success: true,
    advanced: advancing.length,
    total: sorted.length,
    registered: registeredCount ?? 0,
    dnfCount,
    roundNumber: round.round_number,
    nextRoundNumber: nextRound.round_number,
  };
}
