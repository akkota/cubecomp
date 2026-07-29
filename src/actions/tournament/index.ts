'use server';

import { createClient } from '@/lib/supabase/server';
import { generateBracket, seededShuffle } from '@/lib/tournament/bracket-engine';

// ─── Types ───────────────────────────────────────────────────────────

type ActionResult = { success: true; data?: unknown } | { success: false; error: string };

function rpcPayloadOk(data: unknown): { ok: true } | { ok: false; error: string } {
  if (data && typeof data === 'object' && 'success' in data && (data as { success: boolean }).success === false) {
    const err = (data as { error?: string }).error;
    return { ok: false, error: err ?? 'Operation failed' };
  }
  return { ok: true };
}

interface ParticipantDef {
  competitor_id: string;
  seed: number;
  qualifying_average: number | null;
  initial_slot: number;
}

// ─── Create Tournament ───────────────────────────────────────────────

export async function createTournamentAction(
  competitionId: string,
  name: string,
  data: {
    description?: string;
    eventKey?: string | null;
    tournamentType: 'single' | 'double';
    seedingType: 'seeded' | 'unseeded';
    matchFormat: 'bo3' | 'bo5';
    scrambleSource: 'generated' | 'external';
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: comp } = await supabase
    .from('competitions')
    .select('created_by, competition_type')
    .eq('id', competitionId)
    .single();
  if (!comp) return { success: false, error: 'Competition not found' };
  if (comp.competition_type !== 'head_to_head') {
    return { success: false, error: 'Tournaments can only be created for head-to-head competitions' };
  }

  const isAdmin = await checkAdmin(supabase, competitionId, user.id);
  if (!isAdmin) return { success: false, error: 'Not authorized' };

  // One head-to-head tournament per competition (cancelled may be replaced)
  const { data: existing } = await supabase
    .from('tournaments')
    .select('id, status')
    .eq('competition_id', competitionId)
    .neq('status', 'cancelled')
    .limit(1)
    .maybeSingle();
  if (existing) {
    return {
      success: false,
      error: 'This competition already has a tournament. Open it to continue setup.',
    };
  }

  // Prefer the competition's configured event when one exists
  let eventKey = data.eventKey ?? null;
  if (!eventKey) {
    const { data: events } = await supabase
      .from('competition_events')
      .select('event_key')
      .eq('competition_id', competitionId)
      .limit(1);
    eventKey = events?.[0]?.event_key ?? null;
  }

  const { data: insertData, error: insertError } = await supabase.from('tournaments').insert({
    competition_id: competitionId,
    created_by: user.id,
    name,
    description: data.description ?? '',
    event_key: eventKey,
    tournament_type: data.tournamentType,
    seeding_type: data.seedingType,
    match_format: data.matchFormat,
    scramble_source: data.scrambleSource,
    competitor_count: 0, // draft; raised when participants are attached
    status: 'draft',
  }).select('id').single();

  if (insertError) {
    if (insertError.code === '23505' || insertError.message.includes('uniq_one_tournament_per_competition')) {
      return {
        success: false,
        error: 'This competition already has a tournament. Open it to continue setup.',
      };
    }
    if (insertError.message.includes('competitor_count')) {
      return {
        success: false,
        error: 'Could not create draft tournament. Try again, or contact support if this persists.',
      };
    }
    return { success: false, error: insertError.message };
  }
  return { success: true, data: { id: insertData.id } };
}

// ─── Update Tournament Config ────────────────────────────────────────

