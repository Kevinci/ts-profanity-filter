// Adversarial Unicode suite.
//
// The lossless invariant — `segments.map(s => s.text).join('') === input` —
// proves only that nothing was dropped while rebuilding the string. It says
// nothing about whether the *boundaries* still land on the right characters
// after normalisation, and that is where a filter with three internal
// representations of the input (original, folded haystack, segments) actually
// goes wrong.
//
// So every case here asserts the offsets: which slice of the ORIGINAL string
// each flagged segment covers.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { filterFWordsToSegments } from '../dist/index.js';

const DE = { languages: ['de'] } as const;

/** `[start, end, text]` of every flagged segment, in original-string offsets. */
function spans(text: string, options: object = DE): [number, number, string][] {
  const segments = filterFWordsToSegments(text, options);

  // The lossless invariant still has to hold everywhere, so check it here
  // rather than repeating it in every test.
  assert.equal(segments.map((s) => s.text).join(''), text, `lossless: ${JSON.stringify(text)}`);

  // No segment may begin or end inside a surrogate pair. A lone surrogate
  // renders as U+FFFD on its own, and the join invariant above would still
  // pass — this is exactly the class of bug it cannot see.
  for (const s of segments) {
    assert.ok(
      !/[\uD800-\uDBFF]$/.test(s.text) && !/^[\uDC00-\uDFFF]/.test(s.text),
      `segment splits a surrogate pair: ${JSON.stringify(s.text)}`,
    );
  }

  const out: [number, number, string][] = [];
  let at = 0;
  for (const s of segments) {
    if (s.isProfane) out.push([at, at + s.text.length, s.text]);
    at += s.text.length;
  }
  return out;
}

/** Asserts the flagged offsets, and that they slice the expected text back out. */
function expectSpans(text: string, expected: [number, number][], options: object = DE): void {
  const found = spans(text, options);
  assert.deepEqual(
    found.map(([a, b]) => [a, b]),
    expected,
    `spans for ${JSON.stringify(text)}`,
  );
  for (const [a, b, slice] of found) {
    assert.equal(slice, text.slice(a, b), 'segment text must equal the original slice');
  }
}

/* ------------------------- 1. combining marks -------------------------- */

test('composed and decomposed umlauts both map back onto the original', () => {
  const composed = 'Du Dräcksau'; // ä as one character
  const decomposed = 'Du Dräcksau'; // a + combining diaeresis

  expectSpans(composed, [[3, 11]]);
  // One character longer in the original, and the span has to grow with it.
  expectSpans(decomposed, [[3, 12]]);
});

test('a decomposed umlaut inside an allowed word stays allowed', () => {
  assert.deepEqual(spans('Drei Fässer Bier'), []);
});

test('an uncomposable mark is ignored rather than breaking the match', () => {
  // U+0353 has no precomposed form with `e`, so composition cannot help;
  // the mark is dropped for matching instead.
  expectSpans('Du Dre͓cksau', [[3, 12]]);
});

/* ---------------------- 2. zero-width / format ------------------------- */

test('zero-width characters inside a word do not break the match', () => {
  for (const [name, ch] of [
    ['ZWSP', '​'],
    ['ZWJ', '‍'],
    ['ZWNJ', '‌'],
    ['RLM', '‏'],
    ['word joiner', '⁠'],
  ] as const) {
    // The span has to swallow the invisible character, or the segments would
    // not rejoin — which is why this asserts offsets and not just the text.
    expectSpans(`Du Dreck${ch}sau`, [[3, 12]], DE);
    assert.ok(true, name);
  }
});

/* ------------------- 3. surrogate pairs / astral ----------------------- */

test('emoji next to a match never end up inside the flagged span', () => {
  expectSpans('Du Drecksau\u{1F600}', [[3, 11]]);
  expectSpans('\u{1F600}Drecksau', [[2, 10]]);
});

test('an emoji separates words, so an anchored stem still matches', () => {
  // `sau` is anchored to whole words. An emoji is not a letter, so it is a
  // boundary — someone splitting the word with one gets caught on the tail.
  expectSpans('Du Dreck\u{1F600}sau', [[10, 13]]);
});

/* ---------------------- 4. variation selectors ------------------------- */

test('a variation selector stays attached to its base character', () => {
  // VS16 is a combining mark. Splitting it off the `u` would break the
  // grapheme cluster, so the span covers it.
  expectSpans('Du Drecksau️', [[3, 12]]);
  expectSpans('Du Dreck︎sau', [[3, 12]]);
});

/* -------------------- 5. compatibility spellings ----------------------- */

test('compatibility variants fold to the letters the patterns are written in', () => {
  // All of these are NFKC-identical to `Drecksau`. Under NFC they walked
  // straight past every pattern.
  expectSpans('Du Ｄｒｅｃｋｓａｕ', [[3, 11]]); // fullwidth
  expectSpans('Du Ⓓⓡⓔⓒⓚⓢⓐⓤ', [[3, 11]]); // circled
  expectSpans('Du \u{1D403}\u{1D42B}\u{1D41E}\u{1D41C}\u{1D424}\u{1D42C}\u{1D41A}\u{1D42E}', [
    [3, 19], // eight astral characters — sixteen code units
  ]);
});

