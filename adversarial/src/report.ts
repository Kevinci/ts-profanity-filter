import type { RunReport } from './types.js';

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

/** Characters that would otherwise leave no trace in a terminal. */
function visible(text: string): string {
  return [...text]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      if (/[\p{Cf}\p{Zs}]/u.test(ch) && ch !== ' ') return `<U+${cp.toString(16).toUpperCase()}>`;
      if (/\p{M}/u.test(ch)) return `◌${ch}`;
      return ch;
    })
    .join('');
}

const BAR_WIDTH = 24;
function bar(value: number): string {
  const filled = Math.round(value * BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

export interface FormatOptions {
  /** Also list the attacks that passed. Off by default — failures are the news. */
  verbose?: boolean;
  color?: boolean;
}

export function formatReport(report: RunReport, options: FormatOptions = {}): string {
  const color = options.color ?? false;
  const dim = (s: string) => (color ? `[2m${s}[0m` : s);
  const red = (s: string) => (color ? `[31m${s}[0m` : s);
  const green = (s: string) => (color ? `[32m${s}[0m` : s);

  const lines: string[] = [];
  const { score } = report;

  lines.push('');
  lines.push(`  ${report.filter}   ${dim(`${report.languages.join(', ')} · ${report.results.length} attacks`)}`);
  lines.push('');
  lines.push(
    `  evasion resistance  ${bar(score.evasionResistance)}  ${pct(score.evasionResistance)}` +
      dim(`   ${score.flagPassed}/${score.flagTotal} disguises caught`),
  );
  lines.push(
    `  precision           ${bar(score.precision)}  ${pct(score.precision)}` +
      dim(`   ${score.cleanPassed}/${score.cleanTotal} innocent texts left alone`),
  );
  lines.push('');
  lines.push(dim('  Both numbers or neither: `detect = () => true` scores 100% on the first.'));
  lines.push('');

  // Per category, so the report says what leaks rather than only how much.
  const width = Math.max(...Object.keys(report.byCategory).map((c) => c.length));
  for (const [category, { total, passed }] of Object.entries(report.byCategory)) {
    const mark = passed === total ? green('ok') : red('!!');
    lines.push(`  ${mark}  ${category.padEnd(width)}  ${passed}/${total}`);
  }

  const failures = report.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push('');
    lines.push(`  ${failures.length} failing:`);
    for (const failure of failures) {
      const kind = failure.attack.expect === 'flag' ? red('evaded ') : red('flagged');
      lines.push(`    ${kind} ${failure.attack.id}`);
      lines.push(`            ${visible(failure.attack.text)}`);
      lines.push(dim(`            ${failure.attack.note}`));
      if (failure.error) lines.push(red(`            threw: ${failure.error}`));
    }
  }

  if (options.verbose) {
    const passed = report.results.filter((r) => r.passed);
    lines.push('');
    lines.push(`  ${passed.length} passing:`);
    for (const p of passed) lines.push(dim(`    ${p.attack.id.padEnd(26)} ${visible(p.attack.text)}`));
  }

  lines.push('');
  return lines.join('\n');
}

/** One line per filter, for comparing several. */
export function formatComparison(reports: readonly RunReport[]): string {
  const width = Math.max(...reports.map((r) => r.filter.length), 6);
  const lines = [
    '',
    `  ${'filter'.padEnd(width)}   evasion   precision`,
    `  ${'-'.repeat(width)}   -------   ---------`,
  ];
  for (const r of reports) {
    lines.push(
      `  ${r.filter.padEnd(width)}   ${pct(r.score.evasionResistance).padStart(7)}   ${pct(r.score.precision).padStart(9)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
