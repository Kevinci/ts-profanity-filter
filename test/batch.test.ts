import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { AiCompletion } from '../dist/ai/index.js';
import {
  formatSummary,
  runBatch,
  streamBatch,
  type BatchResult,
  type BatchSummary,
} from '../dist/batch/index.js';
import {
  createNdjsonWriter,
  csvFrom,
  csvRowsFrom,
  linesFrom,
  ndjsonFrom,
  recordsFrom,
} from '../dist/batch/node.js';
import { renderSummaryPdf } from '../dist/batch/report.js';

const EN = { languages: ['en'] as const };

/** Two flagged, three clean — the counts every assertion below is built on. */
const CORPUS = [
  'a perfectly ordinary sentence',
  'what the sh1t is this',
  'please pass the class list',       // the cross-check must keep this clean
  'you @sshole',
  'nothing to see here',
];

function stubModel(answer: Record<string, unknown>, counter?: { calls: number }): AiCompletion {
  return async () => {
    if (counter) counter.calls++;
    return { json: JSON.stringify(answer), model: 'stub-model' };
  };
}

const CLEAN_VERDICT = {
  flagged: false,
  severity: 'none',
  categories: [],
  confidence: 0.9,
  reason: 'Harmless.',
};
const FLAGGED_VERDICT = {
  flagged: true,
  severity: 'high',
  categories: ['harassment'],
  confidence: 0.9,
  reason: 'Targeted.',
  quote: 'you',
};

async function collect(
  source: Iterable<string> | AsyncIterable<string>,
  options?: Parameters<typeof streamBatch>[1],
): Promise<{ results: BatchResult[]; summary: BatchSummary }> {
  const iterator = streamBatch(source, options);
  const results: BatchResult[] = [];
  for (;;) {
    const step = await iterator.next();
    if (step.done === true) return { results, summary: step.value };
    results.push(step.value);
  }
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tpf-batch-'));
}

/* ------------------------------ the local run --------------------------- */

test('a batch over an array counts what it found', async () => {
  const summary = await runBatch(CORPUS, { filter: EN });

  assert.equal(summary.processed, 5);
  assert.equal(summary.flagged, 2);
  assert.equal(summary.matchedList, 2);
  assert.equal(summary.aiCalls, 0, 'no ai option means no model is contacted');
  assert.equal(summary.errors, 0);
  assert.equal(summary.aborted, false);
  assert.ok(summary.elapsedMs >= 0);
});

test('results keep the input order and carry the id through', async () => {
  const records = CORPUS.map((text, i) => ({ text, id: `row-${i}` }));
  const { results } = await collect(records as never, { filter: EN });

  assert.deepEqual(
    results.map((result) => result.index),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    results.map((result) => result.id),
    ['row-0', 'row-1', 'row-2', 'row-3', 'row-4'],
  );
  assert.deepEqual(
    results.filter((result) => result.flagged).map((result) => result.id),
    ['row-1', 'row-3'],
  );
});

test('segments are omitted unless asked for', async () => {
  const without = await collect(CORPUS, { filter: EN });
  assert.ok(without.results.every((result) => result.segments === undefined));

  const included = await collect(CORPUS, { filter: EN, segments: true });
  assert.ok(included.results.every((result) => Array.isArray(result.segments)));
  const flagged = included.results.find((result) => result.matchedList);
  assert.ok(flagged?.segments?.some((segment) => segment.isProfane));
});

test('the word lists can be switched off entirely', async () => {
  const summary = await runBatch(CORPUS, { filter: false });
  assert.equal(summary.matchedList, 0);
  assert.equal(summary.flagged, 0);
});

test('PII detection joins the run when asked', async () => {
  const summary = await runBatch(
    ['write to kevin@example.de', 'nothing here', 'IBAN DE44 5001 0517 5407 3249 31'],
    { filter: EN, pii: true },
  );

  assert.equal(summary.piiRecords, 2);
  assert.equal(summary.piiFindings, 2);
  assert.deepEqual(summary.piiByKind, { email: 1, iban: 1 });
  assert.equal(summary.flagged, 2, 'a PII finding flags the record on its own');
});

test('an async source is consumed as it arrives', async () => {
  async function* trickle(): AsyncGenerator<string> {
    for (const text of CORPUS) yield text;
  }
  const summary = await runBatch(trickle(), { filter: EN });
  assert.equal(summary.processed, 5);
  assert.equal(summary.flagged, 2);
});

/* ------------------------------- the gate ------------------------------- */

