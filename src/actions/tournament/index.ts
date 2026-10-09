'use server';

import { fetchAllPages } from '@/lib/pagination';
import { createClient } from '@/lib/supabase/server';
import { generateBracket, seededShuffle } from '@/lib/tournament/bracket-engine';

// ─── Types ───────────────────────────────────────────────────────────

type ActionResult = { success: true; data?: unknown } | { success: false; error: string };

function rpcPayloadOk(data: unknown): { ok: true } | { ok: false; error: string } {
  if (data && typeof data === 'object' && 'success' in data && (data as { success: boolean }).success === false) {
    const err = (data as { error?: string }).error;
    return { ok: false, error: err ?? 'Operation failed' };
  }
  if (!data || typeof data !== 'object' || !('success' in data) || data.success !== true) return { ok: false, error: 'Invalid operation response' };
  return { ok: true };
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

  if (!eventKey || ['333fm', '333mbf'].includes(eventKey)) return { success: false, error: 'This event requires an unsupported result type' };

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
  if (data.eventKey !== undefined) {
    if (!data.eventKey || ['333fm', '333mbf'].includes(data.eventKey)) return { success: false, error: 'Unsupported result type' };
    patch.event_key = data.eventKey;
  }

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

  if (competitorIds.length > 1024 || new Set(competitorIds).size !== competitorIds.length) {
    return { success: false, error: 'Select 2 to 1024 distinct participants' };
  }
  for (const value of Object.values(qualifyingAverages)) {
    if (!Number.isInteger(value) || value <= 0 || value > 2147483647) {
      return { success: false, error: 'Qualifying averages must be positive integer milliseconds' };
    }
  }
  const shuffleSeed = t.shuffle_seed ?? (Date.now() & 0xffffffff);
  const ordered = t.seeding_type === 'seeded'
    ? [...competitorIds].sort((a, b) => (qualifyingAverages[a] ?? Infinity) - (qualifyingAverages[b] ?? Infinity) || a.localeCompare(b))
    : seededShuffle(competitorIds.length, shuffleSeed).map(i => competitorIds[i - 1]);
  const { data, error } = await supabase.rpc('replace_tournament_participants', {
    p_tournament_id: tournamentId, p_shuffle_seed: shuffleSeed,
    p_participants: ordered.map(id => ({ competitor_id: id, qualifying_average: qualifyingAverages[id] ?? null })),
  });
  if (error) return { success: false, error: error.message };
  const result = rpcPayloadOk(data);
  return result.ok ? { success: true, data: { count: ordered.length } } : { success: false, error: result.error };
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
  let comps;
  try {
    comps = await fetchAllPages((from, to) => supabase.from('tournament_participants')
      .select('id, competitor_id, seed, qualifying_average, initial_slot')
      .eq('tournament_id', tournamentId).order('initial_slot').order('id').range(from, to));
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not load participants' }; }

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

export async function activateTournamentAction(tournamentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;
  const { data: t, error: tError } = await supabase.from('tournaments').select('status,event_key,scramble_source').eq('id', tournamentId).single();
  if (tError || !t) return { success: false, error: tError?.message ?? 'Tournament not found' };
  if (t.status === 'active') return { success: true };
  if (t.status !== 'ready') return { success: false, error: 'Tournament must be ready' };
  const { data: matches, error: matchError } = await supabase.from('tournament_matches').select('id')
    .eq('tournament_id', tournamentId).eq('auto_advance', false).eq('status', 'pending').eq('bracket_round', 1)
    .not('competitor1_id', 'is', null).not('competitor2_id', 'is', null).order('bracket_index');
  if (matchError) return { success: false, error: matchError.message };
  try {
    const { generateScrambles } = await import('@/lib/scramble');
    const scrambles = t.scramble_source === 'generated' && matches?.length
      ? await generateScrambles(t.event_key, matches.length) : [];
    const { data, error } = await supabase.rpc('activate_tournament', {
      p_tournament_id: tournamentId,
      p_matches: (matches ?? []).map((m, i) => ({ id: m.id, scramble: scrambles[i] ?? null })),
    });
    if (error) return { success: false, error: error.message };
    const result = rpcPayloadOk(data);
    return result.ok ? { success: true } : { success: false, error: result.error };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Scramble generation failed' }; }
}

export async function makeMatchLiveAction(tournamentId: string, matchId: string): Promise<ActionResult> {
  return ensureActiveMatchPlayableAction(tournamentId, matchId);
}

/** The RPC serializes preparation and never overwrites an existing scramble. */
export async function ensureActiveMatchPlayableAction(tournamentId: string, matchId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;
  const { data: t, error: tError } = await supabase.from('tournaments').select('event_key,scramble_source').eq('id', tournamentId).single();
  if (tError || !t) return { success: false, error: tError?.message ?? 'Tournament not found' };
  try {
    const { generateScramble } = await import('@/lib/scramble');
    const scramble = t.scramble_source === 'generated' ? await generateScramble(t.event_key) : null;
    const { data, error } = await supabase.rpc('prepare_tournament_match', {
      p_tournament_id: tournamentId, p_match_id: matchId, p_scramble: scramble,
    });
    if (error) return { success: false, error: error.message };
    const result = rpcPayloadOk(data);
    return result.ok ? { success: true, data } : { success: false, error: result.error };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Scramble generation failed' }; }
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

async function checkAdmin(supabase: Awaited<ReturnType<typeof createClient>>, competitionId: string, userId: string): Promise<boolean> {
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

async function checkAuthAdmin(supabase: Awaited<ReturnType<typeof createClient>>, tournamentId: string): Promise<{ ok: boolean; result: ActionResult }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, result: { success: false, error: 'Not authenticated' } };

  const { data: t } = await supabase.from('tournaments').select('competition_id').eq('id', tournamentId).single();
  if (!t) return { ok: false, result: { success: false, error: 'Tournament not found' } };

  const isAdmin = await checkAdmin(supabase, t.competition_id, user.id);
  if (!isAdmin) return { ok: false, result: { success: false, error: 'Not authorized' } };

  return { ok: true, result: { success: true } };
}
