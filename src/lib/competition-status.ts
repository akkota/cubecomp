/**
 * Competition display status — pure helpers (tested independently of UI).
 * Mirrors competition_effective_status / registration gates in SQL migration 022.
 */

export type CompetitionDisplayStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

export interface CompetitionLifecycleInput {
  status?: string | null;
  competitionType?: string | null;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  rounds?: Array<{ status: string }>;
  tournamentStatuses?: string[];
  now?: Date;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function competitionRegistrationOpen(input: CompetitionLifecycleInput): boolean {
  const now = input.now ?? new Date();
  const status = input.status ?? 'upcoming';
  if (status === 'completed' || status === 'cancelled') return false;

  const endsAt = toDate(input.endsAt);
  if (endsAt && endsAt.getTime() <= now.getTime()) return false;

  const effective = deriveCompetitionStatus(input.rounds ?? [], {
    competitionType: input.competitionType,
    tournamentStatuses: input.tournamentStatuses,
    status,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    now,
  });
  if (effective === 'completed' || effective === 'cancelled') return false;

  if (input.competitionType === 'head_to_head') {
    const ts = input.tournamentStatuses ?? [];
    if (ts.some(s => s === 'ready' || s === 'active' || s === 'completed')) return false;
  }

  return true;
}

export function deriveCompetitionStatus(
  rounds: Array<{ status: string }>,
  options?: {
    competitionType?: string | null;
    tournamentStatuses?: string[];
    status?: string | null;
    startsAt?: string | Date | null;
    endsAt?: string | Date | null;
    now?: Date;
  },
): CompetitionDisplayStatus {
  const now = options?.now ?? new Date();
  const stored = options?.status ?? null;

  if (stored === 'cancelled') return 'cancelled';

  const endsAt = toDate(options?.endsAt);
  if (endsAt && endsAt.getTime() <= now.getTime()) return 'completed';
  if (stored === 'completed') return 'completed';

  if (options?.competitionType === 'head_to_head') {
    const statuses = options.tournamentStatuses ?? [];
    if (statuses.includes('active')) return 'ongoing';
    if (
      statuses.some(s => s === 'completed') &&
      !statuses.some(s => s === 'draft' || s === 'ready' || s === 'active')
    ) {
      return 'completed';
    }
    const startsAt = toDate(options.startsAt);
    if (startsAt && startsAt.getTime() <= now.getTime() && (!endsAt || endsAt.getTime() > now.getTime())) {
      return 'ongoing';
    }
    return 'upcoming';
  }

  if (!rounds || rounds.length === 0) {
    const startsAt = toDate(options?.startsAt);
    if (startsAt && startsAt.getTime() <= now.getTime() && (!endsAt || endsAt.getTime() > now.getTime())) {
      return 'ongoing';
    }
    if (stored === 'ongoing') return 'ongoing';
    return 'upcoming';
  }

  if (rounds.some(r => r.status === 'active')) return 'ongoing';

  if (rounds.every(r => r.status === 'completed')) return 'completed';

  // Between rounds: some completed, some still pending → still ongoing
  if (rounds.some(r => r.status === 'completed')) return 'ongoing';

  const startsAt = toDate(options?.startsAt);
  if (startsAt && startsAt.getTime() <= now.getTime() && (!endsAt || endsAt.getTime() > now.getTime())) {
    return 'ongoing';
  }
  if (stored === 'ongoing') return 'ongoing';
  return 'upcoming';
}
