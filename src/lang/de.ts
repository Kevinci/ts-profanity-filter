// src/lang/de.ts — import from 'ts-profanity-filter/lang/de'
//
// German word lists. Same rules as the English ones: every entry is a regex
// source string and matching is substring-based.
//
// German needs a much larger allowlist than English for two reasons:
//   1. Compounding — `Weltklasse`, `Sparkasse`, `Trinkwasser` all end in a stem
//      that contains the English pattern `ass`, so allow entries are written
//      permissively as `\p{L}*stem\p{L}*`.
//   2. `aggressive` maps `c` to `[c(k<]`, so English patterns start matching
//      German k-spellings: `cum` suddenly hits `Dokument`, `Kumpel`, `Publikum`.

import type { LanguageDefinition } from '../registry.js';

/**
 * What counts as being *inside* a word, spelled out the same way `enclosingWord`
 * spells it in filter.ts.
 *
 * `\b` cannot be used for this. JavaScript's `\b` is defined in terms of `\w`,
 * which stays ASCII even under the `u` flag, so every umlaut and every `ß` reads
 * as a word boundary: `\bschwanz\b` fires inside `Straußschwanz`, and `\bsau\b`
 * inside `Straußsau`. Both are ordinary German compounds.
 */
const INSIDE_WORD = '[\\p{L}\\p{M}\\p{N}_]';

/**
 * Wraps a stem so it only matches as a whole word — the Unicode-aware version
 * of `\b…\b`.
 *
 * The lookbehind is why `filter.ts` compiles its patterns defensively: engines
 * without lookbehind support fall back rather than throwing.
 */
const word = (stem: string): string => `(?<!${INSIDE_WORD})${stem}(?!${INSIDE_WORD})`;

/** Patterns that flag a match. */
export const DE_PROFANITY: readonly string[] = [
  // general vulgarity
  'arsch', // covers Arschloch, Arschkriecher
  'schei(?:ss|ß)', // Scheiße, Scheiss, bescheissen
  'kacke',
  'piss',
  'verdammt',

  // sexual / anatomical
  'fotze',
  'votze',
  'fick',
  'muschi',
  'titten',
  'pimmel',
  'm(?:ö|oe)se',
  'wichs', // wichsen, Wichser
  word('schwanz'), // whole word only: Pferdeschwanz and Schwanzflosse are fine

  // insults aimed at people
  'hurensohn',
  'hure',
  'nutte',
  'schlampe',
  'bastard',
  'mistst(?:ü|ue)ck',
  // The Dreck- family: Dreck alone is just dirt, the compounds are the insult.
  'drecks?(?:au|schwein|sack|kerl|st(?:ü|ue)ck|viech|nest|fresse)',
  word('schwein'), // whole word only: Schweinefleisch and Meerschweinchen are fine
  'schweinehund',
  'saukerl',
  'sauhund',
  word('sau'), // whole word only: Hausaufgaben, sauber, Sauna are fine
  'penner',
  'depp',
  'trottel',
  'idiot',
  'vollpfosten',
  'bl(?:ö|oe)dmann',
  'hackfresse',
  'missgeburt',
  'spast',

  // slurs
  'neger',
  'kanake',
  'schwuchtel',
  'zigeuner',
];

/**
 * Words that must never be flagged. Anchored against the whole surrounding
 * word, so `\p{L}*klass\p{L}*` clears `Klassik`, `klassisch` and `Weltklasse`.
 *
 * An allowed word always wins over a blocked pattern.
 */
export const DE_ALLOWLIST: readonly string[] = [
  // -- `ass` (English pattern) inside ordinary German words ---------------
  '\\p{L}*klass\\p{L}*', // Klasse, Klassik, klassisch, Klassiker, Weltklasse
  '\\p{L}*mass\\p{L}*', // Masse, Massage, massiv, Massaker, Biomasse
  '\\p{L}*wass\\p{L}*', // Wasser, Trinkwasser, wässrig
  '\\p{L}*kass\\p{L}*', // Kasse, Kassette, kassieren, Sparkasse
  '\\p{L}*gass\\p{L}*', // Gasse, Seitengasse
  '\\p{L}*pass\\p{L}*', // passen, Passagier, Reisepass, anpassen
  '\\p{L}*lass\\p{L}*', // lassen, verlassen, Erlass, blass
  '\\p{L}*fass\\p{L}*', // fassen, Fassade, Fass, verfassen
  '\\p{L}*hass\\p{L}*', // Hass, hassen, verhasst
  '\\p{L}*nass\\p{L}*', // nass, Nässe
  '\\p{L}*tass\\p{L}*', // Tasse
  '\\p{L}*rass\\p{L}*', // Rasse, Terrasse, Strasse, krass
  '\\p{L}*bass\\p{L}*', // Bass, Kontrabass
  '\\p{L}*dass\\p{L}*', // dass
  '\\p{L}*sass\\p{L}*', // sass, Elsass
  '\\p{L}*assist\\p{L}*', // Assistent, Assistenz
  '\\p{L}*kompass\\p{L}*',

  // -- `arsch` inside ordinary German words -------------------------------
  '\\p{L}*marsch\\p{L}*', // Marsch, marschieren, Vormarsch, Marschall
  '\\p{L}*barsch\\p{L}*', // Barsch, barsch
  '\\p{L}*harsch\\p{L}*', // harsch, harscher

  // -- `dick` — German for "thick", nothing to do with the English word ---
  'dick(?:e|er|es|en|em|ere|eren|erer|eres|ste|sten|stes)?',
  '\\p{L}*dickicht',
  'dickdarm\\p{L}*',
  'dickkopf\\p{L}*',
  'dickfl\\p{L}*', // dickflüssig
  'dickh\\p{L}*', // dickhäutig
  'dickmach\\p{L}*',
  'verdick\\p{L}*',

  // -- `anal` -------------------------------------------------------------
  'analy\\p{L}*', // Analyse, analysieren, Analytiker
  'analog\\p{L}*',
  '\\p{L}*kanal\\p{L}*', // Kanal, Kanalisation, Fernsehkanal
  'banal\\p{L}*',
  'analphabet\\p{L}*',
  'annal\\p{L}*',

  // -- `cum` via the aggressive c -> [c(k<] mapping -----------------------
  'dokument\\p{L}*',
  '\\p{L}*kummer\\p{L}*',
  '\\p{L}*kumpel\\p{L}*',
  '\\p{L}*kumpan\\p{L}*',
  '\\p{L}*publikum\\p{L}*',
  'akkumul\\p{L}*',
  'kumul\\p{L}*',
  'zirkum\\p{L}*',
  'vakuum\\p{L}*',

  // -- other aggressive-mode collisions -----------------------------------
  '\\p{L}*schwank\\p{L}*', // wank: schwanken, Schwankung
  'wankel\\p{L}*',
  'wanken',
  'wankt',
  'wankte',
  'wankend\\p{L}*',
  '\\p{L}*spick\\p{L}*', // spic: spicken, Spickzettel
  '\\p{L}*prickel\\p{L}*', // prick: prickeln, prickelnd
  '\\p{L}*krapfen\\p{L}*', // crap: Krapfen
  'kunterbunt\\p{L}*', // cunt: kunterbunt
  'fagott\\p{L}*', // fag: Fagott
  'fkk', // fck: Freikörperkultur
  'homogen\\p{L}*',
  'homolog\\p{L}*',
  'homosexuell\\p{L}*',
];

/** Ready to hand to `registerLanguage('de', de)`. Pre-registered already. */
export const de: LanguageDefinition = {
  profanity: DE_PROFANITY,
  allow: DE_ALLOWLIST,
};
