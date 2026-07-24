'use server';

import { createClient } from '@/lib/supabase/server';
import { generateBracket } from '@/lib/tournament/bracket-engine';
import type { BracketInput, BracketMatchDef } from '@/lib/tournament/bracket-engine';

// ─── Types ───────────────────────────────────────────────────────────

type ActionResult = { success: true; data?: any } | { success: false; error: string };

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

  const { data: comp } = await supabase.from('competitions').select('created_by').eq('id', competitionId).single();
  if (!comp) return { success: false, error: 'Competition not found' };

  const isAdmin = await checkAdmin(supabase, competitionId, user.id);
  if (!isAdmin) return { success: false, error: 'Not authorized' };

  const { data: insertData, error: insertError } = await supabase.from('tournaments').insert({
    competition_id: competitionId,
    created_by: user.id,
    name,
    description: data.description ?? '',
    event_key: data.eventKey ?? null,
    tournament_type: data.tournamentType,
    seeding_type: data.seedingType,
    match_format: data.matchFormat,
    scramble_source: data.scrambleSource,
    competitor_count: 0,
    status: 'draft',
  }).select('id').single();

  if (insertError) return { success: false, error: insertError.message };
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

  const { error } = await supabase.from('tournaments').update(data).eq('id', tournamentId);
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
  if (!t || t.status !== 'draft') return { success: false, error: 'Tournament must be in draft state' };
  if (competitorIds.length < 2) return { success: false, error: 'Need at least 2 competitors' };

  const { data: validComp } = await supabase
    .from('competitors').select('id, user_id, competition_id')
    .in('id', competitorIds).eq('competition_id', t.competition_id);
  if (!validComp || validComp.length !== competitorIds.length) {
    return { success: false, error: 'Competitors must be registered in this competition' };
  }
  const userIds = [...new Set(validComp.map(c => c.user_id))];
  const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', userIds);
  const nameMap = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name || 'Unknown']));
  const compMap = new Map(validComp.map(c => [c.id, c]));

  await supabase.from('tournament_participants').delete().eq('tournament_id', tournamentId);

  let ordered = competitorIds;
  if (t.seeding_type === 'seeded') {
    ordered = [...competitorIds].sort((a, b) => (qualifyingAverages[a] ?? 999999) - (qualifyingAverages[b] ?? 999999));
  }

  for (let i = 0; i < ordered.length; i++) {
    const cid = ordered[i];
    const comp = compMap.get(cid);
    if (!comp) continue;
    await supabase.from('tournament_participants').insert({
      tournament_id: tournamentId, competitor_id: cid,
      display_name_snapshot: nameMap.get(comp.user_id) || 'Unknown',
      seed: i + 1, qualifying_average: qualifyingAverages[cid] ?? null, initial_slot: i + 1,
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
  if (t.status !== 'draft' && t.status !== 'ready') {
    return { success: false, error: 'Cannot generate from current state' };
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

  // Build match JSON for RPC
  const matchRows = def.matches.map((m, idx) => ({
    bracket_type: m.bracketType,
    bracket_round: m.bracketRound,
    match_number: m.matchNumber,
    bracket_index: idx,
    slot1_seed: m.slot1Seed,
    slot2_seed: m.slot2Seed,
    is_bye: m.isBye,
    next_match_idx: m.nextMatchIndex,
    loser_next_match_idx: m.loserNextMatchIndex,
  }));

  // Build participant JSON
  const participantRows = comps.map((c, i) => ({
    competitor_id: c.competitor_id,
    seed: c.seed ?? (i + 1),
    qualifying_average: c.qualifying_average,
    initial_slot: c.initial_slot,
  }));

  // Call RPC
  const { data: result, error } = await supabase.rpc('generate_tournament_bracket', {
    p_tournament_id: tournamentId,
    p_participants: JSON.stringify(participantRows),
    p_matches: JSON.stringify(matchRows),
  });

  if (error) return { success: false, error: error.message };

  // Link match pointers in a second pass
  const { data: dbMatches } = await supabase
    .from('tournament_matches')
    .select('id, bracket_index')
    .eq('tournament_id', tournamentId)
    .order('bracket_index');

  if (dbMatches) {
    const idxToId = new Map(dbMatches.map(m => [m.bracket_index, m.id]));
    for (let i = 0; i < def.matches.length; i++) {
      const m = def.matches[i];
      const mid = idxToId.get(i);
      if (!mid) continue;

      const updates: Record<string, any> = {};
      if (m.nextMatchIndex !== null) {
        const nextId = idxToId.get(m.nextMatchIndex);
        if (nextId) updates.next_match_id = nextId;
      }
      if (m.loserNextMatchIndex !== null) {
        const loserId = idxToId.get(m.loserNextMatchIndex);
        if (loserId) updates.loser_next_match_id = loserId;
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('tournament_matches').update(updates).eq('id', mid);
      }
    }
  }

  return { success: true, data: { matchCount: def.matches.length } };
}

// ─── Activate Tournament ─────────────────────────────────────────────

export async function activateTournamentAction(tournamentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await checkAuthAdmin(supabase, tournamentId);
  if (!auth.ok) return auth.result;

  const { error } = await supabase.from('tournaments').update({ status: 'active' }).eq('id', tournamentId);
  if (error) return { success: false, error: error.message };

  // Activate first non-bye match
  const { data: firstMatch } = await supabase
    .from('tournament_matches')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('bracket_type', 'winners')
    .eq('bracket_round', 1)
    .eq('auto_advance', false)
    .eq('status', 'pending')
    .order('match_number')
    .limit(1)
    .single();

  if (firstMatch) {
    await supabase.from('tournament_matches').update({ status: 'active' }).eq('id', firstMatch.id);
    await supabase.from('tournament_match_sets').insert({
      match_id: firstMatch.id,
      set_number: 1,
      status: 'active',
    });
  }

  return { success: true };
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
    const { generateScrambles } = await import('@/lib/scramble');
    const scrambles = await generateScrambles(t.event_key, 1);
    scramble = scrambles[0] || null;
  }
  const { data, error } = await supabase.rpc('re_solve_tournament_tie', {
    p_tournament_id: tournamentId, p_solve_id: solveId, p_scramble: scramble,
  });
  if (error) return { success: false, error: error.message };
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
