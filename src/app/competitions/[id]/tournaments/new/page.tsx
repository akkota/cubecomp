import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { CreateTournamentWizard } from '@/components/tournament/create-tournament';
import { requireCompetitionAdmin } from '@/lib/tournament/auth';
import { createClient } from '@/lib/supabase/server';

export default async function NewTournamentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ resume?: string; fresh?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const auth = await requireCompetitionAdmin(id);

  if (auth.ok === false) {
    if (auth.reason === 'unauthenticated') {
      redirect(`/login?next=${encodeURIComponent(`/competitions/${id}/tournaments/new`)}`);
    }
    redirect(`/competitions/${id}`);
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('tournaments')
    .select('id, status')
    .eq('competition_id', id)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // One tournament only: resume draft in wizard, otherwise open the existing tournament
  if (existing && query.fresh !== '1') {
    if (existing.status === 'draft' && (!query.resume || query.resume === existing.id)) {
      // allow wizard
    } else if (existing.status !== 'draft') {
      redirect(`/competitions/${id}/tournaments/${existing.id}`);
    } else if (query.resume && query.resume !== existing.id) {
      redirect(`/competitions/${id}/tournaments/new?resume=${existing.id}`);
    }
  } else if (existing && query.fresh === '1') {
    redirect(
      existing.status === 'draft'
        ? `/competitions/${id}/tournaments/new?resume=${existing.id}`
        : `/competitions/${id}/tournaments/${existing.id}`,
    );
  }

  return (
    <Suspense fallback={<div className="mx-auto h-64 max-w-3xl animate-pulse rounded-lg bg-surface-hover" />}>
      <CreateTournamentWizard competitionId={id} />
    </Suspense>
  );
}
