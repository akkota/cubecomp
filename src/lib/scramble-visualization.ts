import type { WcaEventKey } from './wca-events';

export const SCRAMBLE_PUZZLES: Record<WcaEventKey, string> = {
  '333': '3x3x3',
  '222': '2x2x2',
  '444': '4x4x4',
  '555': '5x5x5',
  '666': '6x6x6',
  '777': '7x7x7',
  '333bf': '3x3x3',
  '333fm': '3x3x3',
  '333oh': '3x3x3',
  clock: 'clock',
  mega: 'megaminx',
  pyra: 'pyraminx',
  skewb: 'skewb',
  sq1: 'square1',
  '444bf': '4x4x4',
  '555bf': '5x5x5',
  '333mbf': '3x3x3',
};

export function puzzleForScrambleEvent(eventKey: string): string {
  return SCRAMBLE_PUZZLES[eventKey as WcaEventKey] ?? '3x3x3';
}
