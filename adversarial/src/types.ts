// The contract, kept deliberately small.
//
// Every filter worth benchmarking can answer one question — "is there
// profanity in this string" — and almost nothing else is shared between them.
// Some return a boolean, some a censored string, some a list of matches. Asking
// for more than the boolean would exclude filters rather than measure them.

/** What a benchmark run needs from the filter under test. */
export interface FilterAdapter {
  /** Shown in the report. Include the version if you can — results move. */
  name: string;
  /** True when the filter considers the text profane. */
  detect(text: string): boolean | Promise<boolean>;
}

export type Language = 'en' | 'de';

/**
 * `flag` — the text is profane in disguise; missing it is an evasion.
 * `clean` — the text is innocent; flagging it is a false positive.
 */
export type Expectation = 'flag' | 'clean';

export interface Attack {
  /** Stable across releases, so a result table can be diffed. */
  id: string;
  category: string;
  languages: readonly Language[];
  text: string;
  expect: Expectation;
  /** What is being done to the word, in one line. */
  note: string;
}

export interface AttackResult {
  attack: Attack;
  /** What the filter said. `null` when it threw. */
  detected: boolean | null;
  passed: boolean;
  error?: string;
}

export interface Score {
  /** Disguised profanity that was caught, over all of it. */
  evasionResistance: number;
  /** Innocent text left alone, over all of it. */
  precision: number;
  flagTotal: number;
  flagPassed: number;
  cleanTotal: number;
  cleanPassed: number;
}

export interface RunReport {
  filter: string;
  languages: readonly Language[];
  results: readonly AttackResult[];
  score: Score;
  /** Per category, so a report says *what* leaks rather than only how much. */
  byCategory: Record<string, { total: number; passed: number }>;
}
