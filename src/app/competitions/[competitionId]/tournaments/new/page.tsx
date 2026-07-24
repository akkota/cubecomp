import { CreateTournamentWizard } from '@/components/tournament/create-tournament';

export default async function NewTournamentPage({
  params,
}: {
  params: Promise<{ competitionId: string }>;
}) {
  const { competitionId } = await params;
  return <CreateTournamentWizard competitionId={competitionId} />;
}
