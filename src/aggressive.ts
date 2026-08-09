// src/aggressive.ts
//
// Its own module so both the filter and the language registry can use it —
// the registry needs it to validate that a pattern still compiles *after* the
// expansion, and the filter imports the registry, so this cannot live there.

/**
 * What each letter is allowed to look like.
 *
 * Three kinds of substitution, all of them things people actually type to get
 * past a filter:
 *
 *  - **leet**: `@`/`4` for a, `3` for e, `$`/`5` for s
 *  - **diacritics**: `ä` for a *and* for e — `Dräcksau` uses it as an e, so the
 *    ambiguity is deliberate. A one-to-one fold would have to pick a side and
 *    would get that example wrong.
 *  - **cross-script lookalikes**: Cyrillic `а е о с ѕ і` and Greek `α ε ο ϲ ι`
 *    are different code points that render identically to their Latin twins.
 *    `Аrschloch` with a Cyrillic А reads as the real word to every human.
 *
 * `p` is deliberately *not* expandable: allow patterns are full of `\p{L}`, and
 * rewriting the `p` in it would destroy them.
 */
const CLASSES: Readonly<Record<string, string>> = {
  a: '[aàáâãäåāă@4аα*#]',
  e: '[eèéêëēĕė3äеε*#]',
  i: '[iìíîïīı!1іι*#]',
  o: '[oòóôõöøō0оο*#]',
  u: '[uùúûüū\\^*#]',
  c: '[cçćčk(<сϲк]',
  // Only the lookalike, deliberately not `c`: the c class already reaches k,
  // and mapping k back to c as well would let `kacke` match `cacce`.
  k: '[kк]',
  s: '[sšśş$5ѕ]',
};

/** One pass, so an inserted class is never rescanned and re-expanded. */
const EXPANDABLE = /[aeiousck]/g;

/**
 * Expands a pattern so that leet spellings, diacritics and cross-script
 * lookalikes also match.
 *
 * This rewrites the regex *source*, letters and all, so a pattern that carries
 * its own syntax can come out broken: `[abc]` becomes a nest of character
 * classes and `(?<word>…)` loses its capture group name. The filter compiles
 * with the `u` flag, which is strict enough to reject both, and
 * `registerLanguage` compiles the expanded form up front — so this surfaces as
 * an error at registration rather than as silently different matching.
 *
 * Write patterns as plain words. For hand-written regexes, turn `aggressive`
 * off instead.
 */
export function toAggressivePattern(pattern: string): string {
  return pattern.replace(EXPANDABLE, (letter) => CLASSES[letter] ?? letter);
}
