import { getEventByKey, type WcaEvent } from './wca-events';

/**
 * Server-side scramble generation using cubing.js.
 * Each WCA event maps to a puzzle and scramble generator.
 */

import { randomScrambleForEvent as cubingRandomScrambleForEvent } from 'cubing/scramble';

interface ScrambleConfig {
  puzzle: string;    // cubing.js puzzle class name
  generator: string; // generator method
}

function getScrambleConfig(eventKey: string): ScrambleConfig | null {
  // Map WCA event keys to cubing.js scramble families
  // cubing.js supports: 333, 222, 444, 555, 666, 777, clock, megaminx, pyraminx, skewb, square1
  const configs: Record<string, ScrambleConfig> = {
    '333':   { puzzle: 'cube3x3x3',     generator: 'randomScramble' },
    '222':   { puzzle: 'cube2x2x2',     generator: 'randomScramble' },
    '444':   { puzzle: 'cube4x4x4',     generator: 'randomScramble' },
    '555':   { puzzle: 'cube5x5x5',     generator: 'randomScramble' },
    '666':   { puzzle: 'cube6x6x6',     generator: 'randomScramble' },
    '777':   { puzzle: 'cube7x7x7',     generator: 'randomScramble' },
    '333bf': { puzzle: 'cube3x3x3',     generator: 'randomScramble' },
    '333fm': { puzzle: 'cube3x3x3',     generator: 'randomScramble' },
    '333oh': { puzzle: 'cube3x3x3',     generator: 'randomScramble' },
    'clock':  { puzzle: 'clock',         generator: 'randomScramble' },
    'mega':   { puzzle: 'megaminx',      generator: 'randomScramble' },
    'pyra':   { puzzle: 'pyraminx',      generator: 'randomScramble' },
    'skewb':  { puzzle: 'skewb',         generator: 'randomScramble' },
    'sq1':    { puzzle: 'square1',       generator: 'randomScramble' },
    '444bf': { puzzle: 'cube4x4x4',     generator: 'randomScramble' },
    '555bf': { puzzle: 'cube5x5x5',     generator: 'randomScramble' },
    '333mbf':{ puzzle: 'cube3x3x3',     generator: 'randomScramble' },
  };
  return configs[eventKey] ?? null;
}

/**
 * Generate a single scramble string for an event.
 * Uses cubing.js to produce standard WCA-format scrambles.
 */
async function generateScramble(eventKey: string): Promise<string> {
  const config = getScrambleConfig(eventKey);
  if (!config) {
    throw new Error(`No scramble config for event: ${eventKey}`);
  }

  const randomScrambleForEvent = cubingRandomScrambleForEvent;

  // cubing.js event IDs use WCA names
  const eventIdMap: Record<string, string> = {
    '333': '333', '222': '222', '444': '444', '555': '555',
    '666': '666', '777': '777', '333bf': '333bf', '333fm': '333fm',
    '333oh': '333oh', 'clock': 'clock', 'mega': 'minx',
    'pyra': 'pyram', 'skewb': 'skewb', 'sq1': 'sq1',
    '444bf': '444bf', '555bf': '555bf', '333mbf': '333mbf',
  };

  try {
    const eventId = eventIdMap[eventKey] ?? eventKey;
    const scramble = await randomScrambleForEvent(eventId);
    return scramble.toString();
  } catch {
    // Fallback: generate a basic random-state scramble
    // For unsupported events, we use the 3x3 scramble as a reasonable fallback
    const scramble = await randomScrambleForEvent('333');
    return scramble.toString();
  }
}

/**
 * Generate a full set of scrambles for a round.
 * @param eventKey - WCA event key
 * @param solveCount - Number of scrambles to generate (typically 3 or 5)
 */
export async function generateScrambles(
  eventKey: string,
  solveCount: number
): Promise<string[]> {
  const scrambles: string[] = [];
  for (let i = 0; i < solveCount; i++) {
    const scramble = await generateScramble(eventKey);
    scrambles.push(scramble);
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
  supabase: any
): Promise<string[]> {
  const scrambles = await generateScrambles(eventKey, solveCount);

  const { error } = await supabase
    .from('scrambles')
    .insert(
      scrambles.map((scramble, idx) => ({
        round_id: roundId,
        scramble_number: idx + 1,
        scramble,
      }))
    );

  if (error) throw new Error(`Failed to store scrambles: ${error.message}`);
  return scrambles;
}
