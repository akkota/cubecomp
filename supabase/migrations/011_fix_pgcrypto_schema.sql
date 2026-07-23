-- 011_fix_pgcrypto_schema.sql
-- Supabase installs pgcrypto in the `extensions` schema.
-- SECURITY DEFINER RPCs with search_path = public cannot see gen_salt/crypt.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.configure_competition_visibility(
  p_competition_id UUID,
  p_visibility TEXT,
  p_password TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
    VALUES (p_competition_id, extensions.crypt(trim(p_password), extensions.gen_salt('bf')), NOW())
    ON CONFLICT (competition_id) DO UPDATE
      SET password_hash = extensions.crypt(trim(p_password), extensions.gen_salt('bf')),
          updated_at = NOW();
  END IF;

  UPDATE competitions SET visibility = 'private', updated_at = NOW() WHERE id = p_competition_id;

  RETURN jsonb_build_object('success', true, 'visibility', 'private');
END;
$$;

CREATE OR REPLACE FUNCTION public.unlock_private_competition(
  p_competition_id UUID,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

  IF stored_hash <> extensions.crypt(trim(p_password), stored_hash) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Incorrect competition password');
  END IF;

  INSERT INTO competition_access (competition_id, user_id)
  VALUES (p_competition_id, auth.uid())
  ON CONFLICT (competition_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'unlocked', true);
END;
$$;
