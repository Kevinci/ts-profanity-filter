// src/batch/concurrency.ts — bounded concurrency over a stream, both orders.
//
// No Node APIs here on purpose: the core of the batch runner has to work in a
// browser, an edge runtime and a worker, so `setTimeout` and async iteration are
// the whole toolbox.
//
// The contract every function here relies on: `work` never rejects. The batch
// runner catches per record and returns an error result instead, which is what
// makes one bad record survivable — and what keeps `Promise.race` from throwing
// and orphaning the rest of the pool.

/** A promise that resolves after `ms`. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function aborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

/**
 * Results in input order.
 *
 * A sliding window of `limit` in-flight promises: push until it is full, then
 * yield the oldest. Head-of-line blocking is the price — a slow record holds
 * back the ones behind it — and it buys output you can write straight to a file
 * next to the input.
 */
export async function* mapOrdered<In, Out>(
  source: AsyncIterable<In> | Iterable<In>,
  limit: number,
  work: (item: In, index: number) => Promise<Out>,
  signal?: AbortSignal,
): AsyncGenerator<Out> {
  const window: Promise<Out>[] = [];
  let index = 0;

  for await (const item of source) {
    if (aborted(signal)) break;
    window.push(work(item, index++));
    if (window.length >= limit) {
      const next = window.shift();
      if (next !== undefined) yield await next;
    }
  }

  while (window.length > 0) {
    const next = window.shift();
    if (next !== undefined) yield await next;
  }
}

/**
 * Results in completion order.
 *
 * Each promise carries its own key so the settled one can be removed from the
 * pool — `Promise.race` tells you the value, never which promise produced it.
 */
export async function* mapUnordered<In, Out>(
  source: AsyncIterable<In> | Iterable<In>,
  limit: number,
  work: (item: In, index: number) => Promise<Out>,
  signal?: AbortSignal,
): AsyncGenerator<Out> {
  const pool = new Map<number, Promise<{ key: number; value: Out }>>();
  let index = 0;

  const settle = async (): Promise<Out> => {
    const { key, value } = await Promise.race(pool.values());
    pool.delete(key);
    return value;
  };

  for await (const item of source) {
    if (aborted(signal)) break;
    const key = index++;
    pool.set(
      key,
      work(item, key).then((value) => ({ key, value })),
    );
    if (pool.size >= limit) yield await settle();
  }

  while (pool.size > 0) yield await settle();
}

/**
 * No promises at all.
 *
 * When nothing in the pipeline awaits — word lists and PII detection are both
 * synchronous — two promises per record is pure overhead, and at a million
 * records it is the difference you can measure.
 */
export async function* mapSync<In, Out>(
  source: AsyncIterable<In> | Iterable<In>,
  work: (item: In, index: number) => Out,
  signal?: AbortSignal,
): AsyncGenerator<Out> {
  let index = 0;
  for await (const item of source) {
    if (aborted(signal)) break;
    yield work(item, index++);
  }
}
