// src/registry.ts
//
// The language registry. Any language can be added at runtime; `en` and `de`
// are simply the two that ship pre-registered.
//
// Three things make this more than a lookup table:
//   - `extends` lets a regional variant inherit a base list instead of copying
//     it, so `de-AT` is a handful of extra words, not a second full list.
//   - Lookups fall back along BCP-47 subtags, so `de-AT-1996` finds `de-AT`,
//     and `de-CH` finds plain `de` without anyone registering it.
//   - Patterns are validated when they are registered, not when text is
//     filtered — a typo fails at startup with the offending pattern named,
//     rather than throwing deep inside a moderation request.

import { toAggressivePattern } from './aggressive.js';
import { de } from './lang/de.js';
import { en } from './lang/en.js';

/** The languages that ship with the package. */
export type BuiltinLanguage = 'en' | 'de';

/**
 * A language code. The built-ins autocomplete; any other string is accepted,
 * so BCP-47 tags like `de-AT` or private codes like `internal-slang` work.
 */
export type Language = BuiltinLanguage | (string & {});

/** A resolved list pair, with any `extends` chain already flattened in. */
export interface LanguageLists {
  /** Patterns that flag a match. */
  readonly profanity: readonly string[];
  /** Words that must never be flagged, even when a pattern matches inside them. */
  readonly allow: readonly string[];
}

/** What you hand to {@link registerLanguage}. */
export interface LanguageDefinition {
  /** Patterns that flag a match. Regex sources, matched as substrings. */
  readonly profanity?: readonly string[];
  /**
   * Words that must never be flagged. Regex sources, matched against the
   * **whole surrounding word**, so `klass\p{L}*` clears `Klassik`.
   */
  readonly allow?: readonly string[];
  /**
   * Inherit from an already-registered language. The parent's patterns come
   * first, this definition is added on top. The parent must exist already.
   */
  readonly extends?: Language;
}

interface Entry {
  readonly profanity: readonly string[];
  readonly allow: readonly string[];
  readonly parent?: string;
}

const registry = new Map<string, Entry>();

/** Codes are case-insensitive and trimmed; `de-AT` and `DE-at` are one language. */
function normalize(code: Language): string {
  return String(code).trim().toLowerCase();
}

function assertPatterns(
  code: string,
  kind: 'profanity' | 'allow',
  patterns: readonly string[],
): void {
  if (!Array.isArray(patterns)) {
    throw new TypeError(`registerLanguage('${code}'): ${kind} must be an array of strings.`);
  }
  patterns.forEach((pattern, i) => {
    if (typeof pattern !== 'string' || pattern === '') {
      throw new TypeError(
        `registerLanguage('${code}'): ${kind}[${i}] must be a non-empty string.`,
      );
    }
    const compile = (source: string, flags: string, note: string) => {
      try {
        new RegExp(source, flags);
      } catch (cause) {
        const why = cause instanceof Error ? cause.message : String(cause);
        throw new SyntaxError(
          `registerLanguage('${code}'): ${kind}[${i}] ${JSON.stringify(pattern)} ${note} — ${why}`,
        );
      }
    };

    if (kind === 'allow') {
      // Anchored and unicode-aware, exactly how the filter uses it.
      compile(`^(?:${pattern})$`, 'iu', 'is not a valid regular expression');
    } else {
      compile(pattern, 'gi', 'is not a valid regular expression');
      // The aggressive pass rewrites letters in the source, which can break an
      // otherwise valid pattern: (?<word>…) turns into (?<w[o0]rd>…).
      compile(
        toAggressivePattern(pattern),
        'gi',
        'becomes invalid once aggressive matching expands the letters in it',
      );
    }
  });
}

/**
 * Adds a language, or replaces one that is already registered.
 *
 * ```ts
 * registerLanguage('fr', {
 *   profanity: ['merde', 'connard', 'salope', 'putain'],
 *   allow: ['\\p{L}*connaiss\\p{L}*'],
 * });
 *
 * // A regional variant inherits instead of duplicating:
 * registerLanguage('de-AT', { extends: 'de', profanity: ['oasch', 'gschissana'] });
 * ```
 *
 * @throws TypeError if the code or a pattern has the wrong shape.
 * @throws SyntaxError if a pattern is not a valid regular expression.
 * @throws RangeError if `extends` names an unregistered language or forms a cycle.
 */
