import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateResult,
  getAverageExcludedIndices,
} from '../src/lib/wca-events.ts';

test('ao5 averages the middle three after dropping best and worst', () => {
  // 0.54 best, 10.06 worst → (1300+1300+560)/3 = 1053.33 → 1053
  const result = calculateResult([1300, 10060, 1300, 540, 560], 'average');
  assert.equal(result, 1053);
});

test('ao5 with one DNF drops DNF as worst and best, averages remaining three', () => {
  // times: 1000, DNF, 2000, 3000, 4000 → drop 1000 and DNF → (2000+3000+4000)/3
  const result = calculateResult([1000, null, 2000, 3000, 4000], 'average');
  assert.equal(result, 3000);
});

test('ao5 with two DNFs is DNF', () => {
  const result = calculateResult([700, null, 3610, 2970, null], 'average');
  assert.equal(result, 'DNF');
});

test('ao5 incomplete with two DNFs is already DNF', () => {
  assert.equal(calculateResult([1000, null, null], 'average'), 'DNF');
});

test('ao5 incomplete without two DNFs has no result yet', () => {
  assert.equal(calculateResult([1000, 2000, null], 'average'), null);
});

test('mo3 with any DNF is DNF', () => {
  assert.equal(calculateResult([1000, null, 2000], 'mean'), 'DNF');
  assert.equal(calculateResult([null, null, null], 'mean'), 'DNF');
});

test('mo3 averages all three valid solves', () => {
  assert.equal(calculateResult([1000, 2000, 3000], 'mean'), 2000);
});

test('mo3 incomplete without DNF has no result yet', () => {
  assert.equal(calculateResult([1000, 2000], 'mean'), null);
});

test('ao5 brackets mark best and worst in solve order', () => {
  const times = [1300, 10060, 1300, 540, 560];
  const excluded = getAverageExcludedIndices(times);
  assert.deepEqual([...excluded].sort(), [1, 3]); // 10.06 worst, 0.54 best
});

test('ao5 brackets mark best and a DNF as worst', () => {
  const times = [700, null, 3610, 2970, 1000];
  const excluded = getAverageExcludedIndices(times);
  assert.ok(excluded.has(1)); // DNF worst
  assert.ok(excluded.has(0)); // 0.70 best
});
