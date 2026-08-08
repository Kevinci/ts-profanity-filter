// src/filter.ts
import { toAggressivePattern } from './aggressive.js';
import { normalizeForMatching } from './normalize.js';
import { getLanguage, listLanguages, type Language } from './registry.js';

/** A single segment of the analysed text. */
export interface TextSegment {
  /** The content of the segment. */
  text: string;
  /** True if this segment should be blacked out. */
  isProfane: boolean;
}

export interface FilterOptions {
  /**
   * Which registered languages to match against. Defaults to `['en']`.
   *
   * Pass `['en', 'de']` for mixed-language text, a BCP-47 tag like `'de-AT'`
   * (which falls back to `'de'` when the variant is not registered), or the
   * literal `'*'` to use every registered language.
   */
  languages?: readonly Language[] | '*';
  /**
   * Replaces the built-in profanity patterns entirely. Entries are regex
   * source strings. An empty array falls back to the built-in lists.
   */
  customList?: readonly string[];
  /**
   * Extra words that must never be flagged, added on top of the built-in
   * allowlist. Entries are regex sources matched against the **whole
   * surrounding word**, so `klass\p{L}*` clears `Klassik` and `klassisch`.
   */
  allowList?: readonly string[];
  /**
   * Check every hit against the allowlist before flagging it. Defaults to
   * `true`. Set to `false` for raw substring matching — useful for auditing
   * what the allowlist is actually suppressing.
   */
  crossCheck?: boolean;
  /**
   * Also match common letter substitutions (`a` -> `@`/`4`, `i` -> `!`/`1`,
   * `c` -> `(`/`k`/`<`, ...). Defaults to `true`.
   */
  aggressive?: boolean;
}

/** Characters that count as part of a word when looking up the allowlist. */
const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;

/** Compiled regexes are reused across calls — building them is the slow part. */
const profanityCache = new Map<string, RegExp>();
const allowCache = new Map<string, RegExp | null>();
const CACHE_LIMIT = 64;

function cached<T>(store: Map<string, T>, key: string, build: () => T): T {
  const hit = store.get(key);
  if (hit !== undefined) return hit;
  const built = build();
  if (store.size >= CACHE_LIMIT) store.clear();
  store.set(key, built);
  return built;
}

function profanityRegexFor(patterns: readonly string[], aggressive: boolean): RegExp {
  const key = `${aggressive ? 'a' : 'l'}\u0000${patterns.join('\u0000')}`;
  // 'g' find every occurrence, 'i' ignore case, 'u' so case folding is the
  // full Unicode one — without it 'SCHEIẞE' does not fold to 'ß' and slips
  // through. lastIndex is reset before every use, so sharing one instance
  // across calls is safe.
  return cached(profanityCache, key, () => {
    const source = patterns
      .map((p) => (aggressive ? toAggressivePattern(p) : p))
      .join('|');
    return new RegExp(source, 'giu');
  });
}

function allowRegexFor(patterns: readonly string[], aggressive: boolean): RegExp | null {
  if (patterns.length === 0) return null;
  const key = `${aggressive ? 'a' : 'l'}${'\u0000'}${patterns.join('\u0000')}`;
  // The allowlist gets the same expansion as the patterns it has to overrule.
  // Without that the two sides drift apart: `ass` matches the `4ss` in
  // `Kl4ssik` while the allow entry still only spells `klass`, and a perfectly
  // ordinary word comes back flagged.
  //
  // 'u' so allow entries can use \p{L}; anchored so a stem must cover the
  // whole surrounding word rather than just appearing inside it.
  return cached(allowCache, key, () => {
    const source = patterns
      .map((p) => (aggressive ? toAggressivePattern(p) : p))
      .join('|');
    return new RegExp(`^(?:${source})$`, 'iu');
  });
}

/** Grows a match outwards to the word it sits in, e.g. `ass` -> `Klassik`. */
function enclosingWord(text: string, start: number, end: number): string {
  let a = start;
  let b = end;
  while (a > 0 && WORD_CHAR.test(text.charAt(a - 1))) a--;
  while (b < text.length && WORD_CHAR.test(text.charAt(b))) b++;
  return text.slice(a, b);
}

