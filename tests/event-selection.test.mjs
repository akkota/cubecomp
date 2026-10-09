import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEventSelection } from '../src/lib/event-selection.ts';

test('selecting an unselected event adds it', () => {
  const next = applyEventSelection([], '333', true, 'standard');
  assert.equal(next.length, 1);
  assert.equal(next[0].key, '333');
});

test('selecting an already-selected event is a no-op (no double toggle)', () => {
  const prev = applyEventSelection([], '333', true, 'standard');
  const next = applyEventSelection(prev, '333', true, 'standard');
  assert.equal(next, prev);
});

test('deselecting a selected event removes it', () => {
  const prev = applyEventSelection([], '333', true, 'standard');
  const next = applyEventSelection(prev, '333', false, 'standard');
  assert.deepEqual(next, []);
});

test('deselecting an unselected event is a no-op', () => {
  const prev = [];
  const next = applyEventSelection(prev, '333', false, 'standard');
  assert.equal(next, prev);
});

test('head-to-head selection replaces any previous event', () => {
  const with333 = applyEventSelection([], '333', true, 'head_to_head');
  const with444 = applyEventSelection(with333, '444', true, 'head_to_head');
  assert.equal(with444.length, 1);
  assert.equal(with444[0].key, '444');
});
