// Core types derived from the database schema

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  wca_id: string | null;
  avatar_url: string | null;
  notify_round_start: boolean;
  notify_advancement: boolean;
  notify_pb_beaten: boolean;
  created_at: string;
  updated_at: string;
}

export interface Competition {
  id: string;
  created_by: string;
  name: string;
  description: string;
  status: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  visibility: 'public' | 'private';
  competition_type: 'standard' | 'head_to_head';
  generate_scrambles: boolean;
  allow_spectators: boolean;
  require_verified_solves: boolean;
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

export interface RoundSubmission {
  id: string;
  round_id: string;
  competitor_id: string;
  video_url: string | null;
  verification_status: 'none' | 'pending' | 'verified' | 'rejected';
  verified_by: string | null;
  verified_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
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

// ─── Head-to-Head Tournament Types ─────────────────────

export interface Tournament {
  id: string;
  competition_id: string;
  created_by: string;
  name: string;
  description: string;
  event_key: string | null;
  tournament_type: 'single' | 'double';
  seeding_type: 'seeded' | 'unseeded';
  match_format: 'bo3' | 'bo5';
  scramble_source: 'generated' | 'external';
  status: 'draft' | 'ready' | 'active' | 'completed' | 'cancelled';
  competitor_count: number;
  bracket_locked: boolean;
  bracket_size: number | null;
  shuffle_seed: number | null;
  champion_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TournamentParticipant {
  id: string;
  tournament_id: string;
  competitor_id: string;
  display_name_snapshot: string;
  seed: number | null;
  qualifying_average: number | null;
  initial_slot: number;
  created_at: string;
}

export interface TournamentMatch {
  id: string;
  tournament_id: string;
  bracket_type: 'winners' | 'losers' | 'grand_final' | 'reset_final';
  bracket_round: number;
  match_number: number;
  bracket_index: number | null;
  competitor1_id: string | null;
  competitor2_id: string | null;
  auto_advance: boolean;
  competitor1_sets_won: number;
  competitor2_sets_won: number;
  winner_id: string | null;
  status: 'pending' | 'active' | 'completed' | 'void';
  next_match_id: string | null;
  loser_next_match_id: string | null;
  next_match_slot: 1 | 2 | null;
  loser_next_match_slot: 1 | 2 | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TournamentMatchSet {
  id: string;
  match_id: string;
  set_number: number;
  competitor1_solve_wins: number;
  competitor2_solve_wins: number;
  winner_id: string | null;
  status: 'pending' | 'active' | 'completed';
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TournamentMatchSolve {
  id: string;
  set_id: string;
  solve_number: number;
  re_solve_attempt: number;
  scramble: string | null;
  competitor1_time_ms: number | null;
  competitor1_penalty: 'none' | 'DNF' | '+2' | 'DNS';
  competitor1_adjusted_ms: number | null;
  competitor2_time_ms: number | null;
  competitor2_penalty: 'none' | 'DNF' | '+2' | 'DNS';
  competitor2_adjusted_ms: number | null;
  winner_id: string | null;
  status: 'pending' | 'active' | 'completed' | 'tied';
  completed_at: string | null;
  created_at: string;
}
