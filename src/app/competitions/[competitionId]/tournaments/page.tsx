import { CompetitionSection } from '@/components/tournament/competition-section';

export default function CompetitionTournamentsPage({
  params,
}: {
  params: Promise<{ competitionId: string }>;
}) {
  return <CompetitionSection competitionId={''} />;
}

export async function generateStaticParams() {
  return [];
}
