"use server";

import { createClient } from "@/lib/supabase/server";
import type { AdvancementResult } from "@/types/advancement";

export async function calculateAdvancementAction(roundId: string): Promise<AdvancementResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('calculate_round_advancement', { p_round_id: roundId });
  if (error) return { success: false, error: error.message };
  if (!data || typeof data.success !== 'boolean') return { success: false, error: 'Invalid advancement response' };
  return data;
}
