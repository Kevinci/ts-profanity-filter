// src/ai/index.ts — import from 'ts-profanity-filter/ai'
//
// Word lists catch words. They cannot tell that a sentence with no listed word
// in it is a threat, or that a sentence full of them is a quotation. That
// judgement is what a model adds, and it is the only part of this package that
// leaves your machine — so it is off unless you ask for it.

import { filterFWordsToSegments } from '../filter.js';
import { anthropicCompletion } from './anthropic.js';
import { geminiCompletion } from './gemini.js';
import { ollamaCompletion } from './ollama.js';
import { buildSchema, buildSystemPrompt } from './prompt.js';
import {
  AI_CATEGORIES,
  type AiCategory,
  type AiProvider,
  type AiOptions,
  type AiSeverity,
  type AiVerdict,
  type ModerationOptions,
  type ModerationResult,
} from './types.js';

/**
 * Per-provider defaults. The hosted two are the cheap, fast tier — this is a
 * classification, not an essay — and `ollama` is the same job on your own
 * machine, where `needsKey` is false because there is nobody to authenticate to.
 */
const PROVIDERS = {
  anthropic: {
    complete: anthropicCompletion,
    model: 'claude-opus-5',
    envVar: 'ANTHROPIC_API_KEY',
    needsKey: true,
    timeoutMs: 20_000,
  },
  gemini: {
    complete: geminiCompletion,
    model: 'gemini-flash-lite-latest',
    envVar: 'GEMINI_API_KEY',
    needsKey: true,
    timeoutMs: 20_000,
  },
  ollama: {
    complete: ollamaCompletion,
    model: 'llama3.2',
    // Only read when someone has put the server behind an authenticating proxy.
    envVar: 'OLLAMA_API_KEY',
    needsKey: false,
    // Measured, not guessed: a first call also pays for loading the weights
    // into memory, and a 9 GB model took 34 s on a warm laptop. Twenty seconds
    // would fail every cold start, which reads as "local models do not work".
    timeoutMs: 120_000,
  },
} as const satisfies Record<
  AiProvider,
  { complete: unknown; model: string; envVar: string; needsKey: boolean; timeoutMs: number }
>;

const DEFAULTS = {
  provider: 'anthropic',
  effort: 'low',
  maxTokens: 4096,
} as const;

const SEVERITIES: readonly AiSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];

/**
 * The key from the environment, when there is an environment to read.
 *
 * `process` does not exist in a browser, and a bare `process.env[...]` there is
 * a ReferenceError rather than `undefined` — which would take down the whole
 * call before the caller's own `apiKey` was ever considered.
 */
function envKey(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function verdict(partial: Partial<AiVerdict> & Pick<AiVerdict, 'status'>): AiVerdict {
  return {
    flagged: false,
    severity: 'none',
    categories: [],
    confidence: 0,
    reason: '',
    quote: '',
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
    quote: typeof value['quote'] === 'string' ? value['quote'] : '',
  };
}

/**
 * Lower-level API for running a generic AI completion with provider dispatch.
 * Used by compliance module and other library consumers.
 *
 * Returns the raw JSON (no parsing), or null on error. Refusals and errors
 * are logged to console but don't throw (unless onError: 'throw').
 */
export async function runAiCompletion(
  request: { text: string; system: string; schema: Record<string, unknown> },
  options: AiOptions & { provider?: AiProvider; model?: string } = {},
): Promise<{ json: string; model?: string } | null> {
  const provider = PROVIDERS[options.provider ?? DEFAULTS.provider];
  const apiKey = options.apiKey ?? envKey(provider.envVar);
  const complete = options.complete ?? provider.complete;

  try {
    if (!options.complete && provider.needsKey && !apiKey) {
      throw new Error(
        `No API key. Pass ai.apiKey, set ${provider.envVar}, supply ai.complete ` +
          "to use your own model, or switch to provider: 'ollama' to run one locally.",
      );
    }

    const response = await complete({
      system: request.system,
      text: request.text,
      schema: request.schema,
      model: options.model ?? provider.model,
      effort: options.effort ?? DEFAULTS.effort,
      maxTokens: options.maxTokens ?? DEFAULTS.maxTokens,
      timeoutMs: options.timeoutMs ?? provider.timeoutMs,
      apiKey,
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      fallback: options.fallback ?? true,
    });

    if (response.refused) {
      if (options.onError === 'throw') {
        throw new Error(response.refusalReason ?? 'Provider declined the request.');
      }
      console.error(
        '[runAiCompletion] refused',
        response.refusalReason ?? 'no reason given',
      );
      return null;
    }

    if (response.json === undefined) {
      throw new Error('The provider returned neither a result nor a refusal.');
    }

    return { json: response.json, model: response.model };
  } catch (error) {
    if (options.onError === 'throw') throw error;
    console.error('[runAiCompletion]', redact(error, apiKey));
    return null;
  }
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
  const provider = PROVIDERS[options.provider ?? DEFAULTS.provider];
  const apiKey = options.apiKey ?? envKey(provider.envVar);
  const complete = options.complete ?? provider.complete;

  try {
    if (!options.complete && provider.needsKey && !apiKey) {
      throw new Error(
        `No API key. Pass ai.apiKey, set ${provider.envVar}, supply ai.complete ` +
          "to use your own model, or switch to provider: 'ollama' to run one locally.",
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
      model: options.model ?? provider.model,
      effort: options.effort ?? DEFAULTS.effort,
      maxTokens: options.maxTokens ?? DEFAULTS.maxTokens,
      timeoutMs: options.timeoutMs ?? provider.timeoutMs,
      apiKey,
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
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
export { geminiCompletion, toGeminiSchema } from './gemini.js';
export { ollamaCompletion, OLLAMA_DEFAULT_HOST } from './ollama.js';
export { buildSchema, buildSystemPrompt } from './prompt.js';
export { AI_CATEGORIES, AI_MODELS } from './types.js';
export type {
  AiCategory,
  AiCompletion,
  AiOptions,
  AiProvider,
  AiRequest,
  AiResponse,
  AiSeverity,
  AiVerdict,
  ModerationOptions,
  ModerationResult,
} from './types.js';
export { filterFWordsToSegments } from '../filter.js';
export type { FilterOptions, TextSegment } from '../filter.js';
