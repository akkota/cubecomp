'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CreateTournamentWizard } from '@/components/tournament/create-tournament';
import { createClient } from '@/lib/supabase/client';

const draftKey = (competitionId: string) => `cubecomp-tournament-draft:${competitionId}`;

function hasLocalDraft(competitionId: string) {
  if (typeof window === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(draftKey(competitionId));
    if (!raw) return false;
    const draft = JSON.parse(raw) as { name?: string; step?: number };
    return Boolean(draft.name?.trim() || (draft.step ?? 0) > 0);
  } catch {
    return false;
  }
}

export default function H2HSetupPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    const run = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(`/competitions/${id}/setup`)}`);
        return;
      }

      const { data: comp } = await supabase
        .from('competitions')
        .select('competition_type, created_by')
        .eq('id', id)
        .single();

      if (comp?.competition_type !== 'head_to_head') {
        router.replace(`/competitions/${id}`);
        return;
      }

      let isAdmin = comp.created_by === user.id;
      if (!isAdmin) {
        const { data: adminRow } = await supabase
          .from('competition_admins')
          .select('id')
          .eq('competition_id', id)
          .eq('user_id', user.id)
          .maybeSingle();
        isAdmin = !!adminRow;
      }

      if (!isAdmin) {
        router.replace(`/competitions/${id}`);
        return;
      }

      // Prefer resuming an in-progress wizard (name/settings already chosen)
      if (hasLocalDraft(id)) {
        setShowWizard(true);
        setLoading(false);
        return;
      }

      // Otherwise resume an unfinished DB tournament instead of a blank form
      const { data: existing } = await supabase
        .from('tournaments')
        .select('id, status')
        .eq('competition_id', id)
        .in('status', ['draft', 'ready'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (existing?.[0]) {
        router.replace(`/competitions/${id}/tournaments/${existing[0].id}`);
        return;
      }

      setShowWizard(true);
      setLoading(false);
    };

    void run();
  }, [id, router]);

  if (loading) return <div className="animate-pulse h-64 rounded-lg bg-surface-hover" />;
  if (!showWizard) return null;

  return (
    <Suspense fallback={<div className="mx-auto h-64 max-w-3xl animate-pulse rounded-lg bg-surface-hover" />}>
      <CreateTournamentWizard competitionId={id} />
    </Suspense>
  );
}
