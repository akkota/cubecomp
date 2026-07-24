'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CreateTournamentWizard } from '@/components/tournament/create-tournament';
import { createClient } from '@/lib/supabase/client';

export default function H2HSetupPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isH2H, setIsH2H] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.from('competitions').select('competition_type').eq('id', id).single().then(({ data }) => {
      if (data?.competition_type !== 'head_to_head') {
        router.replace(`/competitions/${id}`);
      } else {
        setIsH2H(true);
      }
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div className="animate-pulse h-64 rounded-lg bg-surface-hover" />;
  if (!isH2H) return null;

  return <CreateTournamentWizard competitionId={id} />;
}
