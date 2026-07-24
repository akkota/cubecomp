/**
 * Pure in-memory tournament advancement simulator.
 * Mirrors the SQL routing rules in migration 019 so we can exhaustively
 * test byes, SE completion, DE loser routing, and grand-final reset
 * without a live database.
 */

import {
  generateBracket,
  type BracketDefinition,
  type BracketMatchDef,
  type TournamentType,
} from './bracket-engine';

export type SimMatchStatus = 'pending' | 'active' | 'completed' | 'void';

export interface SimMatch {
  index: number;
  bracketType: BracketMatchDef['bracketType'];
  bracketRound: number;
  matchNumber: number;
  competitor1Id: string | null;
  competitor2Id: string | null;
  winnerId: string | null;
  status: SimMatchStatus;
  isBye: boolean;
  nextMatchIndex: number | null;
  nextMatchSlot: 1 | 2 | null;
  loserNextMatchIndex: number | null;
  loserNextMatchSlot: 1 | 2 | null;
}

export interface SimTournament {
  type: TournamentType;
  status: 'ready' | 'active' | 'completed';
  championId: string | null;
  matches: SimMatch[];
  losses: Map<string, number>;
}

function placeInSlot(match: SimMatch, slot: 1 | 2, competitorId: string): void {
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

function routeCompetitor(
  matches: SimMatch[],
  from: SimMatch,
  competitorId: string,
  destIndex: number | null,
  destSlot: 1 | 2 | null,
): void {
  if (destIndex == null || destSlot == null) return;
  const dest = matches[destIndex];
  if (!dest) throw new Error(`Missing destination match ${destIndex}`);
  placeInSlot(dest, destSlot, competitorId);
}

/** Propagate all completed bye winners into their next-match slots. */
export function propagateByes(matches: SimMatch[]): void {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < matches.length + 2) {
    changed = false;
    for (const m of matches) {
      if (!m.isBye || m.status !== 'completed' || !m.winnerId) continue;
      if (m.nextMatchIndex == null || m.nextMatchSlot == null) continue;
      const dest = matches[m.nextMatchIndex];
      const before = dest.competitor1Id + '|' + dest.competitor2Id;
      placeInSlot(dest, m.nextMatchSlot, m.winnerId);
      const after = dest.competitor1Id + '|' + dest.competitor2Id;
      if (before !== after) changed = true;
    }
  }
}

export function buildSimTournament(
  participantCount: number,
  tournamentType: TournamentType,
  participantIds?: string[],
): SimTournament {
  const ids = participantIds ?? Array.from({ length: participantCount }, (_, i) => `P${i + 1}`);
  if (ids.length !== participantCount) throw new Error('participantIds length mismatch');

  const def: BracketDefinition = generateBracket({
    participantCount,
    tournamentType,
    seedingType: 'seeded',
  });

  const seedToId = new Map(ids.map((id, i) => [i + 1, id]));
  const matches: SimMatch[] = def.matches.map((m) => {
    const c1 = m.slot1Seed != null ? seedToId.get(m.slot1Seed) ?? null : null;
    const c2 = m.slot2Seed != null ? seedToId.get(m.slot2Seed) ?? null : null;
    const isBye = m.isBye;
    let winnerId: string | null = null;
    let status: SimMatchStatus = 'pending';
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

export function playableMatches(t: SimTournament): SimMatch[] {
  return t.matches.filter(
    m =>
      !m.isBye &&
      m.status === 'pending' &&
      m.competitor1Id != null &&
      m.competitor2Id != null &&
      m.competitor1Id !== m.competitor2Id,
  );
}

/**
 * Complete a match with the given winner (must be one of the two competitors).
 * Applies winner/loser routing and tournament completion / reset-final rules.
 */
export function completeMatch(t: SimTournament, matchIndex: number, winnerId: string): void {
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

  // Grand final: WB champion (slot1) winning ends the tournament;
  // LB champion (slot2) winning activates the pre-created reset final.
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

  routeCompetitor(t.matches, match, winnerId, match.nextMatchIndex, match.nextMatchSlot);

  if (match.bracketType === 'winners' && match.loserNextMatchIndex != null) {
    routeCompetitor(t.matches, match, loserId, match.loserNextMatchIndex, match.loserNextMatchSlot);
  }
}

/** Play every currently playable match with a deterministic winner picker until done. */
export function playToCompletion(
  t: SimTournament,
  pickWinner: (m: SimMatch) => string = (m) => m.competitor1Id!,
): void {
  let guard = 0;
  while (t.status !== 'completed' && guard++ < 500) {
    const playable = playableMatches(t);
    if (playable.length === 0) {
      throw new Error(
        `Deadlock: no playable matches with status=${t.status}. ` +
          `pending=${t.matches.filter(m => m.status === 'pending').map(m => m.index).join(',')}`,
      );
    }
    // Prefer earliest bracket index for stability
    playable.sort((a, b) => a.index - b.index);
    const m = playable[0];
    completeMatch(t, m.index, pickWinner(m));
  }
  if (t.status !== 'completed') throw new Error('Tournament did not complete');
}

/** Assert no match has the same competitor twice, and DE players have ≤2 losses before elimination. */
export function assertBracketIntegrity(t: SimTournament): void {
  for (const m of t.matches) {
    if (m.competitor1Id && m.competitor2Id && m.competitor1Id === m.competitor2Id) {
      throw new Error(`Duplicate competitor in match ${m.index}`);
    }
  }
  if (t.type === 'double' && t.championId) {
    for (const [id, losses] of t.losses) {
      if (id === t.championId) continue;
      if (losses < 2) {
        // Still allowed only if tournament somehow incomplete
        if (t.status === 'completed') {
          throw new Error(`Player ${id} eliminated with only ${losses} loss(es) in double elim`);
        }
      }
    }
  }
}
