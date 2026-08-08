import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';

import {
  filterFWordsToSegments,
  getLanguage,
  hasLanguage,
  listLanguages,
  registerLanguage,
  resetLanguages,
  resolveKey,
  unregisterLanguage,
} from '../dist/index.js';

afterEach(() => resetLanguages());

const flagged = (text: string, options = {}): string[] =>
  filterFWordsToSegments(text, options)
    .filter((s) => s.isProfane)
    .map((s) => s.text);

/* ---------------------------- registering ----------------------------- */

test('en and de are registered out of the box', () => {
  assert.deepEqual(listLanguages(), ['en', 'de']);
  assert.equal(hasLanguage('en'), true);
  assert.equal(hasLanguage('fr'), false);
});

test('a brand new language works end to end', () => {
  registerLanguage('fr', {
    profanity: ['merde', 'connard', 'salope', 'putain'],
    allow: ['\\p{L}*connaiss\\p{L}*'], // connaissance, connaisseur
  });

  assert.equal(hasLanguage('fr'), true);
  assert.deepEqual(listLanguages(), ['en', 'de', 'fr']);
  assert.deepEqual(flagged('Quelle merde alors', { languages: ['fr'] }), ['merde']);
  assert.deepEqual(flagged('Quelle merde alors', { languages: ['en'] }), []);
});

test('languages compose without touching each other', () => {
  registerLanguage('fr', { profanity: ['merde'] });
  const text = 'Total bullshit, du Trottel, quelle merde.';
  assert.deepEqual(flagged(text, { languages: ['en', 'de', 'fr'] }), [
    'shit',
    'Trottel',
    'merde',
  ]);
});

test("languages: '*' uses everything registered", () => {
  registerLanguage('fr', { profanity: ['merde'] });
  assert.deepEqual(flagged('bullshit Trottel merde', { languages: '*' }), [
    'shit',
    'Trottel',
    'merde',
  ]);
});

test('registering an existing code replaces it', () => {
  registerLanguage('en', { profanity: ['banana'] });
  assert.deepEqual(listLanguages(), ['en', 'de']);
  assert.deepEqual(flagged('banana shit'), ['banana']);
});

test('a definition may be profanity-only or allow-only', () => {
  registerLanguage('empty', {});
  assert.deepEqual(getLanguage('empty'), { profanity: [], allow: [] });
  registerLanguage('allowonly', { allow: ['\\p{L}*klass\\p{L}*'] });
  assert.deepEqual(flagged('Klassik', { languages: ['en', 'allowonly'] }), []);
});

/* ------------------------------ extends ------------------------------- */

test('extends inherits the parent and adds on top', () => {
  registerLanguage('de-AT', { extends: 'de', profanity: ['oasch', 'gschissana'] });

  const lists = getLanguage('de-AT')!;
  assert.equal(lists.profanity.includes('arsch'), true, 'inherited from de');
  assert.equal(lists.profanity.includes('oasch'), true, 'own addition');
  assert.equal(lists.allow.length > 0, true, 'inherited the allowlist too');

  assert.deepEqual(flagged('Du Oasch, du Trottel!', { languages: ['de-AT'] }), [
    'Oasch',
    'Trottel',
  ]);
  // The parent is untouched by the child.
  assert.deepEqual(flagged('Du Oasch!', { languages: ['de'] }), []);
});

test('extends chains several levels deep', () => {
  registerLanguage('a', { profanity: ['aaa'] });
  registerLanguage('b', { extends: 'a', profanity: ['bbb'] });
  registerLanguage('c', { extends: 'b', profanity: ['ccc'] });
  assert.deepEqual(getLanguage('c')!.profanity, ['aaa', 'bbb', 'ccc']);
});

test('the inherited allowlist still clears the parent false positives', () => {
  registerLanguage('de-AT', { extends: 'de', profanity: ['oasch'] });
  assert.deepEqual(flagged('Der Klassiker war klasse.', { languages: ['en', 'de-AT'] }), []);
});

test('extending an unregistered language is refused', () => {
  assert.throws(
    () => registerLanguage('xx', { extends: 'nope', profanity: ['a'] }),
    /extends 'nope', which is not registered/,
  );
});

test('a cycle is refused', () => {
  registerLanguage('p', { profanity: ['p'] });
  registerLanguage('q', { extends: 'p', profanity: ['q'] });
  assert.throws(() => registerLanguage('p', { extends: 'q' }), /would create a cycle/);
});

/* --------------------------- subtag fallback --------------------------- */

test('an unregistered regional tag falls back to its base language', () => {
  assert.equal(resolveKey('de-CH'), 'de');
  assert.equal(resolveKey('en-GB-oed'), 'en');
  assert.deepEqual(flagged('Du Trottel!', { languages: ['de-CH'] }), ['Trottel']);
});

