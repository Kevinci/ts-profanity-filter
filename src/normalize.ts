// src/normalize.ts
//
// Leet spellings and lookalikes are handled on the pattern side, because those
// substitutions are one character for one character. Separators, repetition and
// compatibility spellings are not: `D r e c k s a u`, `Dreeecksau` and
// `Ｄｒｅｃｋｓａｕ` change the *length* of the text, so no character class can
// reach them.
//
// So the text is rewritten instead — and every rewritten character remembers
// which slice of the original it came from. Matches are found in the rewritten
// string and then sliced out of the original, which is what keeps the segments
// lossless: concatenating them still reproduces the input exactly.

/** A rewritten copy of the text plus the map back to the original. */
export interface Normalized {
  /** The text to run patterns against. */
  readonly text: string;
  /** `starts[i]` — where character `i` began in the original. */
  readonly starts: readonly number[];
  /** `ends[i]` — where the original slice behind character `i` ended. */
  readonly ends: readonly number[];
}

/**
 * Invisible formatting characters, dropped wherever they appear. A zero-width
 * space has no business inside a word being moderated — `Dreck<ZWSP>sau` is
 * only ever an attempt to break the match up.
 */
const FORMAT = /\p{Cf}/u;

/**
 * Combining marks. These are *composed* rather than dropped: `a` followed by a
 * combining diaeresis becomes `ä`, which the letter classes already know about.
 * Dropping the mark instead would leave a plain `a`, and `Dräcksau` written in
 * decomposed form would need `e` to match `a` — far too loose a rule to want.
 */
const MARK = /\p{M}/u;

/** The same, global, for stripping marks that survived composition. */
const MARK_ALL = /\p{M}/gu;

/** Anything outside ASCII, as a cheap gate in front of the NFKC check. */
// eslint-disable-next-line no-control-regex -- the ASCII range is the pattern
const NON_ASCII = /[^\x00-\x7F]/;

/** What counts as a separator when letters have been pulled apart. */
const SEPARATOR = /[\s._*+~|-]/u;

/**
 * Compiles at runtime instead of as a literal, and reports failure rather than
 * raising it.
 *
 * A regex literal is compiled when the *script* is parsed, so one the engine
 * cannot handle is a syntax error for the whole module — importing this package
 * would fail outright, not just this feature. Lookbehind is the one modern
 * construct here that some engines still lack (Safari only from 16.4), so the
 * patterns that need it are built this way and degrade on their own.
 */
