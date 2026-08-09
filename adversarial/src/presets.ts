// Ready-made adapters for filters people actually use.
//
// None of them is a dependency: each is imported at the moment it is asked for,
// and a missing one turns into "npm install x", not a crash. That keeps this
// package installable without dragging in every filter it can measure.

import type { FilterAdapter } from './types.js';

export const PRESET_NAMES = [
  'ts-profanity-filter',
  'obscenity',
  'bad-words',
  'leo-profanity',
  '@2toad/profanity',
] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

async function load(specifier: string): Promise<any> {
  try {
    return await import(specifier);
  } catch {
    throw new Error(`${specifier} is not installed here. Try: npm install ${specifier}`);
  }
}

/** Its own version, when the package exposes one — results move between releases. */
async function versionOf(name: string): Promise<string> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    return `@${require(`${name}/package.json`).version}`;
  } catch {
    return '';
  }
}

export async function preset(name: string): Promise<FilterAdapter> {
  switch (name) {
    case 'ts-profanity-filter': {
      const mod = await load('ts-profanity-filter');
      return {
        name: `ts-profanity-filter${await versionOf('ts-profanity-filter')}`,
        detect: (text) =>
          mod
            .filterFWordsToSegments(text, { languages: ['en', 'de'] })
            .some((segment: { isProfane: boolean }) => segment.isProfane),
      };
    }

    case 'obscenity': {
      const mod = await load('obscenity');
      const matcher = new mod.RegExpMatcher({
        ...mod.englishDataset.build(),
        ...mod.englishRecommendedTransformers,
      });
      return {
        name: `obscenity${await versionOf('obscenity')}`,
        detect: (text) => matcher.hasMatch(text),
      };
    }

    case 'bad-words': {
      const mod = await load('bad-words');
      // v3 default-exports the class, v4 names it.
      const Filter = mod.Filter ?? mod.default;
      const filter = new Filter();
      return {
        name: `bad-words${await versionOf('bad-words')}`,
        detect: (text) => filter.isProfane(text),
      };
    }

    case 'leo-profanity': {
      const mod = await load('leo-profanity');
      const leo = mod.default ?? mod;
      return {
        name: `leo-profanity${await versionOf('leo-profanity')}`,
        detect: (text) => leo.check(text),
      };
    }

    case '@2toad/profanity': {
      const mod = await load('@2toad/profanity');
      return {
        name: `@2toad/profanity${await versionOf('@2toad/profanity')}`,
        detect: (text) => mod.profanity.exists(text),
      };
    }

    default:
      throw new Error(
        `Unknown preset '${name}'. Known: ${PRESET_NAMES.join(', ')}. ` +
          'For anything else, write a two-line adapter file — see the README.',
      );
  }
}
