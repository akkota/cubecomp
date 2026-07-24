/**
 * Competition display status — pure helpers (tested independently of UI).
 */

export type CompetitionDisplayStatus = 'upcoming' | 'ongoing' | 'completed';

export function deriveCompetitionStatus(
  rounds: Array<{ status: string }>,
  options?: {
    competitionType?: string | null;
    tournamentStatuses?: string[];
  },
): CompetitionDisplayStatus {
  if (options?.competitionType === 'head_to_head') {
    const statuses = options.tournamentStatuses ?? [];
    if (statuses.includes('active')) return 'ongoing';
    if (statuses.some(s => s === 'completed') && !statuses.some(s => s === 'draft' || s === 'ready' || s === 'active')) {
      return 'completed';
    }
    return 'upcoming';
  }

  if (!rounds || rounds.length === 0) return 'upcoming';

  if (rounds.some(r => r.status === 'active')) return 'ongoing';

  if (rounds.every(r => r.status === 'completed')) return 'completed';

  // Between rounds: some completed, some still pending → still ongoing
  if (rounds.some(r => r.status === 'completed')) return 'ongoing';

  return 'upcoming';
}
