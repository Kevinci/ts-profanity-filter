import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { filterFWordsToSegments } from '../dist/index.js';

const BOTH = { languages: ['en', 'de'] } as const;

const flagged = (text: string, options: object = BOTH): string[] =>
  filterFWordsToSegments(text, options)
    .filter((s) => s.isProfane)
    .map((s) => s.text);

const rejoins = (text: string, options: object = BOTH): boolean =>
  filterFWordsToSegments(text, options)
    .map((s) => s.text)
    .join('') === text;

/* --------------------------- spaced-out text --------------------------- */

test('letters pulled apart by separators are matched', () => {
  assert.deepEqual(flagged('D r e c k s a u'), ['D r e c k s a u']);
  assert.deepEqual(flagged('f u c k'), ['f u c k']);
  assert.deepEqual(flagged('D-r-e-c-k-s-a-u'), ['D-r-e-c-k-s-a-u']);
  assert.deepEqual(flagged('D.r.e.c.k.s.a.u'), ['D.r.e.c.k.s.a.u']);
  assert.deepEqual(flagged('a s s h o l e'), ['a s s']);
});

test('the match covers the separators it swallowed, so nothing is lost', () => {
  for (const text of ['D r e c k s a u', 'Du bist eine S a u, echt.', 'f-u-c-k off']) {
    assert.equal(rejoins(text), true, text);
  }
});

test('a spaced run must be whole one-letter words, not word fragments', () => {
  // The regression this guards: 'to a c' inside 'next to a cockroach' is
  // letter-space-letter-space-letter, but 'o' and 'c' belong to real words.
  // Collapsing it produced 'toacockroach' and a false 'cock' the allowlist
  // could no longer clear.
  assert.deepEqual(flagged('A cocktail in the cockpit next to a cockroach.'), []);
  assert.deepEqual(flagged('Es war ein Uhr, als er zu ihr in das Haus am See ging.'), []);
  assert.deepEqual(flagged('Ich sah, wie er es tat, und ob er es je zu tun wagt.'), []);
});

test('ordinary hyphenated compounds are left alone', () => {
  for (const text of [
    'Die Nord-Süd-Achse und die E-Mail-Adresse des Ober-Staats-Anwalts.',
    'grass-fed milk, state-of-the-art, mother-in-law',
    'Das Drei-Gänge-Menü im Vier-Sterne-Hotel.',
  ]) {
    assert.deepEqual(flagged(text), [], text);
  }
});

/* ---------------------------- repetition ------------------------------- */

test('runs of three or more identical characters collapse', () => {
  assert.deepEqual(flagged('Dreeecksau'), ['Dreeecksau']);
  assert.deepEqual(flagged('fuuuuck'), ['fuuuuck']);
  assert.deepEqual(flagged('shiiiit'), ['shiiiit']);
  assert.deepEqual(flagged('Sauuuu'), ['Sauuuu']);
});

test('doubles are ordinary spelling and stay untouched', () => {
  // Collapsing pairs would turn Klasse into Klase and break the allowlist.
  for (const text of [
    'Klasse, Kasse, Masse, Tasse, Fässer, Wasser.',
    'Die Schifffahrt auf der Aaa in Betttuch und Brennnessel.',
  ]) {
    assert.deepEqual(flagged(text), [], text);
  }
});

/* ------------------------- invisible characters ------------------------ */

test('zero-width characters cannot break a word up', () => {
  assert.deepEqual(flagged('Dreck​sau'), ['Dreck​sau']);
  assert.deepEqual(flagged('f‍uck'), ['f‍uck']);
  assert.equal(rejoins('Dreck​sau'), true);
});

test('decomposed diacritics are matched like the composed form', () => {
  // Built from escapes on purpose: 'a' + U+0308 combining diaeresis is a
  // separate code point that no character class can reach, and writing it
  // literally would let an editor silently normalise it back to composed.
  const decomposed = 'Dra' + String.fromCharCode(0x0308) + 'cksau';
  assert.equal(decomposed.length, 9, 'the diaeresis must be its own code point');
  assert.notEqual(decomposed, decomposed.normalize('NFC'));

  assert.deepEqual(flagged(decomposed), [decomposed]);
  assert.equal(rejoins(decomposed), true);
});

/* ------------------------------ interplay ------------------------------ */

test('normalisation and the allowlist agree with each other', () => {
  // Spaced out, the surrounding word is judged as the word it really is.
  assert.deepEqual(flagged('K l a s s i k'), []);
  assert.deepEqual(flagged('Klaaassik'), []);
});

test('normalisation only runs with aggressive on', () => {
  assert.deepEqual(flagged('D r e c k s a u', { ...BOTH, aggressive: false }), []);
  assert.deepEqual(flagged('Dreeecksau', { ...BOTH, aggressive: false }), []);
});

test('a mixed sentence keeps clean and flagged spans in the right places', () => {
  const text = 'Hallo D r e c k s a u, du Dreeecksack, bis morgen.';
  const segments = filterFWordsToSegments(text, BOTH);
  assert.equal(segments.map((s) => s.text).join(''), text);
  assert.deepEqual(
    segments.filter((s) => s.isProfane).map((s) => s.text),
    ['D r e c k s a u', 'Dreeecksack'],
  );
  assert.equal(segments[0]!.text, 'Hallo ');
  assert.equal(segments[segments.length - 1]!.text, ', bis morgen.');
});

/* --------------------------- engine support ---------------------------- */

test('no shipped file contains a lookbehind regex literal', async () => {
  // A regex literal is compiled when the script is parsed, so one the engine
  // cannot handle is a syntax error for the whole module — importing the
  // package would fail outright rather than losing one feature. Lookbehind is
  // the last construct engines shipped (Safari only from 16.4), so it must be
  // built with `new RegExp` and allowed to fail on its own.
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const offenders: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.js')) {
        const source = await readFile(path, 'utf8');
        // A literal starts with `/`; `new RegExp('(?<…` is the allowed form.
        if (/\/[^\n'"`]*\(\?<[=!]/.test(source)) offenders.push(path);
      }
    }
  };
  await walk('dist');

  assert.deepEqual(offenders, [], 'these would break the whole module on Safari < 16.4');
});