export function registerLanguage(code: Language, definition: LanguageDefinition): void {
  const key = normalize(code);
  if (key === '') {
    throw new TypeError('registerLanguage(): the language code must be a non-empty string.');
  }
  if (definition === null || typeof definition !== 'object') {
    throw new TypeError(`registerLanguage('${key}'): the definition must be an object.`);
  }

  let parent: string | undefined;
  if (definition.extends !== undefined) {
    parent = normalize(definition.extends);
    if (!registry.has(parent)) {
      throw new RangeError(
        `registerLanguage('${key}'): extends '${parent}', which is not registered. ` +
          `Register it first. Known: ${listLanguages().join(', ') || '(none)'}.`,
      );
    }
    // The parent must already exist, but re-registering can still close a loop.
    for (let at: string | undefined = parent; at !== undefined; at = registry.get(at)?.parent) {
      if (at === key) {
        throw new RangeError(
          `registerLanguage('${key}'): extending '${parent}' would create a cycle.`,
        );
      }
    }
  }

  const profanity = definition.profanity ?? [];
  const allow = definition.allow ?? [];
  assertPatterns(key, 'profanity', profanity);
  assertPatterns(key, 'allow', allow);

  // Copied and frozen: a caller mutating their array later must not silently
  // change matching behaviour (or stale the filter's regex cache key).
  registry.set(key, {
    profanity: Object.freeze([...profanity]),
    allow: Object.freeze([...allow]),
    parent,
  });
}

/**
 * Removes a language.
 *
 * @returns `false` if it was not registered to begin with.
 * @throws RangeError if another registered language extends it.
 */
export function unregisterLanguage(code: Language): boolean {
  const key = normalize(code);
  const dependents = [...registry.entries()]
    .filter(([, entry]) => entry.parent === key)
    .map(([child]) => child);

  if (dependents.length > 0) {
    throw new RangeError(
      `unregisterLanguage('${key}'): still extended by ${dependents.join(', ')}. ` +
        'Remove those first.',
    );
  }
  return registry.delete(key);
}

/** Every registered code, in registration order. */
export function listLanguages(): Language[] {
  return [...registry.keys()];
}

/** True if the code resolves to a registered language, subtag fallback included. */
export function hasLanguage(code: Language): boolean {
  return resolveKey(code) !== undefined;
}

/**
 * Resolves a code to a registered one by dropping BCP-47 subtags from the
 * right: `de-AT-1996` tries `de-at-1996`, then `de-at`, then `de`.
 */
export function resolveKey(code: Language): string | undefined {
  let key = normalize(code);
  while (key !== '') {
    if (registry.has(key)) return key;
    const cut = key.lastIndexOf('-');
    if (cut === -1) return undefined;
    key = key.slice(0, cut);
  }
  return undefined;
}

/**
 * The lists a code resolves to, with any `extends` chain flattened in and
 * subtag fallback applied. `undefined` if nothing matches.
 */
export function getLanguage(code: Language): LanguageLists | undefined {
  const key = resolveKey(code);
  return key === undefined ? undefined : flatten(key);
}

function flatten(key: string): LanguageLists {
  const entry = registry.get(key);
  /* c8 ignore next */
  if (!entry) return { profanity: [], allow: [] };
  if (entry.parent === undefined) {
    return { profanity: entry.profanity, allow: entry.allow };
  }
  const base = flatten(entry.parent);
  return {
    profanity: [...base.profanity, ...entry.profanity],
    allow: [...base.allow, ...entry.allow],
  };
}

/** Drops every registration and restores the built-in `en` and `de`. */
export function resetLanguages(): void {
  registry.clear();
  seed();
}

function seed(): void {
  // Straight in: the built-ins are covered by the test suite, so re-validating
  // ~270 patterns on every process start would be pure startup cost.
  registry.set('en', { profanity: en.profanity ?? [], allow: en.allow ?? [] });
  registry.set('de', { profanity: de.profanity ?? [], allow: de.allow ?? [] });
}

seed();

export { de, en };