test('by default the model is only asked about records a list already hit', async () => {
  const counter = { calls: 0 };
  const summary = await runBatch(CORPUS, {
    filter: EN,
    ai: { complete: stubModel(CLEAN_VERDICT, counter) },
  });

  assert.equal(counter.calls, 2, 'the two matched records, not all five');
  assert.equal(summary.aiCalls, 2);
  assert.equal(summary.aiFlagged, 0);
});

test('the gate can be inverted, widened, or written by hand', async () => {
  const all = { calls: 0 };
  await runBatch(CORPUS, {
    filter: EN,
    ai: { when: 'all', complete: stubModel(CLEAN_VERDICT, all) },
  });
  assert.equal(all.calls, 5);

  const unmatched = { calls: 0 };
  await runBatch(CORPUS, {
    filter: EN,
    ai: { when: 'unmatched', complete: stubModel(CLEAN_VERDICT, unmatched) },
  });
  assert.equal(unmatched.calls, 3);

  const custom = { calls: 0 };
  await runBatch(CORPUS, {
    filter: EN,
    ai: {
      when: (result) => result.text.includes('class'),
      complete: stubModel(CLEAN_VERDICT, custom),
    },
  });
  assert.equal(custom.calls, 1);
});

test('a model verdict can flag a record the word lists cleared', async () => {
  const summary = await runBatch(['this sentence contains no listed word'], {
    filter: EN,
    ai: { when: 'all', complete: stubModel(FLAGGED_VERDICT) },
  });

  assert.equal(summary.matchedList, 0);
  assert.equal(summary.aiFlagged, 1);
  assert.equal(summary.flagged, 1);
});

test('maxCalls is a hard ceiling, and the summary says so', async () => {
  const counter = { calls: 0 };
  const summary = await runBatch(CORPUS, {
    filter: EN,
    ai: { when: 'all', maxCalls: 2, complete: stubModel(CLEAN_VERDICT, counter) },
  });

  assert.equal(counter.calls, 2);
  assert.equal(summary.aiCalls, 2);
  assert.equal(summary.processed, 5, 'the remaining records are still analysed locally');
  assert.equal(summary.aiBudgetExhausted, true);
});

test('a failing call is retried with backoff, then reported', async () => {
  let attempts = 0;
  const flaky: AiCompletion = async () => {
    attempts++;
    if (attempts < 3) throw new Error('429 slow down');
    return { json: JSON.stringify(CLEAN_VERDICT) };
  };

  const summary = await runBatch(['you @sshole'], {
    filter: EN,
    ai: { complete: flaky, retries: 2, retryDelayMs: 1 },
  });

  assert.equal(attempts, 3, 'two retries after the first failure');
  assert.equal(summary.aiCalls, 1, 'retries are one record, not three calls');
  assert.equal(summary.aiErrors, 0);
});

test('a call that never succeeds costs one record, not the run', async () => {
  const always: AiCompletion = async () => {
    throw new Error('upstream is down');
  };

  const summary = await runBatch(CORPUS, {
    filter: EN,
    ai: { complete: always, retries: 1, retryDelayMs: 1 },
  });

  assert.equal(summary.processed, 5);
  assert.equal(summary.aiErrors, 2);
  assert.equal(summary.matchedList, 2, 'the local half is unaffected');
});

/* ---------------------- isolation, order, abort ------------------------ */

test('a stage that throws is one result, not the end of the run', async () => {
  const summary = await runBatch(CORPUS, { filter: { customList: ['(unclosed'] } });

  assert.equal(summary.processed, 5);
  assert.equal(summary.errors, 5);

  const { results } = await collect(CORPUS, { filter: { customList: ['(unclosed'] } });
  assert.equal(results[0]?.error?.stage, 'filter');
  assert.match(String(results[0]?.error?.message), /regular expression|Unterminated/i);
});

test('unordered emits everything, just not in order', async () => {
  const { results, summary } = await collect(CORPUS, {
    filter: EN,
    ordered: false,
    ai: { when: 'all', complete: stubModel(CLEAN_VERDICT) },
    concurrency: 3,
  });

  assert.equal(summary.processed, 5);
  assert.deepEqual(
    results.map((result) => result.index).sort((a, b) => a - b),
    [0, 1, 2, 3, 4],
  );
});

test('an abort stops the run and the summary admits it', async () => {
  const controller = new AbortController();
  let seen = 0;

  async function* many(): AsyncGenerator<string> {
    for (let i = 0; i < 1000; i++) yield 'ordinary text';
  }

  const summary = await runBatch(many(), {
    filter: EN,
    signal: controller.signal,
    onResult: () => {
      seen++;
      if (seen === 10) controller.abort();
    },
  });

  assert.equal(summary.aborted, true);
  assert.ok(summary.processed < 1000, `stopped early, processed ${summary.processed}`);
});

