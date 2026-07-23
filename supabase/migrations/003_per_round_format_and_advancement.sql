-- 003_per_round_format_and_advancement.sql
-- Per-round format (mo3/ao5) and flexible advancement (fixed/percentage)

-- ============================================================
-- 1. ADD ROUND FORMAT
-- ============================================================
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS round_format TEXT;
-- Default to 'average' for existing rounds
UPDATE rounds SET round_format = 'average' WHERE round_format IS NULL;
-- Now enforce the constraint
ALTER TABLE rounds
  ALTER COLUMN round_format SET NOT NULL,
  ALTER COLUMN round_format SET DEFAULT 'average',
  ADD CONSTRAINT rounds_format_check CHECK (round_format IN ('average', 'mean'));

-- ============================================================
-- 2. ADD ADVANCEMENT MODE + VALUE
-- ============================================================
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS advancement_mode TEXT;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS advancement_value INTEGER;

-- Migrate existing advance_count to new schema:
-- If advance_count was set, default to 'fixed' mode using that value
UPDATE rounds
  SET advancement_mode = 'fixed', advancement_value = advance_count
  WHERE advance_count IS NOT NULL AND advancement_mode IS NULL;

-- Keep advance_count column for backward compat (can drop later)
-- With CHECK ensuring new schema is used going forward:
ALTER TABLE rounds
  ADD CONSTRAINT rounds_advancement_mode_check
  CHECK (advancement_mode IS NULL OR advancement_mode IN ('fixed', 'percentage'));

ALTER TABLE rounds
  ADD CONSTRAINT rounds_advancement_value_check
  CHECK (
    (advancement_mode IS NULL AND advancement_value IS NULL)
    OR
    (advancement_mode = 'fixed' AND advancement_value > 0)
    OR
    (advancement_mode = 'percentage' AND advancement_value > 0 AND advancement_value <= 100)
  );

-- ============================================================
-- 3. UPDATE user_can_access_round FUNCTION
--    (Migration 002 created this; ensure it handles round_format)
--    No change needed — it only checks round_number and participants
-- ============================================================

-- ============================================================
-- 4. LOOSEN SCRAMBLE + SOLVE CHECK CONSTRAINTS
--    Now supports 3 (mo3) or 5 (ao5) per round
-- ============================================================
-- scrambles already allows 1-5 ✓
-- solves already allows 1-5 ✓
