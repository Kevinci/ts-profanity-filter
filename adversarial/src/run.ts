import { CORPUS } from './corpus.js';
import type { Attack, AttackResult, FilterAdapter, Language, RunReport, Score } from './types.js';

export interface RunOptions {
  /** Only attacks written for these languages. Defaults to all of them. */
  languages?: readonly Language[];
  /** Only these categories. Defaults to all of them. */
  categories?: readonly string[];
  /** Replace the built-in corpus entirely. */
  corpus?: readonly Attack[];
}

export function selectAttacks(options: RunOptions = {}): readonly Attack[] {
  const corpus = options.corpus ?? CORPUS;
  return corpus.filter((attack) => {
    if (options.languages && !attack.languages.some((l) => options.languages!.includes(l))) {
      return false;
    }
    if (options.categories && !options.categories.includes(attack.category)) return false;
    return true;
  });
}

function score(results: readonly AttackResult[]): Score {
  const flag = results.filter((r) => r.attack.expect === 'flag');
  const clean = results.filter((r) => r.attack.expect === 'clean');
  const rate = (passed: number, total: number) => (total === 0 ? 1 : passed / total);

  return {
    flagTotal: flag.length,
    flagPassed: flag.filter((r) => r.passed).length,
    cleanTotal: clean.length,
    cleanPassed: clean.filter((r) => r.passed).length,
    evasionResistance: rate(flag.filter((r) => r.passed).length, flag.length),
    precision: rate(clean.filter((r) => r.passed).length, clean.length),
  };
}

/**
 * Runs the corpus against one filter.
 *
 * A filter that throws is recorded as a failure rather than aborting the run —
 * crashing on hostile input is itself a result worth reporting, and one filter
 * blowing up should not cost you the other twenty numbers.
 */
export async function run(adapter: FilterAdapter, options: RunOptions = {}): Promise<RunReport> {
  const attacks = selectAttacks(options);
  const results: AttackResult[] = [];

  for (const attack of attacks) {
    try {
      const detected = await adapter.detect(attack.text);
      results.push({
        attack,
        detected,
        passed: attack.expect === 'flag' ? detected === true : detected === false,
      });
    } catch (error) {
      results.push({
        attack,
        detected: null,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const byCategory: Record<string, { total: number; passed: number }> = {};
  for (const result of results) {
    const bucket = (byCategory[result.attack.category] ??= { total: 0, passed: 0 });
    bucket.total++;
    if (result.passed) bucket.passed++;
  }

  return {
    filter: adapter.name,
    languages: options.languages ?? ['en', 'de'],
    results,
    score: score(results),
    byCategory,
  };
}
