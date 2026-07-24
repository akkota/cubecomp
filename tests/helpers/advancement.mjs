/**
 * Pure in-memory tournament advancement simulator for tests.
 * Mirrors SQL routing rules (migration 019).
 */

import { generateBracket } from '../../src/lib/tournament/bracket-engine.ts';

export function placeInSlot(match, slot, competitorId) {
  if (slot === 1) {
    if (match.competitor1Id != null && match.competitor1Id !== competitorId) {
      throw new Error(`Slot 1 already occupied in match ${match.index}`);
    }
    match.competitor1Id = competitorId;
  } else {
    if (match.competitor2Id != null && match.competitor2Id !== competitorId) {
      throw new Error(`Slot 2 already occupied in match ${match.index}`);
    }
    match.competitor2Id = competitorId;
  }
}

export function propagateByes(matches) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < matches.length * 3) {
    changed = false;

    // 1) Advance completed bye winners into next slots
    for (const m of matches) {
      if (!m.isBye || m.status !== 'completed' || !m.winnerId) continue;
      if (m.nextMatchIndex == null || m.nextMatchSlot == null) continue;
      const dest = matches[m.nextMatchIndex];
      if (!dest) continue;
      const before = dest.competitor1Id + '|' + dest.competitor2Id;
      placeInSlot(dest, m.nextMatchSlot, m.winnerId);
      const after = dest.competitor1Id + '|' + dest.competitor2Id;
      if (before !== after) changed = true;
    }

    // 2) Void matches that can never receive anyone
    for (const m of matches) {
      if (m.status !== 'pending' || m.competitor1Id || m.competitor2Id) continue;
      const openFeeders = matches.filter(src =>
        src.status !== 'completed' && src.status !== 'void' &&
        (src.nextMatchIndex === m.index || src.loserNextMatchIndex === m.index),
      );
      if (openFeeders.length === 0) {
        m.status = 'void';
        changed = true;
      }
    }

    // 3) Auto-complete matches that have exactly one competitor and no remaining feeder
    for (const m of matches) {
      if (m.status !== 'pending' || m.isBye) continue;
      const has1 = m.competitor1Id != null;
      const has2 = m.competitor2Id != null;
      if (has1 === has2) continue;

      const emptySlot = has1 ? 2 : 1;
      const feeders = matches.filter(src =>
        (src.nextMatchIndex === m.index && src.nextMatchSlot === emptySlot) ||
        (src.loserNextMatchIndex === m.index && src.loserNextMatchSlot === emptySlot),
      );
      const openFeeders = feeders.filter(src => {
        if (src.status === 'void') return false;
        if (src.status !== 'completed') return true;
        // Completed feeder still "open" until its winner occupies the destination slot
        if (!src.winnerId) return false;
        const destSlot =
          src.nextMatchIndex === m.index ? src.nextMatchSlot :
          src.loserNextMatchIndex === m.index ? src.loserNextMatchSlot : null;
        if (destSlot === 1) return m.competitor1Id !== src.winnerId;
        if (destSlot === 2) return m.competitor2Id !== src.winnerId;
        return false;
      });
      if (openFeeders.length > 0) continue;

      const winner = m.competitor1Id ?? m.competitor2Id;
      m.isBye = true;
      m.winnerId = winner;
      m.status = 'completed';
      changed = true;
    }
  }
}

export function buildSimTournament(participantCount, tournamentType, participantIds) {
  const ids = participantIds ?? Array.from({ length: participantCount }, (_, i) => `P${i + 1}`);
  const def = generateBracket({
    participantCount,
    tournamentType,
    seedingType: 'seeded',
  });
  const seedToId = new Map(ids.map((id, i) => [i + 1, id]));
  const matches = def.matches.map((m) => {
    const c1 = m.slot1Seed != null ? seedToId.get(m.slot1Seed) ?? null : null;
    const c2 = m.slot2Seed != null ? seedToId.get(m.slot2Seed) ?? null : null;
    const isBye = m.isBye;
    let winnerId = null;
    let status = 'pending';
    if (isBye) {
      winnerId = c1 ?? c2;
      status = 'completed';
    }
    return {
      index: m.bracketIndex,
      bracketType: m.bracketType,
      bracketRound: m.bracketRound,
      matchNumber: m.matchNumber,
      competitor1Id: c1,
      competitor2Id: c2,
      winnerId,
      status,
      isBye,
      nextMatchIndex: m.nextMatchIndex,
      nextMatchSlot: m.nextMatchSlot,
      loserNextMatchIndex: m.loserNextMatchIndex,
      loserNextMatchSlot: m.loserNextMatchSlot,
    };
  });
  propagateByes(matches);
  return {
    type: tournamentType,
    status: 'ready',
    championId: null,
    matches,
    losses: new Map(ids.map(id => [id, 0])),
  };
}

