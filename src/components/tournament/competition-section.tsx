'use client';

import { TournamentList } from '@/components/tournament/tournament-list';

export function CompetitionSection({ competitionId }: { competitionId: string }) {
  return (
    <section className="mt-8 pt-8 border-t border-border">
      <TournamentList competitionId={competitionId} />
    </section>
  );
}
