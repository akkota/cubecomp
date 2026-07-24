import { TournamentDetailView } from '@/components/tournament/tournament-detail';

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ id: string; tournamentId: string }>;
}) {
  const { id, tournamentId } = await params;
  return <TournamentDetailView competitionId={id} tournamentId={tournamentId} />;
}
