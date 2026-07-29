'use server';

import {
  generateAndStoreScrambles,
  storeScramblesForRound,
  validateScrambleBatch,
  cubingEventForAppEvent,
  type SupabaseScrambleStore,
} from '@/lib/scramble';
import { createClient } from '@/lib/supabase/server';

async function assertRoundAdmin(roundId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: round } = await supabase
    .from('rounds')
    .select(
      'id, round_format, competition_event_id, competition_events!inner(event_key, event_format, competition_id, competitions!inner(created_by))',
    )
    .eq('id', roundId)
    .single();
  if (!round) throw new Error('Round not found');

  const ce = round.competition_events as unknown as {
    event_key: string;
    event_format: string;
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

  const format = (round.round_format || ce.event_format) as string;
  const solveCount = format === 'mean' ? 3 : 5;

  return { supabase, eventKey: ce.event_key, solveCount };
}

/**
 * Preferred admin path: generate scrambles in the browser (cubing workers),
 * then persist here. Avoids serverless worker hangs / action timeouts.
 */
export async function storeScramblesAction(
  roundId: string,
  eventKey: string,
  scrambles: string[],
): Promise<string[]> {
  const { supabase, eventKey: roundEventKey, solveCount } = await assertRoundAdmin(roundId);
  if (eventKey !== roundEventKey) {
    throw new Error('Event does not match this round');
  }
  cubingEventForAppEvent(eventKey);
  const normalized = validateScrambleBatch(scrambles, solveCount);
  return storeScramblesForRound(
    roundId,
    normalized,
    supabase as unknown as SupabaseScrambleStore,
  );
}

/**
 * Server-side generate+store fallback (tournaments / scripts). Prefer
 * storeScramblesAction after client generation for competition admin UI.
 */
export async function generateScramblesAction(
  roundId: string,
  eventKey: string,
  solveCount: number,
): Promise<string[]> {
  const { supabase, eventKey: roundEventKey, solveCount: expected } = await assertRoundAdmin(roundId);
  if (eventKey !== roundEventKey) {
    throw new Error('Event does not match this round');
  }
  if (solveCount !== expected) {
    throw new Error(`Expected ${expected} scrambles for this round format`);
  }
  return generateAndStoreScrambles(
    roundId,
    eventKey,
    solveCount,
    supabase as unknown as SupabaseScrambleStore,
  );
}
