-- 008_verified_solves.sql
-- Verified solves system: competitions can require video evidence.
-- One unlisted YouTube video per competitor per round.
-- Only verified competitors can advance to the next round.

-- Track video submissions at the round × competitor level
CREATE TABLE round_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  video_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'none'
    CHECK (verification_status IN ('none', 'pending', 'verified', 'rejected')),
  verified_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  rejected_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(round_id, competitor_id)
);

CREATE INDEX idx_round_submissions_round ON round_submissions(round_id);
CREATE INDEX idx_round_submissions_competitor ON round_submissions(competitor_id);
CREATE INDEX idx_round_submissions_status ON round_submissions(verification_status);

ALTER TABLE round_submissions ENABLE ROW LEVEL SECURITY;

-- Anyone can view submissions (for leaderboard verification badges)
CREATE POLICY "Round submissions are viewable by everyone" ON round_submissions
  FOR SELECT USING (true);

-- Competitors can insert/update their own submission
CREATE POLICY "Competitors can manage own submissions" ON round_submissions
  FOR INSERT WITH CHECK (
    auth.uid() IN (SELECT user_id FROM competitors WHERE id = competitor_id)
  );
CREATE POLICY "Competitors can update own submissions" ON round_submissions
  FOR UPDATE USING (
    auth.uid() IN (SELECT user_id FROM competitors WHERE id = competitor_id)
  );

-- Admins can update verification status
CREATE POLICY "Admins can verify submissions" ON round_submissions
  FOR UPDATE USING (
    auth.uid() IN (SELECT created_by FROM competitions
      WHERE id IN (
        SELECT ce.competition_id FROM rounds r
        JOIN competition_events ce ON ce.id = r.competition_event_id
        WHERE r.id = round_id
      ))
    OR
    auth.uid() IN (SELECT ca.user_id FROM competition_admins ca
      WHERE ca.competition_id IN (
        SELECT ce.competition_id FROM rounds r
        JOIN competition_events ce ON ce.id = r.competition_event_id
        WHERE r.id = round_id
      ))
  );

-- Add competition-level toggle
ALTER TABLE competitions
ADD COLUMN require_verified_solves BOOLEAN NOT NULL DEFAULT false;

-- Update_At trigger for round_submissions
CREATE TRIGGER set_round_submissions_updated_at
  BEFORE UPDATE ON round_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
