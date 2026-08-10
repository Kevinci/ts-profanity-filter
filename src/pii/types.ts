// src/pii/types.ts — what a PII finding is, and what you can ask for.

/**
 * The kinds this module recognises.
 *
 * Every one of them is *verifiable* — a checksum, a range, a structural rule.
 * That is the admission criterion: names, addresses and dates of birth are PII
 * too, but nothing in the string itself can confirm them, and a detector that
 * guesses at those turns every capitalised word into a finding.
 */
export type PiiKind = 'email' | 'phone' | 'iban' | 'card' | 'ip' | 'taxid-de';

/**
 * Why a candidate was believed. Reported alongside the confidence so a caller
 * can tell a mathematical fact from a hunch.
 *
 * - `checksum` — the number verifies against its own check digits. Not a guess.
 * - `structure` — the shape is right: length, ranges, allowed characters.
 * - `format` — punctuation that only this kind uses, like `+` or `@`.
 * - `context` — a nearby word ("IBAN:", "Tel.") agrees with the reading.
 */
export type PiiEvidence = 'checksum' | 'structure' | 'format' | 'context';

/** One finding, as a span of the original text. */
export interface PiiMatch {
  kind: PiiKind;
  /** The exact slice of the input — `text.slice(start, end)`, never rebuilt. */
  text: string;
  /** UTF-16 index of the first character. */
  start: number;
  /** UTF-16 index one past the last character. */
  end: number;
  /** 0..1. See `PiiEvidence` for what moved it. */
  confidence: number;
  /** What argued for it, strongest first. */
  evidence: readonly PiiEvidence[];
}

/** A segment of the analysed text, mirroring `TextSegment` from the filter. */
export interface PiiSegment {
  text: string;
  isPii: boolean;
  /** Present only when `isPii` is true. */
  kind?: PiiKind;
}

export interface PiiOptions {
  /**
   * Which kinds to look for. Defaults to `'*'` — all of them. Narrowing this
   * is the cheapest way to cut false positives when you know your domain.
   */
  kinds?: readonly PiiKind[] | '*';
  /**
   * Findings below this are dropped. Defaults to `0.6`.
   *
   * The scale is deliberately not uniform across kinds: an IBAN that passes
   * mod-97 sits at 0.98 because the arithmetic says so, while a bare
   * eleven-digit number that could be a phone number sits at 0.3 until a word
   * nearby agrees with it. Lower this to audit what is being suppressed.
   */
  minConfidence?: number;
  /**
   * How many characters either side count as context for keyword support.
   * Defaults to 48 — roughly a label and its punctuation, not a whole sentence.
   */
  contextWindow?: number;
}
