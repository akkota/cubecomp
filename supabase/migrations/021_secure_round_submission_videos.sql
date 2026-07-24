-- 021_secure_round_submission_videos.sql
-- video_url must not be world-readable (private competition unlisted links).
-- Leaderboard badges use a status-only RPC with no video_url.

DROP POLICY IF EXISTS "Round submissions are viewable by everyone" ON public.round_submissions;

CREATE POLICY "Submitters can view own round submissions"
  ON public.round_submissions
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT c.user_id FROM public.competitors c WHERE c.id = competitor_id
    )
  );

CREATE POLICY "Admins can view round submissions"
  ON public.round_submissions
  FOR SELECT
  USING (
    public.is_competition_admin((
      SELECT ce.competition_id
      FROM public.rounds r
      JOIN public.competition_events ce ON ce.id = r.competition_event_id
      WHERE r.id = round_submissions.round_id
    ))
  );

-- Status badges for leaderboards — never returns video_url
CREATE OR REPLACE FUNCTION public.get_round_verification_statuses(p_round_id UUID)
RETURNS TABLE (
  competitor_id UUID,
  verification_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rs.competitor_id, rs.verification_status
  FROM public.round_submissions rs
  WHERE rs.round_id = p_round_id
    AND rs.verification_status IS NOT NULL
    AND rs.verification_status <> 'none';
$$;

REVOKE ALL ON FUNCTION public.get_round_verification_statuses(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_round_verification_statuses(UUID) TO anon, authenticated;

COMMENT ON FUNCTION public.get_round_verification_statuses(UUID) IS
  'Public-safe verification badge data for a round. Does not expose video_url.';
