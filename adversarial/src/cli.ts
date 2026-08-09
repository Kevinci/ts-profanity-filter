#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { CATEGORIES, CORPUS } from './corpus.js';
import { formatComparison, formatReport } from './report.js';
import { preset, PRESET_NAMES } from './presets.js';
import { run } from './run.js';
import type { FilterAdapter, Language, RunReport } from './types.js';

const USAGE = `
  profanity-adversarial — measure a profanity filter against deliberate evasion

  Usage
    npx profanity-adversarial <adapter.mjs> [options]
    npx profanity-adversarial --preset <name> [--preset <name> ...]
    npx profanity-adversarial --list

  An adapter is a module with a default export:

    export default {
      name: 'my-filter',
      detect: (text) => myFilter.isProfane(text),
    };

  Options
    --preset <name>     use a built-in adapter (repeatable, for comparison)
    --lang <en,de>      only attacks written for these languages
    --category <a,b>    only these categories
    --json              machine-readable output
    --verbose           also list the attacks that passed
    --min-evasion <n>   exit non-zero below this percentage
    --min-precision <n> exit non-zero below this percentage
    --list              print the corpus and exit
    --help

  Presets: ${PRESET_NAMES.join(', ')}
`;

interface Args {
  adapters: string[];
  presets: string[];
  languages?: Language[];
  categories?: string[];
  json: boolean;
  verbose: boolean;
  minEvasion?: number;
  minPrecision?: number;
  list: boolean;
  help: boolean;
}

function parse(argv: readonly string[]): Args {
  const args: Args = {
    adapters: [], presets: [], json: false, verbose: false, list: false, help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      return value;
    };

    switch (arg) {
      case '--preset': args.presets.push(next()); break;
      case '--lang': args.languages = next().split(',').map((l) => l.trim()) as Language[]; break;
      case '--category': args.categories = next().split(',').map((c) => c.trim()); break;
      case '--json': args.json = true; break;
      case '--verbose': case '-v': args.verbose = true; break;
      case '--min-evasion': args.minEvasion = Number(next()); break;
      case '--min-precision': args.minPrecision = Number(next()); break;
      case '--list': args.list = true; break;
      case '--help': case '-h': args.help = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}.`);
        args.adapters.push(arg);
    }
  }
  return args;
}

async function loadAdapter(path: string): Promise<FilterAdapter> {
  const url = pathToFileURL(resolve(process.cwd(), path)).href;
  const mod = await import(url);
  const adapter = mod.default ?? mod.adapter;

  if (!adapter || typeof adapter.detect !== 'function') {
    throw new Error(
      `${path} must default-export { name, detect(text) }. See --help.`,
    );
  }
  return { name: adapter.name ?? path, detect: adapter.detect };
}

function listCorpus(): void {
  const width = Math.max(...CORPUS.map((a) => a.id.length));
  for (const category of CATEGORIES) {
    console.log(`\n${category}`);
    for (const attack of CORPUS.filter((a) => a.category === category)) {
      const expect = attack.expect === 'flag' ? 'must flag ' : 'must pass ';
      console.log(`  ${attack.id.padEnd(width)}  ${expect}  ${attack.note}`);
    }
  }
  console.log(`\n${CORPUS.length} attacks · ${CATEGORIES.length} categories`);
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));

  if (args.help || (args.adapters.length === 0 && args.presets.length === 0 && !args.list)) {
    console.log(USAGE);
    return;
  }
  if (args.list) {
    listCorpus();
    return;
  }

  const adapters: FilterAdapter[] = [];
  for (const name of args.presets) adapters.push(await preset(name));
  for (const path of args.adapters) adapters.push(await loadAdapter(path));

  const options = {
    ...(args.languages ? { languages: args.languages } : {}),
    ...(args.categories ? { categories: args.categories } : {}),
  };

  const reports: RunReport[] = [];
  for (const adapter of adapters) reports.push(await run(adapter, options));

  if (args.json) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  } else {
    for (const report of reports) {
      console.log(formatReport(report, { verbose: args.verbose, color: process.stdout.isTTY }));
    }
    if (reports.length > 1) console.log(formatComparison(reports));
  }

  // A gate, only when asked for. Every filter fails something here, so failing
  // the build by default would make the tool useless in CI.
  const below = reports.filter(
    (r) =>
      (args.minEvasion !== undefined && r.score.evasionResistance * 100 < args.minEvasion) ||
      (args.minPrecision !== undefined && r.score.precision * 100 < args.minPrecision),
  );
  if (below.length > 0) {
    console.error(`Below threshold: ${below.map((r) => r.filter).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
