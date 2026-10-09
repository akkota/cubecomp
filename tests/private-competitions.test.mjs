/**
 * Smoke checks for private-competition client contracts.
 * Executable DB/RPC regression coverage lives in private-competitions-db.test.mjs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('migration 009 hashes passwords and never grants secret SELECT to clients', () => {
  const sql = readFileSync(join(root, 'supabase/migrations/009_private_competitions.sql'), 'utf8');
  assert.match(sql, /crypt\(trim\(p_password\),\s*gen_salt\('bf'\)\)/);
  assert.match(sql, /REVOKE ALL ON TABLE competition_secrets FROM anon, authenticated/);
  assert.match(sql, /visibility TEXT NOT NULL DEFAULT 'public'/);
  assert.match(sql, /Incorrect competition password/);
  assert.match(sql, /Already registered for this competition/);
  // Unlock alone must not grant round/scramble access — registration required
  assert.match(sql, /Password unlock alone is not enough/);
  assert.match(sql, /user_can_access_round/);
});

test('competition type includes visibility', () => {
  const types = readFileSync(join(root, 'src/types/database.ts'), 'utf8');
  assert.match(types, /visibility: 'public' \| 'private'/);
});

test('privacy server actions wrap RPCs without returning hashes', () => {
  const actions = readFileSync(join(root, 'src/actions/competitionPrivacy.ts'), 'utf8');
  assert.match(actions, /unlock_private_competition/);
  assert.match(actions, /register_for_competition/);
  assert.match(actions, /configure_competition_visibility/);
  assert.doesNotMatch(actions, /password_hash/);
});