function compile(source: string, flags: string): RegExp | null {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/** The spaced-out run, as source so it can be reused in the pre-check. */
const SPACED_RUN_SOURCE = '(?<!\\p{L})(?:\\p{L}[\\s._*+~|\\-]+){2,}\\p{L}(?!\\p{L})';

/**
 * The spaced-out shape: at least three single letters, each pair split by
 * separators.
 *
 * The lookarounds are what make this safe. Without them the run may start or
 * end inside an ordinary word, and `next to a cockroach` collapses into
 * `next toacockroach` — a false `cock` that the allowlist can no longer
 * clear, because `cockroach\p{L}*` no longer covers the surrounding word.
 * Every letter in the run has to be a whole one-letter token.
 *
 * `null` on an engine without lookbehind: spaced-out text is then simply not
 * un-spaced, and everything else keeps working.
 */
const SPACED_RUN = compile(SPACED_RUN_SOURCE, 'gu');

/** Runs of this many identical characters collapse to one. */
const REPEAT_LIMIT = 3;

/**
 * Cheap pre-check, so untouched text never pays for the map. Falls back in
 * step with {@link SPACED_RUN} — without lookbehind it stops asking about
 * spaced runs, because nothing downstream could act on the answer.
 */
const NEEDS_WORK =
  compile(`[\\p{Cf}\\p{M}]|(.)\\1{2,}|${SPACED_RUN_SOURCE}`, 'u') ??
  compile('[\\p{Cf}\\p{M}]|(.)\\1{2,}', 'u') ??
  /(.)\1{2,}/;

/**
 * Rewrites `text` for matching, or returns `null` when there is nothing to do —
 * which is the common case, and lets the filter skip the whole mechanism.
 */
export function normalizeForMatching(text: string): Normalized | null {
  // NFKC-unstable text needs the map too: fullwidth, circled and mathematical
  // letters all fold to plain ones and would otherwise walk straight past every
  // pattern. The ASCII gate keeps ordinary input from paying for the check.
  const foldable = NON_ASCII.test(text) && text.normalize('NFKC') !== text;
  if (!NEEDS_WORK.test(text) && !foldable) return null;

  // 1. Which indices disappear? Separators only count inside a spaced-out run,
  //    and only on an engine that can recognise one.
  const dropped = new Set<number>();
  if (SPACED_RUN !== null) {
    SPACED_RUN.lastIndex = 0;
    let run: RegExpExecArray | null;
    while ((run = SPACED_RUN.exec(text)) !== null) {
      for (let i = run.index; i < run.index + run[0].length; i++) {
        if (SEPARATOR.test(text.charAt(i))) dropped.add(i);
      }
    }
  }

  // 2. Keep what is left, remembering where each character came from.
  //
  //    Iteration is by code point rather than by code unit, so an astral
  //    character is never taken apart. Both halves of its surrogate pair end up
  //    pointing at the same original slice, which is what stops a match
  //    boundary from ever landing inside one — a segment holding half a pair
  //    would render as U+FFFD even though the segments still concatenate back
  //    to the input.
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length;) {
    const point = String.fromCodePoint(text.codePointAt(i)!);

    if (dropped.has(i) || FORMAT.test(point)) {
      i += point.length;
      continue;
    }
    if (MARK.test(point)) {
      i += point.length; // a mark with no base character before it
      continue;
    }

    // Pull any trailing combining marks into one cluster.
    let end = i + point.length;
    while (end < text.length && !dropped.has(end)) {
      const next = String.fromCodePoint(text.codePointAt(end)!);
      if (!MARK.test(next)) break;
      end += next.length;
    }

    // NFKC rather than NFC. NFC only composes; NFKC also folds the
    // compatibility variants an evader actually reaches for — fullwidth
    // `Ｄｒｅｃｋ`, circled `Ⓓⓡⓔⓒⓚ`, mathematical bold `𝐃𝐫𝐞𝐜𝐤` — down to the
    // plain letters the patterns are written in.
    //
    // It can also turn one character into several (a ligature becomes its
    // letters), so the map is one entry per *output* code unit, every one of
    // them pointing back at the same original slice.
    const folded = text.slice(i, end).normalize('NFKC');

    // A mark that survived composition carries no letter of its own. Dropping
    // it keeps `Dre` + an uncomposable mark + `cksau` readable as `Drecksau`,
    // which is the whole reason marks are handled here.
    const kept = folded.replace(MARK_ALL, '') || point;

    for (let k = 0; k < kept.length; k++) {
      chars.push(kept.charAt(k));
      starts.push(i);
      ends.push(end);
    }

    i = end;
  }

  // 3. Collapse long runs. Doubles are left alone — `Klasse` and `Fässer` are
  //    ordinary words, while three of the same character is not.
  const outChars: string[] = [];
  const outStarts: number[] = [];
  const outEnds: number[] = [];
  for (let i = 0; i < chars.length;) {
    const here = chars[i]!.toLowerCase();
    let j = i + 1;
    while (j < chars.length && chars[j]!.toLowerCase() === here) j++;
    const length = j - i;

    if (length >= REPEAT_LIMIT) {
      // One character standing in for the whole run, covering all of it.
      outChars.push(chars[i]!);
      outStarts.push(starts[i]!);
      outEnds.push(ends[j - 1]!);
    } else {
      for (let k = i; k < j; k++) {
        outChars.push(chars[k]!);
        outStarts.push(starts[k]!);
        outEnds.push(ends[k]!);
      }
    }
    i = j;
  }

  return { text: outChars.join(''), starts: outStarts, ends: outEnds };
}