test('progress is reported on a stride, and once at the end', async () => {
  const seen: number[] = [];
  const summary = await runBatch(CORPUS, {
    filter: EN,
    progressEvery: 2,
    onProgress: (progress) => seen.push(progress.processed),
  });

  assert.deepEqual(seen.slice(0, 2), [2, 4]);
  assert.equal(seen[seen.length - 1], summary.processed);
});

test('the summary keeps a bounded number of examples', async () => {
  const many = Array.from({ length: 100 }, () => 'you @sshole');
  const summary = await runBatch(many, { filter: EN, sampleLimit: 5 });

  assert.equal(summary.flagged, 100);
  assert.equal(summary.samples.length, 5, 'a summary must not grow with the input');
});

/* ---------------------------- node adapters ---------------------------- */

test('lines are read without their terminators, CRLF included', async () => {
  const dir = await tempDir();
  const path = join(dir, 'plain.txt');
  await writeFile(path, 'first\r\nsecond\n\nthird');

  const lines: string[] = [];
  for await (const line of linesFrom(path)) lines.push(line);
  assert.deepEqual(lines, ['first', 'second', '', 'third']);
});

test('NDJSON records carry text and id, and bad lines are skipped', async () => {
  const dir = await tempDir();
  const path = join(dir, 'data.ndjson');
  await writeFile(
    path,
    [
      '{"id":1,"text":"you @sshole"}',
      'not json at all',
      '{"id":2,"body":"wrong field"}',
      '{"id":3,"text":"ordinary"}',
      '',
    ].join('\n'),
  );

  const records = [];
  for await (const record of ndjsonFrom(path)) records.push(record);
  assert.deepEqual(records, [
    { text: 'you @sshole', id: 1 },
    { text: 'ordinary', id: 3 },
  ]);

  await assert.rejects(
    async () => {
      for await (const _ of ndjsonFrom(path, { onBadLine: 'throw' })) void _;
    },
    /not valid JSON/,
  );
});

test('the CSV parser survives quotes, delimiters and newlines inside fields', async () => {
  const dir = await tempDir();
  const path = join(dir, 'data.csv');
  await writeFile(
    path,
    'id,comment\n' +
      '1,"he said ""you @sshole"", loudly"\n' +
      '2,"two\nlines, one field"\n' +
      '3,plain\n',
  );

  const rows: string[][] = [];
  for await (const row of csvRowsFrom(path)) rows.push(row);
  assert.deepEqual(rows, [
    ['id', 'comment'],
    ['1', 'he said "you @sshole", loudly'],
    ['2', 'two\nlines, one field'],
    ['3', 'plain'],
  ]);

  const records = [];
  for await (const record of csvFrom(path, { column: 'comment', idColumn: 'id' })) {
    records.push(record);
  }
  assert.equal(records.length, 3);
  assert.equal(records[0]?.id, '1');
  assert.match(String(records[0]?.text), /you @sshole/);

  await assert.rejects(
    async () => {
      for await (const _ of csvFrom(path, { column: 'nope' })) void _;
    },
    /no column "nope"/,
  );
});

test('recordsFrom picks the reader from the extension', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'a.ndjson'), '{"text":"you @sshole"}\n');
  await writeFile(join(dir, 'b.csv'), 'comment\nyou @sshole\n');
  await writeFile(join(dir, 'c.log'), 'you @sshole\n');

  for (const [file, kind] of [['a.ndjson', 'ndjson'], ['b.csv', 'csv'], ['c.log', 'lines']]) {
    const summary = await runBatch(recordsFrom(join(dir, file as string)) as never, { filter: EN });
    assert.equal(summary.flagged, 1, kind);
  }
});

test('the NDJSON writer round-trips through a real file', async () => {
  const dir = await tempDir();
  const path = join(dir, 'out.ndjson');
  const writer = createNdjsonWriter(path);

  await runBatch(CORPUS, {
    filter: EN,
    onResult: async (result) => {
      if (result.flagged) await writer.write({ index: result.index, flagged: true });
    },
  });
  await writer.close();

  const written = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(written, [
    { index: 1, flagged: true },
    { index: 3, flagged: true },
  ]);
});

/* -------------------------------- report ------------------------------- */

test('the text report states the numbers it was given', async () => {
  const summary = await runBatch(CORPUS, { filter: EN, pii: true });
  const report = formatSummary(summary);

  assert.match(report, /Records processed\s+5/);
  assert.match(report, /Flagged\s+2 \(40\.0%\)/);
  assert.match(report, /Examples \(2 of 2\)/);
  assert.doesNotMatch(report, /NaN|undefined/);
});

