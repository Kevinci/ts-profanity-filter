// src/lang/en.ts — import from 'ts-profanity-filter/lang/en'
//
// English word lists. Every entry is a **regex source string**, not a plain
// word — that is what lets a single entry cover several spellings.
//
// Matching is substring-based on purpose: it catches `asshole` from `ass` and
// survives obfuscation. The price is false positives, which is what
// EN_ALLOWLIST exists to undo.

import type { LanguageDefinition } from '../registry.js';

/** Patterns that flag a match. */
export const EN_PROFANITY: readonly string[] = [
  // f-word and its usual manglings
  'fuck',
  'fux?k',
  'f(?:uc|ku)k',
  'fck',

  // general vulgarity
  'shit',
  'ass',
  'arse',
  'bitch',
  'bastard',
  'crap',
  'damn',
  'piss',
  'bollocks',
  'bugger',
  'douche',
  'skank',
  'slut',
  'whore',
  'prick',
  'twat',
  'wank',

  // sexual / anatomical
  'cunt',
  'cock',
  'dick',
  'pussy',
  'anal',
  'boobs',
  'tits',
  'titties',
  'cum',
  'jizz',
  'blowjob',
  'handjob',

  // slurs
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'retard',
  'spic',
  'chink',
  'kike',
  'wetback',
  'tranny',
  'homo',
  'bimbo',
];

/**
 * Words that must never be flagged, even when a pattern above matches inside
 * them. Each entry is a regex source anchored against the **whole surrounding
 * word**, so `class\p{L}*` clears `class`, `classic` and `classifier` but
 * leaves `asshole` alone.
 *
 * An allowed word always wins over a blocked pattern.
 */
export const EN_ALLOWLIST: readonly string[] = [
  // -- ass --------------------------------------------------------------
  'class\\p{L}*',
  'pass\\p{L}*',
  'bypass\\p{L}*',
  'surpass\\p{L}*',
  'compass\\p{L}*',
  'assist\\p{L}*',
  'assess\\p{L}*',
  'assum\\p{L}*',
  'assur\\p{L}*',
  'assign\\p{L}*',
  'assembl\\p{L}*',
  'associat\\p{L}*',
  'assert\\p{L}*',
  'asset\\p{L}*',
  'assort\\p{L}*',
  'assassin\\p{L}*',
  'mass\\p{L}*',
  'glass\\p{L}*',
  'grass\\p{L}*',
  'bass\\p{L}*',
  'brass\\p{L}*',
  'embarrass\\p{L}*',
  'harass\\p{L}*',
  'cassette\\p{L}*',
  'casserole\\p{L}*',
  'chassis',
  'potassium',
  'morass',
  'lasso\\p{L}*',
  'ambassador\\p{L}*',

  // -- cock --------------------------------------------------------------
  'cocktail\\p{L}*',
  'cockpit\\p{L}*',
  'cockroach\\p{L}*',
  'cockney',
  'cockle\\p{L}*',
  'cockatoo\\p{L}*',
  'peacock\\p{L}*',
  'shuttlecock\\p{L}*',
  'hancock',
  'babcock',
  'woodcock',

  // -- cunt / dick — the classic Scunthorpe cases ------------------------
  'scunthorpe',
  'penistone',
  'clitheroe',
  'dickens\\p{L}*',
  'dickinson',
  'dickey',

  // -- anal --------------------------------------------------------------
  'analy\\p{L}*',
  'analog\\p{L}*',
  'canal\\p{L}*',
  'banal\\p{L}*',
  'analphabet\\p{L}*',

  // -- cum ---------------------------------------------------------------
  'document\\p{L}*',
  'circum\\p{L}*',
  'accumulat\\p{L}*',
  'cumulat\\p{L}*',
  'cucumber\\p{L}*',
  'vacuum\\p{L}*',
  'incumbent\\p{L}*',
  'encumber\\p{L}*',
  'cumbersome',
  'succumb\\p{L}*',
  'cumin',

  // -- homo --------------------------------------------------------------
  'homogen\\p{L}*',
  'homolog\\p{L}*',
  'homophone\\p{L}*',
  'homonym\\p{L}*',
  'homograph\\p{L}*',
  'homosexual\\p{L}*',

  // -- spic --------------------------------------------------------------
  'spice\\p{L}*',
  'spicy',
  'spicier',
  'spiciest',
  'suspicio\\p{L}*',
  'auspicio\\p{L}*',
  'conspicuo\\p{L}*',
  'despicabl\\p{L}*',

  // -- arse --------------------------------------------------------------
  'coarse\\p{L}*',
  'hoarse\\p{L}*',
  'sparse\\p{L}*',
  'parse\\p{L}*',
  'arsenal\\p{L}*',
  'arsenic',

  // -- assorted ----------------------------------------------------------
  'scrap\\p{L}*', // crap
  'prickl\\p{L}*', // prick
  'niggard\\p{L}*', // nigger
  'retardant\\p{L}*', // retard
  'retardation',
  'fagott\\p{L}*', // fag — the bassoon
];

/** Ready to hand to `registerLanguage('en', en)`. Pre-registered already. */
export const en: LanguageDefinition = {
  profanity: EN_PROFANITY,
  allow: EN_ALLOWLIST,
};
