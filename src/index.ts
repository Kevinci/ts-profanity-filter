// src/index.ts
export { filterFWordsToSegments } from './filter.js';
export type { TextSegment, FilterOptions } from './filter.js';

export {
  LANGUAGES,
  LISTS,
  DE_ALLOWLIST,
  DE_PROFANITY,
  EN_ALLOWLIST,
  EN_PROFANITY,
} from './lists/index.js';
export type { Language, LanguageLists } from './lists/index.js';
