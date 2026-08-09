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

export interface AiOptions {
  /**
   * The on/off switch. Defaults to `true` whenever this object is present, so
   * passing no `ai` at all means no model is ever called. Set `false` to keep
   * the configuration around while the check is off.
   */
  enabled?: boolean;
  /**
   * Anthropic API key. Falls back to `ANTHROPIC_API_KEY` in the environment.
   *
   * **Keep this server-side.** A key shipped to a browser is readable by
   * everyone who loads the page and can be spent by them.
   */
  apiKey?: string;
  /** Defaults to `claude-opus-5`. */
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
  /** Abort after this many milliseconds. Defaults to 20000. */
  timeoutMs?: number;
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
