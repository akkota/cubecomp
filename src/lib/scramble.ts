import { WCA_EVENTS, type WcaEventKey } from './wca-events';

export const APP_TO_CUBING_EVENT: Record<WcaEventKey, string> = {
  '333': '333',
  '222': '222',
  '444': '444',
  '555': '555',
  '666': '666',
  '777': '777',
  '333bf': '333bf',
  '333fm': '333fm',
  '333oh': '333oh',
  clock: 'clock',
  mega: 'minx',
  pyra: 'pyram',
  skewb: 'skewb',
  sq1: 'sq1',
  '444bf': '444bf',
  '555bf': '555bf',
  '333mbf': '333mbf',
};

export function cubingEventForAppEvent(eventKey: string): string {
  const cubingEvent = APP_TO_CUBING_EVENT[eventKey as WcaEventKey];
  if (!cubingEvent) {
    throw new Error(`Unsupported WCA event: ${eventKey}`);
  }
  return cubingEvent;
}

export function supportedScrambleEvents(): WcaEventKey[] {
  return WCA_EVENTS.map((event) => event.key);
}

interface ScrambleRow {
  scramble: string;
}

export interface SupabaseScrambleStore {
  from(table: 'scrambles'): {
    select(columns: string): {
      eq(column: string, value: string): {
        order(column: string): PromiseLike<{
          data: ScrambleRow[] | null;
          error?: { code?: string; message: string } | null;
        }>;
      };
    };
    insert(rows: Array<{ round_id: string; scramble_number: number; scramble: string }>): PromiseLike<{
      error: { code?: string; message: string } | null;
    }>;
  };
}

async function generateScramble(eventKey: string): Promise<string> {
  const { randomScrambleForEvent } = await import('cubing/scramble');
  const scramble = await randomScrambleForEvent(cubingEventForAppEvent(eventKey));
  return scramble.toString();
}

/**
 * Generate a full set of official WCA scrambles for a round.
 */
export async function generateScrambles(
  eventKey: string,
  solveCount: number,
): Promise<string[]> {
  if (!Number.isInteger(solveCount) || solveCount < 1) {
    throw new Error('solveCount must be a positive integer');
  }

  const scrambles: string[] = [];
  for (let i = 0; i < solveCount; i += 1) {
    scrambles.push(await generateScramble(eventKey));
  }
  return scrambles;
}

/**
 * Generate scrambles and store them in the database for a round.
 */
export async function generateAndStoreScrambles(
  roundId: string,
  eventKey: string,
  solveCount: number,
  supabase: SupabaseScrambleStore,
): Promise<string[]> {
  // Validate before checking storage so invalid events never silently pass.
  cubingEventForAppEvent(eventKey);

  const { data: existing } = await supabase
    .from('scrambles')
    .select('scramble')
    .eq('round_id', roundId)
    .order('scramble_number');

  if (existing && existing.length > 0) {
    return existing.map((s) => s.scramble);
  }

  const scrambles = await generateScrambles(eventKey, solveCount);

  const { error } = await supabase
    .from('scrambles')
    .insert(
      scrambles.map((scramble, idx) => ({
        round_id: roundId,
        scramble_number: idx + 1,
        scramble,
      })),
    );

  // Handle race condition: if another insert beat us, return the persisted rows.
  if (error) {
    if (error.code === '23505') {
      const { data: raced } = await supabase
        .from('scrambles')
        .select('scramble')
        .eq('round_id', roundId)
        .order('scramble_number');
      if (raced) return raced.map((s) => s.scramble);
    }
    throw new Error(`Failed to store scrambles: ${error.message}`);
  }
  return scrambles;
}
