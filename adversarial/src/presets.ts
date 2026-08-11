// The one adapter that ships ready-made: the filter in this repository.
//
// There are deliberately no adapters for other people's filters. Naming a
// competitor in a benchmark you wrote yourself turns a measurement into a
// claim about somebody else, and this tool is meant to be pointed at whatever
// you are responsible for. Writing one is three lines — see the README.

import type { FilterAdapter } from './types.js';

export const PRESET_NAMES = ['ts-profanity-filter'] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

/** Its own version, since results move between releases. */
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
  if (name !== 'ts-profanity-filter') {
    throw new Error(
      `Unknown preset '${name}'. The only built-in one is 'ts-profanity-filter'. ` +
        'For any other filter, write a three-line adapter file — see the README.',
    );
  }

  let mod: any;
  try {
    mod = await import('ts-profanity-filter');
  } catch {
    throw new Error(
      'ts-profanity-filter is not installed here. Try: npm install ts-profanity-filter',
    );
  }

  return {
    name: `ts-profanity-filter${await versionOf('ts-profanity-filter')}`,
    detect: (text) =>
      mod
        .filterFWordsToSegments(text, { languages: ['en', 'de'] })
        .some((segment: { isProfane: boolean }) => segment.isProfane),
  };
}
