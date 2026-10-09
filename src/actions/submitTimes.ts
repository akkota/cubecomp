"use server";

import { createClient } from '@/lib/supabase/server';
import type { SolveInput } from '@/lib/solve-results';

type SubmitTimesResult = { success: true; solves: SolveInput[] } | { success: false; error: string };

export async function submitTimesAction(roundId: string, competitionId: string, solves: SolveInput[]): Promise<SubmitTimesResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_round_times', {
    p_round_id: roundId, p_competition_id: competitionId, p_solves: solves,
  });
  if (error) return { success: false, error: error.message };
  if (data?.success !== true) return { success: false, error: data?.error ?? 'Failed to submit times' };
  return { success: true, solves };
}

export async function submitEvidenceAction(roundId: string, videoUrl: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_round_evidence', { p_round_id: roundId, p_video_url: videoUrl.trim() });
  if (error) return { success: false, error: error.message };
  return data?.success === true ? { success: true } : { success: false, error: data?.error ?? 'Failed to save evidence' };
}
