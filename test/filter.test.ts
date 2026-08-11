import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { filterFWordsToSegments } from '../dist/index.js';
import type { TextSegment } from '../dist/index.js';

/** Re-joining all segments must always reproduce the input exactly. */
function joined(segments: TextSegment[]): string {
  return segments.map((s) => s.text).join('');
}

test('returns a single clean segment for empty input', () => {
  assert.deepEqual(filterFWordsToSegments(''), [{ text: '', isProfane: false }]);
  assert.deepEqual(filterFWordsToSegments('   '), [{ text: '   ', isProfane: false }]);
});

test('returns a single clean segment when nothing matches', () => {
  const result = filterFWordsToSegments('Hello there, friend.');
  assert.deepEqual(result, [{ text: 'Hello there, friend.', isProfane: false }]);
});

test('splits text around a match', () => {
  const result = filterFWordsToSegments('This is bullshit.');
  assert.deepEqual(result, [
    { text: 'This is bull', isProfane: false },
    { text: 'shit', isProfane: true },
    { text: '.', isProfane: false },
  ]);
});

test('matches case-insensitively and handles multiple hits', () => {
  const result = filterFWordsToSegments('Fuck this SHIT');
  assert.deepEqual(result, [
    { text: 'Fuck', isProfane: true },
    { text: ' this ', isProfane: false },
    { text: 'SHIT', isProfane: true },
  ]);
});

test('handles a match at the very start and end', () => {
  const result = filterFWordsToSegments('fuck');
  assert.deepEqual(result, [{ text: 'fuck', isProfane: true }]);
});

test('aggressive mode catches leet-speak substitutions', () => {
  const leet = filterFWordsToSegments('sh1t happens');
  assert.deepEqual(leet[0], { text: 'sh1t', isProfane: true });

  const at = filterFWordsToSegments('b@stard');
  assert.deepEqual(at[0], { text: 'b@stard', isProfane: true });
});

test('non-aggressive mode only matches the literal patterns', () => {
  const result = filterFWordsToSegments('sh1t happens', { aggressive: false });
  assert.deepEqual(result, [{ text: 'sh1t happens', isProfane: false }]);
});

test('customList replaces the default list', () => {
  const result = filterFWordsToSegments('banana shit', {
    customList: ['banana'],
    aggressive: false,
  });
  assert.deepEqual(result, [
    { text: 'banana', isProfane: true },
    { text: ' shit', isProfane: false },
  ]);
});

test('an empty customList falls back to the defaults', () => {
  const result = filterFWordsToSegments('shit', { customList: [] });
  assert.deepEqual(result, [{ text: 'shit', isProfane: true }]);
});

test('segments always reconstruct the original input', () => {
  const inputs = [
    'This is bullshit.',
    'fuckfuck',
    'a$$ no wait, asshole',
    'clean text',
    '   fuck   ',
    'Ümläüte und shit',
  ];
  for (const input of inputs) {
    assert.equal(joined(filterFWordsToSegments(input)), input, input);
  }
});

test('adjacent matches do not produce empty clean segments', () => {
  const result = filterFWordsToSegments('fuckshit');
  assert.deepEqual(result, [
    { text: 'fuck', isProfane: true },
    { text: 'shit', isProfane: true },
  ]);
});

test('a custom pattern that can match empty does not hang', () => {
  const result = filterFWordsToSegments('abc', {
    customList: ['x*'],
    aggressive: false,
  });
  assert.equal(joined(result), 'abc');
});
