// src/index.ts
export { filterFWordsToSegments } from './filter.js';
export type { TextSegment, FilterOptions } from './filter.js';

export { toAggressivePattern } from './aggressive.js';

export {
  registerLanguage,
  unregisterLanguage,
  resetLanguages,
  getLanguage,
  hasLanguage,
  listLanguages,
  resolveKey,
  de,
  en,
} from './registry.js';
export type { Language, BuiltinLanguage, LanguageLists, LanguageDefinition } from './registry.js';

export { DE_ALLOWLIST, DE_PROFANITY } from './lang/de.js';
export { EN_ALLOWLIST, EN_PROFANITY } from './lang/en.js';
