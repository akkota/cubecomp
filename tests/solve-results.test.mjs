import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSolveInputs,
  effectiveTimeMs,
  formatAttemptValue,
  nextSolveIndex,
} from '../src/lib/solve-results.ts';

const normal = (seconds) => ({ value: String(seconds), penalty: 'none' });
const dnf = () => ({ value: '', penalty: 'DNF' });

test('normal timer results preserve raw milliseconds', () => {
  const result = buildSolveInputs({
    1: { value: '12.35', timeMs: 12347, penalty: 'none' },
    2: normal(13),
    3: normal(14),
  }, 3);

  assert.equal(result.success, true);
  assert.equal(result.solves[0].time_ms, 12347);
});

test('+2 stores raw time and produces exactly one two-second adjustment', () => {
  const result = buildSolveInputs({
    1: { value: '2.43', timeMs: 430, penalty: '+2' },
    2: normal(13),
    3: normal(14),
  }, 3);

  assert.equal(result.success, true);
  assert.deepEqual(result.solves[0], {
    solve_number: 1,
    time_ms: 430,
    penalty: '+2',
  });
  assert.equal(effectiveTimeMs(result.solves[0].time_ms, result.solves[0].penalty), 2430);
  assert.equal(formatAttemptValue(430, '+2'), '2.43');
});

test('DNF is valid without a numeric time', () => {
  const result = buildSolveInputs({
    1: dnf(),
    2: normal(13),
    3: normal(14),
  }, 3);

  assert.equal(result.success, true);
  assert.deepEqual(result.solves[0], {
    solve_number: 1,
    time_ms: null,
    penalty: 'DNF',
  });
});

test('repeated solve data does not advance past the first missing solve', () => {
  const drafts = {
    1: normal(10),
    3: normal(12),
  };

  assert.equal(nextSolveIndex(drafts, 5), 1);
  drafts[1] = normal(11);
  assert.equal(nextSolveIndex(drafts, 5), 1);
});

test('mo3 requires exactly three valid results', () => {
  const incomplete = buildSolveInputs({ 1: normal(10), 2: normal(11) }, 3);
  const complete = buildSolveInputs({ 1: normal(10), 2: normal(11), 3: dnf() }, 3);

  assert.equal(incomplete.success, false);
  assert.equal(complete.success, true);
  assert.equal(complete.solves.length, 3);
});

test('ao5 requires exactly five valid results', () => {
  const drafts = Object.fromEntries(
    [1, 2, 3, 4, 5].map((solveNumber) => [solveNumber, normal(9 + solveNumber)]),
  );
  const result = buildSolveInputs(drafts, 5);

  assert.equal(result.success, true);
  assert.equal(result.solves.length, 5);
});

test('invalid submission can be corrected and retried', () => {
  const drafts = { 1: normal(10), 2: { value: '', penalty: 'none' }, 3: dnf() };
  const failed = buildSolveInputs(drafts, 3);
  assert.equal(failed.success, false);

  drafts[2] = { value: '11.25', penalty: '+2' };
  const retried = buildSolveInputs(drafts, 3);
  assert.equal(retried.success, true);
});
