import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSimTournament,
  playableMatches,
  completeMatch,
  playToCompletion,
  assertBracketIntegrity,
} from './helpers/advancement.mjs';
import { generateBracket } from '../src/lib/tournament/bracket-engine.ts';
import { deriveCompetitionStatus } from '../src/lib/competition-status.ts';

describe('advancement: bye propagation', () => {
  it('fills next-round slots from bye winners for N=5 single elim', () => {
    const t = buildSimTournament(5, 'single');
    const byes = t.matches.filter(m => m.isBye);
    assert.ok(byes.length >= 1);
    for (const b of byes) {
      assert.equal(b.status, 'completed');
      assert.ok(b.winnerId);
      if (b.nextMatchIndex != null && b.nextMatchSlot != null) {
        const dest = t.matches[b.nextMatchIndex];
        const placed =
          (b.nextMatchSlot === 1 && dest.competitor1Id === b.winnerId) ||
          (b.nextMatchSlot === 2 && dest.competitor2Id === b.winnerId);
        assert.ok(placed, `bye ${b.index} winner not placed in slot ${b.nextMatchSlot}`);
      }
    }
    assert.ok(playableMatches(t).length >= 1);
  });

  it('never deadlocks for single elim N=2..32', () => {
    for (let n = 2; n <= 32; n++) {
      const t = buildSimTournament(n, 'single');
      playToCompletion(t, m => m.competitor1Id);
      assert.equal(t.status, 'completed');
      assert.ok(t.championId);
      assertBracketIntegrity(t);
    }
  });

  it('never deadlocks for double elim N=2..32 with higher seed always winning', () => {
    for (let n = 2; n <= 32; n++) {
      const t = buildSimTournament(n, 'double');
      playToCompletion(t, m => {
        const a = m.competitor1Id;
        const b = m.competitor2Id;
        return a < b ? a : b;
      });
      assert.equal(t.status, 'completed');
      assert.ok(t.championId);
      assertBracketIntegrity(t);
    }
  });
});

describe('advancement: single elimination champion', () => {
  it('completes when winners final has no next match', () => {
    const t = buildSimTournament(4, 'single');
    playToCompletion(t, m => m.competitor1Id);
    assert.equal(t.status, 'completed');
    assert.equal(t.championId, 'P1');
    const final = t.matches.find(m => m.nextMatchIndex == null && m.bracketType === 'winners');
    assert.ok(final);
    assert.equal(final.winnerId, 'P1');
  });
});

describe('advancement: double elimination reset', () => {
  it('ends without reset when WB champion wins grand final', () => {
    const t = buildSimTournament(4, 'double');
    playToCompletion(t, m => {
      if (m.competitor1Id === 'P1' || m.competitor2Id === 'P1') return 'P1';
      return m.competitor1Id;
    });
    assert.equal(t.status, 'completed');
    assert.equal(t.championId, 'P1');
    const reset = t.matches.find(m => m.bracketType === 'reset_final');
    assert.ok(reset);
    assert.notEqual(reset.status, 'completed');
  });

  it('activates reset final when LB champion beats undefeated WB champ', () => {
    const t = buildSimTournament(4, 'double');
    let guard = 0;
    while (t.status !== 'completed' && guard++ < 100) {
      const playable = playableMatches(t);
      assert.ok(playable.length > 0, 'deadlock before GF');
      playable.sort((a, b) => a.index - b.index);
      const m = playable[0];
      if (m.bracketType === 'grand_final') {
        completeMatch(t, m.index, m.competitor2Id);
        break;
      }
      completeMatch(t, m.index, m.competitor1Id);
    }
    const reset = t.matches.find(m => m.bracketType === 'reset_final');
    assert.ok(reset);
    assert.ok(reset.competitor1Id && reset.competitor2Id);
    assert.equal(t.status, 'active');
    completeMatch(t, reset.index, reset.competitor1Id);
    assert.equal(t.status, 'completed');
    assert.equal(t.championId, reset.competitor1Id);
  });

  it('requires two losses for elimination in double elim', () => {
    const t = buildSimTournament(8, 'double');
    playToCompletion(t, m => m.competitor1Id);
    for (const [id, losses] of t.losses) {
      if (id === t.championId) continue;
      assert.ok(losses >= 2, `${id} eliminated with ${losses} losses`);
    }
  });
});

describe('advancement: loser slot capacity', () => {
  it('routes both WR1 losers into distinct LB slots', () => {
    const def = generateBracket({ participantCount: 4, tournamentType: 'double', seedingType: 'seeded' });
    const wr1 = def.matches.filter(m => m.bracketType === 'winners' && m.bracketRound === 1);
    assert.equal(wr1.length, 2);
    assert.equal(wr1[0].loserNextMatchIndex, wr1[1].loserNextMatchIndex);
    assert.notEqual(wr1[0].loserNextMatchSlot, wr1[1].loserNextMatchSlot);

    const t = buildSimTournament(4, 'double');
    for (const m of playableMatches(t).filter(x => x.bracketRound === 1 && x.bracketType === 'winners')) {
      completeMatch(t, m.index, m.competitor1Id);
    }
    const lb = t.matches.find(m => m.bracketType === 'losers' && m.bracketRound === 1);
    assert.ok(lb);
    assert.ok(lb.competitor1Id);
    assert.ok(lb.competitor2Id);
    assert.notEqual(lb.competitor1Id, lb.competitor2Id);
  });
});

describe('advancement: no duplicate competitor', () => {
  it('never places the same competitor twice in a match across many paths', () => {
    for (let n = 2; n <= 16; n++) {
      for (const type of ['single', 'double']) {
        const t = buildSimTournament(n, type);
        playToCompletion(t, m => ((m.index + m.bracketRound) % 2 === 0 ? m.competitor1Id : m.competitor2Id));
        assertBracketIntegrity(t);
      }
    }
  });
});

describe('competition status', () => {
  it('marks between-rounds as ongoing', () => {
    assert.equal(
      deriveCompetitionStatus([{ status: 'completed' }, { status: 'pending' }]),
      'ongoing',
    );
  });

  it('marks H2H active tournament as ongoing', () => {
    assert.equal(
      deriveCompetitionStatus([], {
        competitionType: 'head_to_head',
        tournamentStatuses: ['active'],
      }),
      'ongoing',
    );
  });

  it('marks H2H completed tournament as completed', () => {
    assert.equal(
      deriveCompetitionStatus([], {
        competitionType: 'head_to_head',
        tournamentStatuses: ['completed'],
      }),
      'completed',
    );
  });
});

describe('bracket engine slots', () => {
  it('emits nextMatchSlot for every non-terminal feed', () => {
    for (let n = 2; n <= 32; n++) {
      for (const type of ['single', 'double']) {
        const def = generateBracket({ participantCount: n, tournamentType: type, seedingType: 'seeded' });
        for (const m of def.matches) {
          if (m.nextMatchIndex != null) {
            if (m.bracketType === 'grand_final') continue;
            assert.ok(m.nextMatchSlot === 1 || m.nextMatchSlot === 2, `missing next slot at ${m.bracketIndex}`);
          }
          if (m.loserNextMatchIndex != null) {
            assert.ok(m.loserNextMatchSlot === 1 || m.loserNextMatchSlot === 2);
          }
        }
      }
    }
  });
});
