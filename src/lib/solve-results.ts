export type SolvePenalty = 'none' | '+2' | 'DNF';

export interface AttemptDraft {
  value: string;
  penalty: SolvePenalty;
  timeMs?: number;
}

export interface SolveInput {
  solve_number: number;
  time_ms: number | null;
  penalty: SolvePenalty;
}

export type AttemptDrafts = Record<number, AttemptDraft>;

type ParsedAttempt =
  | { valid: true; solve: SolveInput }
  | { valid: false; error: string };

export function effectiveTimeMs(timeMs: number, penalty: SolvePenalty): number | null {
  if (penalty === 'DNF') return null;
  return timeMs + (penalty === '+2' ? 2000 : 0);
}

/** Display value for the review input: +2 shows the adjusted time (0.43 → 2.43). */
export function formatAttemptValue(timeMs: number | null, penalty: SolvePenalty): string {
  if (penalty === 'DNF' || timeMs === null) return '';
  const effective = effectiveTimeMs(timeMs, penalty);
  return effective === null ? '' : (effective / 1000).toFixed(2);
}

export function parseAttempt(solveNumber: number, draft?: AttemptDraft): ParsedAttempt {
  if (!draft) {
    return { valid: false, error: `Enter a result for solve ${solveNumber}` };
  }

  const raw = draft.value.trim();
  if (draft.penalty === 'DNF' || raw.toUpperCase() === 'DNF') {
    return {
      valid: true,
      solve: { solve_number: solveNumber, time_ms: null, penalty: 'DNF' },
    };
  }

  const seconds = Number(raw);
  const timeMs = draft.timeMs ?? Math.round(seconds * 1000);
  if (
    (!raw && draft.timeMs === undefined)
    || !Number.isFinite(seconds)
    || !Number.isInteger(timeMs)
    || timeMs <= 0
  ) {
    return { valid: false, error: `Invalid time for solve ${solveNumber}` };
  }

  return {
    valid: true,
    solve: {
      solve_number: solveNumber,
      time_ms: timeMs,
      penalty: draft.penalty,
    },
  };
}

export function isAttemptValid(draft?: AttemptDraft): boolean {
  return parseAttempt(1, draft).valid;
}

export function nextSolveIndex(drafts: AttemptDrafts, solveCount: number): number {
  for (let solveNumber = 1; solveNumber <= solveCount; solveNumber += 1) {
    if (!isAttemptValid(drafts[solveNumber])) return solveNumber - 1;
  }
  return solveCount;
}

export function buildSolveInputs(
  drafts: AttemptDrafts,
  solveCount: number,
): { success: true; solves: SolveInput[] } | { success: false; error: string } {
  const solves: SolveInput[] = [];

  for (let solveNumber = 1; solveNumber <= solveCount; solveNumber += 1) {
    const parsed = parseAttempt(solveNumber, drafts[solveNumber]);
    if (!parsed.valid) return { success: false, error: parsed.error };
    solves.push(parsed.solve);
  }

  return { success: true, solves };
}
