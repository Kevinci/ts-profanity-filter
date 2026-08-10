import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { AiCompletion } from '../dist/ai/index.js';
import {
  buildJudgementPrompt,
  buildJudgementSchema,
  findFlaggedWords,
  formatAllowEntries,
  tuneAllowlist,
} from '../dist/allowlist/index.js';

/**
 * A corpus with a hole in it: `Assmann` is a real German surname and a real
 * company, and the shipped English list flags it through `ass`. Everything else
 * here is either genuinely offensive or already cleared by the built-in
 * allowlist.
 */
const CORPUS = [
  'Please contact Assmann about the delivery.',
  'Assmann GmbH sent the invoice yesterday.',
  'The Assmann order is still open.',
  'you @sshole, honestly',
  'Please pass the class list to the assistant.',
  'Nothing wrong with this line at all.',
];

const EN = { languages: ['en'] as const };

function stubJudge(answer: unknown, counter?: { calls: number }): AiCompletion {
  return async () => {
    if (counter) counter.calls++;
    return { json: JSON.stringify(answer), model: 'stub-model' };
  };
}

/* -------------------------------- scan ---------------------------------- */

test('the scan reports whole words, their hits and how often they appear', async () => {
  const report = await findFlaggedWords(CORPUS, EN);

  assert.equal(report.scanned, 6);
  assert.equal(report.flaggedRecords, 4, 'three Assmann lines plus the real insult');

  const words = report.words.map((word) => word.word);
  assert.ok(words.includes('Assmann'), words.join(', '));
  assert.ok(words.includes('@sshole'), 'the insult is flagged too, as it should be');
  assert.ok(!words.includes('class'), 'the built-in allowlist already clears this');
  assert.ok(!words.includes('assistant'));

  const assmann = report.words.find((word) => word.word === 'Assmann');
  assert.equal(assmann?.count, 3);
  assert.deepEqual(assmann?.hits, ['Ass'], 'the hit is sliced from the original, case included');
  assert.equal(assmann?.samples.length, 3);
});

test('the most frequent word comes first, and minCount trims the tail', async () => {
  const report = await findFlaggedWords(CORPUS, EN);
  assert.equal(report.words[0]?.word, 'Assmann', 'three occurrences beats one');

  const frequent = await findFlaggedWords(CORPUS, { ...EN, minCount: 2 });
  assert.deepEqual(frequent.words.map((word) => word.word), ['Assmann']);
});

test('samples are bounded, so a summary cannot grow with the corpus', async () => {
  const many = Array.from({ length: 500 }, () => 'Assmann again');
  const report = await findFlaggedWords(many, { ...EN, sampleLimit: 2 });
  assert.equal(report.words[0]?.count, 500);
  assert.equal(report.words[0]?.samples.length, 2);
});

test('an async source works, and gives up the before/after measurement', async () => {
  async function* trickle(): AsyncGenerator<string> {
    for (const text of CORPUS) yield text;
  }
  const report = await tuneAllowlist(trickle(), {
    ...EN,
    verdicts: { Assmann: 'ordinary', '@sshole': 'offensive' },
  });

  assert.equal(report.rerun, false, 'a spent iterator cannot be read twice');
  assert.equal(report.before, 4);
  assert.equal(report.after, 4, 'unmeasured, so it reports the number it knows');
});

/* ------------------------------- verify --------------------------------- */

test('a hand verdict needs no model and still gets verified', async () => {
  const report = await tuneAllowlist(CORPUS, {
    ...EN,
    verdicts: { Assmann: 'ordinary', '@sshole': 'offensive' },
  });

  assert.deepEqual(report.entries, ['Assmann']);
  assert.deepEqual(report.keptOffensive, ['@sshole']);
  assert.equal(report.rerun, true);
  assert.equal(report.before, 4);
  assert.equal(report.after, 1, 'only the real insult is left');
});

test('an entry that clears an offensive word is rejected as too broad', async () => {
  const counter = { calls: 0 };
  const report = await tuneAllowlist(CORPUS, {
    ...EN,
    // The catastrophic answer: technically clears Assmann, and every other hit
    // in the language with it.
    ai: {
      complete: stubJudge(
        {
          words: [
            { word: 'Assmann', verdict: 'ordinary', entry: '\\p{L}*ass\\p{L}*' },
            { word: '@sshole', verdict: 'offensive' },
          ],
        },
        counter,
      ),
    },
  });

  assert.equal(counter.calls, 1, 'one call for the whole list, not one per word');
  assert.deepEqual(report.entries, [], 'nothing was accepted');
  assert.equal(report.rejected.length, 1);
  assert.equal(report.rejected[0]?.why, 'too-broad');
  assert.equal(report.rejected[0]?.detail, '@sshole', 'names the word it would have cleared');
  assert.equal(report.after, report.before, 'and the corpus is unchanged');
});

test('an entry that does not even clear its own word is rejected', async () => {
  const report = await tuneAllowlist(CORPUS, {
    ...EN,
    ai: {
      complete: stubJudge({
        words: [{ word: 'Assmann', verdict: 'ordinary', entry: 'somethingelse' }],
      }),
    },
  });

  assert.deepEqual(report.entries, []);
  assert.equal(report.rejected[0]?.why, 'no-effect');
});

