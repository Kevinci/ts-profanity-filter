// src/ai/ollama.ts
//
// A model on your own machine, over plain `fetch` — no SDK, no key, no request
// leaving the building.
//
// This is the answer to the objection that makes the whole AI layer a
// non-starter for some deployments: that moderating a message means sending it
// to a third party. Point this at a local Ollama and the text never leaves the
// host. Everything else — the prompt, the schema, the verdict shape — is
// identical to the hosted providers, so the decision is a one-line config
// change rather than a different code path.

import type { AiCompletion, AiRequest, AiResponse } from './types.js';

/** Ollama's default. Override with `ai.baseUrl` or the OLLAMA_HOST variable. */
export const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';

interface OllamaResponse {
  message?: { content?: string };
  done_reason?: string;
  error?: string;
}

function hostFrom(request: AiRequest): string {
  const raw =
    request.baseUrl ??
    (typeof process !== 'undefined' ? process.env?.['OLLAMA_HOST'] : undefined) ??
    OLLAMA_DEFAULT_HOST;

  // OLLAMA_HOST is commonly set bare, as `localhost:11434`.
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

export const ollamaCompletion: AiCompletion = async (
  request: AiRequest,
): Promise<AiResponse> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  const host = hostFrom(request);

  try {
    const response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        // Plain Ollama needs no key. A key only appears when someone has put
        // the server behind a proxy, which is a sensible thing to do.
        ...(request.apiKey ? { authorization: `Bearer ${request.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: `<text_to_review>\n${request.text}\n</text_to_review>` },
        ],
        // Ollama takes a JSON Schema here directly and constrains decoding to
        // it — the same guarantee the hosted providers give, locally.
        format: request.schema,
        options: {
          // A classifier should give the same answer twice.
          temperature: 0,
          num_predict: request.maxTokens,
        },
      }),
    });

    const data = (await response.json()) as OllamaResponse;

    if (!response.ok) {
      // The overwhelmingly common failure is a model that was never pulled,
      // and Ollama's own message for it is genuinely useful — pass it through
      // rather than replacing it with something vaguer.
      throw new Error(
        data.error ?? `Ollama returned ${response.status} ${response.statusText}.`,
      );
    }

    const json = data.message?.content ?? '';
    if (json.trim() === '') {
      throw new Error(
        `Ollama returned no content (done_reason: ${data.done_reason ?? 'unknown'}).`,
      );
    }

    return { json, model: request.model };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Ollama at ${host} did not answer within ${request.timeoutMs} ms. ` +
          'A first call also pays for loading the model into memory — raise ai.timeoutMs.',
      );
    }
    // A refused connection is the other everyday case, and the default message
    // for it says nothing about what to do.
    if (error instanceof TypeError) {
      throw new Error(
        `Could not reach Ollama at ${host}. Is it running? ` +
          'Start it with `ollama serve`, or point ai.baseUrl somewhere else.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
