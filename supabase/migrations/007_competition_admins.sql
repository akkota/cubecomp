-- 007_competition_admins.sql
-- Multi-admin support: allow competition creators to add other users as admins.
-- Admins have the same management powers as the creator, except they cannot
-- remove the creator, delete the competition, or manage other admins.

CREATE TABLE competition_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(competition_id, user_id)
);

CREATE INDEX idx_competition_admins_competition ON competition_admins(competition_id);
CREATE INDEX idx_competition_admins_user ON competition_admins(user_id);

ALTER TABLE competition_admins ENABLE ROW LEVEL SECURITY;

-- Admins can view the admin list
CREATE POLICY "Competition admins are viewable by everyone" ON competition_admins
  FOR SELECT USING (true);

-- Only the competition creator can insert/delete admins
CREATE POLICY "Creator can manage admins" ON competition_admins
  FOR INSERT WITH CHECK (
    auth.uid() IN (SELECT created_by FROM competitions WHERE id = competition_id)
  );

CREATE POLICY "Creator can delete admins" ON competition_admins
  FOR DELETE USING (
    auth.uid() IN (SELECT created_by FROM competitions WHERE id = competition_id)
  );

-- ── Helper function: is user a competition admin? ──────────────────────
CREATE OR REPLACE FUNCTION public.is_competition_admin(comp_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    auth.uid() IN (SELECT created_by FROM competitions WHERE id = comp_id)
    OR
    auth.uid() IN (SELECT user_id FROM competition_admins WHERE competition_id = comp_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Update existing RLS policies to use the helper ─────────────────────

-- Competition events: admins can manage
DROP POLICY IF EXISTS "Creators can manage events" ON competition_events;
CREATE POLICY "Admins can manage events" ON competition_events
  FOR ALL USING (
    is_competition_admin(competition_id)
  );

-- Rounds: admins can manage
DROP POLICY IF EXISTS "Creators can manage rounds" ON rounds;
CREATE POLICY "Admins can manage rounds" ON rounds
  FOR ALL USING (
    auth.uid() IN (
      SELECT c.created_by
      FROM competition_events ce
      JOIN competitions c ON c.id = ce.competition_id
      WHERE ce.id = rounds.competition_event_id
    )
    OR
    auth.uid() IN (
      SELECT ca.user_id
      FROM competition_events ce
      JOIN competition_admins ca ON ca.competition_id = ce.competition_id
      WHERE ce.id = rounds.competition_event_id
    )
  );

-- Scrambles: admins can manage
DROP POLICY IF EXISTS "Creators can manage scrambles" ON scrambles;
CREATE POLICY "Admins can manage scrambles" ON scrambles
  FOR ALL USING (
    auth.uid() IN (
      SELECT c.created_by
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = scrambles.round_id
    )
    OR
    auth.uid() IN (
      SELECT ca.user_id
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competition_admins ca ON ca.competition_id = ce.competition_id
      WHERE r.id = scrambles.round_id
    )
  );

-- Scrambles visible: admin can always view
DROP POLICY IF EXISTS "Scrambles visible to competitors" ON scrambles;
CREATE POLICY "Scrambles visible to competitors and admins" ON scrambles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = scrambles.round_id
        AND r.status IN ('active', 'completed')
    )
    OR
    is_competition_admin(
      (SELECT ce.competition_id
       FROM rounds r
       JOIN competition_events ce ON ce.id = r.competition_event_id
       WHERE r.id = scrambles.round_id)
    )
  );

-- Competitors: admins can manage
DROP POLICY IF EXISTS "Creators can manage competitors" ON competitors;
CREATE POLICY "Admins can manage competitors" ON competitors
  FOR ALL USING (
    is_competition_admin(competition_id)
  );

-- Solves: admins can manage
DROP POLICY IF EXISTS "Creators can manage all solves" ON solves;
CREATE POLICY "Admins can manage all solves" ON solves
  FOR ALL USING (
    auth.uid() IN (
      SELECT c.created_by
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = solves.round_id
    )
    OR
    auth.uid() IN (
      SELECT ca.user_id
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competition_admins ca ON ca.competition_id = ce.competition_id
      WHERE r.id = solves.round_id
    )
  );
