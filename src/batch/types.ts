// src/batch/types.ts — the shapes a batch run takes.

import type { AiOptions, AiVerdict } from '../ai/types.js';
import type { FilterOptions, TextSegment } from '../filter.js';
import type { PiiKind, PiiMatch, PiiOptions } from '../pii/types.js';

/** One record to analyse. A bare string is the common case. */
export type BatchInput = string | BatchRecord;

export interface BatchRecord {
  text: string;
  /** Carried through to the result so you can join back to your own data. */
  id?: string | number;
}

export interface BatchError {
  stage: 'filter' | 'pii' | 'ai';
  message: string;
}

export interface BatchResult {
  /** Position in the input stream, from 0. Stable even when `ordered` is off. */
  index: number;
  id?: string | number;
  /** The text as given. A reference to a string that already exists — no copy. */
  text: string;
  /** `matchedList`, a PII finding, or the model saying so. */
  flagged: boolean;
  matchedList: boolean;
  /** Only present when `segments: true` — one array per record adds up fast. */
  segments?: TextSegment[];
  pii: PiiMatch[];
  /** Present only when the model was actually asked about this record. */
  ai?: AiVerdict;
  /** Set when one stage threw. The other stages still ran. */
  error?: BatchError;
}

/**
 * When to spend a model call.
 *
 * `matched` (the default) asks only about records a word list already hit,
 * which is the cheap and usually correct choice: it is the quotation check.
 * `unmatched` is the opposite reading and the expensive one — most records in
 * any real corpus are clean, so it sends nearly all of them. Read `maxCalls`
 * before choosing it.
 */
export type AiGate = 'matched' | 'unmatched' | 'all' | ((result: BatchResult) => boolean);

export interface BatchAiOptions extends AiOptions {
  when?: AiGate;
  /**
   * A hard ceiling on model calls for the whole run. Once reached, records are
   * analysed locally and carry no `ai` verdict at all.
   *
   * There is no sensible default here, so it is `Infinity` — but a batch is
   * exactly where one call per record becomes a bill, so set it.
   */
  maxCalls?: number;
  /** Retries per record when the call fails. Default 2. */
  retries?: number;
  /** First backoff in ms; doubles per attempt. Default 500. */
  retryDelayMs?: number;
}

export interface BatchOptions {
  /** Word-list options, or `false` to skip the word lists entirely. */
  filter?: FilterOptions | false;
  /** PII options, or `true` for the defaults. Off unless asked, like the AI check. */
  pii?: PiiOptions | true | false;
  /** Absent means no model is contacted — the same rule as everywhere else here. */
  ai?: BatchAiOptions;
  /** Include the profanity segments per record. Off by default: it is the one
   *  part of a result whose size grows with the text. */
  segments?: boolean;
  /** In-flight records. Only matters when a model is involved. Default 8. */
  concurrency?: number;
  /** Emit results in input order. Default true; `false` is faster when record
   *  durations vary, because nothing waits behind a slow neighbour. */
  ordered?: boolean;
  /** Called every `progressEvery` records, and once at the end. */
  onProgress?: (progress: BatchProgress) => void;
  /** Default 500. Per-record callbacks are their own cost at this scale. */
  progressEvery?: number;
  /** Stops pulling from the source. The summary comes back with `aborted: true`. */
  signal?: AbortSignal;
  /** How many flagged records the summary keeps. Default 20 — a summary must
   *  not grow with the input. */
  sampleLimit?: number;
}

export interface BatchProgress {
  processed: number;
  flagged: number;
  aiCalls: number;
  elapsedMs: number;
  /** Records per second since the start, for an honest ETA. */
  perSecond: number;
}

export interface BatchSummary {
  processed: number;
  flagged: number;
  matchedList: number;
  piiRecords: number;
  piiFindings: number;
  piiByKind: Partial<Record<PiiKind, number>>;
  aiCalls: number;
  aiFlagged: number;
  aiErrors: number;
  /** Records where a stage threw. */
  errors: number;
  aborted: boolean;
  /** True when `maxCalls` stopped further model calls before the end. */
  aiBudgetExhausted: boolean;
  elapsedMs: number;
  /** Up to `sampleLimit` flagged records, for a report. */
  samples: BatchResult[];
}
