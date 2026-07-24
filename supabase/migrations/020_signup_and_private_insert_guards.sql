-- 020_signup_and_private_insert_guards.sql
-- - Signup no longer hard-fails on duplicate usernames
-- - Private visibility is enforced on INSERT as well as UPDATE

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base TEXT;
  v_username TEXT;
  v_display TEXT;
  v_suffix INT := 0;
BEGIN
  v_base := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'username'), ''), split_part(NEW.email, '@', 1));
  v_base := regexp_replace(lower(v_base), '[^a-z0-9_]+', '_', 'g');
  IF v_base IS NULL OR v_base = '' THEN
    v_base := 'user';
  END IF;
  v_display := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''), v_base);
  v_username := v_base;

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) LOOP
    v_suffix := v_suffix + 1;
    v_username := left(v_base, 20) || '_' || v_suffix::TEXT;
    IF v_suffix > 1000 THEN
      v_username := 'user_' || substr(replace(NEW.id::text, '-', ''), 1, 12);
      EXIT;
    END IF;
  END LOOP;

  INSERT INTO public.profiles (id, username, display_name)
  VALUES (NEW.id, v_username, v_display);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_private_competition_secret ON public.competitions;
CREATE TRIGGER trg_enforce_private_competition_secret
  BEFORE INSERT OR UPDATE OF visibility ON public.competitions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_private_competition_secret();
