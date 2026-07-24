/**
 * Bracket Engine — Pure algorithm for generating single/double elimination brackets.
 * Uses standard tournament seeding where seeds are placed in balanced halves.
 *
 * Destination slots (1|2) are explicit so winner/loser routing never depends on
 * arrival order (critical for losers-bracket and rematch-safe advancement).
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
  /** 1 or 2 — which competitor slot in next_match receives the winner */
  nextMatchSlot: 1 | 2 | null;
  loserNextMatchIndex: number | null;
  /** 1 or 2 — which competitor slot receives the loser (double elim) */
  loserNextMatchSlot: 1 | 2 | null;
  bracketIndex: number;
}

export interface BracketDefinition {
  bracketSize: number;
  participantCount: number;
  tournamentType: TournamentType;
  seedPositions: number[];
  matches: BracketMatchDef[];
}

// ─── Seed Placement ──────────────────────────────────────────────────

/** Binary-reflected Gray code for standard seed placement. */
function seedPositions(k: number): number[] {
  if (k <= 0) return [1];
  const size = 1 << k;
  const prev = seedPositions(k - 1);
  const out: number[] = [];
  for (const p of prev) { out.push(p); out.push(size - p + 1); }
  return out;
}

function nextPow2(n: number): number {
  if (n <= 1) return 2;
  let p = 2;
  while (p < n) p <<= 1;
  return p;
}

function buildPosToSeed(P: number[], bs: number): (number | null)[] {
  const map: (number | null)[] = new Array(bs + 1).fill(null);
  for (let s = 1; s <= P.length; s++) {
    const p = P[s - 1];
    if (p >= 1 && p <= bs) map[p] = s;
  }
  return map;
}

function seedAt(p: number, pts: (number | null)[], pc: number): number | null {
  const s = pts[p];
  return s !== null && s <= pc ? s : null;
}

/**
 * Generate the WR1 match pairs in correct display order using quarter-to-quarter cross formula.
 * Returns array of [slot1Seed, slot2Seed] pairs.
 */
function generateWR1Pairs(pc: number, bs: number): Array<[number | null, number | null]> {
  const k = Math.log2(bs);
  if (k < 2) {
    if (k === 0) return [];
    const P = seedPositions(1);
    const pts = buildPosToSeed(P, bs);
    return [[seedAt(P[0], pts, pc), seedAt(P[1], pts, pc)]];
  }
  const P = seedPositions(k);
  const pts = buildPosToSeed(P, bs);
  const qs = bs / 4;
  const pairs: Array<[number | null, number | null]> = [];

  const Q1 = P.slice(0, qs);
  const Q2 = P.slice(qs, 2 * qs);
  const Q3 = P.slice(2 * qs, 3 * qs);
  const Q4 = P.slice(3 * qs);

  const iOrder: number[] = [];
  for (let a = 0, b = qs - 1; a <= b; a++, b--) {
    iOrder.push(a);
    if (a !== b) iOrder.push(b);
  }
  for (const i of iOrder) {
    const s1 = seedAt(Q1[i], pts, pc);
    const s2 = seedAt(Q4[qs - 1 - i], pts, pc);
    pairs.push([s1, s2]);

    const s3 = seedAt(Q2[qs - 1 - i], pts, pc);
    const s4 = seedAt(Q3[i], pts, pc);
    pairs.push([s3, s4]);
  }

  return pairs;
}

function pairSlot(i: number): 1 | 2 {
  return i % 2 === 0 ? 1 : 2;
}

// ─── Single Elimination ──────────────────────────────────────────────

