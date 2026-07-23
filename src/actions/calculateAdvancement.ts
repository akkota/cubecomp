"use server";

import { createClient } from "@/lib/supabase/server";
import { calculateResult } from "@/lib/wca-events";
import type { AdvancementResult } from "@/types/advancement";

export async function calculateAdvancementAction(
  roundId: string,
): Promise<AdvancementResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { data: round } = await supabase
    .from("rounds")
    .select("*, competition_event:competition_event_id!inner(*)")
    .eq("id", roundId)
    .single();

  if (!round) return { success: false, error: "Round not found" };

  const competitionId = round.competition_event.competition_id;

  const { data: comp } = await supabase
    .from("competitions")
    .select("created_by")
    .eq("id", competitionId)
    .single();

  if (!comp) {
    return { success: false, error: "Competition not found" };
  }

  const isCreator = comp.created_by === user.id;
  let isAdmin = false;
  if (!isCreator) {
    const { data: adminRow } = await supabase
      .from("competition_admins")
      .select("id")
      .eq("competition_id", competitionId)
      .eq("user_id", user.id)
      .maybeSingle();
    isAdmin = !!adminRow;
  }

  if (!isCreator && !isAdmin) {
    return {
      success: false,
      error: "Only competition admins can calculate advancement",
    };
  }

  if (round.status !== "completed") {
    return {
      success: false,
      error: "The round must be completed before calculating advancement",
    };
  }

  // Determine advancement mode: prefer new columns, fall back to legacy advance_count
  const mode: "fixed" | "percentage" | null =
    round.advancement_mode || (round.advance_count ? "fixed" : null);
  const value: number | null =
    round.advancement_value ?? round.advance_count ?? null;

  if (!mode || !value) {
    return {
      success: false,
      error:
        "Set an advancement rule (e.g. top 3 or top 60%) before calculating advancement",
    };
  }

  if (mode === "fixed" && value < 1) {
    return {
      success: false,
      error: "Fixed advance count must be a positive integer",
    };
  }
  if (mode === "percentage" && (value < 1 || value > 100)) {
    return { success: false, error: "Percentage must be between 1 and 100" };
  }

  // Get the next round
  const { data: nextRound } = await supabase
    .from("rounds")
    .select("*")
    .eq("competition_event_id", round.competition_event_id)
    .eq("round_number", round.round_number + 1)
    .single();

  if (!nextRound) {
    return {
      success: false,
      error: "No next round exists to advance competitors to",
    };
  }

  // Idempotency guard
  const { count: existingCount } = await supabase
    .from("round_participants")
    .select("*", { count: "exact", head: true })
    .eq("round_id", nextRound.id);

  if (existingCount && existingCount > 0) {
    return {
      success: true,
      advanced: existingCount,
      total: existingCount,
      roundNumber: round.round_number,
      nextRoundNumber: nextRound.round_number,
      alreadyCalculated: true,
    };
  }

  // Check if competition requires verified solves
  const { data: compFull } = await supabase
    .from("competitions")
    .select("require_verified_solves")
    .eq("id", round.competition_event.competition_id)
    .single();
  const needsVerification = compFull?.require_verified_solves === true;

  // Count registered competitors
  const { count: registeredCount } = await supabase
    .from("competitors")
    .select("*", { count: "exact", head: true })
    .eq("competition_id", round.competition_event.competition_id);

  // Fetch all solves for this round
  const { data: solves } = await supabase
    .from("solves")
    .select("*, competitor:competitor_id!inner(*)")
    .eq("round_id", roundId);

  if (!solves || solves.length === 0) {
    return {
      success: true,
      advanced: 0,
      total: 0,
      registered: registeredCount ?? 0,
      roundNumber: round.round_number,
      nextRoundNumber: nextRound.round_number,
    };
  }

  // Group by competitor and calculate results
  const format = (round.round_format ||
    round.competition_event.event_format) as "average" | "mean";

  const competitorResults = new Map<
    string,
    { competitor_id: string; times: (number | null)[] }
  >();
  for (const solve of solves as any[]) {
    const cId = solve.competitor_id;
    if (!competitorResults.has(cId)) {
      competitorResults.set(cId, { competitor_id: cId, times: [] });
    }
    const time =
      solve.penalty === "DNF"
        ? null
        : solve.penalty === "+2" && solve.time_ms !== null
          ? solve.time_ms + 2000
          : solve.penalty === "DNS"
            ? null
            : solve.time_ms;
    competitorResults.get(cId)!.times.push(time);
  }

  const sorted = Array.from(competitorResults.values()).sort((a, b) => {
    const resA = calculateResult(a.times, format);
    const resB = calculateResult(b.times, format);
    if (resA === null && resB === null) return 0;
    if (resA === null) return 1;
    if (resB === null) return -1;
    if (resA === "DNF" && resB === "DNF") return 0;
    if (resA === "DNF") return 1;
    if (resB === "DNF") return -1;
    return (resA as number) - (resB as number);
  });

  let dnfCount = 0;
  for (const c of sorted) {
    const res = calculateResult(c.times, format);
    if (res === "DNF") dnfCount++;
  }

  // If verification required, filter to only verified competitors
  const verifiedCompetitorIds = new Set<string>();
  if (needsVerification) {
    const { data: verifiedSubs } = await supabase
      .from("round_submissions")
      .select("competitor_id")
      .eq("round_id", roundId)
      .eq("verification_status", "verified");
    for (const vs of verifiedSubs ?? []) {
      verifiedCompetitorIds.add(vs.competitor_id);
    }
  }

  // Filter to only competitors with valid results
  const validCompetitors = sorted.filter((c) => {
    const res = calculateResult(c.times, format);
    if (res === null || res === "DNF") return false;
    // If verification is required, must be verified
    if (needsVerification && !verifiedCompetitorIds.has(c.competitor_id))
      return false;
    return true;
  });

  if (validCompetitors.length === 0) {
    return {
      success: true,
      advanced: 0,
      total: sorted.length,
      registered: registeredCount ?? 0,
      dnfCount,
      roundNumber: round.round_number,
      nextRoundNumber: nextRound.round_number,
    };
  }

  // Calculate how many to advance
  let advanceCount: number;
  if (mode === "percentage") {
    // Percentage applies to competitors who competed in THIS round
    advanceCount = Math.ceil(sorted.length * (value / 100));
    // Must advance at least 1 if anyone has a valid result
    if (advanceCount < 1 && validCompetitors.length > 0) advanceCount = 1;
  } else {
    advanceCount = value;
  }

  // Take first N valid competitors
  const advancing: string[] = [];
  for (let i = 0; i < Math.min(advanceCount, validCompetitors.length); i++) {
    advancing.push(validCompetitors[i].competitor_id);
  }

  // Tie handling: advance everyone with equal result at the cutoff
  if (advanceCount <= validCompetitors.length) {
    const cutoffResult = calculateResult(
      validCompetitors[advanceCount - 1].times,
      format,
    );
    for (let i = advanceCount; i < validCompetitors.length; i++) {
      const res = calculateResult(validCompetitors[i].times, format);
      if (res === cutoffResult) {
        advancing.push(validCompetitors[i].competitor_id);
      } else {
        break;
      }
    }
  }

  const inserts = advancing.map((competitor_id) => ({
    round_id: nextRound.id,
    competitor_id,
  }));

  const { error } = await supabase.from("round_participants").insert(inserts);
  if (error) {
    if (error.code === "23505") {
      return {
        success: true,
        advanced: advancing.length,
        total: sorted.length,
        registered: registeredCount ?? 0,
        dnfCount,
        roundNumber: round.round_number,
        nextRoundNumber: nextRound.round_number,
        alreadyCalculated: true,
      };
    }
    return {
      success: false,
      error: `Failed to advance competitors: ${error.message}`,
    };
  }

  return {
    success: true,
    advanced: advancing.length,
    total: sorted.length,
    registered: registeredCount ?? 0,
    dnfCount,
    roundNumber: round.round_number,
    nextRoundNumber: nextRound.round_number,
  };
}
