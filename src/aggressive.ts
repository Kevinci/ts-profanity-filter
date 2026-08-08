// src/aggressive.ts
//
// Its own module so both the filter and the language registry can use it —
// the registry needs it to validate that a pattern still compiles *after* the
// expansion, and the filter imports the registry, so this cannot live there.

/**
 * Expands a pattern so that common leet-speak substitutions also match.
 *
 * This rewrites the regex *source*, letters and all, which has two
 * consequences worth knowing about:
 *
 * - It can produce an invalid pattern. `(?<word>fuck)` becomes
 *   `(?<w[o0]rd>…)`, and that is no longer a legal capture group name.
 *   `registerLanguage` compiles the expanded form to catch this early.
 * - It can silently change a valid pattern's meaning. `[abc]` becomes
 *   `[[a@4]b[c(k<]]`, which still compiles but matches something else.
 *   Nothing can detect that for you — write patterns as plain words, or
 *   turn `aggressive` off for hand-written regexes.
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
