// src/react.ts — import from 'ts-profanity-filter/react'
//
// `react` is an optional peer dependency: importing this entry point pulls it
// in, the core entry point never does.
import { useMemo } from 'react';

import { filterFWordsToSegments, type FilterOptions, type TextSegment } from './filter.js';

/**
 * Splits `text` into segments and memoises the result.
 *
 * `options` is compared by value, so an inline object literal is fine and does
 * not re-run the filter on every render.
 *
 * ```tsx
 * function Comment({ body }: { body: string }) {
 *   const segments = useProfanitySegments(body, { languages: ['en', 'de'] });
 *   return (
 *     <p>
 *       {segments.map((seg, i) =>
 *         seg.isProfane ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>,
 *       )}
 *     </p>
 *   );
 * }
 * ```
 */
export function useProfanitySegments(text: string, options: FilterOptions = {}): TextSegment[] {
  const key = JSON.stringify([
    options.languages,
    options.customList,
    options.allowList,
    options.aggressive,
  ]);

  return useMemo(
    () => filterFWordsToSegments(text, options),
    // `options` is intentionally left out — `key` is its value-level identity,
    // so an inline literal with unchanged contents does not invalidate. A React
    // hooks linter in a consuming app will want that exception spelled out;
    // this repository does not run one, so the directive would be dead weight.
    [text, key],
  );
}

/**
 * Convenience wrapper for the common "is there anything to moderate here"
 * check. Memoised the same way.
 */
export function useIsProfane(text: string, options: FilterOptions = {}): boolean {
  const segments = useProfanitySegments(text, options);
  return useMemo(() => segments.some((s) => s.isProfane), [segments]);
}

export { filterFWordsToSegments } from './filter.js';
export type { FilterOptions, TextSegment } from './filter.js';
export type { Language } from './registry.js';
