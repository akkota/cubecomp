-- Drafts are created before participants are attached; allow 0 until set_participants runs.
ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_competitor_count_check;
ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_competitor_count_check
  CHECK (competitor_count >= 0);