function resolvePatterns(options: FilterOptions): {
  profanity: readonly string[];
  allow: readonly string[];
} {
  const languages =
    options.languages === '*' ? listLanguages() : (options.languages ?? ['en']);

  const builtinProfanity: string[] = [];
  const builtinAllow: string[] = [];
  for (const language of languages) {
    const lists = getLanguage(language);
    if (!lists) {
      // Silently ignoring a typo would let profanity through unfiltered, which
      // is the worst way for a moderation filter to fail.
      throw new RangeError(
        `Unknown language '${language}'. Registered: ${listLanguages().join(', ') || '(none)'}. ` +
          'Add it with registerLanguage().',
      );
    }
    builtinProfanity.push(...lists.profanity);
    builtinAllow.push(...lists.allow);
  }

  const profanity =
    options.customList && options.customList.length > 0
      ? options.customList
      : builtinProfanity;

  if (options.crossCheck === false) {
    return { profanity, allow: [] };
  }

  const allow = options.allowList
    ? [...builtinAllow, ...options.allowList]
    : builtinAllow;

  return { profanity, allow };
}

/**
 * Filters text and returns an array of segments for UI rendering.
 *
 * Matching is substring-based, so `ass` also fires inside `Klassik`. The
 * allowlist is the counterweight: a match is dropped when the word around it
 * is allowed. An allowed word always wins over a blocked pattern.
 *
 * @param text - The input string.
 * @param options - Languages, custom patterns, allowlist additions, aggressive matching.
 * @returns An array of TextSegment objects covering the full input text.
 */
export function filterFWordsToSegments(
  text: string,
  options: FilterOptions = {},
): TextSegment[] {
  if (!text || text.trim() === '') {
    return [{ text: text || '', isProfane: false }];
  }

  const { aggressive = true } = options;
  const { profanity, allow } = resolvePatterns(options);

  if (profanity.length === 0) {
    return [{ text, isProfane: false }];
  }

  const profanityRegex = profanityRegexFor(profanity, aggressive);
  const allowRegex = allowRegexFor(allow, aggressive);

  // Separators and repetition are stripped out for matching only. Every match
  // is then mapped back onto the original text, so the segments still add up
  // to the input exactly. `null` means there was nothing to strip.
  const normalized = aggressive ? normalizeForMatching(text) : null;
  const haystack = normalized ? normalized.text : text;

  /** Original [start, end) of a match found at [from, to) in the haystack. */
  const toOriginal = (from: number, to: number): [number, number] =>
    normalized ? [normalized.starts[from]!, normalized.ends[to - 1]!] : [from, to];

  profanityRegex.lastIndex = 0;

  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = profanityRegex.exec(haystack)) !== null) {
    // A pattern that can match the empty string would loop forever otherwise.
    if (match[0] === '') {
      profanityRegex.lastIndex++;
      continue;
    }

    const hitEnd = match.index + match[0].length;

    // The cross-check: is this hit part of a perfectly ordinary word? Run it on
    // the haystack, so a word that was spaced out is judged as the word it is.
    // Leaving lastIndex untouched lets the surrounding clean run absorb it.
    if (allowRegex && allowRegex.test(enclosingWord(haystack, match.index, hitEnd))) {
      continue;
    }

    const [start, end] = toOriginal(match.index, hitEnd);
    /* c8 ignore next */
    if (start < lastIndex) continue; // defensive: spans must not overlap

    // 1. The clean text *before* the match.
    if (start > lastIndex) {
      segments.push({ text: text.substring(lastIndex, start), isProfane: false });
    }

    // 2. The profane match itself, sliced from the original text.
    segments.push({ text: text.substring(start, end), isProfane: true });

    lastIndex = end;
  }

  // 3. Whatever clean text is left after the last match.
  if (lastIndex < text.length) {
    segments.push({ text: text.substring(lastIndex), isProfane: false });
  }

  return segments;
}
