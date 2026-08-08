import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ref } from 'vue';

import {
  IsProfanePipeBase,
  ProfanityFilter,
  ProfanitySegmentsPipeBase,
} from '../dist/angular.js';
import * as reactEntry from '../dist/react.js';
import { useIsProfane, useProfanitySegments } from '../dist/vue.js';

const BOTH = { languages: ['en', 'de'] } as const;

/* ------------------------------- vue ---------------------------------- */

test('vue: composable recomputes when the source ref changes', () => {
  const text = ref('Ein ganz normaler Satz.');
  const segments = useProfanitySegments(text, { languages: ['de'] });

  assert.deepEqual(segments.value.filter((s) => s.isProfane), []);

  text.value = 'Du Trottel!';
  assert.deepEqual(
    segments.value.filter((s) => s.isProfane).map((s) => s.text),
    ['Trottel'],
  );
});

test('vue: options may be a ref too', () => {
  const text = ref('Du Trottel!');
  const options = ref<{ languages: ('en' | 'de')[] }>({ languages: ['en'] });
  const flagged = useIsProfane(text, options);

  assert.equal(flagged.value, false); // English list only
  options.value = { languages: ['de'] };
  assert.equal(flagged.value, true);
});

test('vue: getters work as input', () => {
  // The getter has to read something reactive — computed only invalidates on
  // reactive dependencies, never on a plain variable reassignment.
  const source = ref('Klassik');
  const segments = useProfanitySegments(() => source.value.trim(), BOTH);
  assert.deepEqual(segments.value, [{ text: 'Klassik', isProfane: false }]);
  source.value = '  Arschloch  ';
  assert.equal(segments.value.some((s) => s.isProfane), true);
});

/* ----------------------------- angular -------------------------------- */

test('angular: pipe base returns segments', () => {
  const pipe = new ProfanitySegmentsPipeBase();
  const out = pipe.transform('Der Klassiker ist Mist, du Trottel.', BOTH);
  assert.deepEqual(out.filter((s) => s.isProfane).map((s) => s.text), ['Trottel']);
});

test('angular: pipe base caches by value, not by reference', () => {
  const pipe = new ProfanitySegmentsPipeBase();
  // A template passes a fresh object literal on every change-detection cycle.
  const first = pipe.transform('hello', { languages: ['en'] });
  const second = pipe.transform('hello', { languages: ['en'] });
  assert.equal(first, second, 'identical inputs must return the identical array');

  const third = pipe.transform('hello', { languages: ['de'] });
  assert.notEqual(first, third, 'changed options must recompute');
});

test('angular: boolean pipe base', () => {
  const pipe = new IsProfanePipeBase();
  assert.equal(pipe.transform('Die Massage war klasse.', BOTH), false);
  assert.equal(pipe.transform('So ein Arschloch!', BOTH), true);
});

test('angular: service applies its defaults and lets calls override them', () => {
  const filter = new ProfanityFilter({ languages: ['de'] });
  assert.equal(filter.isProfane('Du Trottel!'), true);
  assert.equal(filter.isProfane('Du Trottel!', { languages: ['en'] }), false);
});

test('angular: service masks flagged segments losslessly in length', () => {
  const filter = new ProfanityFilter({ languages: ['de'] });
  const input = 'Du Trottel!';
  const masked = filter.mask(input);
  assert.equal(masked, 'Du *******!');
  assert.equal(masked.length, input.length);
});

/* ------------------------------ react --------------------------------- */
// The hook itself needs a renderer, so this only guards the module contract:
// the entry point must load without react-dom and expose the documented API.

test('react: entry point exposes the documented API', () => {
  assert.equal(typeof reactEntry.useProfanitySegments, 'function');
  assert.equal(typeof reactEntry.useIsProfane, 'function');
  assert.equal(typeof reactEntry.filterFWordsToSegments, 'function');
});

test('react: re-exported core function behaves like the main entry', () => {
  assert.deepEqual(
    reactEntry
      .filterFWordsToSegments('Die Massage war klasse.', BOTH)
      .filter((s) => s.isProfane),
    [],
  );
});
