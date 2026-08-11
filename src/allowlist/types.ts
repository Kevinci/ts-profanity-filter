// src/allowlist/types.ts — tuning an allowlist against your own text.

import type { AiOptions } from '../ai/types.js';
import type { Language } from '../registry.js';

/**
 * Where the corpus comes from.
 *
 * A function is preferred: the tuner reads the corpus twice — once to find what
 * gets flagged, once to prove the proposed entries actually helped — and a
 * one-shot generator cannot be read again. Pass an array or a factory and you
 * get the before/after numbers; pass a bare iterator and you get everything
 * except them, with `rerun: false` saying so.
 */
export type AllowSource =
  Iterable<string> | AsyncIterable<string> | (() => Iterable<string> | AsyncIterable<string>);

/** A word the lists flagged, and how often. */
export interface FlaggedWord {
  /** The whole word the hit sits in — `Klassiker`, not `ass`. */
  word: string;
  /** The substrings that matched inside it. */
  hits: string[];
  /** How many records contained it. Frequency is the first signal: an ordinary
   *  word appears everywhere, a slur appears rarely. */
  count: number;
  /** Up to `sampleLimit` records it appeared in, for the reader to judge. */
  samples: string[];
}

export interface FlaggedWordReport {
  /** Records read. */
  scanned: number;
  /** Records with at least one hit. */
  flaggedRecords: number;
  /** Distinct flagged words, most frequent first. */
  words: FlaggedWord[];
}

/** What a word turned out to be. `unsure` is a real answer and never acted on. */
export type WordVerdict = 'ordinary' | 'offensive' | 'unsure';

export interface WordJudgement {
  word: string;
  verdict: WordVerdict;
  /**
   * For an ordinary word: a regex source for the allowlist, matched against the
   * whole surrounding word. Narrow is better — `klassiker` over `\\p{L}*ass\\p{L}*`,
   * which would clear every hit in the language.
   */
  entry?: string;
  /** One sentence, in case a human reviews the run. */
  reason?: string;
}

export interface AcceptedEntry {
  entry: string;
  /** The flagged words this entry clears. */
  clears: string[];
}

export interface RejectedEntry {
  entry: string;
  word: string;
  /**
   * `no-effect` — it did not even clear the word it was proposed for.
   * `too-broad` — it also cleared a word judged offensive.
   * `invalid` — it is not a valid pattern under the `u` flag.
   */
  why: 'no-effect' | 'too-broad' | 'invalid';
  detail?: string;
}

export interface TuneReport {
  /** The scan the run started from. */
  scan: FlaggedWordReport;
  /** Every judgement, whether it led to an entry or not. */
  judgements: WordJudgement[];
  /** Entries that passed verification — ready for `allowList` or a language pack. */
  entries: string[];
  accepted: AcceptedEntry[];
  /** Proposals that were refused, with the reason. Never silently dropped. */
  rejected: RejectedEntry[];
  /** Flagged records before and after, when the corpus could be read twice. */
  before: number;
  after: number;
  /** False when the source was a one-shot iterator, making `after` unmeasured. */
  rerun: boolean;
  /** Words the model or the caller marked offensive — the ones that must keep
   *  being flagged, and the yardstick every entry was checked against. */
  keptOffensive: string[];
}

export interface TuneOptions {
  /** Which languages to tune against. Defaults to `['en']`, like the filter. */
  languages?: readonly Language[] | '*';
  /** Ignore words appearing fewer times than this. Defaults to 1. */
  minCount?: number;
  /** Judge at most this many distinct words, most frequent first. Defaults to 50. */
  limit?: number;
  /** Records kept per word as evidence. Defaults to 3. */
  sampleLimit?: number;
  /**
   * Judgements supplied by hand, keyed by word. Anything listed here is not sent
   * to a model — which is also how the whole feature runs with no key at all.
   */
  verdicts?: Readonly<Record<string, WordVerdict>>;
  /**
   * Ask a model to judge the rest. Absent means no model is contacted and only
   * `verdicts` are used, so a run without this is a pure local scan plus
   * verification.
   */
  ai?: AiOptions;
}
