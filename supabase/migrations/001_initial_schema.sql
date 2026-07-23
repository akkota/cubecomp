-- 001_initial_schema.sql
-- Core schema for CubeComp: Rubik's Cube Competition Platform

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  wca_id TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- COMPETITIONS
-- ============================================================
CREATE TABLE competitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'ongoing', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- COMPETITION EVENTS (pivot: which WCA events, how many rounds)
-- ============================================================
CREATE TABLE competition_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  round_count INT NOT NULL DEFAULT 1 CHECK (round_count >= 1 AND round_count <= 5),
  event_format TEXT NOT NULL DEFAULT 'average'
    CHECK (event_format IN ('average', 'mean')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(competition_id, event_key)
);

-- ============================================================
-- ROUNDS (individual rounds per event)
-- ============================================================
CREATE TABLE rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  round_number INT NOT NULL CHECK (round_number >= 1),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed')),
  advance_count INT, -- how many advance to next round; NULL = no cutoff
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(competition_event_id, round_number)
);

-- ============================================================
-- SCRAMBLES (generated per round)
-- ============================================================
CREATE TABLE scrambles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  scramble_number INT NOT NULL CHECK (scramble_number >= 1 AND scramble_number <= 5),
  scramble TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(round_id, scramble_number)
);

-- ============================================================
-- COMPETITORS (registration)
-- ============================================================
CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(competition_id, user_id)
);

-- ============================================================
-- SOLVES (individual solve times)
-- ============================================================
CREATE TABLE solves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  solve_number INT NOT NULL CHECK (solve_number >= 1 AND solve_number <= 5),
  time_ms INT,              -- NULL for DNF/DNS, raw milliseconds
  penalty TEXT NOT NULL DEFAULT 'none'
    CHECK (penalty IN ('none', 'DNF', '+2', 'DNS')),
  submitted_by UUID REFERENCES profiles(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(round_id, competitor_id, solve_number)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_competitions_created_by ON competitions(created_by);
CREATE INDEX idx_competition_events_competition ON competition_events(competition_id);
CREATE INDEX idx_rounds_competition_event ON rounds(competition_event_id);
CREATE INDEX idx_scrambles_round ON scrambles(round_id);
CREATE INDEX idx_competitors_competition ON competitors(competition_id);
CREATE INDEX idx_competitors_user ON competitors(user_id);
CREATE INDEX idx_solves_round ON solves(round_id);
CREATE INDEX idx_solves_competitor ON solves(competitor_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrambles ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE solves ENABLE ROW LEVEL SECURITY;

-- Profiles: public read, owner write
CREATE POLICY "Profiles are viewable by everyone" ON profiles
  FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Competitions: public read, creator write
CREATE POLICY "Competitions are viewable by everyone" ON competitions
  FOR SELECT USING (true);
CREATE POLICY "Creators can insert competitions" ON competitions
  FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Creators can update own competitions" ON competitions
  FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "Creators can delete own competitions" ON competitions
  FOR DELETE USING (auth.uid() = created_by);

-- Competition events: public read, competition creator write
CREATE POLICY "Competition events are viewable by everyone" ON competition_events
  FOR SELECT USING (true);
CREATE POLICY "Creators can manage events" ON competition_events
  FOR ALL USING (
    auth.uid() IN (
      SELECT created_by FROM competitions WHERE id = competition_events.competition_id
    )
  );

-- Rounds: public read, competition creator write
CREATE POLICY "Rounds are viewable by everyone" ON rounds
  FOR SELECT USING (true);
CREATE POLICY "Creators can manage rounds" ON rounds
  FOR ALL USING (
    auth.uid() IN (
      SELECT c.created_by
      FROM competition_events ce
      JOIN competitions c ON c.id = ce.competition_id
      WHERE ce.id = rounds.competition_event_id
    )
  );

-- Scrambles: visible to competitors in active/completed rounds, creator always
CREATE POLICY "Scrambles visible to competitors" ON scrambles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = scrambles.round_id
        AND r.status IN ('active', 'completed')
    )
    OR
    auth.uid() IN (
      SELECT c.created_by
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = scrambles.round_id
    )
  );
CREATE POLICY "Creators can manage scrambles" ON scrambles
  FOR ALL USING (
    auth.uid() IN (
      SELECT c.created_by
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = scrambles.round_id
    )
  );

-- Competitors: public read, users can register themselves, creator can manage
CREATE POLICY "Competitors are viewable by everyone" ON competitors
  FOR SELECT USING (true);
CREATE POLICY "Users can register for competitions" ON competitors
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Creators can manage competitors" ON competitors
  FOR ALL USING (
    auth.uid() IN (
      SELECT created_by FROM competitions WHERE id = competitors.competition_id
    )
  );

-- Solves: competitors see own solves, public sees all for active/completed rounds
CREATE POLICY "Solves viewable for active rounds" ON solves
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rounds r
      WHERE r.id = solves.round_id AND r.status IN ('active', 'completed')
    )
    OR auth.uid() = solves.submitted_by
    OR auth.uid() IN (
      SELECT c.created_by
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = solves.round_id
    )
  );
CREATE POLICY "Users insert own solves" ON solves
  FOR INSERT WITH CHECK (
    auth.uid() IN (
      SELECT user_id FROM competitors WHERE id = solves.competitor_id
    )
  );
CREATE POLICY "Creators can manage all solves" ON solves
  FOR ALL USING (
    auth.uid() IN (
      SELECT c.created_by
      FROM rounds r
      JOIN competition_events ce ON ce.id = r.competition_event_id
      JOIN competitions c ON c.id = ce.competition_id
      WHERE r.id = solves.round_id
    )
  );

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_competitions_updated_at
  BEFORE UPDATE ON competitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
