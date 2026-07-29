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

const MAX_SCRAMBLE_LENGTH = 2000;

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

export function normalizeScrambleText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Scramble must be a string');
  }
  const scramble = value.trim();
  if (!scramble) {
    throw new Error('Scramble cannot be empty');
  }
  if (scramble.length > MAX_SCRAMBLE_LENGTH) {
    throw new Error('Scramble is too long');
  }
  return scramble;
}

export function validateScrambleBatch(scrambles: unknown, solveCount: number): string[] {
  if (!Number.isInteger(solveCount) || solveCount < 1) {
    throw new Error('solveCount must be a positive integer');
  }
  if (!Array.isArray(scrambles) || scrambles.length !== solveCount) {
    throw new Error(`Expected ${solveCount} scrambles`);
  }
  return scrambles.map(normalizeScrambleText);
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

type ScrambleApi = {
  randomScrambleForEvent: (eventId: string) => Promise<{ toString(): string }>;
};

let scrambleApiPromise: Promise<ScrambleApi> | null = null;

/**
 * Keep cubing.js external on the server (see next.config) so Next does not
 * rewrite the module worker entry URL. The native package worker is reliable
 * in Node and avoids browser bundler/CSP differences.
 */
async function getScrambleApi(): Promise<ScrambleApi> {
  if (!scrambleApiPromise) {
    scrambleApiPromise = (async () => {
      const [{ randomScrambleForEvent }, { setSearchDebug }] = await Promise.all([
        import('cubing/scramble'),
        import('cubing/search'),
      ]);
      setSearchDebug({
        logPerf: false,
        // Prefetch the next scramble for the same event as soon as one finishes.
        scramblePrefetchLevel: 'immediate',
      });
      return { randomScrambleForEvent };
    })();
  }
  return scrambleApiPromise;
}

export async function generateScramble(eventKey: string): Promise<string> {
  const { randomScrambleForEvent } = await getScrambleApi();
  const scramble = await randomScrambleForEvent(cubingEventForAppEvent(eventKey));
  return scramble.toString();
}

/**
 * Generate a full set of official WCA scrambles for a round.
 * Same-event requests stay sequential so cubing's worker + immediate prefetch
 * can reuse warm solver state (parallel same-event calls fight over one worker).
 */
export async function generateScrambles(
  eventKey: string,
  solveCount: number,
): Promise<string[]> {
  if (!Number.isInteger(solveCount) || solveCount < 1) {
    throw new Error('solveCount must be a positive integer');
  }

  // Validate event before doing any worker work.
  cubingEventForAppEvent(eventKey);

  const scrambles: string[] = [];
  for (let i = 0; i < solveCount; i += 1) {
    scrambles.push(await generateScramble(eventKey));
  }
  return scrambles;
}

/**
 * Persist already-generated scramble texts for a round (idempotent).
 */
export async function storeScramblesForRound(
  roundId: string,
  scrambles: string[],
  supabase: SupabaseScrambleStore,
): Promise<string[]> {
  const normalized = validateScrambleBatch(scrambles, scrambles.length);

  const { data: existing } = await supabase
    .from('scrambles')
    .select('scramble')
    .eq('round_id', roundId)
    .order('scramble_number');

  if (existing && existing.length > 0) {
    return existing.map((s) => s.scramble);
  }

  const { error } = await supabase.from('scrambles').insert(
    normalized.map((scramble, idx) => ({
      round_id: roundId,
      scramble_number: idx + 1,
      scramble,
    })),
  );

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
  return normalized;
}

/**
 * Generate scrambles and store them in the database for a round.
 * Prefer client-side generate + storeScramblesForRound for admin UI;
 * keep this for server-only callers (e.g. tournaments).
 */
export async function generateAndStoreScrambles(
  roundId: string,
  eventKey: string,
  solveCount: number,
  supabase: SupabaseScrambleStore,
): Promise<string[]> {
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
  return storeScramblesForRound(roundId, scrambles, supabase);
}
