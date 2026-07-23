/**
 * Derive a competition's display status from its rounds.
 *
 * This is the source of truth — the `competitions.status` column is
 * treated as a cached value, auto-updated by the admin page on round
 * changes, but never relied upon directly for display logic.
 */

export type CompetitionDisplayStatus = 'upcoming' | 'ongoing' | 'completed';

export function deriveCompetitionStatus(rounds: Array<{ status: string }>): CompetitionDisplayStatus {
  // Edge case: no rounds configured at all
  if (!rounds || rounds.length === 0) return 'upcoming';

  // If *any* round is active, the competition is ongoing
  if (rounds.some(r => r.status === 'active')) return 'ongoing';

  // If *all* rounds are completed, the competition is done
  if (rounds.every(r => r.status === 'completed')) return 'completed';

  // Otherwise: some rounds still pending → upcoming
  return 'upcoming';
}
