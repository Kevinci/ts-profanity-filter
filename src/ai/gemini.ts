// src/ai/gemini.ts
//
// Google Gemini, over plain `fetch` — no SDK, no dependency at all. The free
// tier covers this use case comfortably, which makes it the cheapest way to try
// the feature.

import type { AiCompletion, AiRequest, AiResponse } from './types.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini's `responseSchema` is an OpenAPI 3.0 subset, not full JSON Schema:
 * `additionalProperties` is rejected outright. Everything else we emit — type,
 * properties, required, enum, items — carries over unchanged.
 */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { additionalProperties: _dropped, ...rest } = schema as {
    additionalProperties?: unknown;
  } & Record<string, unknown>;

  const out: Record<string, unknown> = { ...rest };

  if (out['properties'] && typeof out['properties'] === 'object') {
    const properties = out['properties'] as Record<string, Record<string, unknown>>;
    out['properties'] = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }
  if (out['items'] && typeof out['items'] === 'object') {
    out['items'] = toGeminiSchema(out['items'] as Record<string, unknown>);
  }
  return out;
}

/**
 * Gemini blocks unsafe content by default — which, for a moderation classifier,
 * is precisely backwards: the text you need it to read is the text it refuses
 * to look at. These thresholds turn its own filtering off so it can classify
 * instead of decline.
 *
 * This is safe *because* the output is a verdict, not generated content: the
 * model never produces the harmful text, it only labels text you already have.
 */
const SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_NONE' }));

interface GeminiPart {
  text?: string;
}
interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

export const geminiCompletion: AiCompletion = async (request: AiRequest): Promise<AiResponse> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const response = await fetch(
      `${ENDPOINT}/${encodeURIComponent(request.model)}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          // Header rather than a query parameter: keys in URLs end up in
          // proxy logs and browser history.
          'x-goog-api-key': request.apiKey ?? '',
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [
            {
              role: 'user',
              parts: [{ text: `<text_to_review>\n${request.text}\n</text_to_review>` }],
            },
          ],
          safetySettings: SAFETY_SETTINGS,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(request.schema),
            maxOutputTokens: request.maxTokens,
            // A classifier should give the same answer twice.
            temperature: 0,
          },
        }),
      },
    );

    const data = (await response.json()) as GeminiResponse;

    if (!response.ok) {
      throw new Error(
        data.error?.message ?? `Gemini returned ${response.status} ${response.statusText}.`,
      );
    }

    // The prompt itself was blocked — no candidate to read.
    if (data.promptFeedback?.blockReason) {
      return { refused: true, refusalReason: `blocked: ${data.promptFeedback.blockReason}` };
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      return { refused: true, refusalReason: 'Gemini returned no candidate.' };
    }
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
      return { refused: true, refusalReason: `finishReason: ${candidate.finishReason}` };
    }
    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error(
        'Gemini hit maxOutputTokens before finishing its answer — raise ai.maxTokens.',
      );
    }

    const json = (candidate.content?.parts ?? []).map((part) => part.text ?? '').join('');

    if (json.trim() === '') {
      throw new Error(
        `Gemini returned no text (finishReason: ${candidate.finishReason ?? 'unknown'}).`,
      );
    }

    return { json, model: request.model };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Gemini did not answer within ${request.timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export { toGeminiSchema };
