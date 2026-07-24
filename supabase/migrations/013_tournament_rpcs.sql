-- 013_tournament_rpcs.sql
-- Atomic RPCs for Head-to-Head tournament operations.
-- All RPCs are SECURITY DEFINER with pinned search_path.
-- REVOKE PUBLIC EXECUTE; GRANT only to authenticated.

-- ============================================================
-- SUBMIT SOLVE RESULT (atomic)
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_tournament_solve(
  p_tournament_id UUID,
  p_match_id UUID,
  p_set_id UUID,
  p_solve_id UUID DEFAULT NULL,
  p_set_number INT DEFAULT 1,
  p_solve_number INT DEFAULT 1,
  p_c1_time_ms INT DEFAULT NULL,
  p_c1_penalty TEXT DEFAULT 'none',
  p_c2_time_ms INT DEFAULT NULL,
  p_c2_penalty TEXT DEFAULT 'none'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_set RECORD;
  v_solve RECORD;
  v_c1_adj INT;
  v_c2_adj INT;
  v_winner UUID;
  v_match_format TEXT;
  v_req_sets INT;
  v_new_solve_number INT;
  v_new_attempt INT;
  v_exists INT;
BEGIN
  -- Auth
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF NOT public.user_is_tournament_admin(p_tournament_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- Validate penalties
  IF p_c1_penalty NOT IN ('none', 'DNF', '+2', 'DNS') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid penalty for competitor 1');
  END IF;
  IF p_c2_penalty NOT IN ('none', 'DNF', '+2', 'DNS') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid penalty for competitor 2');
  END IF;
  IF p_c1_penalty IN ('DNF', 'DNS') AND p_c1_time_ms IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DNF/DNS must not include time');
  END IF;
  IF p_c2_penalty IN ('DNF', 'DNS') AND p_c2_time_ms IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DNF/DNS must not include time');
  END IF;
  IF p_c1_penalty IN ('none', '+2') AND (p_c1_time_ms IS NULL OR p_c1_time_ms <= 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid time required for competitor 1');
  END IF;
  IF p_c2_penalty IN ('none', '+2') AND (p_c2_time_ms IS NULL OR p_c2_time_ms <= 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid time required for competitor 2');
  END IF;

  -- Lock match
  SELECT * INTO v_match FROM tournament_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Match not found'); END IF;
  IF v_match.tournament_id != p_tournament_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match does not belong to tournament');
  END IF;
  IF v_match.status NOT IN ('active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match is not active');
  END IF;
  IF v_match.competitor1_id IS NULL OR v_match.competitor2_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Both competitors required');
  END IF;
  IF v_match.competitor1_id = v_match.competitor2_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competitors must be different');
  END IF;

  -- Lock set
  SELECT * INTO v_set FROM tournament_match_sets WHERE id = p_set_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Set not found'); END IF;
  IF v_set.match_id != p_match_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set does not belong to match');
  END IF;
  IF v_set.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set is not active');
  END IF;

  -- Resolve solve row
  IF p_solve_id IS NOT NULL THEN
    SELECT * INTO v_solve FROM tournament_match_solves WHERE id = p_solve_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Solve not found'); END IF;
    IF v_solve.set_id != p_set_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Solve does not belong to set');
    END IF;
    IF v_solve.status = 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Solve already completed');
    END IF;
    IF v_solve.status NOT IN ('pending', 'active', 'tied') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Solve not submittable');
    END IF;
    SELECT v_solve.solve_number, v_solve.re_solve_attempt INTO p_solve_number, v_new_attempt;
  ELSE
    -- Check no completed solve at this position
    SELECT COUNT(*) INTO v_exists FROM tournament_match_solves
      WHERE set_id = p_set_id AND solve_number = p_solve_number AND status = 'completed';
    IF v_exists > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Solve already completed at this position');
    END IF;
    SELECT COALESCE(MAX(re_solve_attempt), -1) + 1 INTO v_new_attempt
      FROM tournament_match_solves WHERE set_id = p_set_id AND solve_number = p_solve_number;
  END IF;

  -- Compute adjusted
  v_c1_adj := CASE WHEN p_c1_penalty IN ('DNF','DNS') THEN NULL
                    WHEN p_c1_penalty = '+2' THEN p_c1_time_ms + 2000
                    ELSE p_c1_time_ms END;
  v_c2_adj := CASE WHEN p_c2_penalty IN ('DNF','DNS') THEN NULL
                    WHEN p_c2_penalty = '+2' THEN p_c2_time_ms + 2000
                    ELSE p_c2_time_ms END;

  -- Determine winner
  IF v_c1_adj IS NOT NULL AND v_c2_adj IS NULL THEN
    v_winner := v_match.competitor1_id;
  ELSIF v_c1_adj IS NULL AND v_c2_adj IS NOT NULL THEN
    v_winner := v_match.competitor2_id;
  ELSIF v_c1_adj IS NULL AND v_c2_adj IS NULL THEN
    v_winner := NULL;
  ELSIF v_c1_adj < v_c2_adj THEN
    v_winner := v_match.competitor1_id;
  ELSIF v_c2_adj < v_c1_adj THEN
    v_winner := v_match.competitor2_id;
  ELSE
    v_winner := NULL;
  END IF;

  -- Upsert solve
  INSERT INTO tournament_match_solves (set_id, solve_number, re_solve_attempt, scramble,
    competitor1_time_ms, competitor1_penalty, competitor1_adjusted_ms,
    competitor2_time_ms, competitor2_penalty, competitor2_adjusted_ms,
    winner_id, status, completed_at)
  VALUES (p_set_id, p_solve_number, v_new_attempt,
    COALESCE((SELECT scramble FROM tournament_match_solves WHERE set_id = p_set_id AND solve_number = p_solve_number AND re_solve_attempt = v_new_attempt), NULL),
    p_c1_time_ms, p_c1_penalty, v_c1_adj,
    p_c2_time_ms, p_c2_penalty, v_c2_adj,
    v_winner, CASE WHEN v_winner IS NOT NULL THEN 'completed' ELSE 'tied' END,
    CASE WHEN v_winner IS NOT NULL THEN NOW() ELSE NULL END)
  ON CONFLICT (set_id, solve_number, re_solve_attempt) DO UPDATE SET
    competitor1_time_ms = EXCLUDED.competitor1_time_ms,
    competitor1_penalty = EXCLUDED.competitor1_penalty,
    competitor1_adjusted_ms = EXCLUDED.competitor1_adjusted_ms,
    competitor2_time_ms = EXCLUDED.competitor2_time_ms,
    competitor2_penalty = EXCLUDED.competitor2_penalty,
    competitor2_adjusted_ms = EXCLUDED.competitor2_adjusted_ms,
    winner_id = EXCLUDED.winner_id,
    status = EXCLUDED.status,
    completed_at = EXCLUDED.completed_at
  RETURNING * INTO v_solve;

  -- If tied, return early
  IF v_solve.status = 'tied' THEN
    RETURN jsonb_build_object('success', true, 'status', 'tied', 'solve_id', v_solve.id);
  END IF;

  -- Advance set
  IF v_winner = v_match.competitor1_id THEN
    UPDATE tournament_match_sets SET competitor1_solve_wins = competitor1_solve_wins + 1
      WHERE id = p_set_id RETURNING * INTO v_set;
  ELSE
    UPDATE tournament_match_sets SET competitor2_solve_wins = competitor2_solve_wins + 1
      WHERE id = p_set_id RETURNING * INTO v_set;
  END IF;

  -- Check if set won (first to 3 solve wins)
  IF v_set.competitor1_solve_wins >= 3 OR v_set.competitor2_solve_wins >= 3 THEN
    UPDATE tournament_match_sets SET
      status = 'completed',
      winner_id = CASE WHEN v_set.competitor1_solve_wins >= 3 THEN v_match.competitor1_id ELSE v_match.competitor2_id END,
      completed_at = NOW()
    WHERE id = p_set_id RETURNING * INTO v_set;

    -- Determine match format
    SELECT match_format INTO v_match_format FROM tournaments WHERE id = p_tournament_id;
    v_req_sets := CASE WHEN v_match_format = 'bo3' THEN 2 ELSE 3 END;

    -- Advance match
    IF v_set.winner_id = v_match.competitor1_id THEN
      UPDATE tournament_matches SET competitor1_sets_won = competitor1_sets_won + 1
        WHERE id = p_match_id RETURNING * INTO v_match;
    ELSE
      UPDATE tournament_matches SET competitor2_sets_won = competitor2_sets_won + 1
        WHERE id = p_match_id RETURNING * INTO v_match;
    END IF;

    IF v_match.competitor1_sets_won >= v_req_sets OR v_match.competitor2_sets_won >= v_req_sets THEN
      -- Match won — advance bracket
      UPDATE tournament_matches SET
        status = 'completed',
        winner_id = CASE WHEN v_match.competitor1_sets_won >= v_req_sets THEN v_match.competitor1_id ELSE v_match.competitor2_id END,
        completed_at = NOW()
      WHERE id = p_match_id RETURNING * INTO v_match;

      -- Route winner
      IF v_match.next_match_id IS NOT NULL THEN
        UPDATE tournament_matches SET
          competitor1_id = COALESCE(competitor1_id, v_match.winner_id),
          competitor2_id = CASE WHEN competitor1_id IS NOT NULL AND competitor1_id != v_match.winner_id THEN
            COALESCE(competitor2_id, v_match.winner_id) ELSE competitor2_id END
        WHERE id = v_match.next_match_id;
      END IF;

      -- Route loser (double elim)
      IF v_match.bracket_type = 'winners' AND v_match.loser_next_match_id IS NOT NULL THEN
        DECLARE
          v_loser UUID;
        BEGIN
          v_loser := CASE WHEN v_match.winner_id = v_match.competitor1_id THEN v_match.competitor2_id ELSE v_match.competitor1_id END;
          IF v_loser IS NOT NULL THEN
            UPDATE tournament_matches SET
              competitor1_id = COALESCE(competitor1_id, v_loser)
            WHERE id = v_match.loser_next_match_id;
          END IF;
        END;
      END IF;

      -- Check if tournament complete
      IF v_match.next_match_id IS NULL AND v_match.bracket_type IN ('grand_final', 'reset_final') THEN
        UPDATE tournaments SET status = 'completed', champion_id = v_match.winner_id
        WHERE id = p_tournament_id;
      ELSIF v_match.bracket_type = 'grand_final' THEN
        -- Find WBF champion (competitor1 in grand_final comes from WBF)
        -- If LB champion (competitor2) won, create reset final
        DECLARE
          v_gf RECORD;
          v_tourn RECORD;
        BEGIN
          SELECT * INTO v_gf FROM tournament_matches WHERE id = p_match_id;
          -- In grand_final, competitor1 is WBF winner, competitor2 is LBF winner
          IF v_gf.winner_id = v_gf.competitor2_id THEN
            -- LB champion won — create reset final
            SELECT * INTO v_tourn FROM tournaments WHERE id = p_tournament_id;
            INSERT INTO tournament_matches
              (tournament_id, bracket_type, bracket_round, match_number,
               competitor1_id, competitor2_id, status)
            VALUES
              (p_tournament_id, 'reset_final', 1, 1,
               v_gf.competitor1_id, v_gf.competitor2_id, 'active')
            RETURNING id INTO v_match.id;
            -- Create first set for reset final
            INSERT INTO tournament_match_sets (match_id, set_number, status)
            VALUES (v_match.id, 1, 'active');
          END IF;
        END;
      END IF;
    ELSE
      -- Next set
      INSERT INTO tournament_match_sets (match_id, set_number, status)
      VALUES (p_match_id, v_set.set_number + 1, 'active');
    END IF;
  ELSE
    -- Next solve in same set
    INSERT INTO tournament_match_solves (set_id, solve_number, re_solve_attempt, status)
    VALUES (p_set_id, p_solve_number + 1, 0, 'active');
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'completed', 'solve_id', v_solve.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_tournament_solve FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_tournament_solve TO authenticated;

-- ============================================================
-- ADMIN RESOLVE TIE (audited override)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_resolve_tournament_tie(
  p_tournament_id UUID,
  p_solve_id UUID,
  p_winner_competitor_id UUID,
  p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_solve RECORD;
  v_match RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF NOT public.user_is_tournament_admin(p_tournament_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_solve FROM tournament_match_solves WHERE id = p_solve_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Solve not found'); END IF;
  IF v_solve.status != 'tied' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solve is not tied');
  END IF;

  SELECT * INTO v_match FROM tournament_matches
    WHERE id = (SELECT match_id FROM tournament_match_sets WHERE id = v_solve.set_id);
  IF v_match IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Match not found'); END IF;

  IF p_winner_competitor_id NOT IN (v_match.competitor1_id, v_match.competitor2_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Winner must be a competitor in this match');
  END IF;

  UPDATE tournament_match_solves SET
    winner_id = p_winner_competitor_id,
    status = 'completed',
    completed_at = NOW()
  WHERE id = p_solve_id;

  INSERT INTO tournament_audit_log (tournament_id, action, actor_id, target_type, target_id, reason, metadata)
  VALUES (p_tournament_id, 'admin_resolve_tie', auth.uid(), 'solve', p_solve_id,
          COALESCE(NULLIF(p_reason, ''), 'Admin override'), jsonb_build_object('winner', p_winner_competitor_id));

  RETURN jsonb_build_object('success', true, 'status', 'completed');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_resolve_tournament_tie FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_resolve_tournament_tie TO authenticated;

-- ============================================================
-- GENERATE BRACKET (create match rows from bracket engine output)
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_tournament_bracket(
  p_tournament_id UUID,
  p_participants JSONB,  -- [{id: UUID, seed: INT, slot: INT, qual_avg: INT|null}]
  p_matches JSONB        -- [{bracket_type: TEXT, bracket_round: INT, match_number: INT, bracket_index: INT,
                          --   slot1_seed: INT|null, slot2_seed: INT|null, is_bye: BOOL,
                          --   next_match_idx: INT|null, loser_next_match_idx: INT|null}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant JSONB;
  v_match JSONB;
  v_participant_id UUID;
  v_match_ids UUID[];
  v_idx INT;
  v_pc_id UUID;
  v_competitor_id UUID;
  v_profile_name TEXT;
  v_comp_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF NOT public.user_is_tournament_admin(p_tournament_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;
  IF (SELECT status FROM tournaments WHERE id = p_tournament_id) NOT IN ('draft', 'ready') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tournament not in draft/ready state');
  END IF;

  -- Clear existing data
  DELETE FROM tournament_match_solves
    WHERE set_id IN (SELECT id FROM tournament_match_sets WHERE match_id IN
      (SELECT id FROM tournament_matches WHERE tournament_id = p_tournament_id));
  DELETE FROM tournament_match_sets
    WHERE match_id IN (SELECT id FROM tournament_matches WHERE tournament_id = p_tournament_id);
  DELETE FROM tournament_matches WHERE tournament_id = p_tournament_id;
  DELETE FROM tournament_participants WHERE tournament_id = p_tournament_id;

  -- Insert participants
  SELECT competition_id INTO v_comp_id FROM tournaments WHERE id = p_tournament_id;

  FOR v_participant IN SELECT * FROM jsonb_array_elements(p_participants)
  LOOP
    v_competitor_id := (v_participant->>'competitor_id')::UUID;
    SELECT p.display_name INTO v_profile_name
    FROM competitors c JOIN profiles p ON p.id = c.user_id
    WHERE c.id = v_competitor_id;

    INSERT INTO tournament_participants
      (tournament_id, competitor_id, display_name_snapshot, seed, qualifying_average, initial_slot)
    VALUES (
      p_tournament_id,
      v_competitor_id,
      COALESCE(v_profile_name, 'Unknown'),
      (v_participant->>'seed')::INT,
      (v_participant->>'qualifying_average')::INT,
      (v_participant->>'initial_slot')::INT
    ) RETURNING id INTO v_pc_id;
  END LOOP;

  -- Insert matches
  v_match_ids := ARRAY[]::UUID[];
  FOR v_match IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    WITH ins AS (
      INSERT INTO tournament_matches
        (tournament_id, bracket_type, bracket_round, match_number, bracket_index,
         competitor1_id, competitor2_id, auto_advance, status)
      VALUES (
        p_tournament_id,
        v_match->>'bracket_type',
        (v_match->>'bracket_round')::INT,
        (v_match->>'match_number')::INT,
        (v_match->>'bracket_index')::INT,
        NULL, NULL,
        (v_match->>'is_bye')::BOOLEAN,
        CASE WHEN (v_match->>'is_bye')::BOOLEAN THEN 'completed' ELSE 'pending' END
      ) RETURNING id
    ) SELECT id INTO v_pc_id FROM ins;

    v_match_ids := array_append(v_match_ids, v_pc_id);
  END LOOP;

  -- Update tournament metadata
  UPDATE tournaments SET
    bracket_locked = false,
    bracket_size = (SELECT COUNT(*) FROM tournament_matches WHERE tournament_id = p_tournament_id),
    status = 'ready'
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object('success', true, 'match_count', array_length(v_match_ids, 1));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_tournament_bracket FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_tournament_bracket TO authenticated;

-- ============================================================
-- UNDO LAST SOLVE (safe, uses completed_at ordering)
-- ============================================================
CREATE OR REPLACE FUNCTION public.undo_tournament_solve(
  p_tournament_id UUID,
  p_solve_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_solve RECORD;
  v_set RECORD;
  v_match RECORD;
  v_later_exists INT;
  v_downstream_exists INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF NOT public.user_is_tournament_admin(p_tournament_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- Lock and fetch solve
  SELECT s.* INTO v_solve FROM tournament_match_solves s
    JOIN tournament_match_sets ts ON ts.id = s.set_id
    JOIN tournament_matches tm ON tm.id = ts.match_id
    WHERE s.id = p_solve_id AND tm.tournament_id = p_tournament_id
    FOR UPDATE OF s;

  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Solve not found'); END IF;
  IF v_solve.status != 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solve is not completed');
  END IF;

  -- Check for later solves in same match or downstream matches
  SELECT COUNT(*) INTO v_later_exists
  FROM tournament_match_solves
  WHERE set_id IN (
    SELECT id FROM tournament_match_sets WHERE match_id IN (
      SELECT id FROM tournament_matches WHERE tournament_id = p_tournament_id
    )
  )
  AND completed_at IS NOT NULL
  AND completed_at > v_solve.completed_at;

  IF v_later_exists > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Cannot undo: a later solve depends on this result');
  END IF;

  -- Get set and match info
  SELECT * INTO v_set FROM tournament_match_sets WHERE id = v_solve.set_id;
  SELECT * INTO v_match FROM tournament_matches WHERE id = v_set.match_id;

  -- Undo solve
  UPDATE tournament_match_solves SET
    competitor1_time_ms = NULL, competitor1_penalty = 'none',
    competitor1_adjusted_ms = NULL,
    competitor2_time_ms = NULL, competitor2_penalty = 'none',
    competitor2_adjusted_ms = NULL,
    winner_id = NULL, status = 'pending', completed_at = NULL
  WHERE id = p_solve_id;

  -- Revert set
  IF v_solve.winner_id IS NOT NULL THEN
    IF v_solve.winner_id = v_match.competitor1_id THEN
      UPDATE tournament_match_sets SET competitor1_solve_wins = GREATEST(0, competitor1_solve_wins - 1)
      WHERE id = v_solve.set_id;
    ELSE
      UPDATE tournament_match_sets SET competitor2_solve_wins = GREATEST(0, competitor2_solve_wins - 1)
      WHERE id = v_solve.set_id;
    END IF;
  END IF;

  -- If set was completed by this solve, revert set completion
  IF v_set.status = 'completed' AND v_set.completed_at IS NOT NULL
     AND (v_set.completed_at = v_solve.completed_at OR v_set.completed_at > v_solve.completed_at - interval '1 second')
     AND v_set.completed_at < v_solve.completed_at + interval '1 second' THEN
    UPDATE tournament_match_sets SET
      status = 'active', winner_id = NULL, completed_at = NULL
    WHERE id = v_solve.set_id;

    -- Revert match set won
    IF v_set.winner_id IS NOT NULL THEN
      IF v_set.winner_id = v_match.competitor1_id THEN
        UPDATE tournament_matches SET competitor1_sets_won = GREATEST(0, competitor1_sets_won - 1)
        WHERE id = v_set.match_id;
      ELSE
        UPDATE tournament_matches SET competitor2_sets_won = GREATEST(0, competitor2_sets_won - 1)
        WHERE id = v_set.match_id;
      END IF;
    END IF;

    -- If match was completed by this set, revert match completion
    IF v_match.status = 'completed' AND v_match.completed_at IS NOT NULL
       AND v_match.completed_at > v_solve.completed_at - interval '1 second' THEN
      UPDATE tournament_matches SET
        status = 'active', winner_id = NULL, completed_at = NULL
      WHERE id = v_set.match_id;

      -- Revert tournament champion
      UPDATE tournaments SET status = 'active', champion_id = NULL
      WHERE id = p_tournament_id AND champion_id IS NOT NULL;
    END IF;
  END IF;

  INSERT INTO tournament_audit_log
    (tournament_id, action, actor_id, target_type, target_id, reason, metadata)
  VALUES (p_tournament_id, 'undo_solve', auth.uid(), 'solve', p_solve_id,
          'Undo last solve', jsonb_build_object('solve_number', v_solve.solve_number));

  RETURN jsonb_build_object('success', true, 'status', 'reverted');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_tournament_solve FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_tournament_solve TO authenticated;

-- ============================================================
-- RE-SOLVE TIED SOLVE (exactly one active retry)
-- ============================================================
CREATE OR REPLACE FUNCTION public.re_solve_tournament_tie(
  p_tournament_id UUID,
  p_solve_id UUID,
  p_scramble TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_solve RECORD;
  v_set RECORD;
  v_match RECORD;
  v_new_attempt INT;
  v_max_attempt INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF NOT public.user_is_tournament_admin(p_tournament_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_solve FROM tournament_match_solves WHERE id = p_solve_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Solve not found'); END IF;
  IF v_solve.status != 'tied' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solve is not tied');
  END IF;

  SELECT * INTO v_set FROM tournament_match_sets WHERE id = v_solve.set_id;
  SELECT * INTO v_match FROM tournament_matches WHERE id = v_set.match_id;

  -- Get current max attempt
  SELECT COALESCE(MAX(re_solve_attempt), -1) INTO v_max_attempt
  FROM tournament_match_solves
  WHERE set_id = v_solve.set_id AND solve_number = v_solve.solve_number;

  -- Prevent duplicate retries: if max_attempt > current, a newer exists
  IF v_max_attempt > v_solve.re_solve_attempt THEN
    RETURN jsonb_build_object('success', false, 'error', 'A newer re-solve already exists for this position');
  END IF;

  v_new_attempt := v_max_attempt + 1;

  INSERT INTO tournament_match_solves
    (set_id, solve_number, re_solve_attempt, scramble, status)
  VALUES (v_solve.set_id, v_solve.solve_number, v_new_attempt, p_scramble, 'active')
  RETURNING id INTO v_solve.id;

  RETURN jsonb_build_object('success', true, 'solve_id', v_solve.id, 're_solve_attempt', v_new_attempt);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.re_solve_tournament_tie FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.re_solve_tournament_tie TO authenticated;

-- ============================================================
-- UNDO LAST SOLVE (safe, uses completed_at ordering)
-- ============================================================
CREATE OR REPLACE FUNCTION public.undo_tournament_solve(
  p_tournament_id UUID,
  p_solve_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_solve RECORD;
  v_set RECORD;
  v_match RECORD;
  v_later_exists INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF NOT public.user_is_tournament_admin(p_tournament_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT s.* INTO v_solve FROM tournament_match_solves s
    JOIN tournament_match_sets ts ON ts.id = s.set_id
    JOIN tournament_matches tm ON tm.id = ts.match_id
    WHERE s.id = p_solve_id AND tm.tournament_id = p_tournament_id
    FOR UPDATE OF s;

  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Solve not found'); END IF;
  IF v_solve.status != 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solve is not completed');
  END IF;

  SELECT COUNT(*) INTO v_later_exists
  FROM tournament_match_solves
  WHERE set_id IN (
    SELECT id FROM tournament_match_sets WHERE match_id IN (
      SELECT id FROM tournament_matches WHERE tournament_id = p_tournament_id
    )
  )
  AND completed_at IS NOT NULL
  AND completed_at > v_solve.completed_at;

  IF v_later_exists > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Cannot undo: a later solve depends on this result');
  END IF;

  SELECT * INTO v_set FROM tournament_match_sets WHERE id = v_solve.set_id;
  SELECT * INTO v_match FROM tournament_matches WHERE id = v_set.match_id;

  UPDATE tournament_match_solves SET
    competitor1_time_ms = NULL, competitor1_penalty = 'none',
    competitor1_adjusted_ms = NULL,
    competitor2_time_ms = NULL, competitor2_penalty = 'none',
    competitor2_adjusted_ms = NULL,
    winner_id = NULL, status = 'pending', completed_at = NULL
  WHERE id = p_solve_id;

  IF v_solve.winner_id IS NOT NULL THEN
    IF v_solve.winner_id = v_match.competitor1_id THEN
      UPDATE tournament_match_sets SET competitor1_solve_wins = GREATEST(0, competitor1_solve_wins - 1)
      WHERE id = v_solve.set_id;
    ELSE
      UPDATE tournament_match_sets SET competitor2_solve_wins = GREATEST(0, competitor2_solve_wins - 1)
      WHERE id = v_solve.set_id;
    END IF;
  END IF;

  INSERT INTO tournament_audit_log
    (tournament_id, action, actor_id, target_type, target_id, reason, metadata)
  VALUES (p_tournament_id, 'undo_solve', auth.uid(), 'solve', p_solve_id,
          'Undo last solve', jsonb_build_object('solve_number', v_solve.solve_number));

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_tournament_solve FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_tournament_solve TO authenticated;

-- ============================================================
-- RE-SOLVE TIE
-- ============================================================
CREATE OR REPLACE FUNCTION public.re_solve_tournament_tie(
  p_tournament_id UUID,
  p_solve_id UUID,
  p_scramble TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_solve RECORD;
  v_set RECORD;
  v_match RECORD;
  v_new_attempt INT;
  v_max_attempt INT;
  v_new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF NOT public.user_is_tournament_admin(p_tournament_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_solve FROM tournament_match_solves WHERE id = p_solve_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Solve not found'); END IF;
  IF v_solve.status != 'tied' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solve is not tied');
  END IF;

  SELECT COALESCE(MAX(re_solve_attempt), -1) INTO v_max_attempt
  FROM tournament_match_solves
  WHERE set_id = v_solve.set_id AND solve_number = v_solve.solve_number;

  IF v_max_attempt > v_solve.re_solve_attempt THEN
    RETURN jsonb_build_object('success', false, 'error', 'A newer re-solve already exists');
  END IF;

  v_new_attempt := v_max_attempt + 1;

  INSERT INTO tournament_match_solves
    (set_id, solve_number, re_solve_attempt, scramble, status)
  VALUES (v_solve.set_id, v_solve.solve_number, v_new_attempt, p_scramble, 'active')
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'solve_id', v_new_id,
    're_solve_attempt', v_new_attempt, 'scramble', p_scramble);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.re_solve_tournament_tie FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.re_solve_tournament_tie TO authenticated;
