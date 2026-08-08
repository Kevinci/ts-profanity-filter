// src/aggressive.ts
//
// Its own module so both the filter and the language registry can use it —
// the registry needs it to validate that a pattern still compiles *after* the
// expansion, and the filter imports the registry, so this cannot live there.

/**
 * Expands a pattern so that common leet-speak substitutions also match.
 *
 * This rewrites the regex *source*, letters and all, so a pattern that carries
 * its own syntax can come out broken: `[abc]` becomes `[[a@4]b[c(k<]]` and
 * `(?<word>…)` becomes `(?<w[o0]rd>…)`, neither of which is legal.
 *
 * The filter compiles with the `u` flag, which is strict enough to reject both,
 * and `registerLanguage` compiles the expanded form up front — so this surfaces
 * as an error at registration rather than as silently different matching.
 *
 * Write patterns as plain words. For hand-written regexes, turn `aggressive`
 * off instead.
 */
export function toAggressivePattern(pattern: string): string {
  return pattern
    .replace(/a/g, '[a@4]')
    .replace(/e/g, '[e3]')
    .replace(/i/g, '[i!1]')
    .replace(/o/g, '[o0]')
    .replace(/u/g, '[u\\^]')
    .replace(/c/g, '[c(k<]');
}
