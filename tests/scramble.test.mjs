import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WCA_EVENTS } from '../src/lib/wca-events.ts';
import { ScrambleCard } from '../src/components/competitions/scramble-card.tsx';
import {
  APP_TO_CUBING_EVENT,
  cubingEventForAppEvent,
  generateScrambles,
  supportedScrambleEvents,
} from '../src/lib/scramble.ts';
import { SCRAMBLE_PUZZLES, puzzleForScrambleEvent } from '../src/lib/scramble-visualization.ts';

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

test('scramble card renders stored scramble text for every app WCA event', () => {
  for (const eventKey of expectedEvents) {
    const scramble = `${eventKey} STORED SCRAMBLE`;
    const markup = renderToStaticMarkup(
      React.createElement(ScrambleCard, {
        eventKey,
        scramble,
        label: 1,
      }),
    );

    assert.match(markup, /<code/);
    assert.ok(markup.includes(scramble), eventKey);
    assert.ok(!markup.includes('randomScrambleForEvent'), eventKey);
  }
});
