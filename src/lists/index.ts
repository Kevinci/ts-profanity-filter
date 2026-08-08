// src/lists/index.ts
import { DE_ALLOWLIST, DE_PROFANITY } from './de.js';
import { EN_ALLOWLIST, EN_PROFANITY } from './en.js';

/** Languages that ship with a built-in word list. */
export type Language = 'en' | 'de';

export interface LanguageLists {
  /** Patterns that flag a match. */
  readonly profanity: readonly string[];
  /** Words that must never be flagged, even when a pattern matches inside them. */
  readonly allow: readonly string[];
}

/** Every built-in list, keyed by language. */
export const LISTS: Readonly<Record<Language, LanguageLists>> = {
  en: { profanity: EN_PROFANITY, allow: EN_ALLOWLIST },
  de: { profanity: DE_PROFANITY, allow: DE_ALLOWLIST },
};

/** All supported language codes, in a stable order. */
export const LANGUAGES: readonly Language[] = ['en', 'de'];

export { DE_ALLOWLIST, DE_PROFANITY, EN_ALLOWLIST, EN_PROFANITY };
