/**
 * Bracket Engine — Pure algorithm for generating single/double elimination brackets.
 */

export type BracketType = 'winners' | 'losers' | 'grand_final' | 'reset_final';
export type TournamentType = 'single' | 'double';
export type SeedingType = 'seeded' | 'unseeded';

export interface BracketMatchDef {
  bracketType: BracketType;
  bracketRound: number;
  matchNumber: number;
  slot1Seed: number | null;
  slot2Seed: number | null;
  isBye: boolean;
  nextMatchIndex: number | null;
  loserNextMatchIndex: number | null;
}

export interface BracketDefinition {
  bracketSize: number;
  participantCount: number;
  tournamentType: TournamentType;
  seedPositions: number[];
  matches: BracketMatchDef[];
}

// ─── Seed Placement ──────────────────────────────────────────────────

function computeSeedPositions(k: number): number[] {
  if (k <= 0) return [1];
  const size = 1 << k;
  const prev = computeSeedPositions(k - 1);
  const out: number[] = [];
  for (const p of prev) {
    out.push(p);
    out.push(size - p + 1);
  }
  return out;
}

function nextPow2(n: number): number {
  if (n <= 1) return 2;
  let p = 2;
  while (p < n) p <<= 1;
  return p;
}

/** Build position-to-seed reverse lookup. posToSeed[pos] = seed or null. */
function buildPosToSeed(positions: number[], bracketSize: number): (number | null)[] {
  const map: (number | null)[] = new Array(bracketSize + 1).fill(null);
  for (let seed = 1; seed <= positions.length; seed++) {
    const p = positions[seed - 1];
    if (p >= 1 && p <= bracketSize) map[p] = seed;
  }
  return map;
}

/** Given bracket position, return seed if ≤ participantCount, else null. */
function seedAtPos(pos: number, pts: (number | null)[], pc: number): number | null {
  const s = pts[pos];
  return s !== null && s <= pc ? s : null;
}

// ─── Single Elimination ──────────────────────────────────────────────

function generateSingleElimination(pc: number, bs: number): BracketMatchDef[] {
  const k = Math.log2(bs);
  if (k === 0) return [];
  const P = computeSeedPositions(k);
  const pts = buildPosToSeed(P, bs);
  const matches: BracketMatchDef[] = [];
  const wr1c = bs / 2;

  // WR1 — standard seeding: P[i] vs P[n-1-i] (outermost inward)
  for (let i = 0; i < wr1c; i++) {
    const s1 = seedAtPos(P[i], pts, pc);
    const s2 = seedAtPos(P[bs - 1 - i], pts, pc);
    matches.push({
      bracketType: 'winners', bracketRound: 1, matchNumber: i + 1,
      slot1Seed: s1, slot2Seed: s2, isBye: s1 === null || s2 === null,
      nextMatchIndex: k > 1 ? wr1c + Math.floor(i / 2) : null,
      loserNextMatchIndex: null,
    });
  }

  for (let r = 2; r <= k; r++) {
    const mc = bs >> r;
    const rs = matches.length;
    for (let i = 0; i < mc; i++) {
      matches.push({
        bracketType: 'winners', bracketRound: r, matchNumber: i + 1,
        slot1Seed: null, slot2Seed: null, isBye: false,
        nextMatchIndex: r === k ? null : rs + mc + Math.floor(i / 2),
        loserNextMatchIndex: null,
      });
    }
  }
  return matches;
}

// ─── Double Elimination ──────────────────────────────────────────────

