/**
 * Lightweight random-move scramble generator.
 *
 * Replaces cubing.js (which is too heavy for Vercel's 10-second
 * serverless timeout) with an instant scrambler that produces
 * standard-notation scrambles for every WCA event.
 *
 * Uses standard WCA scramble lengths with axis-avoidance for
 * NxN puzzles to prevent redundant/trivial move sequences.
 */

// ---------------------------------------------------------------------------
// Move sets
// ---------------------------------------------------------------------------

const MOVES_333: string[] = ['U','D','R','L','F','B'];
const MOVES_222: string[] = ['U','R','F'];
const N3_DIRS: string[] = ['', "'", '2'];

// Big-cube outer moves plus wide moves (Rw, Uw, etc.)
function bigCubeMoves(size: number): string[] {
  const faces = ['U','D','R','L','F','B'];
  const moves: string[] = [];
  for (const f of faces) {
    moves.push(f);
    moves.push(f + 'w');  // wide
    if (size >= 6) moves.push('3' + f + 'w');
    if (size >= 7) moves.push('4' + f + 'w');
  }
  return moves;
}

function bigCubeDirs(): string[] {
  return ['', "'", '2'];
}

// Pyraminx: tip moves + face moves
const MOVES_PYRA_BASE: string[] = ['U','L','R','B'];

// Skewb: 4 corners labelled clockwise
const MOVES_SKEWB: string[] = ['U','L','R','B'];

// Square-1: simplified notation (slice positions + U/D twists)
function sq1Scramble(): string {
  const pairs: string[] = [];
  for (let i = 0; i < 7; i++) {
    const top = Math.floor(Math.random() * 7) - 3;
    const bot = Math.floor(Math.random() * 7) - 3;
    pairs.push(`(${top},${bot})`);
  }
  pairs.push('/');
  return pairs.join(' / ');
}

// Clock: pin positions + dial turns
function clockScramble(): string {
  const pins = ['UR','DR','DL','UL','U','R','D','L','ALL'];
  const scrambles: string[] = [];
  for (let i = 0; i < 5; i++) {
    const pin1 = pins[Math.floor(Math.random() * pins.length)];
    const pin2 = pins[Math.floor(Math.random() * pins.length)];
    const d1 = Math.floor(Math.random() * 12) - 5;
    const d2 = Math.floor(Math.random() * 12) - 5;
    scrambles.push(`${pin1}${d1 >= 0 ? '+' + d1 : d1} ${pin2}${d2 >= 0 ? '+' + d2 : d2}`);
  }
  return scrambles.join(', ');
}

// Megaminx: simplified (R++/R--/D++/D--/U/U')
function megaminxScramble(length: number): string {
  const parts: string[] = [];
  for (let i = 0; i < length; i++) {
    const r = Math.random();
    if (r < 0.35) parts.push('R++');
    else if (r < 0.7) parts.push('R--');
    else if (r < 0.8) parts.push('D++');
    else if (r < 0.9) parts.push('D--');
    else parts.push(Math.random() < 0.5 ? 'U' : "U'");
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Core generator
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a sequence of `length` moves, avoiding consecutive moves
 * on the same axis (same face letter group).
 */
function generateMoveSequence(
  moves: string[],
  directions: string[],
  length: number,
): string {
  const result: string[] = [];
  let lastFace = '';

  for (let i = 0; i < length; i++) {
    let move: string;
    // Pick a move that doesn't share an axis with the previous one
    do {
      move = pick(moves);
    } while (result.length > 0 && move[0] === lastFace);

    const dir = pick(directions);
    result.push(move + dir);
    lastFace = move[0];
  }

  return result.join(' ');
}

// ---------------------------------------------------------------------------
// Per-event scramble generation
// ---------------------------------------------------------------------------

const SCRAMBLE_LENGTHS: Record<string, number> = {
  '222': 9,
  '333': 20,
  '444': 40,
  '555': 60,
  '666': 80,
  '777': 100,
  '333bf': 20,
  '333fm': 20,
  '333oh': 20,
  'clock': 14,
  'mega': 70,
  'pyra': 10,
  'skewb': 9,
  'sq1': 20,
  '444bf': 40,
  '555bf': 60,
  '333mbf': 20,
};

function generateScramble(eventKey: string): string {
  switch (eventKey) {
    case '222':
      return generateMoveSequence(MOVES_222, N3_DIRS, SCRAMBLE_LENGTHS['222']);

    case '333':
    case '333bf':
    case '333fm':
    case '333oh':
    case '333mbf':
      return generateMoveSequence(MOVES_333, N3_DIRS, SCRAMBLE_LENGTHS['333']);

    case '444':
    case '444bf':
      return generateMoveSequence(bigCubeMoves(4), bigCubeDirs(), SCRAMBLE_LENGTHS['444']);

    case '555':
    case '555bf':
      return generateMoveSequence(bigCubeMoves(5), bigCubeDirs(), SCRAMBLE_LENGTHS['555']);

    case '666':
      return generateMoveSequence(bigCubeMoves(6), bigCubeDirs(), SCRAMBLE_LENGTHS['666']);

    case '777':
      return generateMoveSequence(bigCubeMoves(7), bigCubeDirs(), SCRAMBLE_LENGTHS['777']);

    case 'clock':
      return clockScramble();

    case 'mega':
      return megaminxScramble(SCRAMBLE_LENGTHS['mega']);

    case 'pyra': {
      // Pyraminx: tips + face moves
      const tips: string[] = ['u', 'l', 'r', 'b'];
      const tipScramble = tips
        .map(t => t + pick(N3_DIRS))
        .join(' ');
      const faceScramble = generateMoveSequence(MOVES_PYRA_BASE, N3_DIRS, SCRAMBLE_LENGTHS['pyra']);
      return tipScramble + ' ' + faceScramble;
    }

    case 'skewb':
      return generateMoveSequence(MOVES_SKEWB, N3_DIRS, SCRAMBLE_LENGTHS['skewb']);

    case 'sq1':
      return sq1Scramble();

    default:
      // Fallback to 3x3
      return generateMoveSequence(MOVES_333, N3_DIRS, 20);
  }
}

// ---------------------------------------------------------------------------
// Public API (matches the old cubing.js interface)
// ---------------------------------------------------------------------------

/**
 * Generate a full set of scrambles for a round.
 */
export async function generateScrambles(
  eventKey: string,
  solveCount: number,
): Promise<string[]> {
  const scrambles: string[] = [];
  for (let i = 0; i < solveCount; i++) {
    scrambles.push(generateScramble(eventKey));
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
  supabase: any,
): Promise<string[]> {
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

  if (error) throw new Error(`Failed to store scrambles: ${error.message}`);
  return scrambles;
}
