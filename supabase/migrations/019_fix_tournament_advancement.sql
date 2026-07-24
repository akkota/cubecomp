-- 019_fix_tournament_advancement.sql
-- Fixes critical Head-to-Head tournament bugs:
--   * explicit destination slots for winner/loser routing (no more arrival-order guessing)
--   * bracket linking (next_match_id / loser_next_match_id were never written)
--   * bye propagation at generation time
--   * grand final / bracket reset handling (no duplicate reset_final inserts)
--   * idempotent solve/set creation and a real undo that unwinds downstream placement
--   * re-solve supersedes the tied attempt (and is actually executable)
-- Also folds in privacy/RLS fixes: unlock of public comps, access invalidation on
-- visibility/password change, admin-based round_participants policies, spectator solves.

-- ============================================================
-- SCHEMA
-- ============================================================
ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS next_match_slot INT;
ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS loser_next_match_slot INT;

ALTER TABLE public.tournament_matches
  DROP CONSTRAINT IF EXISTS tournament_matches_next_match_slot_check;
ALTER TABLE public.tournament_matches
  ADD CONSTRAINT tournament_matches_next_match_slot_check
  CHECK (next_match_slot IS NULL OR next_match_slot IN (1, 2));

ALTER TABLE public.tournament_matches
  DROP CONSTRAINT IF EXISTS tournament_matches_loser_next_match_slot_check;
ALTER TABLE public.tournament_matches
  ADD CONSTRAINT tournament_matches_loser_next_match_slot_check
  CHECK (loser_next_match_slot IS NULL OR loser_next_match_slot IN (1, 2));

COMMENT ON COLUMN public.tournament_matches.next_match_slot IS
  'Which competitor slot (1|2) of next_match_id receives this match winner';
COMMENT ON COLUMN public.tournament_matches.loser_next_match_slot IS
  'Which competitor slot (1|2) of loser_next_match_id receives this match loser';

-- 'superseded' marks a tied solve that was replaced by a re-solve attempt.
ALTER TABLE public.tournament_match_solves
  DROP CONSTRAINT IF EXISTS tournament_match_solves_status_check;
ALTER TABLE public.tournament_match_solves
  ADD CONSTRAINT tournament_match_solves_status_check
  CHECK (status IN ('pending', 'active', 'completed', 'tied', 'superseded'));

