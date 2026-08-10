#!/usr/bin/env node
// src/cli.ts — the batch runner from a terminal.
//
//   ts-profanity-filter scan comments.ndjson --pii --out flagged.ndjson
//
// Progress goes to stderr and results to the file, so the command composes: the
// summary on stdout can be piped, redirected or read by a human, and none of it
// is interleaved with the findings.

import { writeFile } from 'node:fs/promises';

import { runBatch, type BatchOptions, type BatchResult } from './batch/index.js';
import { createNdjsonWriter, recordsFrom } from './batch/node.js';
import { formatSummary, renderSummaryPdf } from './batch/report.js';
import type { AiProvider } from './ai/types.js';
import type { PiiKind } from './pii/types.js';

/**
 * A model call per record costs money, and a CLI pointed at a large file is the
 * easiest way to spend a lot of it by accident. So the ceiling is on by default
 * and printed at the start rather than left to the reader's memory.
 */
const DEFAULT_MAX_CALLS = 100;

const HELP = `ts-profanity-filter scan <file> [options]

  Analyses one record per line. .ndjson/.jsonl read a JSON object per line,
  .csv/.tsv one column, anything else one text per line.

Input
  --text-field <name>     NDJSON property holding the text        (default: text)
  --id-field <name>       NDJSON property holding the id          (default: id)
  --column <name|index>   CSV column holding the text             (default: 0)
  --id-column <name|idx>  CSV column holding the id
  --no-header             CSV has no header row

Analysis
  --languages <a,b>       Word lists to match against             (default: en)
  --no-filter             Skip the word lists
  --pii                   Also detect personal data
  --kinds <a,b>           Limit PII kinds (email,phone,iban,card,ip,taxid-de)
  --min-confidence <n>    PII threshold                           (default: 0.6)

Model (off unless --ai is given)
  --ai <provider>         anthropic | gemini | ollama
  --ai-model <id>         Model id
  --ai-when <gate>        matched | unmatched | all               (default: matched)
  --max-calls <n>         Hard ceiling on model calls             (default: ${DEFAULT_MAX_CALLS})

Output
  --out <file>            Write flagged records as NDJSON
  --all                   With --out, write every record, not only flagged ones
  --pdf <file>            Render the summary as a PDF (needs fast-pdf)
  --json                  Print the summary as JSON instead of text
  --quiet                 No progress on stderr
  --fail-on-findings      Exit 1 when anything was flagged (for CI)

Other
  --concurrency <n>       In-flight records when a model is used  (default: 8)
  --unordered             Emit results as they finish, not in input order
  -h, --help              This text
`;

interface Flags {
  values: Map<string, string>;
  present: Set<string>;
  positional: string[];
}

