// src/vue.ts — import from 'ts-profanity-filter/vue'
//
// `vue` is an optional peer dependency (3.3+, for `toValue`): importing this
// entry point pulls it in, the core entry point never does.
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';

import { filterFWordsToSegments, type FilterOptions, type TextSegment } from './filter.js';

/**
 * Reactive wrapper around {@link filterFWordsToSegments}. Both arguments accept
 * a plain value, a ref, or a getter.
 *
 * ```vue
 * <script setup lang="ts">
 * import { ref } from 'vue';
 * import { useProfanitySegments } from 'ts-profanity-filter/vue';
 *
 * const body = ref('');
 * const segments = useProfanitySegments(body, { languages: ['en', 'de'] });
 * </script>
 *
 * <template>
 *   <p>
 *     <template v-for="(seg, i) in segments" :key="i">
 *       <mark v-if="seg.isProfane">{{ seg.text }}</mark>
 *       <template v-else>{{ seg.text }}</template>
 *     </template>
 *   </p>
 * </template>
 * ```
 */
export function useProfanitySegments(
  text: MaybeRefOrGetter<string>,
  options: MaybeRefOrGetter<FilterOptions> = {},
): ComputedRef<TextSegment[]> {
  return computed(() => filterFWordsToSegments(toValue(text), toValue(options)));
}

/** Reactive "is there anything to moderate here" check. */
export function useIsProfane(
  text: MaybeRefOrGetter<string>,
  options: MaybeRefOrGetter<FilterOptions> = {},
): ComputedRef<boolean> {
  const segments = useProfanitySegments(text, options);
  return computed(() => segments.value.some((s) => s.isProfane));
}

export { filterFWordsToSegments } from './filter.js';
export type { FilterOptions, TextSegment } from './filter.js';
export type { Language } from './lists/index.js';
