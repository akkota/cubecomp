import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  publicDisplayWithHandle,
  publicHandle,
  publicUsername,
} from '../src/lib/public-identity.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('public identity helpers never use email', () => {
  assert.equal(publicUsername({ username: 'alice', display_name: 'Alice' }), 'alice');
  assert.equal(publicHandle({ username: 'alice' }), '@alice');
  assert.equal(
    publicDisplayWithHandle({ username: 'alice', display_name: 'Alice Wonder' }),
    'Alice Wonder (@alice)',
  );
  assert.equal(publicUsername({ username: null }), 'unknown');
});

test('navbar and profile UI do not render auth email', () => {
  const navbar = readFileSync(join(root, 'src/components/navbar.tsx'), 'utf8');
  const profile = readFileSync(join(root, 'src/app/profile/page.tsx'), 'utf8');
  const dashboard = readFileSync(join(root, 'src/app/dashboard/page.tsx'), 'utf8');

  assert.doesNotMatch(navbar, /user\.email/);
  assert.match(navbar, /publicHandle|useCurrentProfile/);
  assert.doesNotMatch(profile, /user\?\.email|user\.email/);
  assert.doesNotMatch(profile, /split\('@'\)/);
  assert.match(profile, /Your public identity on CubeComp/);
  assert.doesNotMatch(dashboard, /user\.email|split\('@'\)/);
  assert.match(dashboard, /Welcome back\{username \? `, @\$\{username\}` : ''\}/);
});

test('admin invite searches profiles by username only', () => {
  const admin = readFileSync(join(root, 'src/app/competitions/[id]/admin/page.tsx'), 'utf8');
  assert.match(admin, /Search by username/);
  assert.match(admin, /\.ilike\("username"/);
  assert.doesNotMatch(admin, /\.ilike\("email"/);
  assert.doesNotMatch(admin, /getUserByEmail|listUsers/);
  assert.match(admin, /Email addresses cannot be used to add admins/);
});

test('auth forms still collect email for login/signup only', () => {
  const login = readFileSync(join(root, 'src/components/auth/login-form.tsx'), 'utf8');
  const signup = readFileSync(join(root, 'src/components/auth/signup-form.tsx'), 'utf8');
  assert.match(login, /signInWithPassword\(\{ email/);
  assert.match(signup, /signUp\(\{ email/);
  assert.match(signup, /Email is only used to sign in/);
});

test('migration snapshots use @username not display_name/email', () => {
  const migration = readFileSync(
    join(root, 'supabase/migrations/023_snapshot_username_as_public_identity.sql'),
    'utf8',
  );
  assert.match(migration, /'@' \|\| p\.username/);
  assert.doesNotMatch(migration, /SELECT p\.display_name INTO v_profile_name/);
});