test('a registered regional tag wins over the base', () => {
  registerLanguage('de-AT', { extends: 'de', profanity: ['oasch'] });
  assert.equal(resolveKey('de-AT'), 'de-at');
  assert.equal(resolveKey('de-AT-1996'), 'de-at');
  assert.equal(resolveKey('de-CH'), 'de');
});

test('codes are case-insensitive and trimmed', () => {
  registerLanguage('  Fr  ', { profanity: ['merde'] });
  assert.equal(hasLanguage('FR'), true);
  assert.deepEqual(flagged('merde', { languages: ['fR'] }), ['merde']);
});

test('a truly unknown language throws instead of silently passing text through', () => {
  assert.throws(
    () => filterFWordsToSegments('bullshit', { languages: ['klingon'] }),
    /Unknown language 'klingon'.*Registered: en, de/s,
  );
});

/* ---------------------------- validation ------------------------------ */

test('a malformed profanity pattern is rejected at registration', () => {
  assert.throws(
    () => registerLanguage('bad', { profanity: ['fuck', '(unclosed'] }),
    /profanity\[1\] "\(unclosed" is not a valid regular expression/,
  );
  assert.equal(hasLanguage('bad'), false, 'nothing is registered on failure');
});

test('a pattern that only breaks under aggressive expansion is rejected too', () => {
  // Valid on its own, but the expansion rewrites the group name to w[o0]rd.
  assert.throws(
    () => registerLanguage('bad', { profanity: ['(?<word>fuck)'] }),
    /becomes invalid once aggressive matching expands the letters in it/,
  );
});

test('a character class survives expansion but changes meaning — documented, not caught', () => {
  // [abc] becomes [[a@4]b[c(k<]]: still a legal regex, different semantics.
  // Nothing throws here; this pins the behaviour so it cannot change silently.
  registerLanguage('classy', { profanity: ['[abc]'] });
  assert.equal(hasLanguage('classy'), true);
  assert.deepEqual(flagged('b', { languages: ['classy'], aggressive: false }), ['b']);
});

test('a malformed allow pattern is rejected', () => {
  assert.throws(
    () => registerLanguage('bad', { allow: ['\\p{Nope}*'] }),
    /allow\[0\].*is not a valid regular expression/,
  );
});

test('non-string and empty patterns are rejected', () => {
  // @ts-expect-error deliberately wrong type
  assert.throws(() => registerLanguage('bad', { profanity: [42] }), /must be a non-empty string/);
  assert.throws(() => registerLanguage('bad', { profanity: [''] }), /must be a non-empty string/);
  assert.throws(() => registerLanguage('', { profanity: ['a'] }), /non-empty string/);
});

test('the stored lists are copies, so later mutation cannot change behaviour', () => {
  const patterns = ['merde'];
  registerLanguage('fr', { profanity: patterns });
  patterns.push('bonjour');
  assert.deepEqual(getLanguage('fr')!.profanity, ['merde']);
  assert.deepEqual(flagged('bonjour merde', { languages: ['fr'] }), ['merde']);
});

/* --------------------------- unregistering ----------------------------- */

test('unregisterLanguage removes a language and reports whether it existed', () => {
  registerLanguage('fr', { profanity: ['merde'] });
  assert.equal(unregisterLanguage('fr'), true);
  assert.equal(unregisterLanguage('fr'), false);
  assert.equal(hasLanguage('fr'), false);
});

test('a language that others extend cannot be pulled out from under them', () => {
  registerLanguage('de-AT', { extends: 'de', profanity: ['oasch'] });
  assert.throws(() => unregisterLanguage('de'), /still extended by de-at/);
  assert.equal(unregisterLanguage('de-AT'), true);
  assert.equal(unregisterLanguage('de'), true);
});

test('resetLanguages restores exactly the built-ins', () => {
  registerLanguage('fr', { profanity: ['merde'] });
  unregisterLanguage('en');
  resetLanguages();
  assert.deepEqual(listLanguages(), ['en', 'de']);
  assert.deepEqual(flagged('bullshit'), ['shit']);
});

/* ------------------------------ caching -------------------------------- */

test('re-registering a language takes effect immediately despite the regex cache', () => {
  assert.deepEqual(flagged('banana', { languages: ['en'] }), []);
  registerLanguage('en', { profanity: ['banana'] });
  assert.deepEqual(flagged('banana', { languages: ['en'] }), ['banana']);
  resetLanguages();
  assert.deepEqual(flagged('banana', { languages: ['en'] }), []);
});