function generateDoubleElimination(pc: number, bs: number): BracketMatchDef[] {
  const k = Math.log2(bs);
  if (k <= 1) return generateSingleElimination(pc, bs);

  const P = computeSeedPositions(k);
  const pts = buildPosToSeed(P, bs);
  const M: BracketMatchDef[] = [];
  const wrT = bs - 1;
  const wr1c = bs / 2;
  const lbRc = 2 * k - 2;

  function lbMC(r: number): number {
    if (r < 1 || r > lbRc) return 0;
    return 1 << (k - Math.ceil(r / 2) - 1);
  }
  function lbRS(r: number): number {
    let i = wrT;
    for (let r2 = 1; r2 < r; r2++) i += lbMC(r2);
    return i;
  }

  // WR1 — standard P[i] vs P[n-1-i]
  for (let i = 0; i < wr1c; i++) {
    const s1 = seedAtPos(P[i], pts, pc);
    const s2 = seedAtPos(P[bs - 1 - i], pts, pc);
    M.push({
      bracketType: 'winners', bracketRound: 1, matchNumber: i + 1,
      slot1Seed: s1, slot2Seed: s2, isBye: s1 === null || s2 === null,
      nextMatchIndex: -1, loserNextMatchIndex: -1,
    });
  }

  for (let r = 2; r <= k; r++) {
    const mc = bs >> r;
    for (let i = 0; i < mc; i++) {
      M.push({
        bracketType: 'winners', bracketRound: r, matchNumber: i + 1,
        slot1Seed: null, slot2Seed: null, isBye: false,
        nextMatchIndex: -1, loserNextMatchIndex: -1,
      });
    }
  }

  for (let r = 1; r <= lbRc; r++) {
    const c = lbMC(r);
    for (let i = 0; i < c; i++) {
      M.push({
        bracketType: 'losers', bracketRound: r, matchNumber: i + 1,
        slot1Seed: null, slot2Seed: null, isBye: false,
        nextMatchIndex: -1, loserNextMatchIndex: -1,
      });
    }
  }

  const gfI = M.length;
  M.push({ bracketType: 'grand_final', bracketRound: 1, matchNumber: 1,
    slot1Seed: null, slot2Seed: null, isBye: false, nextMatchIndex: null, loserNextMatchIndex: null });
  const rsI = M.length;
  M.push({ bracketType: 'reset_final', bracketRound: 1, matchNumber: 1,
    slot1Seed: null, slot2Seed: null, isBye: false, nextMatchIndex: null, loserNextMatchIndex: null });

  // WR winner feeds
  const w2s = wr1c;
  for (let i = 0; i < wr1c; i++) M[i].nextMatchIndex = w2s + Math.floor(i / 2);
  let wrS = wr1c;
  for (let r = 2; r < k; r++) {
    const mc = bs >> r;
    const nx = wrS + mc;
    for (let i = 0; i < mc; i++) M[wrS + i].nextMatchIndex = nx + Math.floor(i / 2);
    wrS = nx;
  }
  M[wrT - 1].nextMatchIndex = gfI;

  // WR loser feeds (double elim)
  const l1s = lbRS(1);
  for (let i = 0; i < wr1c; i++) M[i].loserNextMatchIndex = l1s + Math.floor(i / 2);
  wrS = wr1c;
  for (let r = 2; r < k; r++) {
    const mc = bs >> r;
    const lt = 2 * r - 2;
    if (lt >= 1 && lt <= lbRc) {
      const ls = lbRS(lt);
      for (let i = 0; i < mc; i++) M[wrS + i].loserNextMatchIndex = ls + i;
    }
    wrS += mc;
  }
  M[wrT - 1].loserNextMatchIndex = lbRS(lbRc);

  // LB winner feeds
  for (let r = 1; r <= lbRc; r++) {
    const rs = lbRS(r), c = lbMC(r);
    for (let i = 0; i < c; i++) {
      const idx = rs + i;
      if (r < lbRc) {
        const ns = lbRS(r + 1);
        M[idx].nextMatchIndex = r % 2 === 1 ? ns + i : ns + Math.floor(i / 2);
      } else {
        M[idx].nextMatchIndex = gfI;
      }
      M[idx].loserNextMatchIndex = null;
    }
  }

  return M;
}

// ─── Public API ──────────────────────────────────────────────────────

export interface BracketInput {
  participantCount: number;
  tournamentType: TournamentType;
  seedingType: SeedingType;
}

export function generateBracket(input: BracketInput): BracketDefinition {
  const bs = nextPow2(input.participantCount);
  const k = Math.log2(bs);
  const matches = input.tournamentType === 'single'
    ? generateSingleElimination(input.participantCount, bs)
    : generateDoubleElimination(input.participantCount, bs);
  return {
    bracketSize: bs,
    participantCount: input.participantCount,
    tournamentType: input.tournamentType,
    seedPositions: computeSeedPositions(k).slice(0, bs),
    matches,
  };
}

export function seededShuffle(count: number, seed: number): number[] {
  const arr = Array.from({ length: count }, (_, i) => i + 1);
  let s = seed | 0;
  const rng = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function countByes(pc: number, bs: number): number { return bs - pc; }

export function byeMatchIndices(pc: number, bs: number): number[] {
  const k = Math.log2(bs);
  const P = computeSeedPositions(k);
  const pts = buildPosToSeed(P, bs);
  const byes: number[] = [];
  for (let i = 0; i < bs / 2; i++) {
    if (seedAtPos(P[i], pts, pc) === null || seedAtPos(P[bs - 1 - i], pts, pc) === null) {
      byes.push(i);
    }
  }
  return byes;
}
