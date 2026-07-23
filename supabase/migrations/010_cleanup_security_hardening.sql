-- 010_cleanup_security_hardening.sql
-- Intent-preserving fixes from codebase audit:
-- 1) Competitors cannot self-verify round submissions
-- 2) Pin search_path on older SECURITY DEFINER helpers
-- 3) Private visibility requires a configured password secret

-- ============================================================
-- Round submissions: competitors may only manage video + pending
-- ============================================================
DROP POLICY IF EXISTS "Competitors can manage own submissions" ON round_submissions;
DROP POLICY IF EXISTS "Competitors can update own submissions" ON round_submissions;

CREATE POLICY "Competitors can insert own submissions" ON round_submissions
  FOR INSERT WITH CHECK (
    auth.uid() IN (SELECT user_id FROM competitors WHERE id = competitor_id)
    AND verification_status IN ('none', 'pending')
    AND verified_by IS NULL
    AND verified_at IS NULL
  );

CREATE POLICY "Competitors can update own submissions" ON round_submissions
  FOR UPDATE
  USING (
    auth.uid() IN (SELECT user_id FROM competitors WHERE id = competitor_id)
    AND verification_status IN ('none', 'pending')
  )
  WITH CHECK (
    auth.uid() IN (SELECT user_id FROM competitors WHERE id = competitor_id)
    AND verification_status IN ('none', 'pending')
    AND verified_by IS NULL
    AND verified_at IS NULL
  );

-- ============================================================
-- SECURITY DEFINER: pin search_path
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_competition_admin(comp_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    auth.uid() IN (SELECT created_by FROM competitions WHERE id = comp_id)
    OR
    auth.uid() IN (SELECT user_id FROM competition_admins WHERE competition_id = comp_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

-- ============================================================
-- Private visibility must have a password secret
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_private_competition_secret()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.visibility = 'private' THEN
    IF NOT EXISTS (
      SELECT 1 FROM competition_secrets WHERE competition_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Private competitions require a password. Use configure_competition_visibility.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_private_competition_secret ON competitions;
CREATE TRIGGER trg_enforce_private_competition_secret
  BEFORE UPDATE OF visibility ON competitions
  FOR EACH ROW
  WHEN (NEW.visibility = 'private' AND (OLD.visibility IS DISTINCT FROM NEW.visibility))
  EXECUTE FUNCTION public.enforce_private_competition_secret();