test('an empty run reports zero rather than NaN', () => {
  const empty: BatchSummary = {
    processed: 0, flagged: 0, matchedList: 0, piiRecords: 0, piiFindings: 0,
    piiByKind: {}, aiCalls: 0, aiFlagged: 0, aiErrors: 0, errors: 0,
    aborted: false, aiBudgetExhausted: false, elapsedMs: 0, samples: [],
  };
  const report = formatSummary(empty);
  assert.match(report, /Records processed\s+0/);
  assert.doesNotMatch(report, /NaN/);
});

test('a truncated run says so in the report, both ways', () => {
  const cut: BatchSummary = {
    processed: 10, flagged: 1, matchedList: 1, piiRecords: 0, piiFindings: 0,
    piiByKind: {}, aiCalls: 5, aiFlagged: 0, aiErrors: 0, errors: 0,
    aborted: true, aiBudgetExhausted: true, elapsedMs: 100, samples: [],
  };
  const report = formatSummary(cut);
  assert.match(report, /Model budget\s+exhausted/);
  assert.match(report, /Ended\s+aborted/);
});

test('the PDF report renders, and is reproducible when asked to be', async () => {
  const summary = await runBatch(CORPUS, { filter: EN, pii: true });

  const bytes = await renderSummaryPdf(summary, { title: 'Test run', subtitle: 'unit test' });
  assert.ok(bytes.byteLength > 800, `got ${bytes.byteLength} bytes`);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), '%PDF-');

  const first = await renderSummaryPdf(summary, { title: 'Test run', deterministic: true });
  const second = await renderSummaryPdf(summary, { title: 'Test run', deterministic: true });
  assert.deepEqual(first, second, 'deterministic: true must give byte-identical output');
});

/* --------------------- picking the right column ------------------------ */

test('the text column is guessed from the header when nobody names one', async () => {
  const dir = await tempDir();
  const path = join(dir, 'chat.csv');
  await writeFile(path, 'id,author,message\n1,anna,you @sshole\n2,ben,ordinary\n');

  const chosen: { name?: string; index: number; detected: boolean }[] = [];
  const records = [];
  for await (const record of csvFrom(path, { onColumn: (c) => chosen.push(c) })) {
    records.push(record);
  }

  assert.deepEqual(chosen, [{ index: 2, detected: true, name: 'message' }]);
  assert.deepEqual(records.map((r) => r.text), ['you @sshole', 'ordinary']);
});

test('an unguessable header is a question, not a silent scan of column 0', async () => {
  const dir = await tempDir();
  const path = join(dir, 'odd.csv');
  // Reading column 0 here would report a clean file — indistinguishable from a
  // real result, which is the outcome worth failing over.
  await writeFile(path, 'id,autor,freitext\n1,anna,you @sshole\n');

  await assert.rejects(
    async () => {
      for await (const _ of csvFrom(path)) void _;
    },
    /which column holds the text\?.*id, autor, freitext/s,
  );

  const named = [];
  for await (const record of csvFrom(path, { column: 'freitext' })) named.push(record);
  assert.deepEqual(named.map((r) => r.text), ['you @sshole']);
});

test('a single column needs no guessing, and an explicit choice is not announced as one', async () => {
  const dir = await tempDir();
  const path = join(dir, 'one.csv');
  await writeFile(path, 'whatever\nyou @sshole\n');

  const chosen: { detected: boolean }[] = [];
  const records = [];
  for await (const record of csvFrom(path, { onColumn: (c) => chosen.push(c) })) {
    records.push(record);
  }
  assert.equal(chosen[0]?.detected, true);
  assert.deepEqual(records.map((r) => r.text), ['you @sshole']);

  const explicit: { detected: boolean }[] = [];
  for await (const _ of csvFrom(path, { column: 0, onColumn: (c) => explicit.push(c) })) void _;
  assert.equal(explicit[0]?.detected, false);
});

test('skipped NDJSON lines are counted by reason', async () => {
  const dir = await tempDir();
  const path = join(dir, 'mixed.ndjson');
  await writeFile(
    path,
    ['{"body":"wrong field"}', 'not json', '"a bare string"', '{"text":"you @sshole"}'].join('\n'),
  );

  const reasons: string[] = [];
  const records = [];
  for await (const record of ndjsonFrom(path, { onSkip: (_l, why) => reasons.push(why) })) {
    records.push(record);
  }

  assert.deepEqual(reasons.sort(), ['json', 'no-text', 'not-object']);
  assert.equal(records.length, 1);
});
