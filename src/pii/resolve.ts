// src/pii/resolve.ts — deciding who owns a span.
//
// Recognizers are deliberately allowed to disagree. `DE44 5001 0517 5407 3249
// 31` contains a sixteen-digit run that passes Luhn often enough to matter, and
// an IPv6 address contains an IPv4 address by construction. Something has to
// choose, and choosing greedily left to right gets it wrong: the first
// candidate is not the best one, it is merely the earliest.
//
// So this is weighted interval scheduling — the classic dynamic program. Sort by
// end, and for each candidate compare "take it, plus the best solution ending
// before it starts" against "skip it". O(m log m), and it is *optimal* over the
// whole set rather than locally sensible.
//
// The weight is confidence × length. Length is what makes a verified 22-
// character IBAN outrank the speculative phone number hiding inside it, and
// confidence is what stops a long unverified span from outranking a short
// certain one.

import type { PiiMatch } from './types.js';

function weight(match: PiiMatch): number {
  return match.confidence * (match.end - match.start);
}

/**
 * The largest-weight set of non-overlapping findings, in reading order.
 *
 * Touching spans do not overlap: `end <= start` is allowed, so two adjacent
 * numbers both survive.
 */
export function resolve(matches: readonly PiiMatch[]): PiiMatch[] {
  if (matches.length <= 1) return [...matches];

  const sorted = [...matches].sort((a, b) => a.end - b.end || a.start - b.start);
  const n = sorted.length;

  // best[i] = total weight of the optimal solution over the first i candidates.
  const best = new Float64Array(n + 1);
  // predecessor[i] = how many candidates remain in play if we take candidate i.
  const predecessor = new Int32Array(n + 1);

  for (let i = 1; i <= n; i++) {
    const current = sorted[i - 1];
    if (current === undefined) continue;

    // Rightmost j whose end is at or before this candidate's start.
    let low = 0;
    let high = i - 1;
    let p = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (mid === 0) {
        low = mid + 1;
        continue;
      }
      const probe = sorted[mid - 1];
      if (probe !== undefined && probe.end <= current.start) {
        p = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    predecessor[i] = p;
    const taking = weight(current) + (best[p] ?? 0);
    const skipping = best[i - 1] ?? 0;
    best[i] = taking >= skipping ? taking : skipping;
  }

  const kept: PiiMatch[] = [];
  let i = n;
  while (i > 0) {
    if ((best[i] ?? 0) === (best[i - 1] ?? 0)) {
      i--;
      continue;
    }
    const chosen = sorted[i - 1];
    if (chosen !== undefined) kept.push(chosen);
    i = predecessor[i] ?? 0;
  }

  return kept.reverse();
}
