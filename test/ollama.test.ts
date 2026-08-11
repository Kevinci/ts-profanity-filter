// The local provider, tested without a local model.
//
// `fetch` is swapped for a stub, so these run on any machine and in CI. What
// they check is the contract: the request Ollama receives, and how each of its
// failure modes turns into a verdict rather than an exception.

import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';

import { analyzeWithAi, ollamaCompletion, OLLAMA_DEFAULT_HOST } from '../dist/ai/index.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env['OLLAMA_HOST'];
});

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

/** Replaces fetch and records what the provider sent. */
function stub(reply: unknown, ok = true, status = 200): { calls: Captured[] } {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({
      url: String(url),
      headers: init?.headers ?? {},
      body: JSON.parse(init?.body ?? '{}'),
    });
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Not Found',
      json: async () => reply,
    };
  }) as typeof fetch;
  return { calls };
}

const VERDICT = {
  flagged: true,
  severity: 'high',
  categories: ['racism'],
  confidence: 0.9,
  reason: 'Grund.',
  quote: 'Sorte',
};

const request = {
  system: 'system prompt',
  text: 'text to judge',
  schema: { type: 'object', properties: {} },
  model: 'llama3.2',
  effort: 'low' as const,
  maxTokens: 1024,
  timeoutMs: 5000,
  apiKey: undefined,
  fallback: false,
};

/* ------------------------------ the request ----------------------------- */

test('posts to /api/chat on the default host', async () => {
  const { calls } = stub({ message: { content: JSON.stringify(VERDICT) } });
  await ollamaCompletion(request);

  assert.equal(calls[0]!.url, `${OLLAMA_DEFAULT_HOST}/api/chat`);
});

test('sends the schema as the format, and asks for a deterministic answer', async () => {
  const { calls } = stub({ message: { content: JSON.stringify(VERDICT) } });
  await ollamaCompletion(request);

  const body = calls[0]!.body;
  assert.deepEqual(body['format'], request.schema, 'the JSON Schema constrains decoding');
  assert.equal(body['stream'], false);
  assert.equal(body['options'].temperature, 0, 'a classifier must answer the same way twice');
  assert.equal(body['options'].num_predict, request.maxTokens);
  assert.equal(body['messages'][0].role, 'system');
  assert.match(body['messages'][1].content, /<text_to_review>/);
});

test('sends no authorization header when there is no key', async () => {
  const { calls } = stub({ message: { content: JSON.stringify(VERDICT) } });
  await ollamaCompletion(request);

  assert.equal(calls[0]!.headers['authorization'], undefined);
});

test('sends a bearer token when the server sits behind a proxy', async () => {
  const { calls } = stub({ message: { content: JSON.stringify(VERDICT) } });
  await ollamaCompletion({ ...request, apiKey: 'proxy-token' });

  assert.equal(calls[0]!.headers['authorization'], 'Bearer proxy-token');
});

/* ------------------------------- the host ------------------------------- */

test('honours ai.baseUrl, and adds the scheme when it is missing', async () => {
  const { calls } = stub({ message: { content: JSON.stringify(VERDICT) } });

  await ollamaCompletion({ ...request, baseUrl: 'http://gpu-box:11434/' });
  assert.equal(calls[0]!.url, 'http://gpu-box:11434/api/chat', 'trailing slash trimmed');

  // OLLAMA_HOST is commonly set bare.
  await ollamaCompletion({ ...request, baseUrl: 'gpu-box:11434' });
  assert.equal(calls[1]!.url, 'http://gpu-box:11434/api/chat');
});

test('falls back to OLLAMA_HOST from the environment', async () => {
  process.env['OLLAMA_HOST'] = '127.0.0.1:9999';
  const { calls } = stub({ message: { content: JSON.stringify(VERDICT) } });
  await ollamaCompletion(request);

  assert.equal(calls[0]!.url, 'http://127.0.0.1:9999/api/chat');
});

/* ----------------------------- failure modes ---------------------------- */

test('passes through Ollama’s own error for a model that was never pulled', async () => {
  stub({ error: 'model "llama3.2" not found, try pulling it first' }, false, 404);

  await assert.rejects(ollamaCompletion(request), /not found, try pulling it first/);
});

test('a refused connection explains what to do about it', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  await assert.rejects(ollamaCompletion(request), /Is it running\?|ollama serve/);
});

test('an empty answer is an error, not an empty verdict', async () => {
  stub({ message: { content: '   ' }, done_reason: 'load' });

  await assert.rejects(ollamaCompletion(request), /no content/);
});

/* --------------------------- through the layer -------------------------- */

test('needs no API key, unlike the hosted providers', async () => {
  const saved = process.env['OLLAMA_API_KEY'];
  delete process.env['OLLAMA_API_KEY'];
  stub({ message: { content: JSON.stringify(VERDICT) } });

  const result = await analyzeWithAi('Deine Sorte …', { provider: 'ollama' });

  assert.equal(result.status, 'ok', result.error ?? 'no error reported');
  assert.equal(result.flagged, true);
  assert.deepEqual(result.categories, ['racism']);
  assert.equal(result.model, 'llama3.2');

  if (saved !== undefined) process.env['OLLAMA_API_KEY'] = saved;
});

test('a cold start gets a longer default timeout than the hosted providers', async () => {
  // Read off the request the layer builds, rather than inferred from timing.
  const seen: number[] = [];
  const capture = async (r: { timeoutMs: number }) => {
    seen.push(r.timeoutMs);
    return { json: JSON.stringify(VERDICT) };
  };

  await analyzeWithAi('text', { provider: 'ollama', complete: capture as never });
  await analyzeWithAi('text', {
    provider: 'gemini',
    apiKey: 'x',
    complete: capture as never,
  });
  await analyzeWithAi('text', {
    provider: 'ollama',
    timeoutMs: 5000,
    complete: capture as never,
  });

  assert.equal(seen[0], 120_000, 'ollama default — a cold start loads the weights');
  assert.equal(seen[1], 20_000, 'hosted default');
  assert.equal(seen[2], 5000, 'an explicit value still wins');
});

test('an unreachable server becomes a verdict, not a thrown error', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  const result = await analyzeWithAi('text', { provider: 'ollama' });

  assert.equal(result.status, 'error');
  assert.equal(result.flagged, false, 'a failed check must never flag by accident');
  assert.match(result.error ?? '', /Ollama/);
});
