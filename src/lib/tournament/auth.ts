import { createClient } from '@/lib/supabase/server';

/** Server-side: competition creator or listed competition_admins row. */
export async function requireCompetitionAdmin(competitionId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; reason: 'unauthenticated' | 'not_found' | 'forbidden' | 'not_h2h' }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'unauthenticated' };

  const { data: comp } = await supabase
    .from('competitions')
    .select('created_by, competition_type')
    .eq('id', competitionId)
    .maybeSingle();

  if (!comp) return { ok: false, reason: 'not_found' };
  if (comp.competition_type !== 'head_to_head') return { ok: false, reason: 'not_h2h' };

  if (comp.created_by === user.id) return { ok: true, userId: user.id };

  const { data: adminRow } = await supabase
    .from('competition_admins')
    .select('id')
    .eq('competition_id', competitionId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (adminRow) return { ok: true, userId: user.id };
  return { ok: false, reason: 'forbidden' };
}
