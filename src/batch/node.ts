// src/batch/node.ts — import from 'ts-profanity-filter/batch/node'
//
// The file half of batch processing, kept in its own subpath so that importing
// the runner itself never drags a Node API into a browser bundle.
//
// Everything here is a generator over a read stream: a 2 GB NDJSON file is read
// a chunk at a time and the runner consumes records as they arrive, so peak
// memory is a buffer and one record — not the corpus.

import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';

import type { BatchRecord } from './types.js';

/** Lines of a text file, without their terminators and without the trailing empty one. */
export async function* linesFrom(
  path: string,
  encoding: BufferEncoding = 'utf8',
): AsyncGenerator<string> {
  const stream = createReadStream(path, { encoding });
  let carry = '';

  for await (const chunk of stream) {
    const text = carry + (chunk as string);
    const parts = text.split('\n');
    // The last piece may be half a line: hold it until the next chunk.
    carry = parts.pop() ?? '';
    for (const line of parts) {
      yield line.endsWith('\r') ? line.slice(0, -1) : line;
    }
  }

  if (carry !== '') yield carry.endsWith('\r') ? carry.slice(0, -1) : carry;
}

export interface NdjsonOptions {
  /** Which property holds the text. Default `'text'`. */
  textField?: string;
  /** Which property is the record id. Default `'id'`, if present. */
  idField?: string;
  /**
   * What to do with a line that is not JSON, or has no text field.
   * `skip` (default) ignores it, `throw` stops the run at that line.
   */
  onBadLine?: 'skip' | 'throw';
}

/** One JSON object per line — the format every log pipeline already speaks. */
export async function* ndjsonFrom(
  path: string,
  options: NdjsonOptions = {},
): AsyncGenerator<BatchRecord> {
  const textField = options.textField ?? 'text';
  const idField = options.idField ?? 'id';
  const strict = options.onBadLine === 'throw';
  let lineNumber = 0;

  for await (const line of linesFrom(path)) {
    lineNumber++;
    if (line.trim() === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      if (strict) {
        throw new Error(`${path}:${lineNumber} is not valid JSON: ${(cause as Error).message}`);
      }
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      if (strict) throw new Error(`${path}:${lineNumber} is not a JSON object`);
      continue;
    }

    const row = parsed as Record<string, unknown>;
    const text = row[textField];
    if (typeof text !== 'string') {
      if (strict) throw new Error(`${path}:${lineNumber} has no string field ${textField}`);
      continue;
    }

    const id = row[idField];
    const record: BatchRecord = { text };
    if (typeof id === 'string' || typeof id === 'number') record.id = id;
    yield record;
  }
}

export interface CsvOptions {
  /** Column holding the text: a header name, or a zero-based index. Default 0. */
  column?: string | number;
  /** Column holding the id, if any. */
  idColumn?: string | number;
  /** Field separator. Default `','`. */
  delimiter?: string;
  /** Treat the first row as names. Default true. Required for named columns. */
  header?: boolean;
}

/**
 * Rows of a CSV file, parsed properly.
 *
 * A character-level state machine rather than `split('\n')` and `split(',')`,
 * because a quoted field may contain the delimiter, a newline, or an escaped
 * quote — and splitting on lines first makes the embedded-newline case
 * unrecoverable rather than merely wrong.
 */
export async function* csvRowsFrom(
  path: string,
  delimiter = ',',
): AsyncGenerator<string[]> {
  const stream = createReadStream(path, { encoding: 'utf8' });

  let field = '';
  let row: string[] = [];
  /** `field` = plain, `quoted` = inside quotes, `quote` = just saw one inside. */
  let state: 'field' | 'quoted' | 'quote' = 'field';

  for await (const chunk of stream) {
    for (const char of chunk as string) {
      if (state === 'quoted') {
        if (char === '"') state = 'quote';
        else field += char;
        continue;
      }

      if (state === 'quote') {
        if (char === '"') {
          // "" inside a quoted field is one literal quote.
          field += '"';
          state = 'quoted';
          continue;
        }
        state = 'field';
        // and fall through: this character is ordinary again
      }

      if (char === '"' && field === '') {
        state = 'quoted';
      } else if (char === delimiter) {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        field = '';
        yield row;
        row = [];
      } else if (char !== '\r') {
        field += char;
      }
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    yield row;
  }
}

function columnIndex(
  which: string | number | undefined,
  header: string[] | undefined,
  fallback: number | undefined,
  path: string,
): number | undefined {
  if (which === undefined) return fallback;
  if (typeof which === 'number') return which;
  if (header === undefined) {
    throw new Error(`${path}: column ${JSON.stringify(which)} needs header: true`);
  }
  const at = header.indexOf(which);
  if (at === -1) {
    throw new Error(
      `${path}: no column ${JSON.stringify(which)}. Found: ${header.join(', ')}`,
    );
  }
  return at;
}

/** Records from one column of a CSV file. */
export async function* csvFrom(
  path: string,
  options: CsvOptions = {},
): AsyncGenerator<BatchRecord> {
  const delimiter = options.delimiter ?? ',';
  const hasHeader = options.header !== false;

  let header: string[] | undefined;
  let textAt: number | undefined;
  let idAt: number | undefined;

  for await (const row of csvRowsFrom(path, delimiter)) {
    if (hasHeader && header === undefined) {
      header = row;
      textAt = columnIndex(options.column, header, 0, path);
      idAt = columnIndex(options.idColumn, header, undefined, path);
      continue;
    }

    if (textAt === undefined) {
      textAt = columnIndex(options.column, header, 0, path);
      idAt = columnIndex(options.idColumn, header, undefined, path);
    }

    const text = row[textAt ?? 0];
    if (typeof text !== 'string' || text === '') continue;

    const record: BatchRecord = { text };
    if (idAt !== undefined) {
      const id = row[idAt];
      if (id !== undefined && id !== '') record.id = id;
    }
    yield record;
  }
}

/** `.ndjson`/`.jsonl` → NDJSON, `.csv`/`.tsv` → CSV, anything else → one text per line. */
export function recordsFrom(
  path: string,
  options: NdjsonOptions & CsvOptions = {},
): AsyncGenerator<BatchRecord> | AsyncGenerator<string> {
  const lower = path.toLowerCase();
  if (lower.endsWith('.ndjson') || lower.endsWith('.jsonl')) return ndjsonFrom(path, options);
  if (lower.endsWith('.tsv')) return csvFrom(path, { delimiter: '\t', ...options });
  if (lower.endsWith('.csv')) return csvFrom(path, options);
  return linesFrom(path);
}

export interface NdjsonWriter {
  write(value: unknown): Promise<void>;
  close(): Promise<void>;
}

/**
 * Append-as-you-go NDJSON output, respecting backpressure.
 *
 * Without the `drain` await, writing a million lines faster than the disk
 * accepts them buffers the difference in memory — which is the exact failure
 * the streaming input was there to avoid.
 */
export function createNdjsonWriter(path: string): NdjsonWriter {
  const stream = createWriteStream(path, { encoding: 'utf8' });

  return {
    async write(value: unknown): Promise<void> {
      if (!stream.write(`${JSON.stringify(value)}\n`)) {
        await once(stream, 'drain');
      }
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
    },
  };
}