function generateSingleElim(pc: number, bs: number): BracketMatchDef[] {
  const k = Math.log2(bs);
  if (k === 0) return [];
  const matches: BracketMatchDef[] = [];
  const wr1Pairs = generateWR1Pairs(pc, bs);
  const wr1c = bs / 2;
  let idx = 0;

  for (const [s1, s2] of wr1Pairs) {
    matches.push({
      bracketType: 'winners', bracketRound: 1, matchNumber: idx + 1,
      slot1Seed: s1, slot2Seed: s2, isBye: s1 === null || s2 === null,
      nextMatchIndex: k > 1 ? wr1c + Math.floor(idx / 2) : null,
      nextMatchSlot: k > 1 ? pairSlot(idx) : null,
      loserNextMatchIndex: null, loserNextMatchSlot: null, bracketIndex: idx,
    });
    idx++;
  }

  for (let r = 2; r <= k; r++) {
    const mc = bs >> r;
    const rs = matches.length;
    for (let i = 0; i < mc; i++) {
      matches.push({
        bracketType: 'winners', bracketRound: r, matchNumber: i + 1,
        slot1Seed: null, slot2Seed: null, isBye: false,
        nextMatchIndex: r === k ? null : rs + mc + Math.floor(i / 2),
        nextMatchSlot: r === k ? null : pairSlot(i),
        loserNextMatchIndex: null, loserNextMatchSlot: null, bracketIndex: idx++,
      });
    }
  }

  return matches;
}

// ─── Double Elimination ──────────────────────────────────────────────

