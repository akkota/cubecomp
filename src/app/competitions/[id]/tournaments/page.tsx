import { createClient } from '@/lib/supabase/server';
import { CompetitionSection } from '@/components/tournament/competition-section';

export default async function CompetitionTournamentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data: comp } = await supabase
      .from('competitions')
      .select('created_by')
      .eq('id', id)
      .maybeSingle();
    if (comp?.created_by === user.id) {
      isAdmin = true;
    } else if (comp) {
      const { data: adminRow } = await supabase
        .from('competition_admins')
        .select('id')
        .eq('competition_id', id)
        .eq('user_id', user.id)
        .maybeSingle();
      isAdmin = !!adminRow;
    }
  }

  return <CompetitionSection competitionId={id} isAdmin={isAdmin} />;
}
