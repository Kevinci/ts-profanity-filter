// The corpus.
//
// Two halves, and both are load-bearing. The `flag` half is profanity in
// disguise: a filter that misses one has been evaded. The `clean` half is
// ordinary text that merely looks profane to a substring matcher: a filter that
// flags one has produced a false positive.
//
// Scoring only the first half would reward `detect = () => true`, so any filter
// that scores well here has to do both — and the trade-off between them is the
// entire craft.
//
// On vocabulary: this is a test of obfuscation mechanics, not of how many words
// a list holds, so it uses a handful of ordinary swear words and no slurs. The
// disguises are the subject; the base words are just carriers.

import type { Attack } from './types.js';

const EN = ['en'] as const;
const DE = ['de'] as const;

/**
 * Hand-aligned on purpose: 81 attacks as a readable table. Prettier would
 * expand this to 711 lines of one field per line, which is the same data and a
 * far worse corpus to review.
 */
// prettier-ignore
export const CORPUS: readonly Attack[] = [
  /* ---------------------------- control ------------------------------- */
  // If these fail, nothing below means anything.
  { id: 'control-en', category: 'control', languages: EN, expect: 'flag',
    text: 'what an asshole', note: 'plain spelling' },
  { id: 'control-de', category: 'control', languages: DE, expect: 'flag',
    text: 'so eine Drecksau', note: 'plain spelling' },
  { id: 'control-clean-en', category: 'control', languages: EN, expect: 'clean',
    text: 'a pleasant afternoon in the garden', note: 'nothing to find' },
  { id: 'control-clean-de', category: 'control', languages: DE, expect: 'clean',
    text: 'ein schöner Nachmittag im Garten', note: 'nothing to find' },

  /* ------------------------------ leet -------------------------------- */
  { id: 'leet-digits-en', category: 'leet', languages: EN, expect: 'flag',
    text: 'what the sh1t', note: 'digit for letter' },
  { id: 'leet-symbols-en', category: 'leet', languages: EN, expect: 'flag',
    text: 'you @sshole', note: 'symbol for letter' },
  { id: 'leet-mixed-en', category: 'leet', languages: EN, expect: 'flag',
    text: 'f*ck this', note: 'asterisk for letter' },
  { id: 'leet-de', category: 'leet', languages: DE, expect: 'flag',
    text: 'so eine Dr3cks4u', note: 'digits for letters' },
  { id: 'leet-heavy-de', category: 'leet', languages: DE, expect: 'flag',
    text: 'du @rschl0ch', note: 'symbol and digit' },

  /* --------------------------- diacritics ------------------------------ */
  { id: 'diacritic-en', category: 'diacritics', languages: EN, expect: 'flag',
    text: 'you ässhöle', note: 'umlauts on the vowels' },
  { id: 'diacritic-de', category: 'diacritics', languages: DE, expect: 'flag',
    text: 'du DräckSAU', note: 'umlaut plus case noise' },
  { id: 'diacritic-acute', category: 'diacritics', languages: DE, expect: 'flag',
    text: 'Drécksáu', note: 'acute accents' },

  /* --------------------------- homoglyphs ------------------------------ */
  { id: 'homoglyph-cyrillic-en', category: 'homoglyph', languages: EN, expect: 'flag',
    text: 'аsshole', note: 'Cyrillic а for Latin a' },
  { id: 'homoglyph-cyrillic-de', category: 'homoglyph', languages: DE, expect: 'flag',
    text: 'Drеcksau', note: 'Cyrillic е for Latin e' },
  { id: 'homoglyph-greek', category: 'homoglyph', languages: EN, expect: 'flag',
    text: 'shιt', note: 'Greek iota for Latin i' },
  { id: 'homoglyph-mixed-script', category: 'homoglyph', languages: DE, expect: 'flag',
    text: 'Drескsau', note: 'several Cyrillic letters at once' },

  /* ---------------------------- spacing -------------------------------- */
  { id: 'spacing-en', category: 'spacing', languages: EN, expect: 'flag',
    text: 'f u c k this', note: 'spaces between letters' },
  { id: 'spacing-dots-en', category: 'spacing', languages: EN, expect: 'flag',
    text: 's.h.i.t', note: 'dots between letters' },
  { id: 'spacing-dashes-de', category: 'spacing', languages: DE, expect: 'flag',
    text: 'D-r-e-c-k-s-a-u', note: 'dashes between letters' },
  { id: 'spacing-de', category: 'spacing', languages: DE, expect: 'flag',
    text: 'D r e c k s a u', note: 'spaces between letters' },

  /* --------------------------- repetition ------------------------------ */
  { id: 'repeat-en', category: 'repetition', languages: EN, expect: 'flag',
    text: 'fuuuuck', note: 'stretched vowel' },
  { id: 'repeat-de', category: 'repetition', languages: DE, expect: 'flag',
    text: 'Dreeecksau', note: 'stretched vowel' },
  { id: 'repeat-tail-de', category: 'repetition', languages: DE, expect: 'flag',
    text: 'Drecksauuuu', note: 'stretched final letter' },
  { id: 'repeat-doubled-de', category: 'repetition', languages: DE, expect: 'flag',
    text: 'DDrreecckkssaauu', note: 'every letter doubled — collides with ordinary doubles' },

  /* ---------------------------- invisible ------------------------------ */
  { id: 'invisible-zwsp-en', category: 'invisible', languages: EN, expect: 'flag',
    text: 'ass​hole', note: 'zero-width space inside the word' },
  { id: 'invisible-zwj-de', category: 'invisible', languages: DE, expect: 'flag',
    text: 'Dreck‍sau', note: 'zero-width joiner inside the word' },
  { id: 'invisible-shy-de', category: 'invisible', languages: DE, expect: 'flag',
    text: 'Dreck­sau', note: 'soft hyphen inside the word' },
  { id: 'invisible-wj-en', category: 'invisible', languages: EN, expect: 'flag',
    text: 'sh⁠it', note: 'word joiner inside the word' },

  /* -------------------------- compatibility ---------------------------- */
  { id: 'nfkc-fullwidth-en', category: 'compatibility', languages: EN, expect: 'flag',
    text: 'Ａｓｓｈｏｌｅ', note: 'fullwidth letters — NFKC-identical to the plain word' },
  { id: 'nfkc-fullwidth-de', category: 'compatibility', languages: DE, expect: 'flag',
    text: 'Ｄｒｅｃｋｓａｕ', note: 'fullwidth letters' },
  { id: 'nfkc-mathbold-de', category: 'compatibility', languages: DE, expect: 'flag',
    text: '\u{1D403}\u{1D42B}\u{1D41E}\u{1D41C}\u{1D424}\u{1D42C}\u{1D41A}\u{1D42E}',
    note: 'mathematical bold — astral characters' },
  { id: 'nfkc-circled-de', category: 'compatibility', languages: DE, expect: 'flag',
    text: 'Ⓓⓡⓔⓒⓚⓢⓐⓤ', note: 'circled letters' },
  { id: 'nfkc-superscript-de', category: 'compatibility', languages: DE, expect: 'flag',
    text: 'ᴰʳᵉᶜᵏˢᵃᵘ', note: 'modifier letters' },

  /* ---------------------------- combining ------------------------------ */
  { id: 'combining-decomposed-de', category: 'combining', languages: DE, expect: 'flag',
    text: 'Dräcksau', note: 'decomposed umlaut' },
  { id: 'combining-strike-de', category: 'combining', languages: DE, expect: 'flag',
    text: 'D̶r̶e̶c̶k̶s̶a̶u̶', note: 'combining strikethrough on every letter' },
  { id: 'combining-stack-en', category: 'combining', languages: EN, expect: 'flag',
    text: 'sh͓it', note: 'a mark with no precomposed form' },

  /* ------------------------------ casing ------------------------------- */
  { id: 'case-mixed-en', category: 'casing', languages: EN, expect: 'flag',
    text: 'aSsHoLe', note: 'alternating case' },
  { id: 'case-sharp-s-de', category: 'casing', languages: DE, expect: 'flag',
    text: 'SCHEIẞE', note: 'capital sharp s — needs full Unicode case folding' },

  /* ---------------------------- insertion ------------------------------ */
  { id: 'insert-letter-de', category: 'insertion', languages: DE, expect: 'flag',
    text: 'Dreckxsau', note: 'a foreign letter wedged into the word' },
  { id: 'insert-bracket-de', category: 'insertion', languages: DE, expect: 'flag',
    text: 'Dr[e]cksau', note: 'brackets around a letter' },
  { id: 'insert-punct-en', category: 'insertion', languages: EN, expect: 'flag',
    text: 'a$$hole', note: 'currency symbols for letters' },

  /* ------------------------- rewriting the word ------------------------ */
  { id: 'reverse-de', category: 'rewriting', languages: DE, expect: 'flag',
    text: 'uaskcerD', note: 'written backwards' },
  { id: 'phonetic-de', category: 'rewriting', languages: DE, expect: 'flag',
    text: 'Dreggsau', note: 'spelled as it sounds' },
  { id: 'phonetic-en', category: 'rewriting', languages: EN, expect: 'flag',
    text: 'phuck this', note: 'spelled as it sounds' },

  /* ------------------------------ encoding ----------------------------- */
  // Arguably the application's job to decode before moderating — which is
  // exactly the sort of assumption a benchmark should make visible.
  { id: 'encoding-entity-de', category: 'encoding', languages: DE, expect: 'flag',
    text: 'Dreck&#115;au', note: 'HTML entity for one letter' },
  { id: 'encoding-percent-de', category: 'encoding', languages: DE, expect: 'flag',
    text: 'Dreck%73au', note: 'percent-encoded letter' },

  /* ============================ FALSE POSITIVES ======================== */
  // The Scunthorpe family. Every one of these is an ordinary word that contains
  // a shorter rude one, and every one of them has been wrongly blocked by a
  // real product at some point.

  { id: 'fp-scunthorpe', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'Welcome to Scunthorpe', note: 'the original' },
  { id: 'fp-penistone', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'the village of Penistone', note: 'place name' },
  { id: 'fp-clitheroe', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'a weekend in Clitheroe', note: 'place name' },
  { id: 'fp-lightwater', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'she lives in Lightwater', note: 'place name' },
  { id: 'fp-cockburn', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'Professor Cockburn will speak', note: 'surname' },
  { id: 'fp-hancock', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'signed by John Hancock', note: 'surname' },
  { id: 'fp-matsushita', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'Matsushita Electric Industrial', note: 'company name containing a rude substring' },
  { id: 'fp-shiitake', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'shiitake mushrooms, sliced', note: 'ingredient' },
  { id: 'fp-classic', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'a classic assessment by the assistant', note: 'three at once' },
  { id: 'fp-assassin', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'the assassin fled the scene', note: 'ordinary noun' },
  { id: 'fp-cocktail', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'a cocktail before dinner', note: 'ordinary noun' },
  { id: 'fp-analysis', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'the analysis of the canal', note: 'ordinary noun' },
  { id: 'fp-therapist', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'she is a therapist', note: 'ordinary noun' },
  { id: 'fp-cockroach', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'sitting next to a cockroach', note: 'also a trap for spaced-out detection' },
  { id: 'fp-dickens', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'a novel by Dickens', note: 'surname' },
  { id: 'fp-butt', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'the buttress of the cathedral', note: 'ordinary noun' },

  { id: 'fp-klassik', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'der Klassiker aus Kassel', note: 'German compounds containing "ass"' },
  { id: 'fp-hausaufgaben', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'meine Hausaufgaben sind fertig', note: 'contains "sau"' },
  { id: 'fp-meerschweinchen', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'ein Meerschweinchen im Käfig', note: 'contains "schwein"' },
  { id: 'fp-straussschwanz', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'ein Straußschwanz', note: 'ß next to an anchored stem — breaks ASCII \\b' },
  { id: 'fp-analyse', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'die Analyse der Kanalisation', note: 'contains "anal"' },
  { id: 'fp-dokument', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'ein Dokument für das Publikum', note: 'contains "cum" once c maps to k' },
  { id: 'fp-massage', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'eine Massage in der Sauna', note: 'contains "ass" and "sau"' },
  { id: 'fp-sauber', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'alles ganz sauber hier', note: 'starts with "sau"' },
  { id: 'fp-dick', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'ein dickes Buch über Fassaden', note: '"dick" is German for thick' },
  { id: 'fp-titel', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'der Titel des Buches', note: 'contains "tit"' },
  { id: 'fp-wasser', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'Trinkwasser aus der Leitung', note: 'contains "ass"' },
  { id: 'fp-kumpel', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'mein Kumpel und ich', note: 'contains "cum" once c maps to k' },
  { id: 'fp-marsch', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'ein harscher Marsch', note: 'contains "arsch" twice' },
  { id: 'fp-krapfen', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'Krapfen zum Kaffee', note: 'contains "crap" once c maps to k' },
  { id: 'fp-kunterbunt', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'alles kunterbunt gemischt', note: 'contains a rude substring under k/c mapping' },
  { id: 'fp-fagott', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'sie spielt Fagott', note: 'instrument' },

  // Leet expansion has to reach the allowlist too, or ordinary words come back
  // flagged the moment the blocklist is expanded.
  { id: 'fp-leet-klassik', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'Kl4ssik im Radio', note: 'an allowed word written in leet' },
  { id: 'fp-leet-classic', category: 'false-positive', languages: EN, expect: 'clean',
    text: 'a cl4ssic mistake', note: 'an allowed word written in leet' },
  { id: 'fp-repeat-klassik', category: 'false-positive', languages: DE, expect: 'clean',
    text: 'Klaaassiker', note: 'an allowed word, stretched' },
];

/** Every category in the corpus, in the order they first appear. */
export const CATEGORIES: readonly string[] = [...new Set(CORPUS.map((a) => a.category))];