function generateDoubleElim(pc: number, bs: number): BracketMatchDef[] {
  const k = Math.log2(bs);
  if (k <= 1) return generateSingleElim(pc, bs);

  const M: BracketMatchDef[] = [];
  const wr1c = bs / 2;
  const wrT = bs - 1;
  const lbRc = 2 * k - 2;
  let idx = 0;

  function lbMC(r: number): number {
    if (r < 1 || r > lbRc) return 0;
    return 1 << (k - Math.ceil(r / 2) - 1);
  }
  function lbRS(r: number): number {
    let i = wrT;
    for (let r2 = 1; r2 < r; r2++) i += lbMC(r2);
    return i;
  }

  const wr1Pairs = generateWR1Pairs(pc, bs);
  for (const [s1, s2] of wr1Pairs) {
    M.push({
      bracketType: 'winners', bracketRound: 1, matchNumber: M.length + 1,
      slot1Seed: s1, slot2Seed: s2, isBye: s1 === null || s2 === null,
      nextMatchIndex: -1, nextMatchSlot: null,
      loserNextMatchIndex: -1, loserNextMatchSlot: null, bracketIndex: idx++,
    });
  }

  for (let r = 2; r <= k; r++) {
    const mc = bs >> r;
    for (let i = 0; i < mc; i++) {
      M.push({
        bracketType: 'winners', bracketRound: r, matchNumber: i + 1,
        slot1Seed: null, slot2Seed: null, isBye: false,
        nextMatchIndex: -1, nextMatchSlot: null,
        loserNextMatchIndex: -1, loserNextMatchSlot: null, bracketIndex: idx++,
      });
    }
  }

  for (let r = 1; r <= lbRc; r++) {
    const c = lbMC(r);
    for (let i = 0; i < c; i++) {
      M.push({
        bracketType: 'losers', bracketRound: r, matchNumber: i + 1,
        slot1Seed: null, slot2Seed: null, isBye: false,
        nextMatchIndex: -1, nextMatchSlot: null,
        loserNextMatchIndex: -1, loserNextMatchSlot: null, bracketIndex: idx++,
      });
    }
  }

  const gfI = M.length;
  M.push({
    bracketType: 'grand_final', bracketRound: 1, matchNumber: 1,
    slot1Seed: null, slot2Seed: null, isBye: false,
    // Points at reset_final so LB champion can force a bracket reset
    nextMatchIndex: gfI + 1, nextMatchSlot: null,
    loserNextMatchIndex: null, loserNextMatchSlot: null, bracketIndex: idx++,
  });
  M.push({
    bracketType: 'reset_final', bracketRound: 1, matchNumber: 1,
    slot1Seed: null, slot2Seed: null, isBye: false,
    nextMatchIndex: null, nextMatchSlot: null,
    loserNextMatchIndex: null, loserNextMatchSlot: null, bracketIndex: idx++,
  });

  // WR winner feeds
  const w2s = wr1c;
  for (let i = 0; i < wr1c; i++) {
    M[i].nextMatchIndex = w2s + Math.floor(i / 2);
    M[i].nextMatchSlot = pairSlot(i);
  }
  let wrS = wr1c;
  for (let r = 2; r < k; r++) {
    const mc = bs >> r;
    const nx = wrS + mc;
    for (let i = 0; i < mc; i++) {
      M[wrS + i].nextMatchIndex = nx + Math.floor(i / 2);
      M[wrS + i].nextMatchSlot = pairSlot(i);
    }
    wrS = nx;
  }
  // Winners final → grand final slot 1 (WB champion)
  M[wrT - 1].nextMatchIndex = gfI;
  M[wrT - 1].nextMatchSlot = 1;

  // WR loser feeds
  const l1s = lbRS(1);
  for (let i = 0; i < wr1c; i++) {
    if (M[i].isBye) {
      // Bye matches have no loser to drop into the losers bracket
      M[i].loserNextMatchIndex = null;
      M[i].loserNextMatchSlot = null;
    } else {
      M[i].loserNextMatchIndex = l1s + Math.floor(i / 2);
      M[i].loserNextMatchSlot = pairSlot(i);
    }
  }
  wrS = wr1c;
  for (let r = 2; r < k; r++) {
    const mc = bs >> r;
    const lt = 2 * r - 2;
    if (lt >= 1 && lt <= lbRc) {
      const ls = lbRS(lt);
      for (let i = 0; i < mc; i++) {
        // WB drop-ins occupy slot 1; LB survivors occupy slot 2
        M[wrS + i].loserNextMatchIndex = ls + i;
        M[wrS + i].loserNextMatchSlot = 1;
      }
    }
    wrS += mc;
  }
  M[wrT - 1].loserNextMatchIndex = lbRS(lbRc);
  M[wrT - 1].loserNextMatchSlot = 1;

  // LB winner feeds
  for (let r = 1; r <= lbRc; r++) {
    const rs = lbRS(r), c = lbMC(r);
    for (let i = 0; i < c; i++) {
      const mi = rs + i;
      if (r < lbRc) {
        const ns = lbRS(r + 1);
        if (r % 2 === 1) {
          // Odd LB → even LB: 1:1 into slot 2 (WB drop uses slot 1)
          M[mi].nextMatchIndex = ns + i;
          M[mi].nextMatchSlot = 2;
        } else {
          M[mi].nextMatchIndex = ns + Math.floor(i / 2);
          M[mi].nextMatchSlot = pairSlot(i);
        }
      } else {
        // Losers final → grand final slot 2
        M[mi].nextMatchIndex = gfI;
        M[mi].nextMatchSlot = 2;
      }
      M[mi].loserNextMatchIndex = null;
      M[mi].loserNextMatchSlot = null;
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
  const gen = input.tournamentType === 'single' ? generateSingleElim : generateDoubleElim;
  const matches = gen(input.participantCount, bs);
  return {
    bracketSize: bs, participantCount: input.participantCount,
    tournamentType: input.tournamentType,
    seedPositions: seedPositions(k).slice(0, bs), matches,
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
  if (k < 2) return bs > pc ? [0] : [];
  const P = seedPositions(k);
  const pts = buildPosToSeed(P, bs);
  const qs = bs / 4;
  const byes: number[] = [];
  let mi = 0;
  for (let i = 0; i < qs; i++) {
    if (seedAt(P[i], pts, pc) === null || seedAt(P[bs - 1 - i], pts, pc) === null) byes.push(mi);
    mi++;
    if (seedAt(P[bs / 2 - 1 - i], pts, pc) === null || seedAt(P[bs / 2 + i], pts, pc) === null) byes.push(mi);
    mi++;
  }
  return byes;
}
