/**
 * Bracket Engine Tests — pure algorithmic validation, no DB required.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateBracket,
  seededShuffle,
  countByes,
  byeMatchIndices,
} from '../src/lib/tournament/bracket-engine.ts';

function countByType(matches, t) {
  return matches.filter(m => m.bracketType === t).length;
}

function validatePointers(matches) {
  const errors = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.nextMatchIndex !== null && (m.nextMatchIndex < 0 || m.nextMatchIndex >= matches.length)) {
      errors.push(`Match ${i} (${m.bracketType} R${m.bracketRound} M${m.matchNumber}): nextMatchIndex ${m.nextMatchIndex} out of range`);
    }
    if (m.loserNextMatchIndex !== null && (m.loserNextMatchIndex < 0 || m.loserNextMatchIndex >= matches.length)) {
      errors.push(`Match ${i} (${m.bracketType} R${m.bracketRound} M${m.matchNumber}): loserNextMatchIndex ${m.loserNextMatchIndex} out of range`);
    }
  }
  return errors;
}

function detectCycles(matches) {
  const errors = [];
  for (let i = 0; i < matches.length; i++) {
    const visited = new Set();
    let idx = i;
    while (idx !== null && idx !== undefined && idx >= 0) {
      if (visited.has(idx)) {
        errors.push(`Cycle at match ${i}`);
        break;
      }
      visited.add(idx);
      idx = matches[idx]?.nextMatchIndex;
    }
  }
  return errors;
}

// ─── Seed Position Tests ─────────────────────────────────────────────
// slot1Seed/slot2Seed show actual seed numbers (which seed is at each bracket position).

test('seeded 8: correct WR1 seed pairings', () => {
  const def = generateBracket({ participantCount: 8, tournamentType: 'single', seedingType: 'seeded' });
  assert.equal(def.bracketSize, 8);
  const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
  assert.equal(wr1.length, 4);
  // WR1 pairs consecutive elements in seed-positions array [1,8,4,5,2,7,3,6]
  // The seeds at those positions: 1,2,3,4,5,6,7,8
  assert.deepEqual(wr1.map(m => [m.slot1Seed, m.slot2Seed]), [
    [1, 8],
    [2, 7],
    [3, 6],
    [4, 5],
  ]);
});

test('seeded 4: correct WR1 seed pairings', () => {
  const def = generateBracket({ participantCount: 4, tournamentType: 'single', seedingType: 'seeded' });
  const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
  // positions [1,4,2,3] → seeds at those positions: 1,3,2,4
  // Pairs: (1,3), (2,4)
  assert.deepEqual(wr1.map(m => [m.slot1Seed, m.slot2Seed]), [
    [1, 4],  // P[0]=1 vs P[3]=3 → seeds 1,4
    [2, 3],  // P[1]=4 vs P[2]=2 → seeds 2,3
  ]);
});

test('seeded 16: correct WR1 seed pairings', () => {
  const def = generateBracket({ participantCount: 16, tournamentType: 'single', seedingType: 'seeded' });
  const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
  assert.equal(wr1.length, 8);
  // positions: [1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11]
  // seeds at positions: 1,2,8,9,3,4,5,12,13,14,6,7,10,11,15,16
  // Wait, correct mapping: pts[1]=1, pts[16]=2, pts[8]=8, pts[9]=9, pts[4]=3, pts[13]=4,
  // pts[5]=5, pts[12]=12, pts[2]=13, pts[15]=14, pts[7]=6, pts[10]=7, pts[3]=10, pts[14]=11, pts[6]=15, pts[11]=16
  assert.deepEqual(wr1.map(m => [m.slot1Seed, m.slot2Seed]), [
    [1, 16],  // P[0]=1 vs P[15]=11 → seeds 1,16
    [2, 15],  // P[1]=16 vs P[14]=6 → seeds 2,15
    [3, 14],  // P[2]=8 vs P[13]=14 → seeds 3,14
    [4, 13],  // P[3]=9 vs P[12]=3 → seeds 4,13
    [5, 12],  // P[4]=4 vs P[11]=10 → seeds 5,12
    [6, 11],  // P[5]=13 vs P[10]=7 → seeds 6,11
    [7, 10],  // P[6]=5 vs P[9]=15 → seeds 7,10
    [8, 9],   // P[7]=12 vs P[8]=2 → seeds 8,9
  ]);
});

// ─── Single Elimination Topology ─────────────────────────────────────

test('single elim 2: one match, final is terminal', () => {
  const def = generateBracket({ participantCount: 2, tournamentType: 'single', seedingType: 'seeded' });
  assert.equal(def.matches.length, 1);
  assert.equal(def.matches[0].nextMatchIndex, null);
  assert.equal(def.matches[0].isBye, false);
});

test('single elim 8: correct match count and structure', () => {
  const def = generateBracket({ participantCount: 8, tournamentType: 'single', seedingType: 'seeded' });
  assert.equal(def.matches.length, 7); // 4+2+1
  assert.equal(countByType(def.matches, 'winners'), 7);
  const byRound = [1, 2, 3].map(r =>
    def.matches.filter(m => m.bracketRound === r).length
  );
  assert.deepEqual(byRound, [4, 2, 1]);
});

test('single elim: valid pointers and acyclic for N=2..32', () => {
  for (let n = 2; n <= 32; n++) {
    const def = generateBracket({ participantCount: n, tournamentType: 'single', seedingType: 'seeded' });
    const ptrErr = validatePointers(def.matches);
    assert.equal(ptrErr.length, 0, `N=${n}: ${ptrErr.join(', ')}`);
    assert.equal(detectCycles(def.matches).length, 0, `N=${n}: cycles`);
    for (let i = 0; i < def.matches.length; i++) {
      const m = def.matches[i];
      if (m.nextMatchIndex !== null) {
        assert.ok(m.nextMatchIndex > i, `N=${n}: next ${m.nextMatchIndex} <= ${i}`);
      }
    }
  }
});

test('single elim: final match is terminal for all N', () => {
  for (let n = 2; n <= 32; n++) {
    const def = generateBracket({ participantCount: n, tournamentType: 'single', seedingType: 'seeded' });
    const last = def.matches[def.matches.length - 1];
    assert.equal(last.nextMatchIndex, null, `N=${n}`);
    assert.equal(last.loserNextMatchIndex, null, `N=${n}`);
  }
});

// ─── Bye Tests ───────────────────────────────────────────────────────

test('byes: N=5 in 8 — correct bye assignment', () => {
  const def = generateBracket({ participantCount: 5, tournamentType: 'single', seedingType: 'seeded' });
  assert.equal(def.bracketSize, 8);
  assert.equal(countByes(5, 8), 3);
  const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
  // positions [1,8,4,5,2,7,3,6] → seeds 1,2,3,4,5,6,7,8
  // N=5: seeds 6,7,8 are byes. Seeds at positions: pts[1]=1, pts[8]=2, pts[4]=3, pts[5]=4, pts[2]=5, pts[7]=6, pts[3]=7, pts[6]=8
  // Match pairs: (1,2): both ≤5 → no bye
  //             (3,4): both ≤5 → no bye
  //             (5,6): seed6 >5 → bye
  //             (7,8): both >5 → bye
  assert.deepEqual(wr1.map(m => m.isBye), [true, true, true, false]);
  assert.equal(wr1[3].slot1Seed, 4);
  assert.equal(wr1[3].slot2Seed, 5);
});

test('byes: N=3 in 4 — correct bye assignment', () => {
  const def = generateBracket({ participantCount: 3, tournamentType: 'single', seedingType: 'seeded' });
  assert.equal(def.bracketSize, 4);
  const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
  // positions [1,4,2,3], seeds at pos: 1,3,2,4
  // N=3: seed4 is bye
  // (1,3): both ≤3 → no bye
  // (2,4): seed4 >3 → bye
  assert.deepEqual(wr1.map(m => m.isBye), [true, false]);
  assert.equal(wr1[0].slot1Seed, 1);
  assert.equal(wr1[0].slot2Seed, null);
  assert.equal(wr1[1].slot1Seed, 2);
  assert.equal(wr1[1].slot2Seed, 3);
});

test('byes: N=2 — exact fit, no byes', () => {
  const def = generateBracket({ participantCount: 2, tournamentType: 'single', seedingType: 'seeded' });
  assert.equal(def.bracketSize, 2);
  assert.equal(def.matches[0].isBye, false);
  assert.equal(def.matches[0].slot1Seed, 1);
  assert.equal(def.matches[0].slot2Seed, 2);
});

// ─── Double Elimination Topology ────────────────────────────────────

test('double elim 2: same as single (k=1)', () => {
  const def = generateBracket({ participantCount: 2, tournamentType: 'double', seedingType: 'seeded' });
  assert.equal(def.matches.length, 1);
  assert.equal(def.matches[0].bracketType, 'winners');
  assert.equal(def.matches[0].nextMatchIndex, null);
});

test('double elim 4: correct counts', () => {
  const def = generateBracket({ participantCount: 4, tournamentType: 'double', seedingType: 'seeded' });
  assert.equal(countByType(def.matches, 'winners'), 3);
  assert.equal(countByType(def.matches, 'losers'), 2);
  assert.equal(countByType(def.matches, 'grand_final'), 1);
  assert.equal(countByType(def.matches, 'reset_final'), 1);
});

test('double elim 8: correct counts', () => {
  const def = generateBracket({ participantCount: 8, tournamentType: 'double', seedingType: 'seeded' });
  assert.equal(countByType(def.matches, 'winners'), 7);
  assert.equal(countByType(def.matches, 'losers'), 6);
  const lbRounds = [1, 2, 3, 4].map(r =>
    def.matches.filter(m => m.bracketType === 'losers' && m.bracketRound === r).length
  );
  assert.deepEqual(lbRounds, [2, 2, 1, 1]);
});

test('double elim 16: correct counts', () => {
  const def = generateBracket({ participantCount: 16, tournamentType: 'double', seedingType: 'seeded' });
  assert.equal(countByType(def.matches, 'winners'), 15);
  assert.equal(countByType(def.matches, 'losers'), 14);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(r =>
    def.matches.filter(m => m.bracketType === 'losers' && m.bracketRound === r).length
  ), [4, 4, 2, 2, 1, 1]);
});

test('double elim 32: correct counts', () => {
  const def = generateBracket({ participantCount: 32, tournamentType: 'double', seedingType: 'seeded' });
  assert.equal(countByType(def.matches, 'winners'), 31);
  assert.equal(countByType(def.matches, 'losers'), 30);
});

test('double elim: valid topology for all N=2..32', () => {
  for (let n = 2; n <= 32; n++) {
    const def = generateBracket({ participantCount: n, tournamentType: 'double', seedingType: 'seeded' });
    assert.equal(validatePointers(def.matches).length, 0, `N=${n} ptr`);
    assert.equal(detectCycles(def.matches).length, 0, `N=${n} cycles`);

    if (def.bracketSize >= 4) {
      assert.equal(countByType(def.matches, 'winners'), def.bracketSize - 1);
      assert.equal(countByType(def.matches, 'losers'), def.bracketSize - 2);
      assert.equal(def.matches.length, def.bracketSize * 2 - 1);
    }
    if (def.bracketSize === 2) {
      assert.equal(def.matches.length, 1);
    }
  }
});

// ─── Loser Routing ──────────────────────────────────────────────────

test('double elim: WR1 losers route to LB R1', () => {
  const def = generateBracket({ participantCount: 8, tournamentType: 'double', seedingType: 'seeded' });
  const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
  assert.equal(wr1[0].loserNextMatchIndex, wr1[1].loserNextMatchIndex);
  assert.equal(def.matches[wr1[0].loserNextMatchIndex].bracketRound, 1);
  assert.equal(wr1[2].loserNextMatchIndex, wr1[3].loserNextMatchIndex);
  assert.equal(def.matches[wr1[2].loserNextMatchIndex].bracketRound, 1);
});

test('double elim: WR2 losers route to LB R2', () => {
  const def = generateBracket({ participantCount: 8, tournamentType: 'double', seedingType: 'seeded' });
  const wr2 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 2);
  for (const m of wr2) {
    assert.notEqual(m.loserNextMatchIndex, null);
    assert.equal(def.matches[m.loserNextMatchIndex].bracketType, 'losers');
    assert.equal(def.matches[m.loserNextMatchIndex].bracketRound, 2);
  }
});

test('double elim: WBF loser → LBF', () => {
  const def = generateBracket({ participantCount: 8, tournamentType: 'double', seedingType: 'seeded' });
  const wbf = def.matches.filter(m => m.bracketType === 'winners').at(-1);
  assert.notEqual(wbf.loserNextMatchIndex, null);
  assert.equal(def.matches[wbf.loserNextMatchIndex].bracketType, 'losers');
  assert.equal(def.matches[wbf.loserNextMatchIndex].bracketRound, 4);
});

test('double elim: LBF winner goes to Grand Final', () => {
  const def = generateBracket({ participantCount: 8, tournamentType: 'double', seedingType: 'seeded' });
  const lbf = def.matches.filter(m => m.bracketType === 'losers').at(-1);
  const gf = def.matches.find(m => m.bracketType === 'grand_final');
  assert.equal(lbf.nextMatchIndex, def.matches.indexOf(gf));
});

// ─── Unseeded Shuffle ───────────────────────────────────────────────

test('unseeded: same seed → same order', () => {
  assert.deepEqual(seededShuffle(8, 42), seededShuffle(8, 42));
});

test('unseeded: different seeds → different orders', () => {
  assert.notDeepEqual(seededShuffle(8, 42), seededShuffle(8, 99));
});

test('unseeded: preserves all elements', () => {
  for (let n = 2; n <= 32; n++) {
    const s = seededShuffle(n, 42);
    assert.deepEqual([...s].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1));
  }
});

// ─── Bye Index Detection ────────────────────────────────────────────

test('byeMatchIndices: N=5 in 8', () => {
  const bi = byeMatchIndices(5, 8);
  assert.deepEqual(bi, [0, 1, 2]);
});

test('byeMatchIndices: N=8 in 8 yields 0 byes', () => {
  assert.deepEqual(byeMatchIndices(8, 8), []);
});

test('byeMatchIndices: N=3 in 4 yields 1 bye at match 0', () => {
  assert.deepEqual(byeMatchIndices(3, 4), [0]);
});
