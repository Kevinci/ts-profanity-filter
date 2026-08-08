import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { filterFWordsToSegments } from "../dist/index.js";

const BOTH = { languages: ['en', 'de'] } as const;

function flagged(text: string, options = {}): string[] {
  return filterFWordsToSegments(text, options)
    .filter((s) => s.isProfane)
    .map((s) => s.text);
}

/**
 * Ordinary sentences that a substring matcher would wreck without the
 * allowlist. Every one of these must come back completely clean.
 */
const INNOCENT_DE = [
  'Der Klassiker: ein harscher Marsch zur Massage.',
  'Die Analyse der Hausaufgaben dauert eine Klassenstunde.',
  'Klassik, klassisch, Klassifizierung und Weltklasse.',
  'Er hat das dicke Dokument in der Sparkasse verfasst.',
  'Der Kumpel trinkt Wasser aus der Tasse in der Gasse.',
  'Die Passagiere lassen den Reisepass im Kanal fallen.',
  'Ein Barsch im Trinkwasser, das ist krass und banal.',
  'Der Assistent hat die Kassette im Kompass verstaut.',
  'Sie spickte beim Test und aß einen prickelnden Krapfen.',
  'Der Kontrabass schwankte, das Publikum blieb kunterbunt.',
  'Nass, blass und verhasst — dass das passiert!',
  'Vormarsch der Marschmusik, gespielt auf dem Fagott.',
  'Er ließ sich vom Dickicht und dem dickflüssigen Sirup nicht aufhalten.',
  'Die Massage im Elsass war klasse.',
];

const INNOCENT_EN = [
  'The classic assistant assessed the class and assumed the worst.',
  'Please pass the glass of grass-fed milk to the ambassador.',
  'A cocktail in the cockpit next to a cockroach and a peacock.',
  'The analysis of the canal was banal but analogous.',
  'Document the circumstances, then accumulate the cucumber harvest.',
  'Scunthorpe and Penistone are perfectly ordinary place names.',
  'That spicy dish looked suspicious yet auspicious.',
  'A coarse, hoarse voice parsed the sparse arsenal inventory.',
  'She was embarrassed by the potassium in the casserole.',
  'Homogeneous homophones are not homographs.',
  'The fire retardant scrapped the prickly assignment.',
  'Assemble the assets, assign the associates, assert the assumption.',
];

for (const sentence of INNOCENT_DE) {
  test(`clean [de+en]: ${sentence}`, () => {
    assert.deepEqual(flagged(sentence, BOTH), []);
  });
}

for (const sentence of INNOCENT_EN) {
  test(`clean [en]: ${sentence}`, () => {
    assert.deepEqual(flagged(sentence), []);
    assert.deepEqual(flagged(sentence, BOTH), []);
  });
}

/** The allowlist must not swallow the real thing. */
const MUST_FLAG_DE: Array<[string, string[]]> = [
  ['So ein Arschloch!', ['Arsch']],
  ['Diese verdammte Scheiße nervt.', ['verdammt', 'Scheiß']],
  ['Du Vollpfosten, du Trottel.', ['Vollpfosten', 'Trottel']],
  ['Halt die Fresse, du Hurensohn.', ['Hurensohn']],
  ['Das ist eine Sau.', ['Sau']],
  ['Er ist eine Drecksau.', ['Drecksau']],
  ['Du Blödmann!', ['Blödmann']],
];

for (const [sentence, expected] of MUST_FLAG_DE) {
  test(`flags [de]: ${sentence}`, () => {
    assert.deepEqual(flagged(sentence, { languages: ['de'] }), expected);
  });
}

const MUST_FLAG_EN: Array<[string, string[]]> = [
  ['What an asshole.', ['ass']],
  ['This is bullshit.', ['shit']],
  ['You stupid bitch.', ['bitch']],
  ['Total crap, honestly.', ['crap']],
];

for (const [sentence, expected] of MUST_FLAG_EN) {
  test(`flags [en]: ${sentence}`, () => {
    assert.deepEqual(flagged(sentence, { languages: ['en'] }), expected);
  });
}

test('anchored patterns keep German compounds clean', () => {
  // \bschwanz\b and \bsau\b
  assert.deepEqual(flagged('Ein Pferdeschwanz und eine Schwanzflosse.', BOTH), []);
  assert.deepEqual(flagged('Die Hausaufgaben sind sauber und die Sauna sauer.', BOTH), []);
  assert.deepEqual(flagged('Der Schwanz.', { languages: ['de'] }), ['Schwanz']);
});

test('German leet spellings still get caught', () => {
  assert.deepEqual(flagged('Du @rschloch, du Tr0ttel!', { languages: ['de'] }), [
    '@rsch',
    'Tr0ttel',
  ]);
});

test('allowList option adds to the built-in list', () => {
  const text = 'Meine Firma heißt Assmann GmbH.';
  assert.deepEqual(flagged(text, BOTH), ['Ass']);
  assert.deepEqual(flagged(text, { ...BOTH, allowList: ['assmann'] }), []);
});

test('allowlist survives non-aggressive mode', () => {
  assert.deepEqual(flagged('Klassik und Massage', { ...BOTH, aggressive: false }), []);
});

test('customList bypasses the built-in patterns but keeps the allowlist', () => {
  // 'ass' as a custom pattern still loses against the allowlisted 'Klassik'.
  assert.deepEqual(flagged('Klassik', { ...BOTH, customList: ['ass'] }), []);
  assert.deepEqual(flagged('assxyz', { ...BOTH, customList: ['ass'] }), ['ass']);
});

test('segments stay lossless when matches are dropped by the allowlist', () => {
  const text = 'Der Klassiker ist Mist, du Trottel.';
  const segments = filterFWordsToSegments(text, BOTH);
  assert.equal(segments.map((s) => s.text).join(''), text);
});

test('an unknown language throws rather than passing text through unfiltered', () => {
  assert.throws(
    () => flagged('This is bullshit.', { languages: ['xx'] }),
    /Unknown language 'xx'/,
  );
});

test('default language is English only', () => {
  assert.deepEqual(flagged('Du Trottel!'), []);
  assert.deepEqual(flagged('Du Trottel!', { languages: ['de'] }), ['Trottel']);
});