-- ============================================================
-- HELPER: place a competitor into an explicit slot of a match
-- ============================================================
CREATE OR REPLACE FUNCTION public.place_competitor_in_match(
  p_match_id UUID,
  p_competitor_id UUID,
  p_slot INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot INT;
  v_current UUID;
BEGIN
  IF p_match_id IS NULL OR p_competitor_id IS NULL THEN
    RETURN;
  END IF;

  v_slot := COALESCE(p_slot, 1);
  IF v_slot NOT IN (1, 2) THEN
    v_slot := 1;
  END IF;

  IF v_slot = 1 THEN
    SELECT competitor1_id INTO v_current
      FROM tournament_matches WHERE id = p_match_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    IF v_current IS NOT NULL AND v_current <> p_competitor_id THEN
      RAISE EXCEPTION 'Match % slot 1 is already occupied by another competitor', p_match_id;
    END IF;
    IF v_current IS NULL THEN
      UPDATE tournament_matches SET competitor1_id = p_competitor_id WHERE id = p_match_id;
    END IF;
  ELSE
    SELECT competitor2_id INTO v_current
      FROM tournament_matches WHERE id = p_match_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    IF v_current IS NOT NULL AND v_current <> p_competitor_id THEN
      RAISE EXCEPTION 'Match % slot 2 is already occupied by another competitor', p_match_id;
    END IF;
    IF v_current IS NULL THEN
      UPDATE tournament_matches SET competitor2_id = p_competitor_id WHERE id = p_match_id;
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- HELPER: propagate bye winners + auto-complete single-entrant matches
-- ============================================================
CREATE OR REPLACE FUNCTION public.propagate_tournament_byes(
  p_tournament_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guard INT := 0;
  v_changed BOOLEAN;
  v_bye RECORD;
  v_empty RECORD;
  v_occupant UUID;
BEGIN
  LOOP
    v_changed := false;
    v_guard := v_guard + 1;

    FOR v_bye IN
      SELECT m.id, m.winner_id, m.next_match_id, COALESCE(m.next_match_slot, 1) AS slot
      FROM tournament_matches m
      WHERE m.tournament_id = p_tournament_id
        AND m.auto_advance = true
        AND m.status = 'completed'
        AND m.winner_id IS NOT NULL
        AND m.next_match_id IS NOT NULL
      ORDER BY m.bracket_round, m.match_number
    LOOP
      SELECT CASE WHEN v_bye.slot = 2 THEN competitor2_id ELSE competitor1_id END
        INTO v_occupant
        FROM tournament_matches WHERE id = v_bye.next_match_id;

      IF v_occupant IS NULL THEN
        PERFORM public.place_competitor_in_match(v_bye.next_match_id, v_bye.winner_id, v_bye.slot);
        v_changed := true;
      END IF;
    END LOOP;

    FOR v_empty IN
      SELECT m.id
      FROM tournament_matches m
      WHERE m.tournament_id = p_tournament_id
        AND m.status = 'pending'
        AND m.competitor1_id IS NULL
        AND m.competitor2_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM tournament_matches src
          WHERE src.tournament_id = p_tournament_id
            AND src.status NOT IN ('completed', 'void')
            AND (src.next_match_id = m.id OR src.loser_next_match_id = m.id)
        )
    LOOP
      UPDATE tournament_matches SET status = 'void' WHERE id = v_empty.id;
      v_changed := true;
    END LOOP;

    FOR v_bye IN
      SELECT m.id,
             CASE WHEN m.competitor1_id IS NULL THEN 1 ELSE 2 END AS empty_slot,
             COALESCE(m.competitor1_id, m.competitor2_id) AS lone_id,
             m.next_match_id,
             m.next_match_slot
      FROM tournament_matches m
      WHERE m.tournament_id = p_tournament_id
        AND m.status = 'pending'
        AND m.auto_advance = false
        AND (
          (m.competitor1_id IS NOT NULL AND m.competitor2_id IS NULL)
          OR (m.competitor1_id IS NULL AND m.competitor2_id IS NOT NULL)
        )
    LOOP
      IF EXISTS (
        SELECT 1 FROM tournament_matches src
        WHERE src.tournament_id = p_tournament_id
          AND src.status <> 'void'
          AND (
            (src.next_match_id = v_bye.id AND COALESCE(src.next_match_slot, 1) = v_bye.empty_slot)
            OR (src.loser_next_match_id = v_bye.id AND COALESCE(src.loser_next_match_slot, 1) = v_bye.empty_slot)
          )
          AND (
            src.status <> 'completed'
            OR (
              src.winner_id IS NOT NULL
              AND (
                (
                  src.next_match_id = v_bye.id
                  AND CASE COALESCE(src.next_match_slot, 1)
                    WHEN 1 THEN (SELECT competitor1_id FROM tournament_matches WHERE id = v_bye.id) IS DISTINCT FROM src.winner_id
                    ELSE (SELECT competitor2_id FROM tournament_matches WHERE id = v_bye.id) IS DISTINCT FROM src.winner_id
                  END
                )
                OR (
                  src.loser_next_match_id = v_bye.id
                  AND CASE COALESCE(src.loser_next_match_slot, 1)
                    WHEN 1 THEN (SELECT competitor1_id FROM tournament_matches WHERE id = v_bye.id) IS DISTINCT FROM src.winner_id
                    ELSE (SELECT competitor2_id FROM tournament_matches WHERE id = v_bye.id) IS DISTINCT FROM src.winner_id
                  END
                )
              )
            )
          )
      ) THEN
        CONTINUE;
      END IF;

      UPDATE tournament_matches SET
        auto_advance = true,
        status = 'completed',
        winner_id = v_bye.lone_id,
        completed_at = NOW()
      WHERE id = v_bye.id;
      v_changed := true;
    END LOOP;

    EXIT WHEN NOT v_changed OR v_guard >= 64;
  END LOOP;
END;
$$;

-- ============================================================
-- HELPER: remove a competitor from a downstream match (undo path)
-- ============================================================
CREATE OR REPLACE FUNCTION public.clear_competitor_from_match(
  p_match_id UUID,
  p_competitor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_has_results BOOLEAN;
BEGIN
  IF p_match_id IS NULL OR p_competitor_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_match FROM tournament_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Never rip a competitor out of a match that has already produced results.
  SELECT EXISTS (
    SELECT 1
    FROM tournament_match_sets s
    JOIN tournament_match_solves sv ON sv.set_id = s.id
    WHERE s.match_id = p_match_id
      AND sv.status IN ('completed', 'tied', 'superseded')
  ) INTO v_has_results;

  IF v_has_results OR v_match.status = 'completed' THEN
    RETURN;
  END IF;

  UPDATE tournament_matches SET
    competitor1_id = CASE WHEN competitor1_id = p_competitor_id THEN NULL ELSE competitor1_id END,
    competitor2_id = CASE WHEN competitor2_id = p_competitor_id THEN NULL ELSE competitor2_id END,
    status = CASE WHEN status = 'active' THEN 'pending' ELSE status END
  WHERE id = p_match_id;

  DELETE FROM tournament_match_sets
    WHERE match_id = p_match_id AND status IN ('pending', 'active');
END;
$$;

-- ============================================================
-- HELPER: route winner/loser once a match is decided
-- ============================================================
CREATE OR REPLACE FUNCTION public.advance_after_match_win(
  p_tournament_id UUID,
  p_match_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_loser UUID;
  v_reset_id UUID;
BEGIN
  SELECT * INTO v_match FROM tournament_matches
    WHERE id = p_match_id AND tournament_id = p_tournament_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_match.status <> 'completed' OR v_match.winner_id IS NULL THEN
    RETURN;
  END IF;

  -- Grand final: WB champion wins outright, LB champion forces a bracket reset.
  IF v_match.bracket_type = 'grand_final' THEN
    IF v_match.competitor1_id IS NOT NULL AND v_match.winner_id = v_match.competitor1_id THEN
      UPDATE tournaments
        SET status = 'completed', champion_id = v_match.winner_id
        WHERE id = p_tournament_id;
      RETURN;
    END IF;

    SELECT id INTO v_reset_id FROM tournament_matches
      WHERE tournament_id = p_tournament_id AND bracket_type = 'reset_final'
      ORDER BY bracket_round, match_number
      LIMIT 1
      FOR UPDATE;

    IF v_reset_id IS NULL THEN
      INSERT INTO tournament_matches
        (tournament_id, bracket_type, bracket_round, match_number,
         competitor1_id, competitor2_id, status)
      VALUES
        (p_tournament_id, 'reset_final', 1, 1,
         v_match.competitor1_id, v_match.competitor2_id, 'active')
      ON CONFLICT (tournament_id, bracket_type, bracket_round, match_number) DO NOTHING
      RETURNING id INTO v_reset_id;

      IF v_reset_id IS NULL THEN
        SELECT id INTO v_reset_id FROM tournament_matches
          WHERE tournament_id = p_tournament_id AND bracket_type = 'reset_final'
          ORDER BY bracket_round, match_number
          LIMIT 1;
      END IF;
    ELSE
      UPDATE tournament_matches SET
        competitor1_id = v_match.competitor1_id,
        competitor2_id = v_match.competitor2_id,
        status = 'active'
      WHERE id = v_reset_id;
    END IF;

    IF v_reset_id IS NOT NULL THEN
      INSERT INTO tournament_match_sets (match_id, set_number, status)
      VALUES (v_reset_id, 1, 'active')
      ON CONFLICT (match_id, set_number) DO NOTHING;
    END IF;

    RETURN;
  END IF;

  IF v_match.bracket_type = 'reset_final' OR v_match.next_match_id IS NULL THEN
    UPDATE tournaments
      SET status = 'completed', champion_id = v_match.winner_id
      WHERE id = p_tournament_id;
  ELSE
    PERFORM public.place_competitor_in_match(
      v_match.next_match_id,
      v_match.winner_id,
      COALESCE(v_match.next_match_slot, 1)
    );
  END IF;

  -- Double elimination: losers drop into the losers bracket.
  IF v_match.bracket_type = 'winners' AND v_match.loser_next_match_id IS NOT NULL THEN
    v_loser := CASE
      WHEN v_match.winner_id = v_match.competitor1_id THEN v_match.competitor2_id
      ELSE v_match.competitor1_id
    END;
    IF v_loser IS NOT NULL THEN
      PERFORM public.place_competitor_in_match(
        v_match.loser_next_match_id,
        v_loser,
        COALESCE(v_match.loser_next_match_slot, 1)
      );
    END IF;
  END IF;

  -- After placement, auto-complete any single-entrant matches with no remaining feeders
  -- (losers-bracket byes created by winners-bracket byes).
  PERFORM public.propagate_tournament_byes(p_tournament_id);
END;
$$;

-- ============================================================
-- HELPER: apply a decisive solve to set/match/bracket state
-- Shared by submit_tournament_solve and admin_resolve_tournament_tie.
-- ============================================================
CREATE OR REPLACE FUNCTION public.advance_after_solve_win(
  p_tournament_id UUID,
  p_set_id UUID,
  p_solve_number INT,
  p_winner_id UUID,
  p_next_scramble TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set RECORD;
  v_match RECORD;
  v_match_format TEXT;
  v_req_sets INT;
  v_set_completed BOOLEAN := false;
  v_match_completed BOOLEAN := false;
BEGIN
  SELECT * INTO v_set FROM tournament_match_sets WHERE id = p_set_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set not found');
  END IF;

  SELECT * INTO v_match FROM tournament_matches WHERE id = v_set.match_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match not found');
  END IF;
  IF v_match.tournament_id <> p_tournament_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set does not belong to tournament');
  END IF;

  IF p_winner_id = v_match.competitor1_id THEN
    UPDATE tournament_match_sets
      SET competitor1_solve_wins = competitor1_solve_wins + 1
      WHERE id = p_set_id RETURNING * INTO v_set;
  ELSIF p_winner_id = v_match.competitor2_id THEN
    UPDATE tournament_match_sets
      SET competitor2_solve_wins = competitor2_solve_wins + 1
      WHERE id = p_set_id RETURNING * INTO v_set;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Winner is not a competitor in this match');
  END IF;

  -- Set is first to 3 solve wins
  IF v_set.competitor1_solve_wins >= 3 OR v_set.competitor2_solve_wins >= 3 THEN
    v_set_completed := true;

    UPDATE tournament_match_sets SET
      status = 'completed',
      winner_id = CASE WHEN v_set.competitor1_solve_wins >= 3
                       THEN v_match.competitor1_id ELSE v_match.competitor2_id END,
      completed_at = NOW()
    WHERE id = p_set_id RETURNING * INTO v_set;

    SELECT match_format INTO v_match_format FROM tournaments WHERE id = p_tournament_id;
    v_req_sets := CASE WHEN v_match_format = 'bo3' THEN 2 ELSE 3 END;

    IF v_set.winner_id = v_match.competitor1_id THEN
      UPDATE tournament_matches
        SET competitor1_sets_won = competitor1_sets_won + 1
        WHERE id = v_match.id RETURNING * INTO v_match;
    ELSE
      UPDATE tournament_matches
        SET competitor2_sets_won = competitor2_sets_won + 1
        WHERE id = v_match.id RETURNING * INTO v_match;
    END IF;

    IF v_match.competitor1_sets_won >= v_req_sets OR v_match.competitor2_sets_won >= v_req_sets THEN
      v_match_completed := true;

      UPDATE tournament_matches SET
        status = 'completed',
        winner_id = CASE WHEN v_match.competitor1_sets_won >= v_req_sets
                         THEN v_match.competitor1_id ELSE v_match.competitor2_id END,
        completed_at = NOW()
      WHERE id = v_match.id RETURNING * INTO v_match;

      PERFORM public.advance_after_match_win(p_tournament_id, v_match.id);
    ELSE
      INSERT INTO tournament_match_sets (match_id, set_number, status)
      VALUES (v_match.id, v_set.set_number + 1, 'active')
      ON CONFLICT (match_id, set_number) DO NOTHING;
    END IF;
  ELSE
    INSERT INTO tournament_match_solves
      (set_id, solve_number, re_solve_attempt, scramble, status)
    VALUES (p_set_id, p_solve_number + 1, 0, p_next_scramble, 'active')
    ON CONFLICT (set_id, solve_number, re_solve_attempt) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'set_completed', v_set_completed,
    'match_completed', v_match_completed,
    'tournament_completed',
      COALESCE((SELECT status = 'completed' FROM tournaments WHERE id = p_tournament_id), false)
  );
END;
$$;

-- ============================================================
-- GENERATE BRACKET (links matches, propagates byes, real bracket size)
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_tournament_bracket(
  p_tournament_id UUID,
  p_participants JSONB,
  p_matches JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participants JSONB;
  v_matches JSONB;
  v_participant JSONB;
  v_match JSONB;
  v_match_ids UUID[];
  v_new_id UUID;
  v_competitor_id UUID;
  v_profile_name TEXT;
  v_comp_id UUID;
  v_c1 UUID;
  v_c2 UUID;
  v_slot1 INT;
  v_slot2 INT;
  v_is_bye BOOLEAN;
  v_count INT;
  v_idx INT;
  v_total INT;
  v_next_idx INT;
  v_loser_idx INT;
  v_next_slot INT;
  v_loser_slot INT;
  v_bracket_size INT;
  v_changed BOOLEAN;
  v_guard INT;
  v_bye RECORD;
  v_occupant UUID;
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

  -- Unwrap JSON-encoded strings (e.g. client passed JSON.stringify(...))
  v_participants := CASE
    WHEN jsonb_typeof(p_participants) = 'string' THEN (p_participants #>> '{}')::jsonb
    ELSE p_participants
  END;
  v_matches := CASE
    WHEN jsonb_typeof(p_matches) = 'string' THEN (p_matches #>> '{}')::jsonb
    ELSE p_matches
  END;

  IF jsonb_typeof(v_participants) <> 'array' OR jsonb_typeof(v_matches) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid bracket payload');
  END IF;

  SELECT competition_id INTO v_comp_id FROM tournaments WHERE id = p_tournament_id;
  IF v_comp_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tournament not found');
  END IF;

  -- Validate every participant BEFORE destroying the existing bracket.
  FOR v_participant IN SELECT * FROM jsonb_array_elements(v_participants)
  LOOP
    v_competitor_id := NULLIF(v_participant->>'competitor_id', '')::UUID;
    IF v_competitor_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Participant is missing competitor_id');
    END IF;

    SELECT COUNT(*) INTO v_count FROM competitors c
      WHERE c.id = v_competitor_id AND c.competition_id = v_comp_id;
    IF v_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error',
        'Competitor is not registered for this competition');
    END IF;
  END LOOP;

  -- Clear existing bracket
  DELETE FROM tournament_match_solves
    WHERE set_id IN (SELECT id FROM tournament_match_sets WHERE match_id IN
      (SELECT id FROM tournament_matches WHERE tournament_id = p_tournament_id));
  DELETE FROM tournament_match_sets
    WHERE match_id IN (SELECT id FROM tournament_matches WHERE tournament_id = p_tournament_id);
  UPDATE tournaments SET champion_id = NULL WHERE id = p_tournament_id;
  DELETE FROM tournament_matches WHERE tournament_id = p_tournament_id;
  DELETE FROM tournament_participants WHERE tournament_id = p_tournament_id;

  -- Participants
  FOR v_participant IN SELECT * FROM jsonb_array_elements(v_participants)
  LOOP
    v_competitor_id := (v_participant->>'competitor_id')::UUID;

    SELECT p.display_name INTO v_profile_name
    FROM competitors c
    JOIN profiles p ON p.id = c.user_id
    WHERE c.id = v_competitor_id AND c.competition_id = v_comp_id;

    INSERT INTO tournament_participants
      (tournament_id, competitor_id, display_name_snapshot, seed, qualifying_average, initial_slot)
    VALUES (
      p_tournament_id,
      v_competitor_id,
      COALESCE(v_profile_name, 'Unknown'),
      NULLIF(v_participant->>'seed', '')::INT,
      NULLIF(v_participant->>'qualifying_average', '')::INT,
      NULLIF(v_participant->>'initial_slot', '')::INT
    );
  END LOOP;

  -- Matches (competitors placed by seed for round 1)
  v_match_ids := ARRAY[]::UUID[];
  FOR v_match IN SELECT * FROM jsonb_array_elements(v_matches)
  LOOP
    v_slot1 := NULLIF(v_match->>'slot1_seed', '')::INT;
    v_slot2 := NULLIF(v_match->>'slot2_seed', '')::INT;
    v_is_bye := COALESCE((v_match->>'is_bye')::BOOLEAN, false);

    v_c1 := NULL;
    v_c2 := NULL;
    IF v_slot1 IS NOT NULL THEN
      SELECT id INTO v_c1 FROM tournament_participants
        WHERE tournament_id = p_tournament_id AND seed = v_slot1;
    END IF;
    IF v_slot2 IS NOT NULL THEN
      SELECT id INTO v_c2 FROM tournament_participants
        WHERE tournament_id = p_tournament_id AND seed = v_slot2;
    END IF;

    INSERT INTO tournament_matches
      (tournament_id, bracket_type, bracket_round, match_number, bracket_index,
       competitor1_id, competitor2_id, auto_advance, status, winner_id, completed_at)
    VALUES (
      p_tournament_id,
      v_match->>'bracket_type',
      (v_match->>'bracket_round')::INT,
      (v_match->>'match_number')::INT,
      NULLIF(v_match->>'bracket_index', '')::INT,
      v_c1,
      v_c2,
      v_is_bye,
      CASE WHEN v_is_bye THEN 'completed' ELSE 'pending' END,
      CASE
        WHEN v_is_bye AND v_c1 IS NOT NULL AND v_c2 IS NULL THEN v_c1
        WHEN v_is_bye AND v_c2 IS NOT NULL AND v_c1 IS NULL THEN v_c2
        ELSE NULL
      END,
      CASE WHEN v_is_bye THEN NOW() ELSE NULL END
    ) RETURNING id INTO v_new_id;

    v_match_ids := array_append(v_match_ids, v_new_id);
  END LOOP;

  v_total := COALESCE(array_length(v_match_ids, 1), 0);

  -- Second pass: link winner/loser destinations now that every match row exists.
  v_idx := 0;
  FOR v_match IN SELECT * FROM jsonb_array_elements(v_matches)
  LOOP
    v_idx := v_idx + 1;

    v_next_idx := NULLIF(v_match->>'next_match_idx', '')::INT;
    v_loser_idx := NULLIF(v_match->>'loser_next_match_idx', '')::INT;
    v_next_slot := NULLIF(v_match->>'next_match_slot', '')::INT;
    v_loser_slot := NULLIF(v_match->>'loser_next_match_slot', '')::INT;

    IF v_next_idx IS NULL OR v_next_idx < 0 OR v_next_idx >= v_total THEN
      v_next_idx := NULL;
    END IF;
    IF v_loser_idx IS NULL OR v_loser_idx < 0 OR v_loser_idx >= v_total THEN
      v_loser_idx := NULL;
    END IF;
    IF v_next_slot IS NULL OR v_next_slot NOT IN (1, 2) THEN
      v_next_slot := NULL;
    END IF;
    IF v_loser_slot IS NULL OR v_loser_slot NOT IN (1, 2) THEN
      v_loser_slot := NULL;
    END IF;

    UPDATE tournament_matches SET
      next_match_id = CASE WHEN v_next_idx IS NULL THEN NULL ELSE v_match_ids[v_next_idx + 1] END,
      loser_next_match_id = CASE WHEN v_loser_idx IS NULL THEN NULL ELSE v_match_ids[v_loser_idx + 1] END,
      next_match_slot = CASE WHEN v_next_idx IS NULL THEN NULL ELSE v_next_slot END,
      loser_next_match_slot = CASE WHEN v_loser_idx IS NULL THEN NULL ELSE v_loser_slot END
    WHERE id = v_match_ids[v_idx];
  END LOOP;

  PERFORM public.propagate_tournament_byes(p_tournament_id);

  -- Bracket size is the next power of two above the participant count.
  SELECT CASE
    WHEN COUNT(*) = 0 THEN 2
    ELSE (2 ^ CEIL(ROUND(LOG(2::numeric, GREATEST(COUNT(*), 2)::numeric), 6)))::INT
  END INTO v_bracket_size
  FROM tournament_participants WHERE tournament_id = p_tournament_id;

  UPDATE tournaments SET
    bracket_locked = true,
    bracket_size = v_bracket_size,
    competitor_count = (SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = p_tournament_id),
    status = 'ready'
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'success', true,
    'match_count', v_total,
    'bracket_size', v_bracket_size
  );
END;
$$;

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
  v_new_attempt INT;
  v_exists INT;
  v_newer INT;
  v_advance JSONB;
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
  IF v_match.tournament_id <> p_tournament_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match does not belong to tournament');
  END IF;
  IF v_match.status <> 'active' THEN
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
  IF v_set.match_id <> p_match_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set does not belong to match');
  END IF;
  IF v_set.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set is not active');
  END IF;

  -- Resolve solve row
  IF p_solve_id IS NOT NULL THEN
    SELECT * INTO v_solve FROM tournament_match_solves WHERE id = p_solve_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Solve not found'); END IF;
    IF v_solve.set_id <> p_set_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Solve does not belong to set');
    END IF;
    IF v_solve.status = 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Solve already completed');
    END IF;
    IF v_solve.status = 'superseded' THEN
      RETURN jsonb_build_object('success', false, 'error',
        'This attempt was replaced by a re-solve');
    END IF;
    IF v_solve.status NOT IN ('pending', 'active', 'tied') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Solve not submittable');
    END IF;

    -- A tied attempt cannot be re-entered once a re-solve exists for the position.
    SELECT COUNT(*) INTO v_newer FROM tournament_match_solves
      WHERE set_id = p_set_id
        AND solve_number = v_solve.solve_number
        AND re_solve_attempt > v_solve.re_solve_attempt;
    IF v_newer > 0 THEN
      RETURN jsonb_build_object('success', false, 'error',
        'A newer re-solve attempt exists for this solve');
    END IF;

    p_solve_number := v_solve.solve_number;
    v_new_attempt := v_solve.re_solve_attempt;
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

  -- Compute adjusted times
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
    (SELECT scramble FROM tournament_match_solves
       WHERE set_id = p_set_id AND solve_number = p_solve_number
         AND re_solve_attempt = v_new_attempt),
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

  -- Tie: wait for admin resolution or a re-solve
  IF v_solve.status = 'tied' THEN
    RETURN jsonb_build_object('success', true, 'status', 'tied', 'solve_id', v_solve.id);
  END IF;

  -- The queued solve is created without a scramble: reusing the one the
  -- competitors just solved would hand them a known case. The client fills it in.
  v_advance := public.advance_after_solve_win(
    p_tournament_id, p_set_id, v_solve.solve_number, v_winner, NULL
  );

  IF COALESCE((v_advance->>'success')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_advance;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'completed',
    'solve_id', v_solve.id,
    'set_completed', v_advance->'set_completed',
    'match_completed', v_advance->'match_completed',
    'tournament_completed', v_advance->'tournament_completed'
  );
END;
$$;

-- ============================================================
-- ADMIN RESOLVE TIE (audited override, now advances the bracket)
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
  v_set RECORD;
  v_match RECORD;
  v_newer INT;
  v_advance JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF NOT public.user_is_tournament_admin(p_tournament_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_solve FROM tournament_match_solves WHERE id = p_solve_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Solve not found'); END IF;
  IF v_solve.status <> 'tied' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solve is not tied');
  END IF;

  SELECT * INTO v_set FROM tournament_match_sets WHERE id = v_solve.set_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Set not found'); END IF;

  SELECT * INTO v_match FROM tournament_matches WHERE id = v_set.match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Match not found'); END IF;
  IF v_match.tournament_id <> p_tournament_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solve does not belong to tournament');
  END IF;

  IF p_winner_competitor_id IS NULL
     OR p_winner_competitor_id NOT IN (v_match.competitor1_id, v_match.competitor2_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Winner must be a competitor in this match');
  END IF;

  -- A superseded position must be decided by the re-solve, not the original attempt.
  SELECT COUNT(*) INTO v_newer FROM tournament_match_solves
    WHERE set_id = v_solve.set_id
      AND solve_number = v_solve.solve_number
      AND re_solve_attempt > v_solve.re_solve_attempt;
  IF v_newer > 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'A newer re-solve attempt exists for this solve');
  END IF;

  UPDATE tournament_match_solves SET
    winner_id = p_winner_competitor_id,
    status = 'completed',
    completed_at = NOW()
  WHERE id = p_solve_id;

  v_advance := public.advance_after_solve_win(
    p_tournament_id, v_solve.set_id, v_solve.solve_number, p_winner_competitor_id, NULL
  );

  IF COALESCE((v_advance->>'success')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_advance;
  END IF;

  INSERT INTO tournament_audit_log
    (tournament_id, action, actor_id, target_type, target_id, reason, metadata)
  VALUES (p_tournament_id, 'admin_resolve_tie', auth.uid(), 'solve', p_solve_id,
          COALESCE(NULLIF(p_reason, ''), 'Admin override'),
          jsonb_build_object('winner', p_winner_competitor_id));

  RETURN jsonb_build_object(
    'success', true,
    'status', 'completed',
    'solve_id', p_solve_id,
    'set_completed', v_advance->'set_completed',
    'match_completed', v_advance->'match_completed',
    'tournament_completed', v_advance->'tournament_completed'
  );
END;
$$;

-- ============================================================
-- UNDO LAST SOLVE (unwinds set/match/bracket state)
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
  v_match_winner UUID;
  v_match_loser UUID;
  v_set_reverted BOOLEAN := false;
  v_match_reverted BOOLEAN := false;
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
  IF v_solve.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solve is not completed');
  END IF;

  -- Nothing may depend on this result
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

  SELECT * INTO v_set FROM tournament_match_sets WHERE id = v_solve.set_id FOR UPDATE;
  SELECT * INTO v_match FROM tournament_matches WHERE id = v_set.match_id FOR UPDATE;

  v_match_winner := v_match.winner_id;
  v_match_loser := CASE
    WHEN v_match_winner IS NULL THEN NULL
    WHEN v_match_winner = v_match.competitor1_id THEN v_match.competitor2_id
    ELSE v_match.competitor1_id
  END;

  -- Revert the solve itself
  UPDATE tournament_match_solves SET
    competitor1_time_ms = NULL, competitor1_penalty = 'none',
    competitor1_adjusted_ms = NULL,
    competitor2_time_ms = NULL, competitor2_penalty = 'none',
    competitor2_adjusted_ms = NULL,
    winner_id = NULL, status = 'pending', completed_at = NULL
  WHERE id = p_solve_id;

  -- Drop the not-yet-played solves that were queued behind it
  DELETE FROM tournament_match_solves
  WHERE set_id = v_solve.set_id
    AND solve_number > v_solve.solve_number
    AND status IN ('pending', 'active');

  -- Revert set solve wins
  IF v_solve.winner_id IS NOT NULL THEN
    IF v_solve.winner_id = v_match.competitor1_id THEN
      UPDATE tournament_match_sets SET competitor1_solve_wins = GREATEST(0, competitor1_solve_wins - 1)
      WHERE id = v_solve.set_id;
    ELSE
      UPDATE tournament_match_sets SET competitor2_solve_wins = GREATEST(0, competitor2_solve_wins - 1)
      WHERE id = v_solve.set_id;
    END IF;
  END IF;

  -- If this solve closed the set, reopen it
  IF v_set.status = 'completed' AND v_set.completed_at IS NOT NULL
     AND v_set.completed_at >= v_solve.completed_at - interval '1 second'
     AND v_set.completed_at <= v_solve.completed_at + interval '1 second' THEN
    v_set_reverted := true;

    UPDATE tournament_match_sets SET
      status = 'active', winner_id = NULL, completed_at = NULL
    WHERE id = v_solve.set_id;

    -- Remove sets that were only created because this set finished
    DELETE FROM tournament_match_sets later
    WHERE later.match_id = v_set.match_id
      AND later.set_number > v_set.set_number
      AND later.status IN ('pending', 'active')
      AND NOT EXISTS (
        SELECT 1 FROM tournament_match_solves sv
        WHERE sv.set_id = later.id
          AND sv.status IN ('completed', 'tied', 'superseded')
      );

    -- Revert match sets won
    IF v_set.winner_id IS NOT NULL THEN
      IF v_set.winner_id = v_match.competitor1_id THEN
        UPDATE tournament_matches SET competitor1_sets_won = GREATEST(0, competitor1_sets_won - 1)
        WHERE id = v_set.match_id;
      ELSE
        UPDATE tournament_matches SET competitor2_sets_won = GREATEST(0, competitor2_sets_won - 1)
        WHERE id = v_set.match_id;
      END IF;
    END IF;

    -- If this set closed the match, reopen it and pull the competitors back out
    -- of everywhere they were routed to.
    IF v_match.status = 'completed' AND v_match.completed_at IS NOT NULL
       AND v_match.completed_at > v_solve.completed_at - interval '1 second' THEN
      v_match_reverted := true;

      UPDATE tournament_matches SET
        status = 'active', winner_id = NULL, completed_at = NULL
      WHERE id = v_set.match_id;

      IF v_match_winner IS NOT NULL AND v_match.next_match_id IS NOT NULL THEN
        PERFORM public.clear_competitor_from_match(v_match.next_match_id, v_match_winner);
        -- A grand final also seeds the reset final with the losing finalist.
        IF v_match.bracket_type = 'grand_final' AND v_match_loser IS NOT NULL THEN
          PERFORM public.clear_competitor_from_match(v_match.next_match_id, v_match_loser);
        END IF;
      END IF;

      IF v_match.bracket_type = 'winners'
         AND v_match.loser_next_match_id IS NOT NULL
         AND v_match_loser IS NOT NULL THEN
        PERFORM public.clear_competitor_from_match(v_match.loser_next_match_id, v_match_loser);
      END IF;

      -- Revert tournament completion
      UPDATE tournaments SET status = 'active', champion_id = NULL
      WHERE id = p_tournament_id
        AND (champion_id IS NOT NULL OR status = 'completed');
    END IF;
  END IF;

  INSERT INTO tournament_audit_log
    (tournament_id, action, actor_id, target_type, target_id, reason, metadata)
  VALUES (p_tournament_id, 'undo_solve', auth.uid(), 'solve', p_solve_id,
          'Undo last solve',
          jsonb_build_object(
            'solve_number', v_solve.solve_number,
            'set_reverted', v_set_reverted,
            'match_reverted', v_match_reverted
          ));

  RETURN jsonb_build_object(
    'success', true,
    'status', 'reverted',
    'set_reverted', v_set_reverted,
    'match_reverted', v_match_reverted
  );
END;
$$;

-- ============================================================
-- RE-SOLVE TIED SOLVE (supersedes the tied attempt)
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
  IF v_solve.status <> 'tied' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solve is not tied');
  END IF;

  SELECT * INTO v_set FROM tournament_match_sets WHERE id = v_solve.set_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Set not found'); END IF;

  SELECT * INTO v_match FROM tournament_matches WHERE id = v_set.match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Match not found'); END IF;
  IF v_match.tournament_id <> p_tournament_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solve does not belong to tournament');
  END IF;

  SELECT COALESCE(MAX(re_solve_attempt), -1) INTO v_max_attempt
  FROM tournament_match_solves
  WHERE set_id = v_solve.set_id AND solve_number = v_solve.solve_number;

  IF v_max_attempt > v_solve.re_solve_attempt THEN
    RETURN jsonb_build_object('success', false, 'error',
      'A newer re-solve already exists for this position');
  END IF;

  v_new_attempt := v_max_attempt + 1;

  -- The tied attempt is retired so it can no longer be submitted or resolved.
  UPDATE tournament_match_solves SET status = 'superseded' WHERE id = p_solve_id;

  INSERT INTO tournament_match_solves
    (set_id, solve_number, re_solve_attempt, scramble, status)
  VALUES (v_solve.set_id, v_solve.solve_number, v_new_attempt, p_scramble, 'active')
  RETURNING id INTO v_new_id;

  INSERT INTO tournament_audit_log
    (tournament_id, action, actor_id, target_type, target_id, reason, metadata)
  VALUES (p_tournament_id, 're_solve_tie', auth.uid(), 'solve', p_solve_id,
          'Re-solve tied attempt',
          jsonb_build_object('new_solve_id', v_new_id, 're_solve_attempt', v_new_attempt));

  RETURN jsonb_build_object(
    'success', true,
    'solve_id', v_new_id,
    're_solve_attempt', v_new_attempt
  );
END;
$$;

-- ============================================================
-- PRIVACY: unlocking a public competition must not grant access rows
-- ============================================================
CREATE OR REPLACE FUNCTION public.unlock_private_competition(
  p_competition_id UUID,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vis TEXT;
  stored_hash TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT visibility INTO vis FROM competitions WHERE id = p_competition_id;
  IF vis IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competition not found');
  END IF;

  -- Public competitions need no unlock; recording one would survive a later
  -- switch to private and silently bypass the password.
  IF vis = 'public' THEN
    RETURN jsonb_build_object('success', true, 'unlocked', true);
  END IF;

  IF p_password IS NULL OR length(trim(p_password)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Password is required');
  END IF;

  SELECT password_hash INTO stored_hash
  FROM competition_secrets
  WHERE competition_id = p_competition_id;

  IF stored_hash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This private competition has no password configured');
  END IF;

  IF stored_hash <> crypt(trim(p_password), stored_hash) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Incorrect competition password');
  END IF;

  INSERT INTO competition_access (competition_id, user_id)
  VALUES (p_competition_id, auth.uid())
  ON CONFLICT (competition_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'unlocked', true);
END;
$$;

-- ============================================================
-- PRIVACY: changing visibility or password invalidates prior unlocks
-- ============================================================
CREATE OR REPLACE FUNCTION public.configure_competition_visibility(
  p_competition_id UUID,
  p_visibility TEXT,
  p_password TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_secret BOOLEAN;
  old_visibility TEXT;
  password_changed BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT public.is_competition_admin(p_competition_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only competition admins can change visibility');
  END IF;

  IF p_visibility NOT IN ('public', 'private') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Visibility must be public or private');
  END IF;

  SELECT visibility INTO old_visibility FROM competitions WHERE id = p_competition_id;
  IF old_visibility IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competition not found');
  END IF;

  IF p_visibility = 'public' THEN
    UPDATE competitions SET visibility = 'public', updated_at = NOW() WHERE id = p_competition_id;
    DELETE FROM competition_secrets WHERE competition_id = p_competition_id;
    DELETE FROM competition_access WHERE competition_id = p_competition_id;
    RETURN jsonb_build_object('success', true, 'visibility', 'public');
  END IF;

  -- private
  SELECT EXISTS (
    SELECT 1 FROM competition_secrets WHERE competition_id = p_competition_id
  ) INTO has_secret;

  IF (p_password IS NULL OR length(trim(p_password)) = 0) AND NOT has_secret THEN
    RETURN jsonb_build_object('success', false, 'error', 'A password is required for private competitions');
  END IF;

  IF p_password IS NOT NULL AND length(trim(p_password)) > 0 THEN
    IF length(trim(p_password)) < 4 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Password must be at least 4 characters');
    END IF;

    INSERT INTO competition_secrets (competition_id, password_hash, updated_at)
    VALUES (p_competition_id, crypt(trim(p_password), gen_salt('bf')), NOW())
    ON CONFLICT (competition_id) DO UPDATE
      SET password_hash = crypt(trim(p_password), gen_salt('bf')),
          updated_at = NOW();

    password_changed := true;
  END IF;

  UPDATE competitions SET visibility = 'private', updated_at = NOW() WHERE id = p_competition_id;

  -- A new password (or a fresh transition to private) revokes remembered unlocks.
  IF password_changed OR old_visibility <> 'private' THEN
    DELETE FROM competition_access WHERE competition_id = p_competition_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'visibility', 'private');
END;
$$;

-- ============================================================
-- RLS: round_participants managed by competition admins, not just the creator
-- ============================================================
DROP POLICY IF EXISTS "Creators can manage round participants" ON public.round_participants;
DROP POLICY IF EXISTS "Creators can delete round participants" ON public.round_participants;
DROP POLICY IF EXISTS "Admins can insert round participants" ON public.round_participants;
DROP POLICY IF EXISTS "Admins can delete round participants" ON public.round_participants;

CREATE POLICY "Admins can insert round participants" ON public.round_participants
  FOR INSERT WITH CHECK (
    public.is_competition_admin((
      SELECT ce.competition_id
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      WHERE r.id = round_participants.round_id
    ))
  );

CREATE POLICY "Admins can delete round participants" ON public.round_participants
  FOR DELETE USING (
    public.is_competition_admin((
      SELECT ce.competition_id
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      WHERE r.id = round_participants.round_id
    ))
  );

-- ============================================================
-- RLS: spectators may read solves of public spectator competitions
-- ============================================================
DROP POLICY IF EXISTS "Solves viewable for eligible users" ON public.solves;

CREATE POLICY "Solves viewable for eligible users" ON public.solves
  FOR SELECT USING (
    auth.uid() = solves.submitted_by
    OR public.is_competition_admin((
      SELECT ce.competition_id
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      WHERE r.id = solves.round_id
    ))
    OR (
      EXISTS (
        SELECT 1 FROM rounds r
        WHERE r.id = solves.round_id AND r.status IN ('active', 'completed')
      )
      AND public.user_can_access_round(solves.round_id)
    )
    OR (
      EXISTS (
        SELECT 1 FROM rounds r
        JOIN competition_events ce ON ce.id = r.competition_event_id
        JOIN competitions c ON c.id = ce.competition_id
        WHERE r.id = solves.round_id
          AND r.status IN ('active', 'completed')
          AND c.allow_spectators = TRUE
          AND c.visibility = 'public'
      )
    )
  );

-- ============================================================
-- PERMISSIONS
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.place_competitor_in_match(UUID, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_competitor_in_match(UUID, UUID, INT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.propagate_tournament_byes(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.propagate_tournament_byes(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.clear_competitor_from_match(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_competitor_from_match(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.advance_after_match_win(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_after_match_win(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.advance_after_solve_win(UUID, UUID, INT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_after_solve_win(UUID, UUID, INT, UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.generate_tournament_bracket(UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_tournament_bracket(UUID, JSONB, JSONB) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_tournament_solve(UUID, UUID, UUID, UUID, INT, INT, INT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_tournament_solve(UUID, UUID, UUID, UUID, INT, INT, INT, TEXT, INT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_resolve_tournament_tie(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_resolve_tournament_tie(UUID, UUID, UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.undo_tournament_solve(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_tournament_solve(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.re_solve_tournament_tie(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.re_solve_tournament_tie(UUID, UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.unlock_private_competition(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlock_private_competition(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.configure_competition_visibility(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_competition_visibility(UUID, TEXT, TEXT) TO authenticated;
