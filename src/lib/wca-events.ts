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
 * Calculate a single-completion result string from solves.
 * For average-of-5: drops best + worst, averages the middle 3.
 * For mean-of-3: averages all 3.
 * Returns null if not enough valid solves.
 */
export function calculateResult(
  times: (number | null)[],  // null = DNF
  format: 'average' | 'mean'
): number | 'DNF' | null {
  if (format === 'mean') {
    if (times.length > 0 && times.every(t => t !== null)) {
      return Math.round((times as number[]).reduce((a, b) => a + b, 0) / times.length);
    }
    return times.some(t => t !== null) ? 'DNF' : null;
  }

  // Average of 5: need at least 3 non-DNF solves
  const valid = times.filter(t => t !== null) as number[];
  if (valid.length < 3) return 'DNF';
  if (times.length >= 5) {
    valid.sort((a, b) => a - b);
    const middle = valid.slice(1, -1);
    return Math.round(middle.reduce((a, b) => a + b, 0) / middle.length);
  }
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
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
