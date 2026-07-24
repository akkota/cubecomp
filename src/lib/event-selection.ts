import { WCA_EVENTS, type WcaEventKey } from '@/lib/wca-events';

export type EventFormat = 'average' | 'mean';

export type SelectedEvent = {
  key: WcaEventKey;
  roundCount: number;
  format: EventFormat;
};

export function defaultFormatForEvent(eventKey: WcaEventKey): EventFormat {
  return WCA_EVENTS.find(e => e.key === eventKey)?.format ?? 'average';
}

/** Idempotent select/deselect used by the event row Switch (absolute checked state). */
export function applyEventSelection(
  prev: SelectedEvent[],
  eventKey: WcaEventKey,
  selected: boolean,
  competitionType: 'standard' | 'head_to_head',
): SelectedEvent[] {
  const exists = prev.some(e => e.key === eventKey);
  if (selected) {
    if (exists) return prev;
    const next: SelectedEvent = {
      key: eventKey,
      roundCount: 1,
      format: defaultFormatForEvent(eventKey),
    };
    if (competitionType === 'head_to_head') return [next];
    return [...prev, next];
  }
  if (!exists) return prev;
  return prev.filter(e => e.key !== eventKey);
}
