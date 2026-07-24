'use client';

import { TournamentList } from '@/components/tournament/tournament-list';

export function CompetitionSection({
  competitionId,
  isAdmin = false,
}: {
  competitionId: string;
  isAdmin?: boolean;
}) {
  return (
    <section className="mt-8 pt-8 border-t border-border">
      <TournamentList competitionId={competitionId} isAdmin={isAdmin} />
    </section>
  );
}
