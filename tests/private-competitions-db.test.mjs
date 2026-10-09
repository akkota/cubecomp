/**
 * Execute the actual migrations and privacy RPCs on disposable PostgreSQL.
 * Only the Supabase auth schema/roles are shimmed; application SQL is unchanged.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { auditDatabaseTests } from './helpers/audit-database.mjs';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(root, 'supabase/migrations');
const config = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
const bin = config.status === 0 ? config.stdout.trim() : '';
const available = bin && ['initdb', 'pg_ctl', 'psql'].every(name => existsSync(join(bin, name)));
const skip = !available
  ? 'Local PostgreSQL tools are required for database regression tests'
  : process.getuid?.() === 0 ? 'initdb requires a non-root user' : false;

if (skip && process.env.REQUIRE_DB_TESTS === '1') throw new Error(String(skip));

function run(command, args, input) {
  // Ignore ambient libpq configuration so these tests always use their own
  // cluster, even when the developer has PGHOSTADDR/PGSERVICE/PGOPTIONS set.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
  const result = spawnSync(command, args, { input, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0,
    `${command} failed: ${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

const quote = value => value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;

test('competition password RPCs resolve pgcrypto after ordered migrations', { skip, timeout: 120_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cubecomp-passwords-'));
  const data = join(directory, 'data');
  let started = false;
  const sql = (database, query) => run(join(bin, 'psql'), [
    '-X', '-q', '-A', '-t', '--set=ON_ERROR_STOP=1',
    '--host', directory, '--username', 'postgres', '--dbname', database,
  ], query);
  const asUser = (database, user, query) => sql(database, `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claim.sub" = ${quote(user)};
    ${query}
    COMMIT;
  `);
  const asUserAsync = (database, user, query) => new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
    const child = spawn(join(bin, 'psql'), ['-X', '-q', '-A', '-t', '--set=ON_ERROR_STOP=1', '--host', directory, '--username', 'postgres', '--dbname', database], { env });
    let output = ''; let error = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    child.stdin.end(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"=${quote(user)}; ${query} COMMIT;`);
  });
  const rpc = (database, user, name, ...args) => JSON.parse(asUser(database, user,
    `SELECT public.${name}(${args.map(quote).join(', ')});`));
  const migrationFiles = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
  const repair = '024_fix_competition_password_search_path.sql';
  const apply = (database, file) => sql(database, readFileSync(join(migrations, file), 'utf8'));

  try {
    run(join(bin, 'initdb'), ['-D', data, '--username=postgres', '--auth=trust', '--no-locale']);
    run(join(bin, 'pg_ctl'), [
      '-D', data, '-l', join(directory, 'postgres.log'),
      '-o', `-c listen_addresses='' -c unix_socket_directories='${directory.replaceAll("'", "''")}'`,
      '-w', 'start',
    ]);
    started = true;
    sql('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');

    for (const mode of ['upgrade', 'fresh']) {
      await t.test(`${mode}: password and privacy behavior`, async t => {
        const database = `password_${mode}`;
        sql('postgres', `CREATE DATABASE ${database};`);
        sql(database, `
          CREATE SCHEMA auth;
          CREATE SCHEMA extensions;
          CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
          CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT, raw_user_meta_data JSONB);
          CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
            SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
          $$;
          GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT ALL ON TABLES TO anon, authenticated, service_role;
        `);
        for (const file of migrationFiles) {
          if (mode === 'upgrade' && file >= repair) break;
          apply(database, file);
        }

        const owner = randomUUID();
        const participant = randomUUID();
        sql(database, `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
          (${quote(owner)}, 'owner@example.test', '{"username":"owner"}'),
          (${quote(participant)}, 'participant@example.test', '{"username":"participant"}');`);
        const createCompetition = (type = 'standard') => {
          const id = randomUUID();
          asUser(database, owner, `INSERT INTO public.competitions
            (id, name, created_by, competition_type, visibility)
            VALUES (${quote(id)}, 'Password regression', ${quote(owner)}, ${quote(type)}, 'public');`);
          return id;
        };
        const configure = (id, visibility, password) =>
          rpc(database, owner, 'configure_competition_visibility', id, visibility, password);
        const unlock = (id, password) =>
          rpc(database, participant, 'unlock_private_competition', id, password);
        const accessCount = id => Number(sql(database,
          `SELECT count(*) FROM public.competition_access WHERE competition_id = ${quote(id)};`));
        const passwordHash = id => sql(database,
          `SELECT password_hash FROM public.competition_secrets WHERE competition_id = ${quote(id)};`);
        const expectSuccess = result => assert.equal(result.success, true, JSON.stringify(result));

        const existing = createCompetition();
        sql(database, `INSERT INTO public.competition_secrets (competition_id, password_hash)
          VALUES (${quote(existing)}, extensions.crypt('existing-password', extensions.gen_salt('bf')));
          UPDATE public.competitions SET visibility = 'private' WHERE id = ${quote(existing)};`);
        const existingHash = passwordHash(existing);

        if (mode === 'upgrade') {
          await t.test('reproduces both missing crypto functions before the repair', () => {
            const id = createCompetition();
            assert.throws(() => configure(id, 'private', 'password'), /function gen_salt\(unknown\) does not exist/);
            assert.throws(() => unlock(existing, 'existing-password'), /function crypt\(text, text\) does not exist/);
          });
          const definitions = () => sql(database, `SELECT jsonb_agg(jsonb_build_object(
              'oid', oid, 'body', prosrc, 'security_definer', prosecdef, 'permissions', proacl) ORDER BY oid)
            FROM pg_proc WHERE oid IN (
              'public.configure_competition_visibility(uuid,text,text)'::regprocedure,
              'public.unlock_private_competition(uuid,text)'::regprocedure);`);
          const before = definitions();
          apply(database, repair);
          await t.test('repair preserves function bodies, security mode, permissions, and existing hashes', () => {
            assert.equal(definitions(), before);
            assert.equal(passwordHash(existing), existingHash);
          });
        }

        if (mode === 'upgrade') for (const file of migrationFiles.filter(file => file > repair)) apply(database, file);

        await t.test('an existing private password still unlocks', () => {
          expectSuccess(unlock(existing, 'existing-password'));
          assert.equal(accessCount(existing), 1);
          assert.equal(passwordHash(existing), existingHash);
        });

        for (const type of ['standard', 'head_to_head']) {
          await t.test(`${type}: public and private creation, unlocks, and password rotation`, () => {
            const id = createCompetition(type);
            expectSuccess(unlock(id, null));
            assert.equal(accessCount(id), 0, 'public unlock must not grant remembered access');
            expectSuccess(configure(id, 'private', '  first-password  '));
            assert.equal(sql(database, `SELECT visibility FROM public.competitions WHERE id = ${quote(id)};`), 'private');
            const firstHash = passwordHash(id);
            assert.notEqual(firstHash, 'first-password', 'password is stored as a hash');
            assert.deepEqual(unlock(id, 'wrong-password'), { success: false, error: 'Incorrect competition password' });
            assert.equal(accessCount(id), 0, 'wrong password must not grant access');
            expectSuccess(unlock(id, ' first-password '));
            assert.equal(accessCount(id), 1);
            expectSuccess(unlock(id, 'first-password'));
            assert.equal(accessCount(id), 1, 'repeated unlock is idempotent');
            expectSuccess(configure(id, 'private', null));
            assert.equal(passwordHash(id), firstHash, 'keeping a password preserves its hash');
            assert.equal(accessCount(id), 1, 'keeping a password preserves remembered access');
            expectSuccess(configure(id, 'private', 'second-password'));
            assert.equal(accessCount(id), 0, 'password rotation revokes remembered access');
            assert.deepEqual(unlock(id, 'first-password'), { success: false, error: 'Incorrect competition password' });
            expectSuccess(unlock(id, 'second-password'));
            expectSuccess(configure(id, 'public', null));
            assert.equal(accessCount(id), 0);
            assert.equal(passwordHash(id), '', 'making a competition public removes the secret');
            expectSuccess(unlock(id, null));
            assert.equal(accessCount(id), 0);
            expectSuccess(configure(id, 'private', 'third-password'));
            assert.equal(accessCount(id), 0, 'a fresh private transition requires another unlock');
          });
        }

        await t.test('registration verifies private passwords and public registration needs none', () => {
          const privateId = createCompetition();
          expectSuccess(configure(privateId, 'private', 'registration-password'));
          assert.deepEqual(rpc(database, participant, 'register_for_competition', privateId, 'wrong'),
            { success: false, error: 'Incorrect competition password' });
          assert.equal(accessCount(privateId), 0);
          expectSuccess(rpc(database, participant, 'register_for_competition', privateId, 'registration-password'));
          expectSuccess(rpc(database, participant, 'register_for_competition', createCompetition(), null));
        });

        await auditDatabaseTests(t, { sql, asUser, asUserAsync, rpc, database, owner, participant });

        await t.test('authentication, admin authorization, and secret permissions remain enforced', () => {
          const id = createCompetition();
          assert.deepEqual(configure(id, 'private', null),
            { success: false, error: 'A password is required for private competitions' });
          assert.deepEqual(configure(id, 'private', 'abc'),
            { success: false, error: 'Password must be at least 4 characters' });
          assert.deepEqual(rpc(database, participant, 'configure_competition_visibility', id, 'private', 'password'),
            { success: false, error: 'Only competition admins can change visibility' });
          assert.deepEqual(rpc(database, '', 'configure_competition_visibility', id, 'private', 'password'),
            { success: false, error: 'Not authenticated' });
          assert.deepEqual(rpc(database, '', 'unlock_private_competition', id, 'password'),
            { success: false, error: 'Not authenticated' });
          assert.throws(() => asUser(database, participant, 'SELECT * FROM public.competition_secrets;'),
            /permission denied for table competition_secrets/);
        });
      });
    }
  } finally {
    if (started) run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
    rmSync(directory, { recursive: true, force: true });
  }
});
