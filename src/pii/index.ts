// src/pii/index.ts — import from 'ts-profanity-filter/pii'
//
// Personal data detection, built the same way as the rest of this library: it
// reports spans and never rewrites your string, so the redaction stays yours to
// render.
//
// The pipeline is four steps, and each one exists because the obvious
// alternative is worse:
//
//   1. scan      — one O(n) pass for anchors. Six regexes over the text would
//                  walk it six times and still miss the grouped spellings.
//   2. clusters  — build the "digits with punctuation in them" objects once.
//                  Phone, card and tax id are the same object at this stage.
//   3. recognize — ask a local question at each anchor, and *score* the answer.
//                  Checksums are facts; shape is an argument; a nearby word only
//                  adjusts what the string already said.
//   4. resolve   — weighted interval scheduling over the survivors, because an
//                  IBAN contains a Luhn-passing run and an IPv6 address
//                  contains an IPv4 one, and greedy resolution picks wrong.

import { RECOGNIZERS, type RecognizerContext } from './recognizers.js';
import { resolve } from './resolve.js';
import { clusters, scan } from './scan.js';
import type { PiiKind, PiiMatch, PiiOptions, PiiSegment } from './types.js';

export type { PiiEvidence, PiiKind, PiiMatch, PiiOptions, PiiSegment } from './types.js';

export {
  IBAN_LENGTHS,
  iso7064Mod1110,
  isValidGermanTaxId,
  isValidIban,
  isValidLuhn,
} from './checksums.js';

/** Every kind this module knows, in the order findings are reported for ties. */
export const PII_KINDS: readonly PiiKind[] = [
  'email',
  'iban',
  'card',
  'phone',
  'taxid-de',
  'ip',
];

const DEFAULT_MIN_CONFIDENCE = 0.6;
const DEFAULT_CONTEXT_WINDOW = 48;

function selectedKinds(requested: PiiOptions['kinds']): readonly PiiKind[] {
  if (requested === undefined || requested === '*') return PII_KINDS;

  for (const kind of requested) {
    if (!PII_KINDS.includes(kind)) {
      // Same rule as an unknown language in the filter: silently scanning for
      // nothing is the worst way for a detector to fail, because it looks
      // exactly like a clean result.
      throw new TypeError(
        `detectPii: unknown kind ${JSON.stringify(kind)}. Known kinds: ${PII_KINDS.join(', ')}.`,
      );
    }
  }

  return requested;
}

/**
 * Find personal data in `text`.
 *
 * Findings never overlap and are returned in reading order, each with the span
 * it occupies, a confidence and the evidence behind it.
 */
export function detectPii(text: string, options: PiiOptions = {}): PiiMatch[] {
  const kinds = selectedKinds(options.kinds);
  if (typeof text !== 'string' || text.length === 0) return [];

  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

  const anchors = scan(text);
  const context: RecognizerContext = {
    text,
    anchors,
    clusters: clusters(text, anchors.digitRuns),
    contextWindow,
  };

  const candidates: PiiMatch[] = [];
  for (const kind of kinds) {
    for (const match of RECOGNIZERS[kind](context)) {
      if (match.confidence >= minConfidence) candidates.push(match);
    }
  }

  return resolve(candidates);
}

/** True if anything at or above the threshold was found. Stops at the first hit. */
export function hasPii(text: string, options: PiiOptions = {}): boolean {
  return detectPii(text, options).length > 0;
}

/**
 * The same text, split into segments — the shape `filterFWordsToSegments`
 * returns, so the two can be rendered by the same code.
 *
 * Concatenating every `segment.text` reproduces the input exactly.
 */
export function piiToSegments(text: string, options: PiiOptions = {}): PiiSegment[] {
  const matches = detectPii(text, options);
  if (matches.length === 0) {
    return text.length === 0 ? [] : [{ text, isPii: false }];
  }

  const segments: PiiSegment[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start), isPii: false });
    }
    segments.push({ text: match.text, isPii: true, kind: match.kind });
    cursor = match.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isPii: false });
  }

  return segments;
}
