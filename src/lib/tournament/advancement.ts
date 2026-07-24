/**
 * Pure tournament advancement helpers used by docs/tests conceptually.
 * Executable simulations live in tests/helpers/advancement.mjs (Node test runner).
 * SQL source of truth: supabase/migrations/019_fix_tournament_advancement.sql
 */

export {
  generateBracket,
  type BracketDefinition,
  type BracketMatchDef,
  type TournamentType,
} from './bracket-engine';
