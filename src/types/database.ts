// Core types derived from the database schema

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  wca_id: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Competition {
  id: string;
  created_by: string;
  name: string;
  description: string;
  status: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface CompetitionEvent {
  id: string;
  competition_id: string;
  event_key: string;
  round_count: number;
  event_format: 'average' | 'mean';
  created_at: string;
}

export interface Round {
  id: string;
  competition_event_id: string;
  round_number: number;
  status: 'pending' | 'active' | 'completed';
  advance_count: number | null;
  round_format: 'average' | 'mean';
  advancement_mode: 'fixed' | 'percentage' | null;
  advancement_value: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface Scramble {
  id: string;
  round_id: string;
  scramble_number: number;
  scramble: string;
  created_at: string;
}

export interface Competitor {
  id: string;
  competition_id: string;
  user_id: string;
  created_at: string;
}

export interface Solve {
  id: string;
  round_id: string;
  competitor_id: string;
  solve_number: number;
  time_ms: number | null;
  penalty: 'none' | 'DNF' | '+2' | 'DNS';
  submitted_by: string | null;
  submitted_at: string;
}

// Enriched types for UI (with joins)

export type SolveWithProfile = Solve & {
  competitor: Competitor & {
    user: Profile;
  };
};

export type RoundWithEvent = Round & {
  competition_event: CompetitionEvent & {
    competition: Competition;
  };
};

export type LeaderboardEntry = {
  competitor_id: string;
  username: string;
  display_name: string | null;
  solve_times: (number | null)[];
  result: number | 'DNF' | null;
  formatted_result: string;
};
