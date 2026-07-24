/**
 * Contract checks for round_submission video_url privacy.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(
  join(root, 'supabase/migrations/021_secure_round_submission_videos.sql'),
  'utf8',
);

test('round_submissions no longer has world-readable SELECT', () => {
  assert.match(migration, /DROP POLICY IF EXISTS "Round submissions are viewable by everyone"/);
  assert.match(migration, /Submitters can view own round submissions/);
  assert.match(migration, /Admins can view round submissions/);
  assert.match(migration, /is_competition_admin/);
});

test('status RPC exists and does not select video_url', () => {
  assert.match(migration, /get_round_verification_statuses/);
  assert.match(migration, /SECURITY DEFINER/);
  const fnStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.get_round_verification_statuses');
  const fnBody = migration.slice(fnStart, migration.indexOf('$$;', fnStart) + 3);
  assert.match(fnBody, /SELECT rs\.competitor_id, rs\.verification_status/);
  assert.doesNotMatch(fnBody, /rs\.video_url|SELECT\s+.*video_url/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_round_verification_statuses\(UUID\) TO anon, authenticated/);
});

test('leaderboard uses status RPC instead of selecting video rows', () => {
  const board = readFileSync(join(root, 'src/components/competitions/leaderboard.tsx'), 'utf8');
  assert.match(board, /get_round_verification_statuses/);
  assert.doesNotMatch(board, /from\(["']round_submissions["']\)/);
});
