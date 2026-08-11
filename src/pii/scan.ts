// src/pii/scan.ts — one pass over the text, then everything derives from it.
//
// The naive design runs one regex per kind over the whole input, so the text is
// walked six times and each walk pays for the others' misses. This walks it
// once, recording only the three things any recognizer could anchor on: where
// the '@' signs are, where the digits are, and where the colons are.
//
// Everything else is a local question asked at an anchor. An IBAN is "a digit
// run with two letters in front of it". A card is "a digit cluster of the right
// length". No recognizer ever scans the whole string again.

/** A maximal run of ASCII digits. */
export interface DigitRun {
  start: number;
  end: number;
}

export interface Anchors {
  /** Every '@' — the only place an e-mail can be. */
  atSigns: number[];
  /** Every maximal digit run, in order. */
  digitRuns: DigitRun[];
  /** Every ':' — IPv6 and nothing else here. */
  colons: number[];
}

const ZERO = 48;
const NINE = 57;

export function scan(text: string): Anchors {
  const atSigns: number[] = [];
  const digitRuns: DigitRun[] = [];
  const colons: number[] = [];

  let runStart = -1;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isDigit = code >= ZERO && code <= NINE;

    if (isDigit) {
      if (runStart === -1) runStart = i;
      continue;
    }

    if (runStart !== -1) {
      digitRuns.push({ start: runStart, end: i });
      runStart = -1;
    }

    if (code === 64)
      atSigns.push(i); // '@'
    else if (code === 58) colons.push(i); // ':'
  }

  if (runStart !== -1) digitRuns.push({ start: runStart, end: text.length });

  return { atSigns, digitRuns, colons };
}

/**
 * A run of digits written with the punctuation humans put in numbers.
 *
 * Phone numbers, card numbers and tax ids are the same object at this stage —
 * a group of digits with separators — and telling them apart is the
 * recognizers' job, not the scanner's. Building the cluster once is what lets
 * three recognizers disagree about the same span cheaply, which is exactly the
 * situation `resolve()` exists to settle.
 */
export interface DigitCluster {
  /** Span in the original text, punctuation included, edges trimmed. */
  start: number;
  end: number;
  /** Just the digits, in order. */
  digits: string;
  /** The length of each digit group — `[3, 2, 2, 2]` for `030 12 34 56`. */
  groups: number[];
  /** A leading `+`, which is the strongest single hint a number is a phone. */
  plus: boolean;
  /** The raw slice, for date-shaped rejections and for reporting. */
  raw: string;
}

/** Characters allowed *between* digit groups. */
const DIGIT_SEPARATOR = new Set([' ', ' ', ' ', '-', '‑', '.', '/', ')', '(']);

/** At most this many separator characters may bridge two groups. */
const MAX_GAP = 2;

/** Shared with the recognizers: one definition, so the edge rules agree. */
export const ALNUM = /[\p{L}\p{N}]/u;

/**
 * Merge digit runs that are separated by a little punctuation into clusters.
 *
 * The gap limit is what keeps `12 34` together and `1234, aber 5678` apart, and
 * the alphanumeric edge check is what keeps `abc123` from being read as a
 * number at all — it is an identifier, and treating its tail as a phone number
 * is the classic way these detectors embarrass themselves.
 */
export function clusters(text: string, runs: readonly DigitRun[]): DigitCluster[] {
  const out: DigitCluster[] = [];
  let i = 0;

  while (i < runs.length) {
    const first = runs[i];
    if (first === undefined) break;

    // A run glued to a letter is part of a word, not a number.
    if (first.start > 0 && ALNUM.test(text[first.start - 1] as string)) {
      i++;
      continue;
    }

    let last = first;
    let j = i + 1;

    while (j < runs.length) {
      const next = runs[j];
      if (next === undefined) break;

      const gap = text.slice(last.end, next.start);
      if (gap.length === 0 || gap.length > MAX_GAP) break;
      if (![...gap].every((char) => DIGIT_SEPARATOR.has(char))) break;

      last = next;
      j++;
    }

    // A trailing letter means the same thing as a leading one.
    if (last.end < text.length && ALNUM.test(text[last.end] as string)) {
      i = j;
      continue;
    }

    let start = first.start;
    let plus = false;
    if (start > 0 && text[start - 1] === '+') {
      start--;
      plus = true;
    } else if (start > 0 && text[start - 1] === '(') {
      // Keep an area code's opening bracket with it, since its closing one is
      // inside the cluster anyway.
      if (text.slice(start, last.end).includes(')')) start--;
    }

    const groups: number[] = [];
    let digits = '';
    for (let k = i; k < j; k++) {
      const run = runs[k];
      if (run === undefined) continue;
      groups.push(run.end - run.start);
      digits += text.slice(run.start, run.end);
    }

    out.push({
      start,
      end: last.end,
      digits,
      groups,
      plus,
      raw: text.slice(start, last.end),
    });

    i = j;
  }

  return out;
}
