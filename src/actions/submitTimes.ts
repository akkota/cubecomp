'use server';

import { createClient } from '@/lib/supabase/server';
import type { SolveInput } from '@/lib/solve-results';

type SubmitTimesResult =
  | { success: true; solves: SolveInput[] }
  | { success: false; error: string };

export async function submitTimesAction(
  roundId: string,
  competitionId: string,
  solves: SolveInput[],
): Promise<SubmitTimesResult> {
  const supabase = await createClient();

  // 1. Get current user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // 2. Verify the round exists and is active
  const { data: round } = await supabase
    .from('rounds')
    .select('*, competition_event:competition_event_id!inner(*)')
    .eq('id', roundId)
    .single();

  if (!round) return { success: false, error: 'Round not found' };
  if (round.status !== 'active') return { success: false, error: 'Round is not active' };
  if (round.competition_event.competition_id !== competitionId) {
    return { success: false, error: 'Round does not belong to this competition' };
  }

  // 3. Verify user is a registered competitor for this competition
  const { data: competitor } = await supabase
    .from('competitors')
    .select('id')
    .eq('competition_id', competitionId)
    .eq('user_id', user.id)
    .single();

  if (!competitor) return { success: false, error: 'You are not registered for this competition' };

  // 4. Server-side eligibility check
  //    - Round 1: any registered competitor is eligible
  //    - Round 2+: must be in round_participants
  if (round.round_number > 1) {
    const { data: participant } = await supabase
      .from('round_participants')
      .select('id')
      .eq('round_id', roundId)
      .eq('competitor_id', competitor.id)
      .maybeSingle();

    if (!participant) {
      return { success: false, error: 'You have not qualified for this round' };
    }
  }

  // 5. Validate solves using per-round format
  //    round_format overrides the event-level event_format
  const roundFormat = (round.round_format || round.competition_event.event_format) as 'average' | 'mean';
  const solveCount = roundFormat === 'mean' ? 3 : 5;

  if (solves.length !== solveCount) {
    return { success: false, error: `Submit exactly ${solveCount} solves for this round` };
  }

  const solveNumbers = new Set<number>();
  for (const solve of solves) {
    if (solve.solve_number < 1 || solve.solve_number > solveCount) {
      return { success: false, error: `Invalid solve number: ${solve.solve_number}` };
    }
    if (solveNumbers.has(solve.solve_number)) {
      return { success: false, error: `Duplicate solve number: ${solve.solve_number}` };
    }
    solveNumbers.add(solve.solve_number);
    if (!['none', 'DNF', '+2'].includes(solve.penalty)) {
      return { success: false, error: `Invalid penalty: ${solve.penalty}` };
    }
    if (solve.penalty === 'DNF') {
      if (solve.time_ms !== null) {
        return { success: false, error: `${solve.penalty} must not include a numeric time` };
      }
    } else if (
      solve.time_ms === null
      || !Number.isInteger(solve.time_ms)
      || solve.time_ms <= 0
    ) {
      return { success: false, error: `Invalid time for solve ${solve.solve_number}` };
    }
  }

  // 6. Prevent duplicate submissions: check if solves already exist for this competitor
  const { data: existingSolves } = await supabase
    .from('solves')
    .select('solve_number')
    .eq('round_id', roundId)
    .eq('competitor_id', competitor.id);

  if (existingSolves && existingSolves.length > 0) {
    return { success: false, error: 'Times already submitted for this round. You cannot submit again.' };
  }

  // 7. Insert solves
  const inserts = solves.map(solve => ({
    round_id: roundId,
    competitor_id: competitor.id,
    solve_number: solve.solve_number,
    time_ms: solve.time_ms,
    penalty: solve.penalty,
    submitted_by: user.id,
  }));

  const { error } = await supabase
    .from('solves')
    .insert(inserts);

  if (error) return { success: false, error: `Failed to submit times: ${error.message}` };

  return { success: true, solves };
}