function parseArgs(argv: readonly string[]): Flags {
  const values = new Map<string, string>();
  const present = new Set<string>();
  const positional: string[] = [];

  const TAKES_VALUE = new Set([
    'text-field', 'id-field', 'column', 'id-column', 'languages', 'kinds',
    'min-confidence', 'ai', 'ai-model', 'ai-when', 'max-calls', 'out', 'pdf',
    'concurrency',
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    const name = arg.replace(/^--?/, '');
    present.add(name);
    if (TAKES_VALUE.has(name)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--${name} needs a value`);
      }
      values.set(name, next);
      i++;
    }
  }

  return { values, present, positional };
}

function number(flags: Flags, name: string, fallback: number): number {
  const raw = flags.values.get(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number, got ${raw}`);
  return parsed;
}

function list(flags: Flags, name: string): string[] | undefined {
  const raw = flags.values.get(name);
  if (raw === undefined) return undefined;
  return raw.split(',').map((part) => part.trim()).filter((part) => part !== '');
}

/** A column reference is a name unless it is entirely digits. */
function column(raw: string | undefined): string | number | undefined {
  if (raw === undefined) return undefined;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

function buildOptions(flags: Flags): BatchOptions {
  const options: BatchOptions = {
    concurrency: number(flags, 'concurrency', 8),
    ordered: !flags.present.has('unordered'),
  };

  if (flags.present.has('no-filter')) {
    options.filter = false;
  } else {
    const languages = list(flags, 'languages') ?? ['en'];
    options.filter = { languages };
  }

  if (flags.present.has('pii')) {
    const kinds = list(flags, 'kinds') as PiiKind[] | undefined;
    options.pii = {
      minConfidence: number(flags, 'min-confidence', 0.6),
      ...(kinds !== undefined ? { kinds } : {}),
    };
  }

  if (flags.present.has('ai')) {
    const gate = flags.values.get('ai-when') ?? 'matched';
    if (gate !== 'matched' && gate !== 'unmatched' && gate !== 'all') {
      throw new Error(`--ai-when must be matched, unmatched or all, got ${gate}`);
    }
    const model = flags.values.get('ai-model');
    options.ai = {
      provider: flags.values.get('ai') as AiProvider,
      when: gate,
      maxCalls: number(flags, 'max-calls', DEFAULT_MAX_CALLS),
      ...(model !== undefined ? { model } : {}),
    };
  }

  return options;
}

function progressLine(processed: number, flagged: number, perSecond: number): string {
  return `  ${processed.toLocaleString('en-US')} records · ${flagged.toLocaleString('en-US')} flagged · ${Math.round(perSecond).toLocaleString('en-US')}/s`;
}

async function main(argv: readonly string[]): Promise<number> {
  const flags = parseArgs(argv);

  if (flags.present.has('help') || flags.present.has('h') || flags.positional.length === 0) {
    process.stdout.write(HELP);
    return flags.positional.length === 0 && !flags.present.has('help') && !flags.present.has('h')
      ? 1
      : 0;
  }

  const [command, file] = flags.positional;
  if (command !== 'scan') {
    process.stderr.write(`Unknown command ${JSON.stringify(command)}. Try: scan\n`);
    return 1;
  }
  if (file === undefined) {
    process.stderr.write('scan needs a file.\n');
    return 1;
  }

  const options = buildOptions(flags);
  const quiet = flags.present.has('quiet');

  // Counted so that "0 records" can explain itself instead of looking like a
  // clean file. A wrong --text-field skips every line, and silence there is the
  // one failure mode a scanner must never have.
  const skipped = { json: 0, 'not-object': 0, 'no-text': 0 };

  const source = recordsFrom(file, {
    onColumn: ({ name, index, detected }) => {
      if (quiet) return;
      const label = name !== undefined ? `${name} (index ${index})` : `index ${index}`;
      process.stderr.write(
        detected
          ? `  column: ${label} — guessed; pass --column to choose another\n`
          : `  column: ${label}\n`,
      );
    },
    onSkip: (_line, reason) => {
      skipped[reason]++;
    },
    ...(flags.values.get('text-field') !== undefined
      ? { textField: flags.values.get('text-field') as string }
      : {}),
    ...(flags.values.get('id-field') !== undefined
      ? { idField: flags.values.get('id-field') as string }
      : {}),
    ...(column(flags.values.get('column')) !== undefined
      ? { column: column(flags.values.get('column')) }
      : {}),
    ...(column(flags.values.get('id-column')) !== undefined
      ? { idColumn: column(flags.values.get('id-column')) }
      : {}),
    ...(flags.present.has('no-header') ? { header: false } : {}),
  });

  if (!quiet) {
    process.stderr.write(`Scanning ${file}\n`);
    if (options.ai) {
      process.stderr.write(
        `  model: ${options.ai.provider ?? 'anthropic'}, gate ${String(options.ai.when)}, ` +
          `at most ${options.ai.maxCalls} calls\n`,
      );
    }
  }

  const outPath = flags.values.get('out');
  const writer = outPath !== undefined ? createNdjsonWriter(outPath) : undefined;
  const writeAll = flags.present.has('all');

  // Ctrl-C stops pulling records and still prints the summary for what ran —
  // a long scan that reports nothing when interrupted has wasted its work.
  const controller = new AbortController();
  const onSigint = (): void => {
    if (!quiet) process.stderr.write('\n  interrupted — finishing the records in flight\n');
    controller.abort();
  };
  process.on('SIGINT', onSigint);

  let lastLine = 0;

  try {
    const summary = await runBatch(source, {
      ...options,
      signal: controller.signal,
      onProgress: quiet
        ? undefined
        : ({ processed, flagged, perSecond }) => {
            lastLine = processed;
            process.stderr.write(`\r${progressLine(processed, flagged, perSecond)}`);
          },
      onResult: writer
        ? async (result: BatchResult) => {
            if (!writeAll && !result.flagged) return;
            await writer.write({
              index: result.index,
              ...(result.id !== undefined ? { id: result.id } : {}),
              flagged: result.flagged,
              matchedList: result.matchedList,
              ...(result.pii.length > 0
                ? { pii: result.pii.map((f) => ({ kind: f.kind, start: f.start, end: f.end })) }
                : {}),
              ...(result.ai !== undefined
                ? { ai: { status: result.ai.status, flagged: result.ai.flagged, severity: result.ai.severity } }
                : {}),
              ...(result.error !== undefined ? { error: result.error } : {}),
            });
          }
        : undefined,
    });

    await writer?.close();
    if (!quiet && lastLine > 0) process.stderr.write('\n');

    if (flags.present.has('json')) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      process.stdout.write(`\n${formatSummary(summary)}\n`);
    }

    // A skipped line is fine in ones and twos and suspicious in bulk, so say so
    // either way rather than only when nothing at all came through.
    const totalSkipped = skipped.json + skipped['not-object'] + skipped['no-text'];
    if (totalSkipped > 0 && !quiet) {
      const parts = [
        skipped['no-text'] > 0
          ? `${skipped['no-text']} without a usable text field (--text-field)`
          : '',
        skipped.json > 0 ? `${skipped.json} not valid JSON` : '',
        skipped['not-object'] > 0 ? `${skipped['not-object']} not a JSON object` : '',
      ].filter(Boolean);
      process.stderr.write(`\n  Skipped ${totalSkipped} lines: ${parts.join(', ')}\n`);
    }

    if (summary.processed === 0 && !quiet) {
      process.stderr.write(
        '  Nothing was analysed. Check --text-field for NDJSON or --column for CSV.\n',
      );
    }

    const pdfPath = flags.values.get('pdf');
    if (pdfPath !== undefined) {
      const bytes = await renderSummaryPdf(summary, {
        title: 'Moderation batch report',
        subtitle: `${file} · ${summary.processed.toLocaleString('en-US')} records`,
      });
      await writeFile(pdfPath, bytes);
      if (!quiet) process.stderr.write(`  PDF written to ${pdfPath}\n`);
    }

    if (flags.present.has('fail-on-findings') && summary.flagged > 0) return 1;
    return 0;
  } finally {
    process.off('SIGINT', onSigint);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
