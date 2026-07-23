'use server';

import { createClient } from '@/lib/supabase/server';

type ActionResult = { success: true } | { success: false; error: string };

type UnlockResult = ActionResult & { unlocked?: boolean };
type VisibilityResult = ActionResult & { visibility?: 'public' | 'private' };

function asResult(data: unknown, fallback: string): ActionResult {
  if (!data || typeof data !== 'object') {
    return { success: false, error: fallback };
  }
  const payload = data as { success?: boolean; error?: string };
  if (payload.success) return { success: true };
  return { success: false, error: payload.error || fallback };
}

export async function unlockPrivateCompetitionAction(
  competitionId: string,
  password: string,
): Promise<UnlockResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data, error } = await supabase.rpc('unlock_private_competition', {
    p_competition_id: competitionId,
    p_password: password,
  });

  if (error) return { success: false, error: error.message };
  const result = asResult(data, 'Failed to unlock competition');
  return result.success ? { success: true, unlocked: true } : result;
}

export async function registerForCompetitionAction(
  competitionId: string,
  password?: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data, error } = await supabase.rpc('register_for_competition', {
    p_competition_id: competitionId,
    p_password: password ?? null,
  });

  if (error) return { success: false, error: error.message };
  return asResult(data, 'Failed to register');
}

export async function configureCompetitionVisibilityAction(
  competitionId: string,
  visibility: 'public' | 'private',
  password?: string | null,
): Promise<VisibilityResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  if (visibility === 'private' && password !== undefined && password !== null && password.trim().length > 0 && password.trim().length < 4) {
    return { success: false, error: 'Password must be at least 4 characters' };
  }

  const { data, error } = await supabase.rpc('configure_competition_visibility', {
    p_competition_id: competitionId,
    p_visibility: visibility,
    p_password: password?.trim() ? password.trim() : null,
  });

  if (error) return { success: false, error: error.message };
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'Failed to update visibility' };
  }
  const payload = data as { success?: boolean; error?: string; visibility?: 'public' | 'private' };
  if (!payload.success) {
    return { success: false, error: payload.error || 'Failed to update visibility' };
  }
  return { success: true, visibility: payload.visibility ?? visibility };
}

export async function checkCompetitionUnlockAction(
  competitionId: string,
): Promise<{ unlocked: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { unlocked: false };

  const { data, error } = await supabase.rpc('user_has_competition_unlock', {
    comp_id: competitionId,
  });

  if (error) return { unlocked: false };
  return { unlocked: data === true };
}
