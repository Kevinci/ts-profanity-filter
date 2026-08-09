// src/ai/anthropic.ts
//
// The built-in provider. `@anthropic-ai/sdk` is an optional peer dependency and
// is imported lazily, so a caller who supplies their own `complete` never needs
// it installed at all.

import type { AiCompletion, AiRequest, AiResponse } from './types.js';

/** Text blocks carry the answer; everything else in the response is ignored. */
function extractText(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

/**
 * Calls Claude with structured outputs, so the answer is schema-valid rather
 * than merely JSON-shaped.
 *
 * Two things here are not boilerplate:
 *
 * - **`stop_reason` is checked before the content is read.** The provider's own
 *   safety layer can decline a request and still return HTTP 200 with an empty
 *   `content` — and moderation input is exactly the kind of text that trips it.
 *   Reading `content[0]` first would throw on the one case this feature exists
 *   to handle.
 * - **A declined request is retried on another model server-side** (`fallbacks`),
 *   because a refusal is not a verdict. Turn it off with `ai.fallback: false`.
 */
export const anthropicCompletion: AiCompletion = async (
  request: AiRequest,
): Promise<AiResponse> => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');

  const client = new Anthropic({
    ...(request.apiKey ? { apiKey: request.apiKey } : {}),
    timeout: request.timeoutMs,
    maxRetries: 2,
  });

  const response = await client.beta.messages.create({
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system,
    // Adaptive rather than disabled: with thinking off, Claude Opus 5 can leak
    // internal tags into the answer. Low effort keeps it cheap instead.
    thinking: { type: 'adaptive' },
    output_config: {
      effort: request.effort,
      format: { type: 'json_schema', schema: request.schema },
    },
    ...(request.fallback
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {}),
    messages: [
      {
        role: 'user',
        content: `<text_to_review>\n${request.text}\n</text_to_review>`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    return {
      refused: true,
      refusalReason: response.stop_details?.explanation ?? undefined,
      model: response.model,
    };
  }

  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      'The model hit max_tokens before finishing its answer — raise ai.maxTokens.',
    );
  }

  const json = extractText(response.content);
  if (json.trim() === '') {
    throw new Error(`The model returned no text (stop_reason: ${response.stop_reason}).`);
  }

  return { json, model: response.model };
};
