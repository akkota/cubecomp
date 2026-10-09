import assert from 'node:assert/strict';
import test from 'node:test';
import { safeRedirectPath } from '../src/lib/safe-redirect.ts';
import { fetchAllPages } from '../src/lib/pagination.ts';

test('redirect accepts internal paths and rejects browser-normalized external URLs', () => {
  for (const value of ['//evil.test', '/\\evil.test', '\\evil.test', 'https://evil.test', '/\nevil.test', '/\tevil.test', '/\0evil.test']) {
    assert.equal(safeRedirectPath(value), '/dashboard', JSON.stringify(value));
  }
  for (const value of ['/competitions/123', '/profile?tab=history#latest', '/a%20b', '/xyz']) {
    assert.equal(safeRedirectPath(value), value);
  }
});

test('pagination respects a server cap smaller than the requested page and preserves all records', async () => {
  const source = Array.from({ length: 1207 }, (_, id) => ({ id }));
  const calls = [];
  const rows = await fetchAllPages(async (from, to) => {
    calls.push([from, to]);
    return { data: source.slice(from, Math.min(to + 1, from + 83)), error: null };
  });
  assert.deepEqual(rows, source);
  assert.equal(calls.at(-1)[0], 1207);
});

test('pagination fails rather than using partial data after a later page error', async () => {
  await assert.rejects(fetchAllPages(async from => from ? { data: null, error: { message: 'query failed' } }
    : { data: [1, 2], error: null }), /query failed/);
});
