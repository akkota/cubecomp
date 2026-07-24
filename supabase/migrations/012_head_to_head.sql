-- 012_head_to_head.sql
-- Head-to-Head bracket tournaments within competitions.
-- Single/double elimination, bo3/bo5, seeded/unseeded, generated/external scrambles.

-- ============================================================
-- TOURNAMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  event_key TEXT,
  tournament_type TEXT NOT NULL DEFAULT 'single'
    CHECK (tournament_type IN ('single', 'double')),
  seeding_type TEXT NOT NULL DEFAULT 'unseeded'
    CHECK (seeding_type IN ('seeded', 'unseeded')),
  match_format TEXT NOT NULL DEFAULT 'bo3'
    CHECK (match_format IN ('bo3', 'bo5')),
  scramble_source TEXT NOT NULL DEFAULT 'generated'
    CHECK (scramble_source IN ('generated', 'external')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'active', 'completed', 'cancelled')),
  competitor_count INT NOT NULL CHECK (competitor_count >= 2),
  bracket_locked BOOLEAN NOT NULL DEFAULT false,
  bracket_size INT,
  shuffle_seed BIGINT,
  champion_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_comp ON public.tournaments(competition_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON public.tournaments(status);

-- ============================================================
-- TOURNAMENT PARTICIPANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tournament_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE RESTRICT,
  display_name_snapshot TEXT NOT NULL,
  seed INT,
  qualifying_average INT,
  initial_slot INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, competitor_id),
  UNIQUE(tournament_id, initial_slot)
);

CREATE INDEX IF NOT EXISTS idx_tp_tournament ON public.tournament_participants(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tp_competitor ON public.tournament_participants(competitor_id);

-- ============================================================
-- TOURNAMENT MATCHES (bracket nodes)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tournament_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  bracket_type TEXT NOT NULL DEFAULT 'winners'
    CHECK (bracket_type IN ('winners', 'losers', 'grand_final', 'reset_final')),
  bracket_round INT NOT NULL CHECK (bracket_round >= 1),
  match_number INT NOT NULL CHECK (match_number >= 1),
  bracket_index INT,
  competitor1_id UUID REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  competitor2_id UUID REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  auto_advance BOOLEAN NOT NULL DEFAULT false,
  competitor1_sets_won INT NOT NULL DEFAULT 0,
  competitor2_sets_won INT NOT NULL DEFAULT 0,
  winner_id UUID REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'void')),
  next_match_id UUID REFERENCES public.tournament_matches(id) ON DELETE SET NULL,
  loser_next_match_id UUID REFERENCES public.tournament_matches(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, bracket_type, bracket_round, match_number)
);

CREATE INDEX IF NOT EXISTS idx_tm_tournament ON public.tournament_matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tm_status ON public.tournament_matches(status);
CREATE INDEX IF NOT EXISTS idx_tm_next ON public.tournament_matches(next_match_id);
CREATE INDEX IF NOT EXISTS idx_tm_loser ON public.tournament_matches(loser_next_match_id);

-- ============================================================
-- TOURNAMENT MATCH SETS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tournament_match_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.tournament_matches(id) ON DELETE CASCADE,
  set_number INT NOT NULL CHECK (set_number >= 1),
  competitor1_solve_wins INT NOT NULL DEFAULT 0,
  competitor2_solve_wins INT NOT NULL DEFAULT 0,
  winner_id UUID REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, set_number)
);

CREATE INDEX IF NOT EXISTS idx_tms_match ON public.tournament_match_sets(match_id);

-- ============================================================
-- TOURNAMENT MATCH SOLVES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tournament_match_solves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES public.tournament_match_sets(id) ON DELETE CASCADE,
  solve_number INT NOT NULL CHECK (solve_number >= 1),
  re_solve_attempt INT NOT NULL DEFAULT 0 CHECK (re_solve_attempt >= 0),
  scramble TEXT,
  competitor1_time_ms INT,
  competitor1_penalty TEXT NOT NULL DEFAULT 'none'
    CHECK (competitor1_penalty IN ('none', 'DNF', '+2', 'DNS')),
  competitor1_adjusted_ms INT,
  competitor2_time_ms INT,
  competitor2_penalty TEXT NOT NULL DEFAULT 'none'
    CHECK (competitor2_penalty IN ('none', 'DNF', '+2', 'DNS')),
  competitor2_adjusted_ms INT,
  winner_id UUID REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'tied')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(set_id, solve_number, re_solve_attempt)
);

CREATE INDEX IF NOT EXISTS idx_tmsol_set ON public.tournament_match_solves(set_id);
CREATE INDEX IF NOT EXISTS idx_tmsol_status ON public.tournament_match_solves(status);

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tournament_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tal_tournament ON public.tournament_audit_log(tournament_id);

