// All 17 official WCA events with metadata
// Event keys follow WCA notation: https://www.worldcubeassociation.org/regulations/

export type WcaEventKey = typeof WCA_EVENTS[number]['key'];

export interface WcaEvent {
  key: string;
  name: string;
  format: 'average' | 'mean';    // average = avg of 5 (trimmed), mean = mean of 3
  solveCount: number;             // attempts per round
  icon: string;
}

export const WCA_EVENTS = [
  { key: '333',  name: '3x3x3 Cube',              format: 'average', solveCount: 5, icon: '🧊' },
  { key: '222',  name: '2x2x2 Cube',              format: 'average', solveCount: 5, icon: '🟦' },
  { key: '444',  name: '4x4x4 Cube',              format: 'average', solveCount: 5, icon: '🟩' },
  { key: '555',  name: '5x5x5 Cube',              format: 'average', solveCount: 5, icon: '🟨' },
  { key: '666',  name: '6x6x6 Cube',              format: 'mean',    solveCount: 3, icon: '🟧' },
  { key: '777',  name: '7x7x7 Cube',              format: 'mean',    solveCount: 3, icon: '🟥' },
  { key: '333bf',name: '3x3x3 Blindfolded',       format: 'mean',    solveCount: 3, icon: '🙈' },
  { key: '333fm',name: '3x3x3 Fewest Moves',     format: 'mean',    solveCount: 3, icon: '🧠' },
  { key: '333oh',name: '3x3x3 One-Handed',        format: 'average', solveCount: 5, icon: '✋' },
  { key: 'clock', name: 'Clock',                   format: 'average', solveCount: 5, icon: '🕐' },
  { key: 'mega',  name: 'Megaminx',                format: 'average', solveCount: 5, icon: '🟣' },
  { key: 'pyra',  name: 'Pyraminx',                format: 'average', solveCount: 5, icon: '🔺' },
  { key: 'skewb', name: 'Skewb',                   format: 'average', solveCount: 5, icon: '🔷' },
  { key: 'sq1',   name: 'Square-1',                format: 'average', solveCount: 5, icon: '🔲' },
  { key: '444bf',name: '4x4x4 Blindfolded',       format: 'mean',    solveCount: 3, icon: '🙈' },
  { key: '555bf',name: '5x5x5 Blindfolded',       format: 'mean',    solveCount: 3, icon: '🙈' },
  { key: '333mbf',name: '3x3x3 Multi-Blind',       format: 'mean',    solveCount: 3, icon: '🧩' },
] as const;

export function getEventByKey(key: string): WcaEvent | undefined {
  return WCA_EVENTS.find(e => e.key === key);
}

/**
 * Calculate a WCA-style round result from solve times (ms).
 * null = DNF/DNS.
 *
 * Mean of 3: any DNF → DNF; otherwise mean of all 3.
 * Average of 5: drop best + worst, average the middle 3.
 *   DNF counts as worst. Two or more DNFs → DNF.
 */
export function calculateResult(
  times: (number | null)[],
  format: 'average' | 'mean'
): number | 'DNF' | null {
  if (format === 'mean') {
    if (times.length < 3) {
      // Incomplete mean: already DNF if any DNF present, otherwise no result yet
      if (times.some(t => t === null)) return 'DNF';
      return null;
    }
    if (times.some(t => t === null)) return 'DNF';
    const total = (times as number[]).reduce((a, b) => a + b, 0);
    return Math.round(total / 3);
  }

  // Average of 5
  if (times.length < 5) {
    // Incomplete Ao5: 2+ DNFs already guarantees DNF
    if (times.filter(t => t === null).length >= 2) return 'DNF';
    return null;
  }

  // Treat DNF as +Infinity so it sorts as the worst time
  const ranked = times
    .map(t => (t === null ? Number.POSITIVE_INFINITY : t))
    .sort((a, b) => a - b);

  // Drop best (index 0) and worst (index 4); average the middle three
  const middle = ranked.slice(1, 4);
  if (middle.some(t => !Number.isFinite(t))) return 'DNF';

  return Math.round(middle.reduce((a, b) => a + b, 0) / 3);
}

/**
 * Indices of the best and worst solves excluded from an Ao5 (WCA parentheses).
 * Keeps solve order; picks the first matching index on ties.
 */
export function getAverageExcludedIndices(times: (number | null)[]): Set<number> {
  const excluded = new Set<number>();
  if (times.length < 5) return excluded;

  let bestIdx = -1;
  let bestVal = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i];
    if (t !== null && t < bestVal) {
      bestVal = t;
      bestIdx = i;
    }
  }

  let worstIdx = -1;
  // Prefer a DNF as worst (if multiple DNFs, the first one that isn't best)
  for (let i = 0; i < times.length; i += 1) {
    if (times[i] === null && i !== bestIdx) {
      worstIdx = i;
      break;
    }
  }
  if (worstIdx === -1) {
    let worstVal = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < times.length; i += 1) {
      const t = times[i];
      if (t !== null && i !== bestIdx && t > worstVal) {
        worstVal = t;
        worstIdx = i;
      }
    }
  }

  if (bestIdx >= 0) excluded.add(bestIdx);
  if (worstIdx >= 0) excluded.add(worstIdx);
  return excluded;
}

export function formatTime(ms: number | null | 'DNF'): string {
  if (ms === 'DNF' || ms === null) return 'DNF';
  if (ms === -1) return 'DNS';
  const seconds = ms / 1000;
  if (seconds < 60) return seconds.toFixed(2);
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}
