import { TournamentDetailView } from '@/components/tournament/tournament-detail';
import { createClient } from '@/lib/supabase/server';

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ competitionId: string; tournamentId: string }>;
}) {
  const { competitionId, tournamentId } = await params;
  return <TournamentDetailView competitionId={competitionId} tournamentId={tournamentId} />;
}
