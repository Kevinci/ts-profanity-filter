// Tests for the benchmark itself.
//
// A benchmark that is wrong is worse than none, so the corpus gets checked for
// the mistakes that would quietly invalidate every number it prints.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { CATEGORIES, CORPUS } from '../dist/corpus.js';
import { run, selectAttacks } from '../dist/run.js';
import { formatReport } from '../dist/report.js';

/* ------------------------------ the corpus ------------------------------ */

test('every id is unique — a report is diffed by id', () => {
  const ids = CORPUS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every attack declares a language, an expectation and a note', () => {
  for (const attack of CORPUS) {
    assert.ok(attack.languages.length > 0, `${attack.id}: no language`);
    assert.ok(['flag', 'clean'].includes(attack.expect), `${attack.id}: bad expectation`);
    assert.ok(attack.note.length > 0, `${attack.id}: no note`);
    assert.ok(attack.text.length > 0, `${attack.id}: empty text`);
  }
});

test('both halves are substantial — neither can be a token gesture', () => {
  const flag = CORPUS.filter((a) => a.expect === 'flag').length;
  const clean = CORPUS.filter((a) => a.expect === 'clean').length;

  assert.ok(flag >= 20, `only ${flag} evasion attacks`);
  assert.ok(clean >= 20, `only ${clean} false-positive attacks`);
  // Not equal, but not lopsided either: a 90/10 split would let one half of the
  // score be decided by noise.
  const ratio = Math.min(flag, clean) / Math.max(flag, clean);
  assert.ok(ratio > 0.5, `halves are lopsided: ${flag} flag vs ${clean} clean`);
});

test('each language has attacks of both kinds', () => {
  for (const lang of ['en', 'de'] as const) {
    const mine = CORPUS.filter((a) => a.languages.includes(lang));
    assert.ok(mine.some((a) => a.expect === 'flag'), `${lang}: nothing to evade`);
    assert.ok(mine.some((a) => a.expect === 'clean'), `${lang}: no false positives`);
  }
});

/* ---------------------------- the scoring ------------------------------- */

const always = { name: 'always', detect: () => true };
const never = { name: 'never', detect: () => false };

test('a filter that flags everything scores 100/0, not 100', () => {
  return run(always).then((report) => {
    assert.equal(report.score.evasionResistance, 1);
    assert.equal(report.score.precision, 0);
  });
});

test('a filter that flags nothing scores 0/100', async () => {
  const report = await run(never);
  assert.equal(report.score.evasionResistance, 0);
  assert.equal(report.score.precision, 1);
});

test('the control cases are passable — otherwise nothing below them means anything', async () => {
  const control = await run(
    // The dumbest possible real filter: plain substring matching.
    {
      name: 'substring',
      detect: (text: string) =>
        ['asshole', 'drecksau', 'shit', 'fuck'].some((w) => text.toLowerCase().includes(w)),
    },
    { categories: ['control'] },
  );
  assert.equal(control.score.evasionResistance, 1, 'plain spellings must be catchable');
  assert.equal(control.score.precision, 1, 'clean controls must be passable');
});

/* ------------------------------ selection ------------------------------- */

test('language and category filters narrow the run', () => {
  const en = selectAttacks({ languages: ['en'] });
  assert.ok(en.length > 0 && en.length < CORPUS.length);
  assert.ok(en.every((a) => a.languages.includes('en')));

  const leet = selectAttacks({ categories: ['leet'] });
  assert.ok(leet.every((a) => a.category === 'leet'));
});

test('an unknown category selects nothing rather than everything', () => {
  assert.equal(selectAttacks({ categories: ['does-not-exist'] }).length, 0);
});

/* ------------------------------- runner --------------------------------- */

test('a filter that throws fails that attack and the run continues', async () => {
  let calls = 0;
  const report = await run({
    name: 'flaky',
    detect: () => {
      if (++calls === 3) throw new Error('boom');
      return true;
    },
  });

  assert.equal(report.results.length, CORPUS.length, 'run completed');
  const thrown = report.results.filter((r) => r.error);
  assert.equal(thrown.length, 1);
  assert.equal(thrown[0]!.passed, false);
  assert.equal(thrown[0]!.detected, null);
});

test('an async detect is awaited, not counted as truthy', async () => {
  const report = await run({ name: 'async', detect: async () => false });
  assert.equal(report.score.evasionResistance, 0, 'a Promise must not read as true');
});

/* ------------------------------- report --------------------------------- */

test('the report names the failures and makes invisible characters visible', async () => {
  const text = formatReport(await run(never, { categories: ['invisible'] }));

  assert.match(text, /evasion resistance/);
  assert.match(text, /failing/);
  assert.match(text, /U\+200B/, 'a zero-width space must not print as nothing');
});

test('every category appears in the byCategory breakdown', async () => {
  const report = await run(never);
  assert.deepEqual(Object.keys(report.byCategory).sort(), [...CATEGORIES].sort());
});
