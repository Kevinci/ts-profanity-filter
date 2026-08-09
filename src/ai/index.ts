// src/ai/index.ts — import from 'ts-profanity-filter/ai'
//
// Word lists catch words. They cannot tell that a sentence with no listed word
// in it is a threat, or that a sentence full of them is a quotation. That
// judgement is what a model adds, and it is the only part of this package that
// leaves your machine — so it is off unless you ask for it.

import { filterFWordsToSegments } from '../filter.js';
import { anthropicCompletion } from './anthropic.js';
import { buildSchema, buildSystemPrompt } from './prompt.js';
import {
  AI_CATEGORIES,
  type AiCategory,
  type AiOptions,
  type AiSeverity,
  type AiVerdict,
  type ModerationOptions,
  type ModerationResult,
} from './types.js';

const DEFAULTS = {
  model: 'claude-opus-5',
  effort: 'low',
  maxTokens: 4096,
  timeoutMs: 20_000,
} as const;

const SEVERITIES: readonly AiSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];

function verdict(partial: Partial<AiVerdict> & Pick<AiVerdict, 'status'>): AiVerdict {
  return {
    flagged: false,
    severity: 'none',
    categories: [],
    confidence: 0,
    reason: '',
    ...partial,
  };
}

/**
 * Never let a provider's error text carry the key. Messages get logged, and a
 * key in a log is a key in everyone's log.
 */
function redact(error: unknown, apiKey: string | undefined): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!apiKey || apiKey.length < 8) return message;
  return message.split(apiKey).join('[redacted]');
}

/** Trust the schema, but not blindly — a custom `complete` has no schema at all. */
function parseVerdict(json: string, allowed: readonly AiCategory[]): AiVerdict {
  const raw: unknown = JSON.parse(json);
  if (raw === null || typeof raw !== 'object') {
    throw new Error('The model did not return a JSON object.');
  }
  const value = raw as Record<string, unknown>;

  const categories = Array.isArray(value['categories'])
    ? value['categories'].filter((c): c is AiCategory =>
        allowed.includes(c as AiCategory),
      )
    : [];

  const severity = SEVERITIES.includes(value['severity'] as AiSeverity)
    ? (value['severity'] as AiSeverity)
    : 'none';

  const confidence = typeof value['confidence'] === 'number' ? value['confidence'] : 0;

  return {
    status: 'ok',
    flagged: value['flagged'] === true,
    severity,
    categories,
    confidence: Math.min(1, Math.max(0, confidence)),
    reason: typeof value['reason'] === 'string' ? value['reason'] : '',
  };
}

/**
 * Asks a model whether the text is racist, hateful, threatening, harassing,
 * obscene, sexually predatory, or pushing someone toward self-harm.
 *
 * Returns a verdict rather than throwing: a moderation call that fails should
 * be a decision you make, not an exception that takes down the request. Set
 * `onError: 'throw'` if you would rather it stopped.
 */
export async function analyzeWithAi(
  text: string,
  options: AiOptions = {},
): Promise<AiVerdict> {
  if (options.enabled === false) return verdict({ status: 'disabled' });
  if (!text || text.trim() === '') return verdict({ status: 'skipped' });

  const categories = options.categories?.length ? options.categories : AI_CATEGORIES;
  const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  const complete = options.complete ?? anthropicCompletion;

  try {
    if (!options.complete && !apiKey) {
      throw new Error(
        'No API key. Pass ai.apiKey, set ANTHROPIC_API_KEY, or supply ai.complete ' +
          'to use your own model.',
      );
    }

    const response = await complete({
      system:
        options.prompt ??
        buildSystemPrompt({
          categories,
          ...(options.extraInstructions !== undefined
            ? { extraInstructions: options.extraInstructions }
            : {}),
          ...(options.languageHint !== undefined
            ? { languageHint: options.languageHint }
            : {}),
        }),
      text,
      schema: buildSchema(categories),
      model: options.model ?? DEFAULTS.model,
      effort: options.effort ?? DEFAULTS.effort,
      maxTokens: options.maxTokens ?? DEFAULTS.maxTokens,
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      apiKey,
      fallback: options.fallback ?? true,
    });

    if (response.refused) {
      return verdict({
        status: 'refused',
        ...(response.model !== undefined ? { model: response.model } : {}),
        error:
          response.refusalReason ??
          "The provider's own safety layer declined the request.",
      });
    }

    if (response.json === undefined) {
      throw new Error('The provider returned neither a result nor a refusal.');
    }

    const parsed = parseVerdict(response.json, categories);
    return response.model !== undefined ? { ...parsed, model: response.model } : parsed;
  } catch (error) {
    if (options.onError === 'throw') throw error;
    return verdict({ status: 'error', error: redact(error, apiKey) });
  }
}

/**
 * Both signals in one call: the local word lists (synchronous, free, offline)
 * and the model's read of the whole sentence.
 *
 * Without an `ai` option no model is contacted and this is just
 * {@link filterFWordsToSegments} in a wrapper — which is the point: the network
 * call is something you opt into, not something you have to remember to remove.
 *
 * ```ts
 * const result = await moderateText(comment, {
 *   languages: ['en', 'de'],
 *   ai: { enabled: true },        // key from ANTHROPIC_API_KEY
 * });
 *
 * if (result.flagged) hold(result.ai.reason);
 * else publish(result.segments);
 * ```
 */
export async function moderateText(
  text: string,
  options: ModerationOptions = {},
): Promise<ModerationResult> {
  const { ai, ...filterOptions } = options;

  const segments = filterFWordsToSegments(text, filterOptions);
  const matchedList = segments.some((segment) => segment.isProfane);

  const aiVerdict = ai
    ? await analyzeWithAi(text, ai)
    : verdict({ status: 'disabled' });

  return {
    segments,
    matchedList,
    ai: aiVerdict,
    flagged: matchedList || aiVerdict.flagged,
  };
}

export { anthropicCompletion } from './anthropic.js';
export { buildSchema, buildSystemPrompt } from './prompt.js';
export { AI_CATEGORIES } from './types.js';
export type {
  AiCategory,
  AiCompletion,
  AiOptions,
  AiRequest,
  AiResponse,
  AiSeverity,
  AiVerdict,
  ModerationOptions,
  ModerationResult,
} from './types.js';
export { filterFWordsToSegments } from '../filter.js';
export type { FilterOptions, TextSegment } from '../filter.js';