-- ============================================================
-- FKs that depend on tables created above
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_tournament_champion'
  ) THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT fk_tournament_champion
      FOREIGN KEY (champion_id) REFERENCES public.tournament_participants(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- HELPERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_is_tournament_admin(p_tournament_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.is_competition_admin(
    (SELECT competition_id FROM public.tournaments WHERE id = p_tournament_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_can_view_tournament(p_tournament_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp_id UUID;
  v_vis TEXT;
BEGIN
  SELECT t.competition_id, c.visibility INTO v_comp_id, v_vis
  FROM public.tournaments t
  JOIN public.competitions c ON c.id = t.competition_id
  WHERE t.id = p_tournament_id;
  IF v_comp_id IS NULL THEN RETURN FALSE; END IF;
  IF public.is_competition_admin(v_comp_id) THEN RETURN TRUE; END IF;
  IF v_vis = 'public' THEN RETURN TRUE; END IF;
  RETURN public.user_has_competition_unlock(v_comp_id);
END;
$$;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_match_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_match_solves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_audit_log ENABLE ROW LEVEL SECURITY;

-- Tournaments
DROP POLICY IF EXISTS "Viewable per comp rules" ON public.tournaments;
CREATE POLICY "Viewable per comp rules" ON public.tournaments
  FOR SELECT USING (public.user_can_view_tournament(id));
DROP POLICY IF EXISTS "Admins manage" ON public.tournaments;
CREATE POLICY "Admins manage" ON public.tournaments
  FOR ALL USING (public.user_is_tournament_admin(id))
  WITH CHECK (public.user_is_tournament_admin(id));

-- Participants
DROP POLICY IF EXISTS "Viewable per comp rules" ON public.tournament_participants;
CREATE POLICY "Viewable per comp rules" ON public.tournament_participants
  FOR SELECT USING (public.user_can_view_tournament(tournament_id));
DROP POLICY IF EXISTS "Admins manage" ON public.tournament_participants;
CREATE POLICY "Admins manage" ON public.tournament_participants
  FOR ALL USING (public.user_is_tournament_admin(tournament_id))
  WITH CHECK (public.user_is_tournament_admin(tournament_id));

-- Matches
DROP POLICY IF EXISTS "Viewable per comp rules" ON public.tournament_matches;
CREATE POLICY "Viewable per comp rules" ON public.tournament_matches
  FOR SELECT USING (public.user_can_view_tournament(tournament_id));
DROP POLICY IF EXISTS "Admins manage" ON public.tournament_matches;
CREATE POLICY "Admins manage" ON public.tournament_matches
  FOR ALL USING (public.user_is_tournament_admin(tournament_id))
  WITH CHECK (public.user_is_tournament_admin(tournament_id));

-- Sets
DROP POLICY IF EXISTS "Viewable per comp" ON public.tournament_match_sets;
CREATE POLICY "Viewable per comp" ON public.tournament_match_sets
  FOR SELECT USING (
    public.user_can_view_tournament(
      (SELECT tournament_id FROM public.tournament_matches WHERE id = match_id)
    )
  );
DROP POLICY IF EXISTS "Admins manage" ON public.tournament_match_sets;
CREATE POLICY "Admins manage" ON public.tournament_match_sets
  FOR ALL USING (
    public.user_is_tournament_admin(
      (SELECT tournament_id FROM public.tournament_matches WHERE id = match_id)
    )
  ) WITH CHECK (
    public.user_is_tournament_admin(
      (SELECT tournament_id FROM public.tournament_matches WHERE id = match_id)
    )
  );

-- Solves
DROP POLICY IF EXISTS "Viewable per comp" ON public.tournament_match_solves;
CREATE POLICY "Viewable per comp" ON public.tournament_match_solves
  FOR SELECT USING (
    public.user_can_view_tournament(
      (SELECT tm.tournament_id
       FROM public.tournament_match_sets tms
       JOIN public.tournament_matches tm ON tm.id = tms.match_id
       WHERE tms.id = set_id)
    )
  );
DROP POLICY IF EXISTS "Admins manage" ON public.tournament_match_solves;
CREATE POLICY "Admins manage" ON public.tournament_match_solves
  FOR ALL USING (
    public.user_is_tournament_admin(
      (SELECT tm.tournament_id
       FROM public.tournament_match_sets tms
       JOIN public.tournament_matches tm ON tm.id = tms.match_id
       WHERE tms.id = set_id)
    )
  ) WITH CHECK (
    public.user_is_tournament_admin(
      (SELECT tm.tournament_id
       FROM public.tournament_match_sets tms
       JOIN public.tournament_matches tm ON tm.id = tms.match_id
       WHERE tms.id = set_id)
    )
  );

-- Audit log
DROP POLICY IF EXISTS "Viewable per comp" ON public.tournament_audit_log;
CREATE POLICY "Viewable per comp" ON public.tournament_audit_log
  FOR SELECT USING (public.user_can_view_tournament(tournament_id));
DROP POLICY IF EXISTS "Admins insert" ON public.tournament_audit_log;
CREATE POLICY "Admins insert" ON public.tournament_audit_log
  FOR INSERT WITH CHECK (public.user_is_tournament_admin(tournament_id));
DROP POLICY IF EXISTS "Admins manage" ON public.tournament_audit_log;
CREATE POLICY "Admins manage" ON public.tournament_audit_log
  FOR ALL USING (public.user_is_tournament_admin(tournament_id))
  WITH CHECK (public.user_is_tournament_admin(tournament_id));

-- ============================================================
-- TRIGGERS
-- ============================================================
DROP TRIGGER IF EXISTS set_tournaments_updated_at ON public.tournaments;
CREATE TRIGGER set_tournaments_updated_at BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS set_tm_updated_at ON public.tournament_matches;
CREATE TRIGGER set_tm_updated_at BEFORE UPDATE ON public.tournament_matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS set_tms_updated_at ON public.tournament_match_sets;
CREATE TRIGGER set_tms_updated_at BEFORE UPDATE ON public.tournament_match_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
