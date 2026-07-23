-- 009_private_competitions.sql
-- Public/private competitions with hashed passwords, unlock tracking, and RLS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- COMPETITIONS: visibility (safe default = public)
-- ============================================================
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private'));

COMMENT ON COLUMN competitions.visibility IS
  'public = anyone can register; private = password unlock required before registration';

-- ============================================================
-- COMPETITION SECRETS (password hashes — never exposed via API)
-- ============================================================
CREATE TABLE IF NOT EXISTS competition_secrets (
  competition_id UUID PRIMARY KEY REFERENCES competitions(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE competition_secrets ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only SECURITY DEFINER functions may access this table.
REVOKE ALL ON TABLE competition_secrets FROM anon, authenticated;
GRANT ALL ON TABLE competition_secrets TO service_role;

-- ============================================================
-- COMPETITION ACCESS (remembered unlocks after password verify)
-- ============================================================
CREATE TABLE IF NOT EXISTS competition_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (competition_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_competition_access_competition ON competition_access(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_access_user ON competition_access(user_id);

ALTER TABLE competition_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own competition access" ON competition_access;
CREATE POLICY "Users can view own competition access" ON competition_access
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view competition access" ON competition_access;
CREATE POLICY "Admins can view competition access" ON competition_access
  FOR SELECT USING (public.is_competition_admin(competition_id));

-- No client INSERT/UPDATE/DELETE — unlock only via SECURITY DEFINER function.

-- ============================================================
-- HELPERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_has_competition_unlock(comp_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.is_competition_admin(comp_id) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM competition_access
    WHERE competition_id = comp_id AND user_id = auth.uid()
  );
END;
$$;

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

  IF public.is_competition_admin(comp_id) THEN
    RETURN TRUE;
  END IF;

  SELECT visibility INTO vis FROM competitions WHERE id = comp_id;
  IF vis IS NULL THEN
    RETURN FALSE;
  END IF;

  IF vis = 'public' THEN
    RETURN TRUE;
  END IF;

  -- Private: must have unlocked with password
  RETURN public.user_has_competition_unlock(comp_id);
END;
$$;

-- ============================================================
-- RPC: configure visibility + optional password (creator/admin)
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

  IF p_visibility = 'public' THEN
    UPDATE competitions SET visibility = 'public', updated_at = NOW() WHERE id = p_competition_id;
    DELETE FROM competition_secrets WHERE competition_id = p_competition_id;
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
  END IF;

  UPDATE competitions SET visibility = 'private', updated_at = NOW() WHERE id = p_competition_id;

  RETURN jsonb_build_object('success', true, 'visibility', 'private');
END;
$$;

-- ============================================================
-- RPC: unlock private competition with password
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

  IF vis = 'public' THEN
    INSERT INTO competition_access (competition_id, user_id)
    VALUES (p_competition_id, auth.uid())
    ON CONFLICT (competition_id, user_id) DO NOTHING;
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
-- RPC: register for competition (enforces private unlock)
-- ============================================================
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
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT visibility INTO vis FROM competitions WHERE id = p_competition_id;
  IF vis IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Competition not found');
  END IF;

  -- Already registered?
  IF EXISTS (
    SELECT 1 FROM competitors
    WHERE competition_id = p_competition_id AND user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already registered for this competition');
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

GRANT EXECUTE ON FUNCTION public.user_has_competition_unlock(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.user_can_register_for_competition(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.configure_competition_visibility(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_private_competition(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_for_competition(UUID, TEXT) TO authenticated;

-- ============================================================
-- RLS: competitors insert must respect private unlock
-- ============================================================
DROP POLICY IF EXISTS "Users can register for competitions" ON competitors;
CREATE POLICY "Users can register for competitions" ON competitors
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.user_can_register_for_competition(competition_id)
  );

-- ============================================================
-- Round access: admins always; registration still required to compete
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_can_access_round(check_round_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  round_num INT;
  comp_event_id UUID;
  comp_id UUID;
  competitor_id UUID;
BEGIN
  SELECT r.round_number, r.competition_event_id, ce.competition_id
  INTO round_num, comp_event_id, comp_id
  FROM rounds r
  JOIN competition_events ce ON ce.id = r.competition_event_id
  WHERE r.id = check_round_id;

  IF round_num IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Creator / competition admins always have access
  IF public.is_competition_admin(comp_id) THEN
    RETURN TRUE;
  END IF;

  SELECT comp.id INTO competitor_id
  FROM competitors comp
  WHERE comp.competition_id = comp_id AND comp.user_id = auth.uid()
  LIMIT 1;

  -- Password unlock alone is not enough — must be registered
  IF competitor_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF round_num = 1 THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM round_participants rp
    WHERE rp.round_id = check_round_id AND rp.competitor_id = competitor_id
  );
END;
$$;

-- ============================================================
-- Fix scramble SELECT: restore registration gating (007 was too open).
-- Public spectator comps may still expose active/completed scrambles.
-- Private comps never expose scrambles without registration/admin.
-- ============================================================
DROP POLICY IF EXISTS "Scrambles visible to competitors" ON scrambles;
DROP POLICY IF EXISTS "Scrambles visible to eligible competitors" ON scrambles;
DROP POLICY IF EXISTS "Scrambles visible to competitors and admins" ON scrambles;

CREATE POLICY "Scrambles visible to eligible users" ON scrambles
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
          AND r.status IN ('active', 'completed')
          AND public.user_can_access_round(scrambles.round_id)
      )
    )
    OR (
      EXISTS (
        SELECT 1 FROM rounds r
        JOIN competition_events ce ON ce.id = r.competition_event_id
        JOIN competitions c ON c.id = ce.competition_id
        WHERE r.id = scrambles.round_id
          AND r.status IN ('active', 'completed')
          AND c.allow_spectators = TRUE
          AND c.visibility = 'public'
      )
    )
  );
