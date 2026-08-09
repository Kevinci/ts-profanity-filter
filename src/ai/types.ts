// src/ai/types.ts
import type { FilterOptions, TextSegment } from '../filter.js';

/**
 * What the model is asked to judge. The local word lists catch *words*; these
 * are about what a whole sentence is doing — a message can be abusive without
 * containing a single listed word, and can contain one while being harmless.
 */
export type AiCategory =
  /** Racist or ethnic slurs, and language that dehumanises by origin or skin colour. */
  | 'racism'
  /** Hatred or contempt toward a group: religion, ethnicity, nationality, sexuality, gender, disability. */
  | 'hate'
  /** Threats, incitement, or glorification of violence — including against a whole group. */
  | 'violence'
  /** Insults, bullying, or degradation aimed at a specific person. */
  | 'harassment'
  /** Explicit or obscene sexual content. */
  | 'sexual'
  /** Sexual content involving minors, or grooming and predatory approaches. */
  | 'sexual_minors'
  /** Encouraging suicide or self-harm. */
  | 'self_harm';

/** Every category, in the order the default prompt lists them. */
export const AI_CATEGORIES: readonly AiCategory[] = [
  'racism',
  'hate',
  'violence',
  'harassment',
  'sexual',
  'sexual_minors',
  'self_harm',
];

export type AiSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** What the model reported, or why it could not report anything. */
export interface AiVerdict {
  /**
   * `ok` — a verdict was produced.
   * `disabled` — the check was switched off.
   * `skipped` — nothing to check (empty input).
   * `refused` — the provider's own safety layer declined the request.
   * `error` — the call failed; see `error`.
   */
  status: 'ok' | 'disabled' | 'skipped' | 'refused' | 'error';
  /** True only when the model actually flagged something. Never true on error. */
  flagged: boolean;
  severity: AiSeverity;
  categories: AiCategory[];
  /** The model's own confidence, 0–1. */
  confidence: number;
  /** One sentence, in the language of the input, explaining the call. */
  reason: string;
  /**
   * The stretch of the input the model objected to, copied verbatim so you can
   * locate and highlight it. Empty when nothing was flagged — and worth
   * checking against the original before trusting it, since a model can
   * paraphrase despite being told not to.
   */
  quote: string;
  /** Which model answered — useful when a provider-side fallback swapped it. */
  model?: string;
  /** Present when `status` is `error` or `refused`. Never contains the API key. */
  error?: string;
}

/** The whole picture: local word matches plus the model's read of the text. */
export interface ModerationResult {
  /** Exactly what `filterFWordsToSegments` returns — lossless, ready to render. */
  segments: TextSegment[];
  /** True if any segment matched a word list. */
  matchedList: boolean;
  /** The model's verdict. Always present; check `status` before trusting it. */
  ai: AiVerdict;
  /** True when either signal fired — the single value most callers act on. */
  flagged: boolean;
}

/** The resolved request handed to a provider. */
export interface AiRequest {
  /** The full system prompt, default or custom. */
  system: string;
  /** The text to judge. */
  text: string;
  /** JSON Schema the answer must satisfy. */
  schema: Record<string, unknown>;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  timeoutMs: number;
  apiKey: string | undefined;
  /** Base URL for a self-hosted provider, when one was configured. */
  baseUrl?: string | undefined;
  /** Let the provider retry on another model if its safety layer declines. */
  fallback: boolean;
}

/** A provider's answer: the raw JSON text, plus whatever it knows about the call. */
export interface AiResponse {
  /** JSON matching the schema. Omitted when `refused` is true. */
  json?: string;
  /** The provider's safety layer declined — not a failure of your code. */
  refused?: boolean;
  /** Why it declined, when the provider says. */
  refusalReason?: string;
  /** Which model actually answered. */
  model?: string;
}

