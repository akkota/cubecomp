-- 004_generate_scrambles_toggle.sql
-- Add competition-wide scramble generation toggle.
-- When false, only times are recorded; no scrambles are generated or displayed.

ALTER TABLE competitions
ADD COLUMN generate_scrambles BOOLEAN NOT NULL DEFAULT true;