test('a folded character that expands still maps back to the one original', () => {
  // The ligature is one character in the input and two in the haystack, so
  // the map is one entry per output code unit pointing at the same source.
  expectSpans('Du Drecksauﬁx', [[3, 11]]);
});

test('NFC, NFD and NFKC inputs all resolve to the same word', () => {
  const base = 'Du Dräcksau';
  expectSpans(base.normalize('NFC'), [[3, 11]]);
  expectSpans(base.normalize('NFD'), [[3, 12]]);
  expectSpans(base.normalize('NFKC'), [[3, 11]]);
});

/* ------------------------- 6. repetition ------------------------------- */

test('a stretched word is flagged over its full original length', () => {
  expectSpans('Du Dreeecksau', [[3, 13]]);
  expectSpans('Du Drecksauuuu', [[3, 14]]);
});

test('repetition inside an allowed word stays allowed', () => {
  assert.deepEqual(spans('Viele Klaaassiker'), []);
  assert.deepEqual(spans('Viele Kl4444ssiker'), []);
});

/* --------------------- 7. word boundaries ------------------------------ */

test('anchored stems use Unicode word boundaries, not ASCII ones', () => {
  // `\b` is defined in terms of `\w`, which stays ASCII even under the `u`
  // flag — so every `ß` and every umlaut read as a word boundary and these
  // ordinary compounds came back flagged.
  for (const word of ['Ein Straußschwanz', 'Grüßschwanz', 'Die Straußsau', 'Die Mäusesau']) {
    assert.deepEqual(spans(word), [], word);
  }

  // ASCII neighbours were always handled correctly and must stay that way.
  for (const word of ['Das Hausschwein', 'Ein Wildschwein', 'Der Pfauenschwanz']) {
    assert.deepEqual(spans(word), [], word);
  }
});

test('the anchored stems still fire as standalone words', () => {
  expectSpans('Du Sau', [[3, 6]]);
  expectSpans('Du Schwein', [[3, 10]]);
  assert.deepEqual(spans('Die Sauna'), []);
  assert.deepEqual(spans('Meine Hausaufgaben'), []);
  assert.deepEqual(spans('Alles sauber'), []);
});

test('scripts without spaces do not confuse the boundaries', () => {
  expectSpans('你好Drecksau你好', [[2, 10]]);
  assert.deepEqual(spans('你好Klassik'), []);
});

/* ----------------------- 8. multiple matches --------------------------- */

test('adjacent matches produce separate, non-overlapping spans', () => {
  const found = spans('Drecksau Arschloch');
  assert.deepEqual(
    found.map(([a, b]) => [a, b]),
    [
      [0, 8],
      [9, 14],
    ],
  );
  // Spans must be ordered and must not touch or overlap.
  for (let i = 1; i < found.length; i++) {
    assert.ok(found[i]![0] >= found[i - 1]![1], 'spans overlap');
  }
});

/* --------------------------- 9. emoji ---------------------------------- */

test('emoji are not word-list entries', () => {
  // Deliberate: the pictograph carries no verdict on its own. A peach in a
  // recipe and a peach in an insult are the same character, so a pattern
  // cannot separate them — that judgement belongs to the model layer.
  for (const text of ['Lutsch mein 🍆', 'Ich esse eine 🍑', '🐵🐵🐵', 'Du 🐒']) {
    assert.deepEqual(spans(text), [], text);
  }
});

/* ------------------- 10. found by the adversarial suite ----------------- */

test('surnames and place names are not insults', () => {
  // Every one of these was flagged until the benchmark said so. A false
  // positive on somebody's name is the most expensive kind.
  for (const text of [
    'Professor Cockburn will speak',
    'she lives in Lightwater',
    'Matsushita Electric Industrial',
    'signed by John Hancock',
    'a novel by Dickens',
  ]) {
    assert.deepEqual(spans(text, { languages: ['en'] }), [], text);
  }
});

test('masking characters stand in for the letter they hide', () => {
  // People type these because some *other* filter trained them to.
  assert.equal(spans('f*ck this', { languages: ['en'] }).length, 1);
  assert.equal(spans('sh#t', { languages: ['en'] }).length, 1);
  assert.equal(spans('a$$hole', { languages: ['en'] }).length, 1);
});

test('an asterisk in ordinary text is still an asterisk', () => {
  for (const text of [
    'The **assignment** is due Monday',
    'SELECT * FROM users',
    'I am a C# developer',
    '#hashtag #classic #assessment',
    'Der Kurs kostet 5 * 20 Euro',
  ]) {
    assert.deepEqual(spans(text, { languages: ['en', 'de'] }), [], text);
  }
});

test('more of the alphabet has cross-script twins', () => {
  assert.equal(spans('shιt', { languages: ['en'] }).length, 1, 'Greek iota');
  assert.equal(spans('Drескsau', { languages: ['de'] }).length, 1, 'several Cyrillic letters');
});