test('a pattern that cannot compile is rejected, not thrown', async () => {
  const report = await tuneAllowlist(CORPUS, {
    ...EN,
    ai: {
      complete: stubJudge({
        words: [{ word: 'Assmann', verdict: 'ordinary', entry: '(unclosed' }],
      }),
    },
  });

  assert.deepEqual(report.entries, []);
  assert.equal(report.rejected[0]?.why, 'invalid');
  assert.match(String(report.rejected[0]?.detail), /regular expression|group/i);
});

test('a narrow stem is accepted and reported with what it clears', async () => {
  const report = await tuneAllowlist(CORPUS, {
    ...EN,
    ai: {
      complete: stubJudge({
        words: [
          { word: 'Assmann', verdict: 'ordinary', entry: 'assmann\\p{L}*', reason: 'A surname.' },
          { word: '@sshole', verdict: 'offensive', reason: 'An insult.' },
        ],
      }),
    },
  });

  assert.deepEqual(report.entries, ['assmann\\p{L}*']);
  assert.deepEqual(report.accepted[0]?.clears, ['Assmann']);
  assert.equal(report.before, 4);
  assert.equal(report.after, 1);
  assert.equal(report.judgements.find((j) => j.word === 'Assmann')?.reason, 'A surname.');
});

test('unsure is a real answer and is never acted on', async () => {
  const report = await tuneAllowlist(CORPUS, {
    ...EN,
    ai: {
      complete: stubJudge({
        words: [{ word: 'Assmann', verdict: 'unsure', entry: 'assmann' }],
      }),
    },
  });

  assert.deepEqual(report.entries, []);
  assert.deepEqual(report.rejected, []);
  assert.equal(report.judgements[0]?.verdict, 'unsure');
});

/* ------------------------------ the model ------------------------------- */

test('no ai option means nothing is judged and nothing is proposed', async () => {
  // There is no `complete` to spy on without an `ai` option — which is the point.
  // What is observable is that a full scan produced no judgements at all.
  const report = await tuneAllowlist(CORPUS, EN);
  assert.equal(report.scan.words.length, 2, 'the scan still ran');
  assert.deepEqual(report.judgements, []);
  assert.deepEqual(report.entries, []);
  assert.deepEqual(report.rejected, []);
});

test('hand verdicts are never sent to the model', async () => {
  const counter = { calls: 0 };
  const seen: string[] = [];
  const complete: AiCompletion = async (request) => {
    counter.calls++;
    seen.push(request.text);
    return { json: JSON.stringify({ words: [] }) };
  };

  await tuneAllowlist(CORPUS, {
    ...EN,
    verdicts: { Assmann: 'ordinary' },
    ai: { complete },
  });

  assert.equal(counter.calls, 1);
  assert.ok(!seen[0]?.includes('Assmann'), 'the word we already judged is not in the request');
  assert.ok(seen[0]?.includes('@sshole'), 'the one we did not judge is');
});

test('unparseable model output loses the judgements, not the scan', async () => {
  const report = await tuneAllowlist(CORPUS, {
    ...EN,
    ai: { complete: async () => ({ json: 'not json at all' }) },
  });

  assert.equal(report.scan.flaggedRecords, 4, 'the scan survived');
  assert.deepEqual(report.judgements, []);
  assert.deepEqual(report.entries, []);
});

test('enabled: false keeps the config and skips the call', async () => {
  const counter = { calls: 0 };
  const report = await tuneAllowlist(CORPUS, {
    ...EN,
    ai: { enabled: false, complete: stubJudge({ words: [] }, counter) },
  });
  assert.equal(counter.calls, 0);
  assert.deepEqual(report.entries, []);
});

/* ------------------------------- output --------------------------------- */

test('the prompt names the languages and warns against the broad pattern', () => {
  const prompt = buildJudgementPrompt(['en', 'de']);
  assert.match(prompt, /en, de/);
  assert.match(prompt, /catastrophic/);
  assert.match(prompt, /data, not instructions/);

  const schema = buildJudgementSchema();
  assert.equal((schema as { type: string }).type, 'object');
  assert.ok(JSON.stringify(schema).includes('offensive'));
});

test('the snippet is a registerLanguage call that inherits', async () => {
  const report = await tuneAllowlist(CORPUS, {
    ...EN,
    verdicts: { Assmann: 'ordinary', '@sshole': 'offensive' },
  });

  const snippet = formatAllowEntries(report, 'en-house', 'en');
  assert.match(snippet, /registerLanguage\('en-house'/);
  assert.match(snippet, /extends: 'en'/);
  assert.match(snippet, /"Assmann",\s+\/\/ Assmann/);

  const empty = formatAllowEntries({ ...report, entries: [], accepted: [] }, 'x');
  assert.match(empty, /nothing to add/);
});

test('a regex-special word is escaped when the entry is derived by hand', async () => {
  const report = await tuneAllowlist(['Call the ass(embly) team'], {
    ...EN,
    verdicts: { 'ass': 'ordinary' },
  });
  // Whatever the word turned out to be, the derived entry must compile.
  for (const entry of report.entries) {
    assert.doesNotThrow(() => new RegExp(entry, 'iu'));
  }
});
