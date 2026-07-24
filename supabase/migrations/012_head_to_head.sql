-- 012_head_to_head.sql
-- Head-to-Head bracket tournaments within competitions.
-- Single/double elimination, bo3/bo5, seeded/unseeded, generated/external scrambles.

-- ============================================================
-- TOURNAMENTS
-- ============================================================
CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
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
  bracket_size INT,                          -- next power of 2, set on generation
  shuffle_seed BIGINT,                       -- deterministic seed for unseeded
  champion_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- champion FK added after tournament_participants exists
ALTER TABLE tournaments ADD CONSTRAINT fk_tournament_champion
  FOREIGN KEY (champion_id) REFERENCES tournament_participants(id) ON DELETE SET NULL;

CREATE INDEX idx_tournaments_comp ON tournaments(competition_id);
CREATE INDEX idx_tournaments_status ON tournaments(status);

-- ============================================================
-- TOURNAMENT PARTICIPANTS
-- ============================================================
CREATE TABLE tournament_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE RESTRICT,
  display_name_snapshot TEXT NOT NULL,       -- profile.display_name at creation
  seed INT,                                 -- NULL for unseeded
  qualifying_average INT,                   -- ms; seeding only
  initial_slot INT NOT NULL,                -- 1-indexed bracket position
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, competitor_id),
  UNIQUE(tournament_id, initial_slot)
);

CREATE INDEX idx_tp_tournament ON tournament_participants(tournament_id);
CREATE INDEX idx_tp_competitor ON tournament_participants(competitor_id);

-- ============================================================
-- TOURNAMENT MATCHES (bracket nodes)
-- ============================================================
CREATE TABLE tournament_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  bracket_type TEXT NOT NULL DEFAULT 'winners'
    CHECK (bracket_type IN ('winners', 'losers', 'grand_final', 'reset_final')),
  bracket_round INT NOT NULL CHECK (bracket_round >= 1),
  match_number INT NOT NULL CHECK (match_number >= 1),
  bracket_index INT,                        -- flat index from bracket engine (for linking)
  competitor1_id UUID REFERENCES tournament_participants(id) ON DELETE SET NULL,
  competitor2_id UUID REFERENCES tournament_participants(id) ON DELETE SET NULL,
  auto_advance BOOLEAN NOT NULL DEFAULT false,  -- bye/void: auto-advance competitor1
  competitor1_sets_won INT NOT NULL DEFAULT 0,
  competitor2_sets_won INT NOT NULL DEFAULT 0,
  winner_id UUID REFERENCES tournament_participants(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'void')),
  next_match_id UUID REFERENCES tournament_matches(id) ON DELETE SET NULL,
  loser_next_match_id UUID REFERENCES tournament_matches(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, bracket_type, bracket_round, match_number)
);

CREATE INDEX idx_tm_tournament ON tournament_matches(tournament_id);
CREATE INDEX idx_tm_status ON tournament_matches(status);
CREATE INDEX idx_tm_next ON tournament_matches(next_match_id);
CREATE INDEX idx_tm_loser ON tournament_matches(loser_next_match_id);

-- ============================================================
-- TOURNAMENT MATCH SETS
-- ============================================================
CREATE TABLE tournament_match_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  set_number INT NOT NULL CHECK (set_number >= 1),
  competitor1_solve_wins INT NOT NULL DEFAULT 0,
  competitor2_solve_wins INT NOT NULL DEFAULT 0,
  winner_id UUID REFERENCES tournament_participants(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, set_number)
);

CREATE INDEX idx_tms_match ON tournament_match_sets(match_id);

-- ============================================================
-- TOURNAMENT MATCH SOLVES (individual solve battles)
-- ============================================================
CREATE TABLE tournament_match_solves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES tournament_match_sets(id) ON DELETE CASCADE,
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
  winner_id UUID REFERENCES tournament_participants(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'tied')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(set_id, solve_number, re_solve_attempt)
);

CREATE INDEX idx_tmsol_set ON tournament_match_solves(set_id);
CREATE INDEX idx_tmsol_status ON tournament_match_solves(status);

