'use server';

import { createClient } from '@/lib/supabase/server';
import { getEventByKey } from '@/lib/wca-events';

interface SolveInput {
  solve_number: number;
  time_ms: number | null;
  penalty: string;
}

export async function submitTimesAction(
  roundId: string,
  competitionId: string,
  solves: SolveInput[],
): Promise<{ success: boolean; error?: string }> {
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

  // 5. Validate solves
  const eventKey = round.competition_event.event_key;
  const wcaEvent = getEventByKey(eventKey);
  const solveCount = wcaEvent?.solveCount ?? 5;

  if (solves.length === 0) return { success: false, error: 'Enter at least one time' };

  for (const solve of solves) {
    if (solve.solve_number < 1 || solve.solve_number > solveCount) {
      return { success: false, error: `Invalid solve number: ${solve.solve_number}` };
    }
    if (!['none', 'DNF', '+2', 'DNS'].includes(solve.penalty)) {
      return { success: false, error: `Invalid penalty: ${solve.penalty}` };
    }
    if (solve.penalty === 'none' && solve.time_ms !== null && solve.time_ms < 0) {
      return { success: false, error: `Invalid time for solve ${solve.solve_number}` };
    }
  }

  // 6. Use upsert instead of delete+insert for idempotency.
  //    If the same (round_id, competitor_id, solve_number) exists, update it.
  //    This prevents errors from the unique constraint when called concurrently.
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
    .upsert(inserts, {
      onConflict: 'round_id,competitor_id,solve_number',
      ignoreDuplicates: false,
    });

  if (error) return { success: false, error: `Failed to submit times: ${error.message}` };

  return { success: true };
}
