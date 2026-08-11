// src/compliance/types.ts — DSA Art. 17 compliance data structures
import type { AiCompletion, AiProvider, AiSeverity } from '../ai/types.js';

/** The action taken against content or an account. */
export type ComplianceAction =
  | 'CONTENT_REMOVED'
  | 'CONTENT_DEMOTION'
  | 'ACCOUNT_SUSPENSION'
  | 'ACCOUNT_TERMINATION'
  | 'FEATURE_RESTRICTION';

/** The legal or policy basis for the action. */
export interface PolicyBasis {
  /** E.g. 'Community Guidelines', 'Terms of Service', 'Legal' */
  name: string;
  /** E.g. '§4.2', '5.1' — the specific section violated */
  section?: string;
  /** URL to the full policy text, if available */
  url?: string;
}

/** The specific facts that triggered the moderation decision. */
export interface FactsContext {
  /** The flagged text (quoted verbatim or summarized) */
  quote: string;
  /** Detected categories (from AI or rule matches) */
  categories: string[];
  /**
   * How heavily the violation weighs. This is the grading the assessment
   * explains — `none` when no model was asked and only a word list matched.
   */
  severity: AiSeverity;
  /** Confidence level in the decision, 0–1 */
  confidence: number;
  /** Whether the decision was influenced by automated systems */
  automatedDetection: boolean;
  /** Whether a human reviewed the decision */
  humanReview: boolean;
}

/**
 * DSA Art. 17 Begründungspflicht: A user-facing explanation of why
 * content was removed, a user was suspended, etc.
 *
 * This must be provided in a way that allows the user to save it
 * (not a popup), and must be in their language.
 */
export interface ComplianceJustification {
  /** What action was taken */
  action: ComplianceAction;
  /** One-line reason in the user's language */
  reason: string;
  /**
   * How the violation is to be weighed, in prose: how serious it is and why it
   * lands there, what the wording does, whom it targets, which rule it crosses,
   * and where the call is uncertain.
   *
   * Art. 17 asks for the facts *and the grounds* — the excerpt alone says what
   * was found, never why it was enough. This is the paragraph the reader will
   * quote back at you in an appeal.
   */
  assessment: string;
  /** The legal/policy bases for the decision */
  policyBases: PolicyBasis[];
  /** Detailed explanation of the facts */
  facts: FactsContext;
  /** When the decision was made (ISO 8601) */
  timestamp: string;
  /** How long the measure lasts: e.g. '7d', '30d', 'permanent', 'indefinite' */
  duration: string;
  /** User's language tag, e.g. 'de', 'en' */
  language: string;
  /** URL where the user can appeal or request review */
  appealUrl?: string;
  /** Additional context or house rules that apply */
  additionalNotes?: string;
}

export interface GenerateJustificationOptions {
  /** The action that was taken */
  action?: ComplianceAction;
  /** The policy bases that apply (e.g., 'Community Guidelines') */
  policyBases?: readonly (PolicyBasis | string)[];
  /** Duration of the sanction */
  duration?: string;
  /** Appeal/redress URL */
  appealUrl?: string;
  /** User's language. Auto-detected from text if omitted */
  language?: string;
  /** Additional house rules or context for justification */
  additionalNotes?: string;
  /**
   * Ask a model to phrase the explanation. Omit it entirely and no model is
   * contacted — the wording falls back to the built-in templates, which is a
   * complete justification in its own right, just a blunter one.
   *
   * The facts never come from the model: action, policy bases, categories,
   * quote, confidence and timestamp are all decided by the code above it. The
   * model only writes the sentence a human reads.
   */
  ai?: {
    /** Set `false` to keep the configuration around while the call is off. */
    enabled?: boolean;
    provider?: AiProvider;
    apiKey?: string;
    model?: string;
    /** House rules for the wording — tone, house terms, a signature line. */
    extraInstructions?: string;
    /** Bring your own model, exactly as in `AiOptions`. Bypasses the providers. */
    complete?: AiCompletion;
  };
}