/**
 * Swap in any model you like. Anything that can take a system prompt plus text
 * and return JSON matching the schema will work — this is the seam that keeps
 * the package from being welded to one vendor, and it is how the tests run
 * without a network.
 */
export type AiCompletion = (request: AiRequest) => Promise<AiResponse>;

/** Which built-in provider to call. Ignored when you supply your own `complete`. */
export type AiProvider = 'anthropic' | 'gemini' | 'ollama';

/**
 * A few known model ids per provider, for populating a picker. Not a closed
 * set — `ai.model` takes any string the provider accepts, and providers add
 * models faster than a package can track them.
 */
export const AI_MODELS: Readonly<Record<AiProvider, readonly string[]>> = {
  anthropic: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  // Verified against a fresh free-tier key: gemini-2.5-flash is listed by the
  // models endpoint but rejected for new accounts ("no longer available to new
  // users"), and gemini-2.0-flash is out of free quota. The -latest aliases
  // never go stale, which is why one of them is the default.
  gemini: [
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
  ],
  // Whatever you have pulled. These are only starting points — ask your own
  // server with `ollama list` for the real answer. A small instruct model is
  // enough: this is a classification with a fixed schema, not an essay.
  ollama: ['llama3.2', 'qwen2.5', 'mistral', 'gemma2', 'phi4'],
};

export interface AiOptions {
  /**
   * Defaults to `anthropic`. `gemini` needs no SDK at all — it is a plain
   * `fetch` — and Google's free tier covers this use case, which makes it the
   * cheapest way to try the feature.
   */
  provider?: AiProvider;
  /**
   * The on/off switch. Defaults to `true` whenever this object is present, so
   * passing no `ai` at all means no model is ever called. Set `false` to keep
   * the configuration around while the check is off.
   */
  enabled?: boolean;
  /**
   * The API key. Falls back to `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` in the
   * environment, whichever matches the provider.
   *
   * **Keep this server-side.** A key shipped to a browser is readable by
   * everyone who loads the page and can be spent by them.
   */
  apiKey?: string;
  /**
   * Any model id the provider accepts. Defaults to `claude-opus-5` or
   * `gemini-flash-lite-latest`, whichever matches the provider. See {@link AI_MODELS}
   * for a starting point.
   */
  model?: string;
  /** Reasoning depth. Defaults to `low` — this is a classification, not an essay. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Output cap. Defaults to 4096, which leaves room for thinking. */
  maxTokens?: number;
  /** Restrict the check to a subset. Defaults to all of {@link AI_CATEGORIES}. */
  categories?: readonly AiCategory[];
  /** Replaces the built-in system prompt entirely. You own the categories then. */
  prompt?: string;
  /** Appended to the built-in prompt — house rules, domain terms, exceptions. */
  extraInstructions?: string;
  /** Tell the model what to expect, e.g. `'German'`. Defaults to auto-detect. */
  languageHint?: string;
  /**
   * Abort after this many milliseconds. Defaults to 20000 for the hosted
   * providers and 120000 for `ollama`, where a cold start also loads the model.
   */
  timeoutMs?: number;
  /**
   * Where to reach a self-hosted provider. Only `ollama` reads it, where it
   * defaults to `OLLAMA_HOST` or `http://localhost:11434`.
   */
  baseUrl?: string;
  /**
   * Retry on another model if the provider's own safety layer declines the
   * request. Defaults to `true` — moderation text is exactly the kind of input
   * that trips those classifiers, and a declined request is not a verdict.
   */
  fallback?: boolean;
  /**
   * `return` (default) reports failures as `status: 'error'` and lets you
   * decide. `throw` raises instead — pick it when a missing verdict must stop
   * the request rather than pass quietly.
   */
  onError?: 'return' | 'throw';
  /** Bring your own model. Bypasses the built-in Anthropic provider entirely. */
  complete?: AiCompletion;
}

export interface ModerationOptions extends FilterOptions {
  ai?: AiOptions;
}
