// src/batch/report.ts — the run, written down.
//
// Two formats, and only one of them can cost you an install. `formatSummary`
// is a string built from numbers and ships with the library. `renderSummaryPdf`
// reaches for `fast-pdf` through a dynamic import, so it is present only in the
// code path that asks for a PDF: `dependencies` stays empty, and nobody who
// never calls this function installs anything.

import type { PiiKind } from '../pii/types.js';
import type { BatchSummary } from './types.js';

/** Percentage with one decimal, and no `NaN%` when nothing was processed. */
function share(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}

function throughput(summary: BatchSummary): string {
  if (summary.elapsedMs <= 0) return '—';
  return `${Math.round((summary.processed / summary.elapsedMs) * 1000).toLocaleString('en-US')}/s`;
}

/** The rows both formats share, so the PDF can never disagree with the text. */
export function summaryRows(summary: BatchSummary): [string, string][] {
  const rows: [string, string][] = [
    ['Records processed', summary.processed.toLocaleString('en-US')],
    [
      'Flagged',
      `${summary.flagged.toLocaleString('en-US')} (${share(summary.flagged, summary.processed)})`,
    ],
    ['Matched a word list', summary.matchedList.toLocaleString('en-US')],
  ];

  if (summary.piiFindings > 0 || summary.piiRecords > 0) {
    rows.push([
      'Records with personal data',
      `${summary.piiRecords.toLocaleString('en-US')} (${summary.piiFindings.toLocaleString('en-US')} findings)`,
    ]);
  }

  if (summary.aiCalls > 0) {
    rows.push(['Model calls', summary.aiCalls.toLocaleString('en-US')]);
    rows.push(['Flagged by the model', summary.aiFlagged.toLocaleString('en-US')]);
    if (summary.aiErrors > 0) rows.push(['Model calls that failed', String(summary.aiErrors)]);
  }

  if (summary.errors > 0) rows.push(['Records with a stage error', String(summary.errors)]);

  rows.push(['Duration', `${duration(summary.elapsedMs)} · ${throughput(summary)}`]);

  // Both of these change how the numbers above must be read, so they are never
  // omitted when true — a truncated run that looks complete is the worst report.
  if (summary.aiBudgetExhausted)
    rows.push(['Model budget', 'exhausted — later records went unasked']);
  if (summary.aborted) rows.push(['Ended', 'aborted before the input was finished']);

  return rows;
}

function kindRows(summary: BatchSummary): [string, string][] {
  return (Object.entries(summary.piiByKind) as [PiiKind, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => [kind, count.toLocaleString('en-US')]);
}

/** A fixed-width report for a terminal or a log. No dependency, no options. */
export function formatSummary(summary: BatchSummary): string {
  const rows = summaryRows(summary);
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`);

  const kinds = kindRows(summary);
  if (kinds.length > 0) {
    const kindWidth = Math.max(...kinds.map(([kind]) => kind.length));
    lines.push('', '  Personal data by kind');
    for (const [kind, count] of kinds) {
      lines.push(`    ${kind.padEnd(kindWidth)}  ${count}`);
    }
  }

  if (summary.samples.length > 0) {
    lines.push(
      '',
      `  Examples (${summary.samples.length} of ${summary.flagged.toLocaleString('en-US')})`,
    );
    for (const sample of summary.samples) {
      const reasons = [
        sample.matchedList ? 'word list' : '',
        sample.pii.length > 0 ? sample.pii.map((finding) => finding.kind).join('/') : '',
        sample.ai?.flagged === true ? `model:${sample.ai.severity}` : '',
      ].filter(Boolean);
      const label = sample.id !== undefined ? `#${sample.id}` : `row ${sample.index}`;
      lines.push(`    ${label}  [${reasons.join(', ')}]  ${excerpt(sample.text)}`);
    }
  }

  return lines.join('\n');
}

function excerpt(text: string, limit = 72): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= limit ? single : `${single.slice(0, limit - 1)}…`;
}

export interface PdfReportOptions {
  /** Shown as the document title and the first heading. */
  title?: string;
  /** A line under the title — the input file, the job id, whatever locates this run. */
  subtitle?: string;
  /** Include the flagged examples the summary kept. Default true. */
  samples?: boolean;
  /**
   * Byte-identical output for identical input: no wall-clock timestamp is
   * embedded. Default false, so a report says when it was made.
   */
  deterministic?: boolean;
}

/**
 * Render the summary as a PDF.
 *
 * Requires `fast-pdf`, which is an **optional** peer dependency — it is loaded
 * here and nowhere else, so the library keeps `dependencies: {}` and an install
 * that never renders a PDF pulls nothing extra.
 */
export async function renderSummaryPdf(
  summary: BatchSummary,
  options: PdfReportOptions = {},
): Promise<Uint8Array> {
  let PDFDocument: typeof import('fast-pdf').PDFDocument;
  try {
    ({ PDFDocument } = await import('fast-pdf'));
  } catch {
    throw new Error(
      'renderSummaryPdf needs the optional peer dependency `fast-pdf`. ' +
        'Install it with: npm install fast-pdf',
    );
  }

  const title = options.title ?? 'Moderation batch report';
  const doc = new PDFDocument({
    fontSize: 10.5,
    metadata: { title, creator: 'ts-profanity-filter' },
    ...(options.deterministic === true ? { deterministic: true } : {}),
  });

  doc.text(title, { size: 20, bold: true, spacingAfter: 4 });
  if (options.subtitle !== undefined) {
    doc.text(options.subtitle, { size: 10.5, color: '#666666', spacingAfter: 14 });
  }

  doc.text('Summary', { size: 13, bold: true, spacingBefore: 8, spacingAfter: 6 });
  doc.table([['Measure', 'Value'], ...summaryRows(summary)], {
    header: true,
    // Widths are points, not fractions — and anything wider than the content
    // area is scaled down proportionally. Oversized numbers in the ratio I want
    // therefore behave like percentages without hard-coding the page geometry.
    widths: [550, 450],
    fontSize: 10,
  });

  const kinds = kindRows(summary);
  if (kinds.length > 0) {
    doc.text('Personal data by kind', { size: 13, bold: true, spacingBefore: 16, spacingAfter: 6 });
    doc.table([['Kind', 'Findings'], ...kinds], {
      header: true,
      widths: [550, 450],
      fontSize: 10,
    });
  }

  if (options.samples !== false && summary.samples.length > 0) {
    doc.text('Examples', { size: 13, bold: true, spacingBefore: 16, spacingAfter: 2 });
    doc.text(
      `${summary.samples.length} of ${summary.flagged.toLocaleString('en-US')} flagged records. ` +
        'Excerpts are verbatim, so this page carries the original wording.',
      { size: 9.5, color: '#666666', spacingAfter: 6 },
    );
    doc.table(
      [
        ['Record', 'Why', 'Excerpt'],
        ...summary.samples.map((sample) => [
          sample.id !== undefined ? `#${sample.id}` : `row ${sample.index}`,
          [
            sample.matchedList ? 'word list' : '',
            sample.pii.map((finding) => finding.kind).join('/'),
            sample.ai?.flagged === true ? `model:${sample.ai.severity}` : '',
          ]
            .filter(Boolean)
            .join(', '),
          excerpt(sample.text, 90),
        ]),
      ],
      { header: true, widths: [140, 260, 600], fontSize: 9 },
    );
  }

  doc.pageNumbers();
  return doc.render();
}
