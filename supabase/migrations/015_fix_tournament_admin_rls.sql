-- Fix tournament RLS: INSERT must authorize via competition_id, not tournament id lookup.
-- user_is_tournament_admin(id) fails on INSERT because the row is not yet readable for the lookup.

DROP POLICY IF EXISTS "Admins manage" ON public.tournaments;

CREATE POLICY "Admins manage tournaments" ON public.tournaments
  FOR ALL
  USING (public.is_competition_admin(competition_id))
  WITH CHECK (public.is_competition_admin(competition_id));

-- Align related tables to the same competition-admin check via tournament → competition
DROP POLICY IF EXISTS "Admins manage" ON public.tournament_participants;
CREATE POLICY "Admins manage participants" ON public.tournament_participants
  FOR ALL
  USING (public.user_is_tournament_admin(tournament_id))
  WITH CHECK (public.user_is_tournament_admin(tournament_id));

DROP POLICY IF EXISTS "Admins manage" ON public.tournament_matches;
CREATE POLICY "Admins manage matches" ON public.tournament_matches
  FOR ALL
  USING (public.user_is_tournament_admin(tournament_id))
  WITH CHECK (public.user_is_tournament_admin(tournament_id));
