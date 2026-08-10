// src/batch/index.ts — import from 'ts-profanity-filter/batch'
//
// Analysing one comment is a function call. Analysing two million of them is a
// different problem, and the difference is not speed — it is that the naive
// version holds the whole corpus in memory, stops at the first bad record, and
// makes one paid model call per row.
//
// So: (async) iterable in, results streamed out, bounded concurrency, one bad
// record cannot end the run, and the model is only asked about the records a
// word list could not settle — under a hard ceiling you set.
//
// Nothing in this file touches a Node API. File and CSV input live in
// 'ts-profanity-filter/batch/node', which is a separate subpath so that
// importing the runner in a browser or an edge function stays possible.

import { analyzeWithAi } from '../ai/index.js';
import type { AiOptions, AiVerdict } from '../ai/types.js';
import { filterFWordsToSegments, type TextSegment } from '../filter.js';
import { detectPii } from '../pii/index.js';
import type { PiiMatch } from '../pii/types.js';
import { delay, mapOrdered, mapSync, mapUnordered } from './concurrency.js';
import type {
  BatchAiOptions,
  BatchInput,
  BatchOptions,
  BatchRecord,
  BatchResult,
  BatchSummary,
} from './types.js';

export type {
  AiGate,
  BatchAiOptions,
  BatchError,
  BatchInput,
  BatchOptions,
  BatchProgress,
  BatchRecord,
  BatchResult,
  BatchSummary,
} from './types.js';

export { delay, mapOrdered, mapSync, mapUnordered } from './concurrency.js';
export { formatSummary } from './report.js';

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_PROGRESS_EVERY = 500;
const DEFAULT_SAMPLE_LIMIT = 20;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 500;

/** Mutable counters for one run. Kept out of the results so they stay plain data. */
interface RunState {
  processed: number;
  flagged: number;
  matchedList: number;
  piiRecords: number;
  piiFindings: number;
  piiByKind: Record<string, number>;
  aiCalls: number;
  aiFlagged: number;
  aiErrors: number;
  errors: number;
  aiBudgetExhausted: boolean;
  samples: BatchResult[];
  startedAt: number;
}

function newState(): RunState {
  return {
    processed: 0,
    flagged: 0,
    matchedList: 0,
    piiRecords: 0,
    piiFindings: 0,
    piiByKind: {},
    aiCalls: 0,
    aiFlagged: 0,
    aiErrors: 0,
    errors: 0,
    aiBudgetExhausted: false,
    samples: [],
    startedAt: Date.now(),
  };
}

function toRecord(input: BatchInput): BatchRecord {
  return typeof input === 'string' ? { text: input } : input;
}

/**
 * The synchronous half: word lists and PII.
 *
 * Each stage is wrapped, because a custom pattern or a hostile record must cost
 * one result and not the whole run — a batch job that dies at row 900 000 with
 * nothing written is the failure mode this design exists to avoid.
 */
