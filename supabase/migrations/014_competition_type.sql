-- 014_competition_type.sql
-- Add competition_type to distinguish Standard vs Head-to-Head competitions.

ALTER TABLE public.competitions
ADD COLUMN IF NOT EXISTS competition_type TEXT NOT NULL DEFAULT 'standard'
  CHECK (competition_type IN ('standard', 'head_to_head'));

COMMENT ON COLUMN public.competitions.competition_type IS
  'standard = multi-round WCA-format competition; head_to_head = bracket tournament';
