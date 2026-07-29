import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WCA_EVENTS } from '../src/lib/wca-events.ts';
import {
  APP_TO_CUBING_EVENT,
  cubingEventForAppEvent,
  generateScrambles,
  supportedScrambleEvents,
  validateScrambleBatch,
} from '../src/lib/scramble.ts';
import { SCRAMBLE_PUZZLES, puzzleForScrambleEvent } from '../src/lib/scramble-visualization.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const expectedEvents = [
  '333',
  '222',
  '444',
  '555',
  '666',
  '777',
  '333bf',
  '333fm',
  '333oh',
  'clock',
  'mega',
  'pyra',
  'skewb',
  'sq1',
  '444bf',
  '555bf',
  '333mbf',
];
const sortedExpectedEvents = [...expectedEvents].sort();

test('scramble generation supports every app WCA event', async () => {
  assert.deepEqual(WCA_EVENTS.map((event) => event.key), expectedEvents);
  assert.deepEqual(supportedScrambleEvents(), expectedEvents);
  assert.deepEqual(Object.keys(APP_TO_CUBING_EVENT).sort(), sortedExpectedEvents);

  for (const eventKey of expectedEvents) {
    const [scramble] = await generateScrambles(eventKey, 1);
    assert.equal(typeof scramble, 'string', eventKey);
    assert.ok(scramble.length > 0, eventKey);
  }
});

test('app event keys map to official cubing event ids where they differ', () => {
  assert.equal(cubingEventForAppEvent('mega'), 'minx');
  assert.equal(cubingEventForAppEvent('pyra'), 'pyram');
  assert.equal(cubingEventForAppEvent('333'), '333');
  assert.throws(() => cubingEventForAppEvent('not-wca'), /Unsupported WCA event/);
});

test('visualization maps every app WCA event to a cubing puzzle', () => {
  assert.deepEqual(Object.keys(SCRAMBLE_PUZZLES).sort(), sortedExpectedEvents);

  for (const eventKey of expectedEvents) {
    assert.equal(typeof puzzleForScrambleEvent(eventKey), 'string', eventKey);
    assert.ok(puzzleForScrambleEvent(eventKey).length > 0, eventKey);
  }

  assert.equal(puzzleForScrambleEvent('mega'), 'megaminx');
  assert.equal(puzzleForScrambleEvent('pyra'), 'pyraminx');
  assert.equal(puzzleForScrambleEvent('sq1'), 'square1');
});

test('scramble card bundles the official state renderer and retains text fallback', () => {
  const card = readFileSync(
    join(root, 'src/components/competitions/scramble-card.tsx'),
    'utf8',
  );

  assert.match(card, /import \{ TwistyPlayer \} from 'cubing\/twisty'/);
  assert.doesNotMatch(card, /await import\('cubing\/twisty'\)/);
  assert.match(card, /experimentalSetupAlg: scramble/);
  assert.match(card, /\{scramble\}/);
  assert.match(card, /Visualization unavailable — retry/);
  assert.doesNotMatch(card, /randomScrambleForEvent/);
});

test('validateScrambleBatch enforces count and non-empty text', () => {
  assert.deepEqual(validateScrambleBatch(['R U', 'U R'], 2), ['R U', 'U R']);
  assert.throws(() => validateScrambleBatch(['R U'], 2), /Expected 2/);
  assert.throws(() => validateScrambleBatch(['', 'U'], 2), /empty/);
  assert.throws(() => validateScrambleBatch('nope', 1), /Expected 1/);
});

test('admin generates scrambles in an externalized Node server action', () => {
  const admin = readFileSync(join(root, 'src/app/competitions/[id]/admin/page.tsx'), 'utf8');
  const actions = readFileSync(join(root, 'src/actions/generateScrambles.ts'), 'utf8');
  const config = readFileSync(join(root, 'next.config.ts'), 'utf8');
  const layout = readFileSync(join(root, 'src/app/competitions/[id]/admin/layout.tsx'), 'utf8');

  assert.match(admin, /generateScramblesAction/);
  assert.doesNotMatch(admin, /from ["']@\/lib\/scramble["']/);
  assert.doesNotMatch(admin, /Timed out/);
  assert.doesNotMatch(admin, /25000/);
  assert.match(actions, /generateAndStoreScrambles/);
  assert.match(config, /serverExternalPackages/);
  assert.match(config, /cubing/);
  assert.match(layout, /runtime = "nodejs"/);
  assert.match(layout, /maxDuration = 60/);
});

test('scramble module configures immediate prefetch for warm sequential generation', () => {
  const scrambleLib = readFileSync(join(root, 'src/lib/scramble.ts'), 'utf8');
  assert.match(scrambleLib, /scramblePrefetchLevel:\s*'immediate'/);
  assert.doesNotMatch(scrambleLib, /prioritizeEsbuildWorkaroundForWorkerInstantiation:\s*true/);
});
