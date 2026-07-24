/**
 * Integration tests for Head-to-Head tournament bracket engine.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateBracket,
  seededShuffle,
  countByes,
} from '../src/lib/tournament/bracket-engine.ts';

test('integration: 8-player single elim — complete bracket trace', () => {
  const def = generateBracket({ participantCount: 8, tournamentType: 'single', seedingType: 'seeded' });
  assert.equal(def.bracketSize, 8);
  assert.equal(def.matches.length, 7);

  const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
  assert.equal(wr1.length, 4);

  for (let i = 0; i < wr1.length; i++) {
    assert.notEqual(wr1[i].nextMatchIndex, null);
    assert.equal(def.matches[wr1[i].nextMatchIndex].bracketRound, 2);
  }

  const wr2 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 2);
  assert.equal(wr2.length, 2);
  for (const m of wr2) {
    assert.notEqual(m.nextMatchIndex, null);
    assert.equal(def.matches[m.nextMatchIndex].bracketRound, 3);
  }

  const wbf = def.matches.find(m => m.bracketType === 'winners' && m.bracketRound === 3);
  assert.ok(wbf);
  assert.equal(wbf.nextMatchIndex, null);
  assert.equal(wbf.loserNextMatchIndex, null);
});

test('integration: double elim 8 — loser routing and structure', () => {
  const def = generateBracket({ participantCount: 8, tournamentType: 'double', seedingType: 'seeded' });

  const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
  for (const m of wr1) {
    assert.notEqual(m.loserNextMatchIndex, null, 'WR1 must route loser to LB');
    const lbMatch = def.matches[m.loserNextMatchIndex];
    assert.equal(lbMatch.bracketType, 'losers');
    assert.equal(lbMatch.bracketRound, 1);
  }

  const lbMatches = def.matches.filter(m => m.bracketType === 'losers');
  const lbf = lbMatches[lbMatches.length - 1];
  assert.notEqual(lbf.nextMatchIndex, null);
  assert.equal(def.matches[lbf.nextMatchIndex].bracketType, 'grand_final');
});

test('integration: byes with N=5 single elim', () => {
  const def = generateBracket({ participantCount: 5, tournamentType: 'single', seedingType: 'seeded' });
  assert.equal(def.bracketSize, 8);
  assert.equal(countByes(5, 8), 3);

  const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
  const byeIndices = wr1.map((m, i) => m.isBye ? i : -1).filter(i => i >= 0);
  assert.deepEqual(byeIndices, [0, 2, 3]);
});

test('integration: seeded 16 — seeds 1+2 in opposite WR3 groups', () => {
  const def = generateBracket({ participantCount: 16, tournamentType: 'single', seedingType: 'seeded' });
  const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);

  const groups = [
    [wr1[0], wr1[1]].flatMap(m => [m.slot1Seed, m.slot2Seed]),
    [wr1[2], wr1[3]].flatMap(m => [m.slot1Seed, m.slot2Seed]),
    [wr1[4], wr1[5]].flatMap(m => [m.slot1Seed, m.slot2Seed]),
    [wr1[6], wr1[7]].flatMap(m => [m.slot1Seed, m.slot2Seed]),
  ];

  const topWR3 = [...groups[0], ...groups[1]].filter(s => s !== null);
  const botWR3 = [...groups[2], ...groups[3]].filter(s => s !== null);

  const sumTop = topWR3.reduce((a, b) => a + b, 0);
  const sumBot = botWR3.reduce((a, b) => a + b, 0);
  assert.equal(sumTop, sumBot, 'WR3 seed sums must be equal');

  const topHas1 = topWR3.includes(1);
  const topHas2 = topWR3.includes(2);
  assert.ok((topHas1 && !topHas2) || (!topHas1 && topHas2),
    'Seeds 1 and 2 must be in different WR3 groups');
});

test('integration: double elim N=2..32 — valid pointers', () => {
  for (let n = 2; n <= 32; n++) {
    const def = generateBracket({ participantCount: n, tournamentType: 'double', seedingType: 'seeded' });
    const errors = [];

    for (let i = 0; i < def.matches.length; i++) {
      const m = def.matches[i];
      if (m.nextMatchIndex !== null && (m.nextMatchIndex < 0 || m.nextMatchIndex >= def.matches.length)) {
        errors.push(`M${i}: next out of range`);
      }
      if (m.loserNextMatchIndex !== null && (m.loserNextMatchIndex < 0 || m.loserNextMatchIndex >= def.matches.length)) {
        errors.push(`M${i}: loser out of range`);
      }
    }

    // Cycle detection
    for (let i = 0; i < def.matches.length; i++) {
      const visited = new Set();
      let idx = i;
      while (idx !== null && idx !== undefined && idx >= 0) {
        if (visited.has(idx)) { errors.push(`Cycle at M${i}`); break; }
        visited.add(idx);
        idx = def.matches[idx].nextMatchIndex;
      }
    }

    assert.equal(errors.length, 0, `N=${n}: ${errors.join(', ')}`);
  }
});

test('integration: unseeded shuffle deterministic', () => {
  const a = seededShuffle(16, 42);
  const b = seededShuffle(16, 42);
  assert.deepEqual(a, b);
  assert.equal(a.length, 16);
  assert.deepEqual([...a].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});

test('integration: single elim 2 — minimal', () => {
  const def = generateBracket({ participantCount: 2, tournamentType: 'single', seedingType: 'seeded' });
  assert.equal(def.matches.length, 1);
  assert.equal(def.matches[0].nextMatchIndex, null);
});

test('integration: double elim 2 — treated as single', () => {
  const def = generateBracket({ participantCount: 2, tournamentType: 'double', seedingType: 'seeded' });
  assert.equal(def.matches.length, 1);
  assert.equal(def.matches[0].bracketType, 'winners');
});

test('integration: all seeds present for powers of 2', () => {
  for (let k = 1; k <= 5; k++) {
    const n = 1 << k;
    const def = generateBracket({ participantCount: n, tournamentType: 'single', seedingType: 'seeded' });
    const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
    const allSeeds = wr1.flatMap(m => [m.slot1Seed, m.slot2Seed]).sort((a, b) => (a ?? 0) - (b ?? 0));
    assert.deepEqual(allSeeds, Array.from({ length: n }, (_, i) => i + 1),
      `N=${n}: all seeds present once`);
  }
});