export async function updateTournamentConfigAction(
  tournamentId: string,
  data: {
    name?: string;
    description?: string;
    tournamentType?: 'single' | 'double';
    seedingType?: 'seeded' | 'unseeded';
    matchFormat?: 'bo3' | 'bo5';
    scrambleSource?: 'generated' | 'external';
    eventKey?: string | null;
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;

  const { data: t } = await supabase.from('tournaments').select('status').eq('id', tournamentId).single();
  if (!t || t.status !== 'draft') {
    return { success: false, error: 'Tournament settings can only be edited while in draft' };
  }

  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  if (data.tournamentType !== undefined) patch.tournament_type = data.tournamentType;
  if (data.seedingType !== undefined) patch.seeding_type = data.seedingType;
  if (data.matchFormat !== undefined) patch.match_format = data.matchFormat;
  if (data.scrambleSource !== undefined) patch.scramble_source = data.scrambleSource;
  if (data.eventKey !== undefined) patch.event_key = data.eventKey;

  const { error } = await supabase.from('tournaments').update(patch).eq('id', tournamentId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Set Participants ────────────────────────────────────────────────

export async function setParticipantsAction(
  tournamentId: string,
  competitorIds: string[],
  qualifyingAverages: Record<string, number>,
): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;

  const { data: t } = await supabase.from('tournaments').select('*').eq('id', tournamentId).single();
  if (!t || t.status !== 'draft') {
    return { success: false, error: 'Participants can only be changed while the tournament is a draft' };
  }
  if (competitorIds.length < 2) return { success: false, error: 'Need at least 2 competitors' };

  const { data: validComp } = await supabase
    .from('competitors').select('id, user_id, competition_id')
    .in('id', competitorIds).eq('competition_id', t.competition_id);
  if (!validComp || validComp.length !== competitorIds.length) {
    return { success: false, error: 'Competitors must be registered in this competition' };
  }
  const userIds = [...new Set(validComp.map(c => c.user_id))];
  const { data: profiles } = await supabase.from('profiles').select('id, username, display_name').in('id', userIds);
  const nameMap = new Map(
    (profiles ?? []).map((p: any) => [p.id, p.username ? `@${p.username}` : 'Unknown']),
  );
  const compMap = new Map(validComp.map(c => [c.id, c]));

  await supabase.from('tournament_participants').delete().eq('tournament_id', tournamentId);

  let ordered = competitorIds;
  if (t.seeding_type === 'seeded') {
    ordered = [...competitorIds].sort((a, b) => {
      const aAvg = qualifyingAverages[a];
      const bAvg = qualifyingAverages[b];
      const aVal = aAvg != null && aAvg > 0 ? aAvg : Number.POSITIVE_INFINITY;
      const bVal = bAvg != null && bAvg > 0 ? bAvg : Number.POSITIVE_INFINITY;
      if (aVal !== bVal) return aVal - bVal;
      return a.localeCompare(b);
    });
  } else {
    // Unseeded: deterministic random order from a stored shuffle seed
    const shuffleSeed = (t.shuffle_seed as number | null) ?? (Date.now() & 0xffffffff);
    if (t.shuffle_seed == null) {
      await supabase.from('tournaments').update({ shuffle_seed: shuffleSeed }).eq('id', tournamentId);
    }
    const order = seededShuffle(competitorIds.length, shuffleSeed);
    ordered = order.map(i => competitorIds[i - 1]);
  }

  for (let i = 0; i < ordered.length; i++) {
    const cid = ordered[i];
    const comp = compMap.get(cid);
    if (!comp) continue;
    const avg = qualifyingAverages[cid];
    await supabase.from('tournament_participants').insert({
      tournament_id: tournamentId, competitor_id: cid,
      display_name_snapshot: nameMap.get(comp.user_id) || 'Unknown',
      seed: i + 1,
      qualifying_average: avg != null && avg > 0 ? avg : null,
      initial_slot: i + 1,
    });
  }

  await supabase.from('tournaments').update({ competitor_count: ordered.length }).eq('id', tournamentId);
  return { success: true, data: { count: ordered.length } };
}

// ─── Generate Bracket ────────────────────────────────────────────────

export async function generateBracketAction(tournamentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;

  const { data: t } = await supabase.from('tournaments').select('*').eq('id', tournamentId).single();
  if (!t) return { success: false, error: 'Tournament not found' };
  if (t.status !== 'draft') {
    return { success: false, error: 'Bracket can only be generated once from a draft tournament' };
  }

  // Fetch competitors
  const { data: comps } = await supabase
    .from('tournament_participants')
    .select('id, competitor_id, seed, qualifying_average, initial_slot')
    .eq('tournament_id', tournamentId)
    .order('initial_slot');

  if (!comps || comps.length < 2) return { success: false, error: 'Need at least 2 participants' };

  const participantCount = comps.length;

  // Generate bracket
  const def = generateBracket({
    participantCount,
    tournamentType: t.tournament_type,
    seedingType: t.seeding_type,
  });

  // Build match JSON for RPC (slots + pointers applied atomically inside the RPC)
  const matchRows = def.matches.map((m, idx) => ({
    bracket_type: m.bracketType,
    bracket_round: m.bracketRound,
    match_number: m.matchNumber,
    bracket_index: idx,
    slot1_seed: m.slot1Seed,
    slot2_seed: m.slot2Seed,
    is_bye: m.isBye,
    next_match_idx: m.nextMatchIndex,
    next_match_slot: m.nextMatchSlot,
    loser_next_match_idx: m.loserNextMatchIndex,
    loser_next_match_slot: m.loserNextMatchSlot,
  }));

  const participantRows = comps.map((c, i) => ({
    competitor_id: c.competitor_id,
    seed: c.seed ?? (i + 1),
    qualifying_average: c.qualifying_average,
    initial_slot: c.initial_slot,
  }));

  const { data: result, error } = await supabase.rpc('generate_tournament_bracket', {
    p_tournament_id: tournamentId,
    p_participants: participantRows,
    p_matches: matchRows,
  });

  if (error) return { success: false, error: error.message };
  if (result && result.success === false) {
    return { success: false, error: result.error ?? 'Failed to generate bracket' };
  }

  return { success: true, data: { matchCount: def.matches.length } };
}

// ─── Activate Tournament ─────────────────────────────────────────────

async function startMatchPlay(
  supabase: any,
  matchId: string,
  eventKey: string | null,
  scrambleSource: string,
  precomputedScramble?: string | null,
): Promise<{ success: true } | { success: false; error: string }> {
  const { error: matchErr } = await supabase
    .from('tournament_matches')
    .update({ status: 'active' })
    .eq('id', matchId);
  if (matchErr) return { success: false, error: matchErr.message };

  const { data: existingSet } = await supabase
    .from('tournament_match_sets')
    .select('id')
    .eq('match_id', matchId)
    .eq('status', 'active')
    .maybeSingle();

  let setId = existingSet?.id as string | undefined;
  if (!setId) {
    const { data: setRow, error: setErr } = await supabase
      .from('tournament_match_sets')
      .insert({ match_id: matchId, set_number: 1, status: 'active' })
      .select('id')
      .single();
    if (setErr || !setRow) {
      return { success: false, error: setErr?.message ?? 'Failed to create set' };
    }
    setId = setRow.id;
  }

  const { data: pendingSolve } = await supabase
    .from('tournament_match_solves')
    .select('id')
    .eq('set_id', setId)
    .in('status', ['pending', 'active', 'tied'])
    .limit(1)
    .maybeSingle();

  if (!pendingSolve) {
    let scramble: string | null =
      typeof precomputedScramble === 'string' ? precomputedScramble : null;
    if (scramble == null && scrambleSource === 'generated' && eventKey) {
      try {
        const { generateScramble } = await import('@/lib/scramble');
        scramble = await generateScramble(eventKey);
      } catch {
        scramble = null;
      }
    }
    const { error: solveErr } = await supabase.from('tournament_match_solves').insert({
      set_id: setId,
      solve_number: 1,
      re_solve_attempt: 0,
      scramble,
      status: 'pending',
    });
    if (solveErr) return { success: false, error: solveErr.message };
  }

  return { success: true };
}

export async function activateTournamentAction(tournamentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;

  const { data: t } = await supabase
    .from('tournaments')
    .select('status, event_key, scramble_source')
    .eq('id', tournamentId)
    .single();
  if (!t) return { success: false, error: 'Tournament not found' };
  if (t.status !== 'ready') {
    return { success: false, error: 'Tournament must be ready before starting' };
  }

  const { error } = await supabase.from('tournaments').update({ status: 'active' }).eq('id', tournamentId);
  if (error) return { success: false, error: error.message };

  // Start every first-round playable match — multiple can be live at once.
  // Batch-generate scrambles once so we warm the solver once instead of
  // paying cold-start cost per match.
  const { data: playable } = await supabase
    .from('tournament_matches')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('auto_advance', false)
    .eq('status', 'pending')
    .eq('bracket_round', 1)
    .not('competitor1_id', 'is', null)
    .not('competitor2_id', 'is', null)
    .order('bracket_index');

  const matches = playable ?? [];
  let batch: Array<string | null> = matches.map(() => null);
  if (t.scramble_source === 'generated' && t.event_key && matches.length > 0) {
    try {
      const { generateScrambles } = await import('@/lib/scramble');
      const texts = await generateScrambles(t.event_key, matches.length);
      batch = texts;
    } catch {
      batch = matches.map(() => null);
    }
  }

  for (let i = 0; i < matches.length; i += 1) {
    const started = await startMatchPlay(
      supabase,
      matches[i].id,
      t.event_key,
      t.scramble_source,
      batch[i],
    );
    if (!started.success) return started;
  }

  return { success: true };
}

/** Make a pending match live (multiple live matches allowed). */
export async function makeMatchLiveAction(tournamentId: string, matchId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;

  const { data: t } = await supabase
    .from('tournaments')
    .select('status, event_key, scramble_source')
    .eq('id', tournamentId)
    .single();
  if (!t || t.status !== 'active') {
    return { success: false, error: 'Tournament must be active' };
  }

  const { data: match } = await supabase
    .from('tournament_matches')
    .select('*')
    .eq('id', matchId)
    .eq('tournament_id', tournamentId)
    .single();
  if (!match) return { success: false, error: 'Match not found' };
  if (match.auto_advance) return { success: false, error: 'Bye matches cannot be made live' };
  if (match.status === 'active') return { success: true, data: { alreadyLive: true } };
  if (match.status !== 'pending') {
    return { success: false, error: 'Only pending matches can be made live' };
  }
  if (!match.competitor1_id || !match.competitor2_id) {
    return { success: false, error: 'Both competitors must be set before making this match live' };
  }

  return startMatchPlay(supabase, matchId, t.event_key, t.scramble_source);
}

/** Ensure an active match has an active set + pending solve so results can be entered. */
export async function ensureActiveMatchPlayableAction(tournamentId: string, matchId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;

  const { data: t } = await supabase
    .from('tournaments')
    .select('status, event_key, scramble_source')
    .eq('id', tournamentId)
    .single();
  if (!t || t.status !== 'active') {
    return { success: false, error: 'Tournament is not active' };
  }

  const { data: match } = await supabase
    .from('tournament_matches')
    .select('*')
    .eq('id', matchId)
    .eq('tournament_id', tournamentId)
    .single();
  if (!match) return { success: false, error: 'Match not found' };
  if (match.auto_advance) return { success: false, error: 'Bye matches cannot be played' };
  if (match.status !== 'active') {
    return { success: false, error: 'Match is not active' };
  }
  if (!match.competitor1_id || !match.competitor2_id) {
    return { success: false, error: 'Both competitors required' };
  }

  let { data: setRow } = await supabase
    .from('tournament_match_sets')
    .select('*')
    .eq('match_id', matchId)
    .eq('status', 'active')
    .order('set_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!setRow) {
    const nextSetNumber =
      ((
        await supabase
          .from('tournament_match_sets')
          .select('set_number')
          .eq('match_id', matchId)
          .order('set_number', { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data?.set_number ?? 0) + 1;

    const inserted = await supabase
      .from('tournament_match_sets')
      .insert({
        match_id: matchId,
        set_number: nextSetNumber,
        status: 'active',
      })
      .select('*')
      .single();
    if (inserted.error || !inserted.data) {
      return { success: false, error: inserted.error?.message ?? 'Failed to create set' };
    }
    setRow = inserted.data;
  }

  const { data: pendingSolve } = await supabase
    .from('tournament_match_solves')
    .select('id, scramble')
    .eq('set_id', setRow.id)
    .in('status', ['pending', 'active', 'tied'])
    .order('solve_number', { ascending: false })
    .order('re_solve_attempt', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pendingSolve) {
    const completedCount =
      (
        await supabase
          .from('tournament_match_solves')
          .select('id', { count: 'exact', head: true })
          .eq('set_id', setRow.id)
          .eq('status', 'completed')
      ).count ?? 0;

    let scramble: string | null = null;
    if (t.scramble_source === 'generated' && t.event_key) {
      try {
        const { generateScramble } = await import('@/lib/scramble');
        scramble = await generateScramble(t.event_key);
      } catch {
        scramble = null;
      }
    }

    const { error: solveError } = await supabase.from('tournament_match_solves').insert({
      set_id: setRow.id,
      solve_number: completedCount + 1,
      re_solve_attempt: 0,
      scramble,
      status: 'pending',
    });
    if (solveError) return { success: false, error: solveError.message };
  } else if (!pendingSolve.scramble && t.scramble_source === 'generated' && t.event_key) {
    // RPC-created next solves omit scramble — backfill once for the active attempt
    try {
      const { generateScramble } = await import('@/lib/scramble');
      const scramble = await generateScramble(t.event_key);
      if (scramble) {
        await supabase
          .from('tournament_match_solves')
          .update({ scramble })
          .eq('id', pendingSolve.id)
          .is('scramble', null);
      }
    } catch {
      // leave scramble null; admin can still enter times
    }
  }

  return { success: true, data: { setId: setRow.id } };
}

// ─── Cancel Tournament ───────────────────────────────────────────────

export async function cancelTournamentAction(tournamentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;

  const { error } = await supabase.from('tournaments').update({ status: 'cancelled' }).eq('id', tournamentId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Submit Solve Result ─────────────────────────────────────────────

export async function submitSolveResultAction(
  tournamentId: string,
  matchId: string,
  setId: string,
  solveId: string | null,
  setNumber: number,
  solveNumber: number,
  c1TimeMs: number | null,
  c1Penalty: string,
  c2TimeMs: number | null,
  c2Penalty: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;

  if (!['none', 'DNF', '+2', 'DNS'].includes(c1Penalty) || !['none', 'DNF', '+2', 'DNS'].includes(c2Penalty)) {
    return { success: false, error: 'Invalid penalty' };
  }

  const { data, error } = await supabase.rpc('submit_tournament_solve', {
    p_tournament_id: tournamentId,
    p_match_id: matchId,
    p_set_id: setId,
    p_solve_id: solveId,
    p_set_number: setNumber,
    p_solve_number: solveNumber,
    p_c1_time_ms: c1TimeMs,
    p_c1_penalty: c1Penalty,
    p_c2_time_ms: c2TimeMs,
    p_c2_penalty: c2Penalty,
  });

  if (error) return { success: false, error: error.message };
  const check = rpcPayloadOk(data);
  if (!check.ok) return { success: false, error: check.error };
  return { success: true, data };
}

// ─── Admin Resolve Tie ───────────────────────────────────────────────

export async function adminResolveTieAction(
  tournamentId: string,
  solveId: string,
  winnerCompetitorId: string,
  reason: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;

  const { data, error } = await supabase.rpc('admin_resolve_tournament_tie', {
    p_tournament_id: tournamentId,
    p_solve_id: solveId,
    p_winner_competitor_id: winnerCompetitorId,
    p_reason: reason,
  });

  if (error) return { success: false, error: error.message };
  const check = rpcPayloadOk(data);
  if (!check.ok) return { success: false, error: check.error };
  return { success: true, data };
}

// ─── Re-Solve (server-side scramble generation) ──────────────────────

export async function reSolveAction(
  tournamentId: string,
  solveId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;
  const { data: t } = await supabase.from('tournaments').select('event_key, scramble_source').eq('id', tournamentId).single();
  if (!t) return { success: false, error: 'Tournament not found' };
  const { data: solve } = await supabase.from('tournament_match_solves').select('id, status').eq('id', solveId).single();
  if (!solve) return { success: false, error: 'Solve not found' };
  if (solve.status !== 'tied') return { success: false, error: 'Solve is not tied' };
  let scramble: string | null = null;
  if (t.scramble_source === 'generated' && t.event_key) {
    const { generateScramble } = await import('@/lib/scramble');
    scramble = await generateScramble(t.event_key);
  }
  const { data, error } = await supabase.rpc('re_solve_tournament_tie', {
    p_tournament_id: tournamentId, p_solve_id: solveId, p_scramble: scramble,
  });
  if (error) return { success: false, error: error.message };
  const check = rpcPayloadOk(data);
  if (!check.ok) return { success: false, error: check.error };
  return { success: true, data };
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function checkAdmin(supabase: any, competitionId: string, userId: string): Promise<boolean> {
  const { data: comp } = await supabase.from('competitions').select('created_by').eq('id', competitionId).single();
  if (!comp) return false;
  if (comp.created_by === userId) return true;

  const { data: admin } = await supabase
    .from('competition_admins')
    .select('id')
    .eq('competition_id', competitionId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!admin;
}

async function checkAuthAdmin(supabase: any, tournamentId: string): Promise<{ ok: boolean; result: ActionResult }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, result: { success: false, error: 'Not authenticated' } };

  const { data: t } = await supabase.from('tournaments').select('competition_id').eq('id', tournamentId).single();
  if (!t) return { ok: false, result: { success: false, error: 'Tournament not found' } };

  const isAdmin = await checkAdmin(supabase, t.competition_id, user.id);
  if (!isAdmin) return { ok: false, result: { success: false, error: 'Not authorized' } };

  return { ok: true, result: { success: true } };
}
