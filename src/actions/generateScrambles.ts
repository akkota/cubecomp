'use server';

import { generateAndStoreScrambles } from '@/lib/scramble';
import { createClient } from '@/lib/supabase/server';

export async function generateScramblesAction(
  roundId: string,
  eventKey: string,
  solveCount: number
): Promise<string[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: round } = await supabase
    .from('rounds')
    .select('id, competition_event_id, competition_events!inner(competition_id, competitions!inner(created_by))')
    .eq('id', roundId)
    .single();
  if (!round) throw new Error('Round not found');

  const ce = round.competition_events as unknown as {
    competition_id: string;
    competitions: { created_by: string };
  };
  const competitionId = ce.competition_id;
  const createdBy = ce.competitions.created_by;
  let isAdmin = createdBy === user.id;
  if (!isAdmin) {
    const { data: admin } = await supabase
      .from('competition_admins')
      .select('id')
      .eq('competition_id', competitionId)
      .eq('user_id', user.id)
      .maybeSingle();
    isAdmin = !!admin;
  }
  if (!isAdmin) throw new Error('Not authorized');

  return generateAndStoreScrambles(roundId, eventKey, solveCount, supabase);
}
