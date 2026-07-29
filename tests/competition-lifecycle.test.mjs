/**
 * Competition lifecycle: registration open/closed and status derivation.
 * Mirrors supabase/migrations/022_competition_lifecycle_gates.sql intent.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  competitionRegistrationOpen,
  deriveCompetitionStatus,
} from '../src/lib/competition-status.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(
  join(root, 'supabase/migrations/022_competition_lifecycle_gates.sql'),
  'utf8',
);

const NOW = new Date('2026-07-24T18:00:00.000Z');

test('registration open before start and without end', () => {
  assert.equal(
    competitionRegistrationOpen({
      status: 'upcoming',
      startsAt: '2026-07-25T00:00:00.000Z',
      endsAt: null,
      rounds: [],
      now: NOW,
    }),
    true,
  );
});

test('registration open while ongoing with future end', () => {
  assert.equal(
    competitionRegistrationOpen({
      status: 'ongoing',
      startsAt: '2026-07-20T00:00:00.000Z',
      endsAt: '2026-07-30T00:00:00.000Z',
      rounds: [{ status: 'active' }],
      now: NOW,
    }),
    true,
  );
});

test('registration blocked after ends_at even if status still upcoming', () => {
  assert.equal(
    competitionRegistrationOpen({
      status: 'upcoming',
      endsAt: '2026-07-23T00:00:00.000Z',
      rounds: [{ status: 'pending' }],
      now: NOW,
    }),
    false,
  );
});

test('registration blocked when stored status is completed', () => {
  assert.equal(
    competitionRegistrationOpen({
      status: 'completed',
      endsAt: null,
      rounds: [{ status: 'completed' }],
      now: NOW,
    }),
    false,
  );
});

test('registration blocked when stored status is cancelled', () => {
  assert.equal(
    competitionRegistrationOpen({
      status: 'cancelled',
      rounds: [],
      now: NOW,
    }),
    false,
  );
});

test('registration blocked when all rounds completed even if status stale', () => {
  assert.equal(
    competitionRegistrationOpen({
      status: 'ongoing',
      endsAt: null,
      rounds: [{ status: 'completed' }, { status: 'completed' }],
      now: NOW,
    }),
    false,
  );
});

test('registration blocked for H2H once bracket is ready', () => {
  assert.equal(
    competitionRegistrationOpen({
      status: 'upcoming',
      competitionType: 'head_to_head',
      tournamentStatuses: ['ready'],
      rounds: [],
      now: NOW,
    }),
    false,
  );
});

test('status flips to completed when ends_at passes (refresh-safe)', () => {
  assert.equal(
    deriveCompetitionStatus([{ status: 'pending' }], {
      status: 'upcoming',
      endsAt: '2026-07-01T00:00:00.000Z',
      now: NOW,
    }),
    'completed',
  );
  // Same inputs after "page refresh" (new now still after ends_at) stay completed
  assert.equal(
    deriveCompetitionStatus([{ status: 'pending' }], {
      status: 'upcoming',
      endsAt: '2026-07-01T00:00:00.000Z',
      now: new Date('2026-08-01T00:00:00.000Z'),
    }),
    'completed',
  );
});

test('status is ongoing during active round before end', () => {
  assert.equal(
    deriveCompetitionStatus([{ status: 'active' }], {
      status: 'upcoming',
      endsAt: '2026-08-01T00:00:00.000Z',
      now: NOW,
    }),
    'ongoing',
  );
});

test('migration closes registration and hides completed-round scrambles', () => {
  assert.match(migration, /competition_registration_open/);
  assert.match(migration, /competition_effective_status/);
  assert.match(migration, /refresh_competition_status/);
  assert.match(migration, /ends_at/);
  assert.match(migration, /Registration is closed for this competition/);
  // Scramble policy must require active rounds for non-admins
  assert.match(migration, /r\.status = 'active'/);
  assert.doesNotMatch(
    migration.slice(migration.indexOf('Scrambles visible to eligible users')),
    /r\.status IN \('active', 'completed'\)/,
  );
});

test('privacy action refreshes status before register RPC', () => {
  const actions = readFileSync(join(root, 'src/actions/competitionPrivacy.ts'), 'utf8');
  assert.match(actions, /refresh_competition_status/);
  assert.match(actions, /competition_registration_open/);
  assert.match(actions, /register_for_competition/);
});

test('detail page blocks register CTA when registration is closed', () => {
  const page = readFileSync(join(root, 'src/app/competitions/[id]/page.tsx'), 'utf8');
  // Unregistered + closed must short-circuit before any "Register to compete" path
  const closedGate = page.indexOf('if (!registrationOpen)');
  const registerLabel = page.indexOf("'Register to compete'");
  assert.ok(closedGate > 0, 'expected registrationOpen gate in getRoundAccess');
  assert.ok(registerLabel > closedGate, 'Register CTA must come after closed-registration gate');
  // Round click must not open registration when closed (spectators may still navigate)
  assert.match(page, /!isRegistered && !isOwner && !isAdmin && registrationOpen/);
  assert.match(page, /Registration is closed for this competition/);
});

test('detail page only exposes head-to-head UI for head-to-head competitions', () => {
  const page = readFileSync(join(root, 'src/app/competitions/[id]/page.tsx'), 'utf8');

  assert.match(page, /const isH2H = competition\.competition_type === 'head_to_head'/);
  assert.doesNotMatch(page, /useState\(false\).*isH2H|setH2H/);
  assert.doesNotMatch(page, /<TabsTrigger[^>]+value=["'](?:head-to-head|head_to_head|tournaments)["']/);
  assert.match(page, /\{isH2H \? \(/);
});
