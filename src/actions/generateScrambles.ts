'use server';

import { generateAndStoreScrambles } from '@/lib/scramble';
import { createClient } from '@/lib/supabase/server';

export async function generateScramblesAction(
  roundId: string,
  eventKey: string,
  solveCount: number
): Promise<string[]> {
  const supabase = await createClient();
  return generateAndStoreScrambles(roundId, eventKey, solveCount, supabase);
}