export function playableMatches(t) {
  return t.matches.filter(
    m =>
      !m.isBye &&
      m.status === 'pending' &&
      m.competitor1Id != null &&
      m.competitor2Id != null &&
      m.competitor1Id !== m.competitor2Id,
  );
}

export function completeMatch(t, matchIndex, winnerId) {
  const match = t.matches[matchIndex];
  if (!match) throw new Error(`Unknown match ${matchIndex}`);
  if (match.status === 'completed') throw new Error(`Match ${matchIndex} already completed`);
  if (match.competitor1Id == null || match.competitor2Id == null) {
    throw new Error(`Match ${matchIndex} missing competitors`);
  }
  if (winnerId !== match.competitor1Id && winnerId !== match.competitor2Id) {
    throw new Error('Winner must be a competitor in the match');
  }

  const loserId = winnerId === match.competitor1Id ? match.competitor2Id : match.competitor1Id;
  match.winnerId = winnerId;
  match.status = 'completed';
  t.losses.set(loserId, (t.losses.get(loserId) ?? 0) + 1);
  if (t.status === 'ready') t.status = 'active';

  if (match.bracketType === 'grand_final') {
    if (winnerId === match.competitor1Id) {
      t.status = 'completed';
      t.championId = winnerId;
      return;
    }
    const reset = t.matches.find(m => m.bracketType === 'reset_final');
    if (!reset) throw new Error('Missing reset_final match');
    reset.competitor1Id = match.competitor1Id;
    reset.competitor2Id = match.competitor2Id;
    reset.status = 'pending';
    return;
  }

  if (match.bracketType === 'reset_final' || match.nextMatchIndex == null) {
    t.status = 'completed';
    t.championId = winnerId;
    return;
  }

  placeInSlot(t.matches[match.nextMatchIndex], match.nextMatchSlot, winnerId);

  if (match.bracketType === 'winners' && match.loserNextMatchIndex != null) {
    placeInSlot(t.matches[match.loserNextMatchIndex], match.loserNextMatchSlot, loserId);
  }

  // Newly filled single-entrant losers matches (from WR byes) may now be auto-byes
  propagateByes(t.matches);
}

export function playToCompletion(t, pickWinner = (m) => m.competitor1Id) {
  let guard = 0;
  while (t.status !== 'completed' && guard++ < 500) {
    const playable = playableMatches(t);
    if (playable.length === 0) {
      throw new Error(
        `Deadlock: no playable matches with status=${t.status}. ` +
          `pending=${t.matches.filter(m => m.status === 'pending').map(m => m.index).join(',')}`,
      );
    }
    playable.sort((a, b) => a.index - b.index);
    const m = playable[0];
    completeMatch(t, m.index, pickWinner(m));
  }
  if (t.status !== 'completed') throw new Error('Tournament did not complete');
}

export function assertBracketIntegrity(t) {
  for (const m of t.matches) {
    if (m.competitor1Id && m.competitor2Id && m.competitor1Id === m.competitor2Id) {
      throw new Error(`Duplicate competitor in match ${m.index}`);
    }
  }
  if (t.type === 'double' && t.championId && t.status === 'completed') {
    // N<=2 collapses to single-elim topology
    const hasLosers = t.matches.some(m => m.bracketType === 'losers');
    if (!hasLosers) return;
    for (const [id, losses] of t.losses) {
      if (id === t.championId) continue;
      if (losses < 2) {
        throw new Error(`Player ${id} eliminated with only ${losses} loss(es) in double elim`);
      }
    }
  }
}