function analyseLocal(input: BatchInput, index: number, options: BatchOptions): BatchResult {
  const record = toRecord(input);
  const text = record.text ?? '';

  let segments: TextSegment[] | undefined;
  let matchedList = false;
  let pii: PiiMatch[] = [];
  let error: BatchResult['error'];

  if (options.filter !== false) {
    try {
      const produced = filterFWordsToSegments(text, options.filter ?? {});
      matchedList = produced.some((segment) => segment.isProfane);
      if (options.segments) segments = produced;
    } catch (cause) {
      error = { stage: 'filter', message: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  if (options.pii !== undefined && options.pii !== false) {
    try {
      pii = detectPii(text, options.pii === true ? {} : options.pii);
    } catch (cause) {
      error ??= { stage: 'pii', message: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  const result: BatchResult = {
    index,
    text,
    flagged: matchedList || pii.length > 0,
    matchedList,
    pii,
  };
  if (record.id !== undefined) result.id = record.id;
  if (segments !== undefined) result.segments = segments;
  if (error !== undefined) result.error = error;
  return result;
}

function wantsModel(result: BatchResult, ai: BatchAiOptions): boolean {
  const gate = ai.when ?? 'matched';
  if (typeof gate === 'function') return gate(result);
  if (gate === 'all') return true;
  if (gate === 'matched') return result.matchedList;
  return !result.matchedList;
}

/**
 * One model call, retried with exponential backoff.
 *
 * `analyzeWithAi` reports failure as `status: 'error'` rather than throwing, so
 * the retry loop reads the status instead of catching. A refusal is *not*
 * retried: the provider's safety layer declining is a decision, and asking it
 * again in 500 ms will not change its mind.
 */
async function askModel(
  text: string,
  ai: BatchAiOptions,
  state: RunState,
): Promise<AiVerdict | undefined> {
  const maxCalls = ai.maxCalls ?? Infinity;
  if (state.aiCalls >= maxCalls) {
    state.aiBudgetExhausted = true;
    return undefined;
  }
  state.aiCalls++;

  const retries = ai.retries ?? DEFAULT_RETRIES;
  const base = ai.retryDelayMs ?? DEFAULT_RETRY_DELAY;

  // `when`, `maxCalls`, `retries` and `retryDelayMs` are ours; everything else
  // belongs to the AI module and is passed through untouched.
  const { when: _when, maxCalls: _maxCalls, retries: _retries, retryDelayMs: _delay, ...rest } = ai;
  const aiOptions: AiOptions = { ...rest, onError: 'return' };

  let last: AiVerdict | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await analyzeWithAi(text, aiOptions);
    if (last.status !== 'error') return last;
    if (attempt < retries) await delay(base * 2 ** attempt);
  }
  return last;
}

function account(result: BatchResult, state: RunState, sampleLimit: number): void {
  state.processed++;
  if (result.matchedList) state.matchedList++;
  if (result.error) state.errors++;

  if (result.pii.length > 0) {
    state.piiRecords++;
    state.piiFindings += result.pii.length;
    for (const finding of result.pii) {
      state.piiByKind[finding.kind] = (state.piiByKind[finding.kind] ?? 0) + 1;
    }
  }

  if (result.ai) {
    if (result.ai.flagged) state.aiFlagged++;
    if (result.ai.status === 'error') state.aiErrors++;
  }

  if (result.flagged) {
    state.flagged++;
    if (state.samples.length < sampleLimit) state.samples.push(result);
  }
}

function summarize(state: RunState, aborted: boolean): BatchSummary {
  return {
    processed: state.processed,
    flagged: state.flagged,
    matchedList: state.matchedList,
    piiRecords: state.piiRecords,
    piiFindings: state.piiFindings,
    piiByKind: state.piiByKind,
    aiCalls: state.aiCalls,
    aiFlagged: state.aiFlagged,
    aiErrors: state.aiErrors,
    errors: state.errors,
    aborted,
    aiBudgetExhausted: state.aiBudgetExhausted,
    elapsedMs: Date.now() - state.startedAt,
    samples: state.samples,
  };
}

/**
 * Analyse a stream of records, yielding one result each.
 *
 * The generator's **return value** is the summary, which `for await` discards —
 * use `runBatch` if that is what you want, or drive `.next()` yourself.
 */
export async function* streamBatch(
  source: AsyncIterable<BatchInput> | Iterable<BatchInput>,
  options: BatchOptions = {},
): AsyncGenerator<BatchResult, BatchSummary> {
  const state = newState();
  const sampleLimit = options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
  const every = Math.max(1, options.progressEvery ?? DEFAULT_PROGRESS_EVERY);
  const ai = options.ai;

  const report = (): void => {
    if (!options.onProgress) return;
    const elapsedMs = Date.now() - state.startedAt;
    options.onProgress({
      processed: state.processed,
      flagged: state.flagged,
      aiCalls: state.aiCalls,
      elapsedMs,
      perSecond: elapsedMs > 0 ? (state.processed / elapsedMs) * 1000 : 0,
    });
  };

  const emit = (result: BatchResult): BatchResult => {
    account(result, state, sampleLimit);
    if (state.processed % every === 0) report();
    return result;
  };

  if (ai === undefined || ai.enabled === false) {
    // Nothing awaits, so nothing needs a promise per record.
    for await (const result of mapSync(
      source,
      (item, index) => emit(analyseLocal(item, index, options)),
      options.signal,
    )) {
      yield result;
    }
  } else {
    const work = async (item: BatchInput, index: number): Promise<BatchResult> => {
      const result = analyseLocal(item, index, options);
      if (!wantsModel(result, ai)) return result;
      try {
        const verdict = await askModel(result.text, ai, state);
        if (verdict !== undefined) {
          result.ai = verdict;
          if (verdict.flagged) result.flagged = true;
        }
      } catch (cause) {
        // askModel is written not to throw; if a provider ever does anyway,
        // one record must still not take the run down.
        result.error ??= {
          stage: 'ai',
          message: cause instanceof Error ? cause.message : String(cause),
        };
      }
      return result;
    };

    const limit = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    const runner = options.ordered === false ? mapUnordered : mapOrdered;
    for await (const result of runner(source, limit, work, options.signal)) {
      yield emit(result);
    }
  }

  report();
  return summarize(state, options.signal?.aborted === true);
}

/**
 * Run a batch to completion and return the summary.
 *
 * This is the shape for large input: results are handed to `onResult` as they
 * arrive and then dropped, so memory stays flat no matter how long the file is.
 */
export async function runBatch(
  source: AsyncIterable<BatchInput> | Iterable<BatchInput>,
  options: BatchOptions & { onResult?: (result: BatchResult) => void | Promise<void> } = {},
): Promise<BatchSummary> {
  const iterator = streamBatch(source, options);

  for (;;) {
    const step = await iterator.next();
    if (step.done === true) return step.value;
    if (options.onResult) await options.onResult(step.value);
  }
}
