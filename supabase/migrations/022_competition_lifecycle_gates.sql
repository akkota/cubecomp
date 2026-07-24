-- 022_competition_lifecycle_gates.sql
-- Enforce registration and scramble visibility from competition lifecycle
-- (stored status + optional starts_at/ends_at), not just the UI.

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

COMMENT ON COLUMN public.competitions.starts_at IS
  'Optional scheduled start. Used with status/rounds for display and access gates.';
COMMENT ON COLUMN public.competitions.ends_at IS
  'Optional hard end. When set and in the past, registration is closed and the competition is treated as completed.';

CREATE INDEX IF NOT EXISTS idx_competitions_ends_at ON public.competitions(ends_at)
  WHERE ends_at IS NOT NULL;

-- ============================================================
-- Effective status from stored status + dates + round/tournament state
-- ============================================================
CREATE OR REPLACE FUNCTION public.competition_effective_status(comp_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_type TEXT;
  v_starts TIMESTAMPTZ;
  v_ends TIMESTAMPTZ;
  v_has_rounds BOOLEAN;
  v_any_active BOOLEAN;
  v_all_completed BOOLEAN;
  v_any_completed BOOLEAN;
  v_t_active BOOLEAN;
  v_t_open BOOLEAN;
  v_t_completed BOOLEAN;
BEGIN
  SELECT status, competition_type, starts_at, ends_at
    INTO v_status, v_type, v_starts, v_ends
  FROM competitions WHERE id = comp_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN 'cancelled';
  END IF;

  IF v_ends IS NOT NULL AND v_ends <= NOW() THEN
    RETURN 'completed';
  END IF;

  IF v_status = 'completed' THEN
    RETURN 'completed';
  END IF;

  IF v_type = 'head_to_head' THEN
    SELECT
      EXISTS (SELECT 1 FROM tournaments t WHERE t.competition_id = comp_id AND t.status = 'active'),
      EXISTS (SELECT 1 FROM tournaments t WHERE t.competition_id = comp_id AND t.status IN ('draft', 'ready', 'active')),
      EXISTS (SELECT 1 FROM tournaments t WHERE t.competition_id = comp_id AND t.status = 'completed'
              AND NOT EXISTS (
                SELECT 1 FROM tournaments t2
                WHERE t2.competition_id = comp_id AND t2.status IN ('draft', 'ready', 'active')
              ))
    INTO v_t_active, v_t_open, v_t_completed;

    IF v_t_active THEN RETURN 'ongoing'; END IF;
    IF v_t_completed THEN RETURN 'completed'; END IF;
    IF v_starts IS NOT NULL AND v_starts <= NOW() AND (v_ends IS NULL OR v_ends > NOW()) THEN
      RETURN 'ongoing';
    END IF;
    RETURN 'upcoming';
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      WHERE ce.competition_id = comp_id
    ),
    EXISTS (
      SELECT 1 FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      WHERE ce.competition_id = comp_id AND r.status = 'active'
    ),
    EXISTS (
      SELECT 1 FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      WHERE ce.competition_id = comp_id
    ) AND NOT EXISTS (
      SELECT 1 FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      WHERE ce.competition_id = comp_id AND r.status <> 'completed'
    ),
    EXISTS (
      SELECT 1 FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      WHERE ce.competition_id = comp_id AND r.status = 'completed'
    )
  INTO v_has_rounds, v_any_active, v_all_completed, v_any_completed;

  IF v_any_active THEN RETURN 'ongoing'; END IF;
  IF v_has_rounds AND v_all_completed THEN RETURN 'completed'; END IF;
  IF v_any_completed THEN RETURN 'ongoing'; END IF;
  IF v_starts IS NOT NULL AND v_starts <= NOW() AND (v_ends IS NULL OR v_ends > NOW()) THEN
    RETURN 'ongoing';
  END IF;
  IF v_status = 'ongoing' THEN RETURN 'ongoing'; END IF;
  RETURN 'upcoming';
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_competition_status(comp_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eff TEXT;
  v_ends TIMESTAMPTZ;
BEGIN
  v_eff := public.competition_effective_status(comp_id);
  IF v_eff IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ends_at INTO v_ends FROM competitions WHERE id = comp_id;

  UPDATE competitions SET
    status = CASE
      WHEN v_eff = 'cancelled' THEN 'cancelled'
      WHEN v_eff = 'completed' THEN 'completed'
      WHEN v_eff = 'ongoing' THEN 'ongoing'
      ELSE 'upcoming'
    END,
    ends_at = CASE
      WHEN v_eff = 'completed' AND v_ends IS NULL THEN NOW()
      ELSE v_ends
    END,
    updated_at = NOW()
  WHERE id = comp_id;

  RETURN v_eff;
END;
$$;

CREATE OR REPLACE FUNCTION public.competition_registration_open(comp_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_ends TIMESTAMPTZ;
  v_type TEXT;
BEGIN
  SELECT status, ends_at, competition_type
    INTO v_status, v_ends, v_type
  FROM competitions WHERE id = comp_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_status IN ('completed', 'cancelled') THEN
    RETURN FALSE;
  END IF;

  IF v_ends IS NOT NULL AND v_ends <= NOW() THEN
    RETURN FALSE;
  END IF;

  -- Effective completion from rounds/tournaments even if status column is stale
  IF public.competition_effective_status(comp_id) IN ('completed', 'cancelled') THEN
    RETURN FALSE;
  END IF;

  IF v_type = 'head_to_head' AND EXISTS (
    SELECT 1 FROM tournaments t
    WHERE t.competition_id = comp_id
      AND t.status IN ('ready', 'active', 'completed')
  ) THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- Registration gate (RLS + RPC)
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_can_register_for_competition(comp_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vis TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT public.competition_registration_open(comp_id) THEN
    RETURN FALSE;
  END IF;

  -- Admins may still register while open (e.g. to compete), but not after close
  SELECT visibility INTO vis FROM competitions WHERE id = comp_id;
  IF vis IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.is_competition_admin(comp_id) THEN
    RETURN TRUE;
  END IF;

  IF vis = 'public' THEN
    RETURN TRUE;
  END IF;

  RETURN public.user_has_competition_unlock(comp_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_for_competition(
  p_competition_id UUID,
  p_password TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vis TEXT;
  unlock_result JSONB;
  v_eff TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT visibility INTO vis FROM competitions WHERE id = p_competition_id;
  IF vis IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competition not found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM competitors
    WHERE competition_id = p_competition_id AND user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already registered for this competition');
  END IF;

  -- Refresh cached status before gating (handles stale status vs ends_at/rounds)
  v_eff := public.refresh_competition_status(p_competition_id);

  IF NOT public.competition_registration_open(p_competition_id) THEN
    IF v_eff = 'cancelled' THEN
      RETURN jsonb_build_object('success', false, 'error', 'This competition has been cancelled');
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'Registration is closed for this competition');
  END IF;

  IF vis = 'private' AND NOT public.user_has_competition_unlock(p_competition_id) THEN
    unlock_result := public.unlock_private_competition(p_competition_id, p_password);
    IF (unlock_result->>'success')::boolean IS NOT TRUE THEN
      RETURN unlock_result;
    END IF;
  END IF;

  IF NOT public.user_can_register_for_competition(p_competition_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unlock this private competition with the password before registering');
  END IF;

  INSERT INTO competitors (competition_id, user_id)
  VALUES (p_competition_id, auth.uid());

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already registered for this competition');
END;
$$;

-- ============================================================
-- Scrambles: only while the round is active (not after completion).
-- Late registration must not unlock past scramble data.
-- Admins retain access for verification.
-- ============================================================
DROP POLICY IF EXISTS "Scrambles visible to eligible users" ON public.scrambles;

CREATE POLICY "Scrambles visible to eligible users" ON public.scrambles
  FOR SELECT USING (
    public.is_competition_admin(
      (SELECT ce.competition_id
       FROM rounds r
       JOIN competition_events ce ON ce.id = r.competition_event_id
       WHERE r.id = scrambles.round_id)
    )
    OR (
      EXISTS (
        SELECT 1 FROM rounds r
        WHERE r.id = scrambles.round_id
          AND r.status = 'active'
          AND public.user_can_access_round(scrambles.round_id)
      )
    )
    OR (
      EXISTS (
        SELECT 1 FROM rounds r
        JOIN competition_events ce ON ce.id = r.competition_event_id
        JOIN competitions c ON c.id = ce.competition_id
        WHERE r.id = scrambles.round_id
          AND r.status = 'active'
          AND c.allow_spectators = TRUE
          AND c.visibility = 'public'
          AND public.competition_effective_status(c.id) NOT IN ('completed', 'cancelled')
      )
    )
  );

REVOKE ALL ON FUNCTION public.competition_effective_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.competition_effective_status(UUID) TO authenticated, anon;

REVOKE ALL ON FUNCTION public.refresh_competition_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_competition_status(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.competition_registration_open(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.competition_registration_open(UUID) TO authenticated, anon;

GRANT EXECUTE ON FUNCTION public.user_can_register_for_competition(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.register_for_competition(UUID, TEXT) TO authenticated;
