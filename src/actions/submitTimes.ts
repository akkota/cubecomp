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
) {
  const supabase = await createClient();

  // 1. Get current user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // 2. Verify the round exists and is active
  const { data: round } = await supabase
    .from('rounds')
    .select('*, competition_event:competition_event_id!inner(*)')
    .eq('id', roundId)
    .single();

  if (!round) throw new Error('Round not found');
  if (round.status !== 'active') throw new Error('Round is not active');

  // 3. Verify user is a registered competitor for this competition
  const { data: competitor } = await supabase
    .from('competitors')
    .select('id')
    .eq('competition_id', competitionId)
    .eq('user_id', user.id)
    .single();

  if (!competitor) throw new Error('You are not registered for this competition');

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
      throw new Error('You have not qualified for this round');
    }
  }

  // 5. Validate solves
  const eventKey = round.competition_event.event_key;
  const wcaEvent = getEventByKey(eventKey);
  const solveCount = wcaEvent?.solveCount ?? 5;

  if (solves.length === 0) throw new Error('Enter at least one time');

  for (const solve of solves) {
    if (solve.solve_number < 1 || solve.solve_number > solveCount) {
      throw new Error(`Invalid solve number: ${solve.solve_number}`);
    }
    if (!['none', 'DNF', '+2', 'DNS'].includes(solve.penalty)) {
      throw new Error(`Invalid penalty: ${solve.penalty}`);
    }
    if (solve.penalty === 'none' && solve.time_ms !== null && solve.time_ms < 0) {
      throw new Error(`Invalid time for solve ${solve.solve_number}`);
    }
  }

  // 6. Delete existing solves for this user/round
  await supabase
    .from('solves')
    .delete()
    .eq('round_id', roundId)
    .eq('competitor_id', competitor.id);

  // 7. Insert new solves
  const inserts = solves.map(solve => ({
    round_id: roundId,
    competitor_id: competitor.id,
    solve_number: solve.solve_number,
    time_ms: solve.time_ms,
    penalty: solve.penalty,
    submitted_by: user.id,
  }));

  const { error } = await supabase.from('solves').insert(inserts);
  if (error) throw new Error(`Failed to submit times: ${error.message}`);

  return { success: true };
}
