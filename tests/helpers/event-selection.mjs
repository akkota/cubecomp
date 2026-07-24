/**
 * Event selection state helper — pure, Node-testable.
 * Keep in sync with UI usage in create-form (absolute Switch checked state).
 */
import { WCA_EVENTS } from '../../src/lib/wca-events.ts';

export function defaultFormatForEvent(eventKey) {
  return WCA_EVENTS.find(e => e.key === eventKey)?.format ?? 'average';
}

export function applyEventSelection(prev, eventKey, selected, competitionType) {
  const exists = prev.some(e => e.key === eventKey);
  if (selected) {
    if (exists) return prev;
    const next = {
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
