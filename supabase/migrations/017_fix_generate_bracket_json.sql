-- Fix generate_tournament_bracket:
-- 1) Accept JSON arrays (and unwrap accidental JSON-string scalars)
-- 2) Place participants into matches by seed so the bracket isn't empty

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
  v_pc_id UUID;
  v_competitor_id UUID;
  v_profile_name TEXT;
  v_comp_id UUID;
  v_c1 UUID;
  v_c2 UUID;
  v_slot1 INT;
  v_slot2 INT;
  v_is_bye BOOLEAN;
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

  DELETE FROM tournament_match_solves
    WHERE set_id IN (SELECT id FROM tournament_match_sets WHERE match_id IN
      (SELECT id FROM tournament_matches WHERE tournament_id = p_tournament_id));
  DELETE FROM tournament_match_sets
    WHERE match_id IN (SELECT id FROM tournament_matches WHERE tournament_id = p_tournament_id);
  DELETE FROM tournament_matches WHERE tournament_id = p_tournament_id;
  DELETE FROM tournament_participants WHERE tournament_id = p_tournament_id;

  SELECT competition_id INTO v_comp_id FROM tournaments WHERE id = p_tournament_id;

  FOR v_participant IN SELECT * FROM jsonb_array_elements(v_participants)
  LOOP
    v_competitor_id := (v_participant->>'competitor_id')::UUID;
    SELECT p.display_name INTO v_profile_name
    FROM competitors c JOIN profiles p ON p.id = c.user_id
    WHERE c.id = v_competitor_id AND c.competition_id = v_comp_id;

    INSERT INTO tournament_participants
      (tournament_id, competitor_id, display_name_snapshot, seed, qualifying_average, initial_slot)
    VALUES (
      p_tournament_id,
      v_competitor_id,
      COALESCE(v_profile_name, 'Unknown'),
      (v_participant->>'seed')::INT,
      (v_participant->>'qualifying_average')::INT,
      (v_participant->>'initial_slot')::INT
    );
  END LOOP;

  v_match_ids := ARRAY[]::UUID[];
  FOR v_match IN SELECT * FROM jsonb_array_elements(v_matches)
  LOOP
    v_slot1 := NULLIF(v_match->>'slot1_seed', '')::INT;
    v_slot2 := NULLIF(v_match->>'slot2_seed', '')::INT;
    v_is_bye := COALESCE((v_match->>'is_bye')::BOOLEAN, false);

    SELECT id INTO v_c1 FROM tournament_participants
      WHERE tournament_id = p_tournament_id AND seed = v_slot1;
    SELECT id INTO v_c2 FROM tournament_participants
      WHERE tournament_id = p_tournament_id AND seed = v_slot2;

    WITH ins AS (
      INSERT INTO tournament_matches
        (tournament_id, bracket_type, bracket_round, match_number, bracket_index,
         competitor1_id, competitor2_id, auto_advance, status, winner_id)
      VALUES (
        p_tournament_id,
        v_match->>'bracket_type',
        (v_match->>'bracket_round')::INT,
        (v_match->>'match_number')::INT,
        (v_match->>'bracket_index')::INT,
        v_c1,
        v_c2,
        v_is_bye,
        CASE WHEN v_is_bye THEN 'completed' ELSE 'pending' END,
        CASE
          WHEN v_is_bye AND v_c1 IS NOT NULL AND v_c2 IS NULL THEN v_c1
          WHEN v_is_bye AND v_c2 IS NOT NULL AND v_c1 IS NULL THEN v_c2
          ELSE NULL
        END
      ) RETURNING id
    ) SELECT id INTO v_pc_id FROM ins;

    v_match_ids := array_append(v_match_ids, v_pc_id);
  END LOOP;

  UPDATE tournaments SET
    bracket_locked = false,
    bracket_size = (SELECT COUNT(*) FROM tournament_matches WHERE tournament_id = p_tournament_id),
    competitor_count = (SELECT COUNT(*) FROM tournament_participants WHERE tournament_id = p_tournament_id),
    status = 'ready'
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object('success', true, 'match_count', COALESCE(array_length(v_match_ids, 1), 0));
END;
$$;
