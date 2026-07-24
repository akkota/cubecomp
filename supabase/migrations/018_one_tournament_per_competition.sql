-- One non-cancelled tournament per competition
CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_tournament_per_competition
  ON public.tournaments (competition_id)
  WHERE status <> 'cancelled';
