-- 002_round_participants_and_rls.sql
-- Round-granularity access control, advancement tracking, and tighter RLS policies

-- ============================================================
-- ROUND PARTICIPANTS (who is eligible for each round)
-- ============================================================
CREATE TABLE round_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(round_id, competitor_id)
);

CREATE INDEX idx_round_participants_round ON round_participants(round_id);
CREATE INDEX idx_round_participants_competitor ON round_participants(competitor_id);

ALTER TABLE round_participants ENABLE ROW LEVEL SECURITY;

-- Everyone can view who advanced (transparency / leaderboard)
CREATE POLICY "Round participants viewable by everyone" ON round_participants
  FOR SELECT USING (true);

-- Creator can manage participants (insert/delete qualifiers)
CREATE POLICY "Creators can manage round participants" ON round_participants
  FOR INSERT WITH CHECK (
    auth.uid() IN (
      SELECT c.created_by
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = round_participants.round_id
    )
  );
CREATE POLICY "Creators can delete round participants" ON round_participants
  FOR DELETE USING (
    auth.uid() IN (
      SELECT c.created_by
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = round_participants.round_id
    )
  );

-- ============================================================
-- HELPER: user_can_access_round
-- Returns TRUE if the current user is allowed to view scrambles
-- and submit times for the given round.
--
-- Logic:
--   - Competition creator always has access.
--   - Round 1: any registered competitor has access.
--   - Round 2+: only competitors in round_participants have access.
--   - Round must be active or completed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_can_access_round(check_round_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  round_num INT;
  comp_event_id UUID;
  comp_id UUID;
BEGIN
  -- Creator always has access
  IF EXISTS (
    SELECT 1 FROM rounds r
    JOIN competition_events ce ON ce.id = r.competition_event_id
    JOIN competitions c ON c.id = ce.competition_id
    WHERE r.id = check_round_id AND c.created_by = auth.uid()
  ) THEN
    RETURN TRUE;
  END IF;

  -- Get round info
  SELECT r.round_number, r.competition_event_id INTO round_num, comp_event_id
  FROM rounds r WHERE r.id = check_round_id;

  IF round_num IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Find this user's competitor record for this competition
  SELECT comp.id INTO comp_id
  FROM competition_events ce
  JOIN competitions c ON c.id = ce.competition_id
  JOIN competitors comp ON comp.competition_id = c.id AND comp.user_id = auth.uid()
  WHERE ce.id = comp_event_id
  LIMIT 1;

  IF comp_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Round 1: any registered competitor is eligible
  IF round_num = 1 THEN
    RETURN TRUE;
  END IF;

  -- Round 2+: must be in round_participants
  RETURN EXISTS (
    SELECT 1 FROM round_participants rp
    WHERE rp.round_id = check_round_id AND rp.competitor_id = comp_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- UPDATED SCRAMBLES RLS
-- Only show scrambles to users who:
--   - are the competition creator, OR
--   - are a registered competitor for round 1 and the round is active/completed, OR
--   - are in round_participants and the round is active/completed
-- ============================================================
DROP POLICY IF EXISTS "Scrambles visible to competitors" ON scrambles;

CREATE POLICY "Scrambles visible to eligible competitors" ON scrambles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rounds r
      WHERE r.id = scrambles.round_id
        AND r.status IN ('active', 'completed')
        AND public.user_can_access_round(scrambles.round_id)
    )
  );

-- ============================================================
-- UPDATED SOLVES INSERT RLS
-- Users can only insert solves for rounds they are eligible for.
-- ============================================================
DROP POLICY IF EXISTS "Users insert own solves" ON solves;

CREATE POLICY "Users insert own solves" ON solves
  FOR INSERT WITH CHECK (
    -- Must own the competitor record
    auth.uid() IN (
      SELECT user_id FROM competitors WHERE id = solves.competitor_id
    )
    -- Must be eligible for this round
    AND public.user_can_access_round(solves.round_id)
    -- Round must be active
    AND EXISTS (
      SELECT 1 FROM rounds r
      WHERE r.id = solves.round_id AND r.status = 'active'
    )
  );

-- ============================================================
-- UPDATED SOLVES SELECT RLS
-- Viewable if: you submitted it, or you're the creator,
-- or the round is active/completed AND you're eligible.
-- ============================================================
DROP POLICY IF EXISTS "Solves viewable for active rounds" ON solves;

CREATE POLICY "Solves viewable for eligible users" ON solves
  FOR SELECT USING (
    auth.uid() = solves.submitted_by
    OR auth.uid() IN (
      SELECT c.created_by
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = solves.round_id
    )
    OR (
      EXISTS (
        SELECT 1 FROM rounds r
        WHERE r.id = solves.round_id AND r.status IN ('active', 'completed')
      )
      AND public.user_can_access_round(solves.round_id)
    )
  );
