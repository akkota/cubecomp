-- 023_snapshot_username_as_public_identity.sql
-- Public identity is username only. Email stays in auth.users for login.
-- Tournament display snapshots store @username instead of display_name / email.

UPDATE public.tournament_participants tp
SET display_name_snapshot = '@' || p.username
FROM public.competitors c
JOIN public.profiles p ON p.id = c.user_id
WHERE tp.competitor_id = c.id
  AND p.username IS NOT NULL
  AND btrim(p.username) <> '';

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

    SELECT CASE WHEN p.username IS NULL OR btrim(p.username) = '' THEN NULL ELSE '@' || p.username END INTO v_profile_name
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