-- ============================================================
-- AUDIT LOG (admin overrides, bracket regen)
-- ============================================================
CREATE TABLE tournament_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES profiles(id),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tal_tournament ON tournament_audit_log(tournament_id);

-- ============================================================
-- HELPERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_is_tournament_admin(p_tournament_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.is_competition_admin(
    (SELECT competition_id FROM tournaments WHERE id = p_tournament_id)
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
  FROM tournaments t
  JOIN competitions c ON c.id = t.competition_id
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
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_match_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_match_solves ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_audit_log ENABLE ROW LEVEL SECURITY;

-- Tournaments
CREATE POLICY "Viewable per comp rules" ON tournaments
  FOR SELECT USING (public.user_can_view_tournament(id));
CREATE POLICY "Admins manage" ON tournaments
  FOR ALL USING (public.user_is_tournament_admin(id))
  WITH CHECK (public.user_is_tournament_admin(id));

-- Participants
CREATE POLICY "Viewable per comp rules" ON tournament_participants
  FOR SELECT USING (public.user_can_view_tournament(tournament_id));
CREATE POLICY "Admins manage" ON tournament_participants
  FOR ALL USING (public.user_is_tournament_admin(tournament_id))
  WITH CHECK (public.user_is_tournament_admin(tournament_id));

-- Matches
CREATE POLICY "Viewable per comp rules" ON tournament_matches
  FOR SELECT USING (public.user_can_view_tournament(tournament_id));
CREATE POLICY "Admins manage" ON tournament_matches
  FOR ALL USING (public.user_is_tournament_admin(tournament_id))
  WITH CHECK (public.user_is_tournament_admin(tournament_id));

-- Sets (inherit through match)
CREATE POLICY "Viewable per comp" ON tournament_match_sets
  FOR SELECT USING (
    public.user_can_view_tournament(
      (SELECT tournament_id FROM tournament_matches WHERE id = match_id)
    )
  );
CREATE POLICY "Admins manage" ON tournament_match_sets
  FOR ALL USING (
    public.user_is_tournament_admin(
      (SELECT tournament_id FROM tournament_matches WHERE id = match_id)
    )
  ) WITH CHECK (
    public.user_is_tournament_admin(
      (SELECT tournament_id FROM tournament_matches WHERE id = match_id)
    )
  );

-- Solves (inherit through set → match)
CREATE POLICY "Viewable per comp" ON tournament_match_solves
  FOR SELECT USING (
    public.user_can_view_tournament(
      (SELECT tm.tournament_id
       FROM tournament_match_sets tms
       JOIN tournament_matches tm ON tm.id = tms.match_id
       WHERE tms.id = set_id)
    )
  );
CREATE POLICY "Admins manage" ON tournament_match_solves
  FOR ALL USING (
    public.user_is_tournament_admin(
      (SELECT tm.tournament_id
       FROM tournament_match_sets tms
       JOIN tournament_matches tm ON tm.id = tms.match_id
       WHERE tms.id = set_id)
    )
  ) WITH CHECK (
    public.user_is_tournament_admin(
      (SELECT tm.tournament_id
       FROM tournament_match_sets tms
       JOIN tournament_matches tm ON tm.id = tms.match_id
       WHERE tms.id = set_id)
    )
  );

-- Audit log
CREATE POLICY "Viewable per comp" ON tournament_audit_log
  FOR SELECT USING (public.user_can_view_tournament(tournament_id));
CREATE POLICY "Admins insert" ON tournament_audit_log
  FOR INSERT WITH CHECK (public.user_is_tournament_admin(tournament_id));
CREATE POLICY "Admins manage" ON tournament_audit_log
  FOR ALL USING (public.user_is_tournament_admin(tournament_id))
  WITH CHECK (public.user_is_tournament_admin(tournament_id));

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
CREATE TRIGGER set_tournaments_updated_at BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_tm_updated_at BEFORE UPDATE ON tournament_matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_tms_updated_at BEFORE UPDATE ON tournament_match_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- GRANTS for RPCs (created later with functions)
-- ============================================================
-- RPC execution granted to authenticated role only
