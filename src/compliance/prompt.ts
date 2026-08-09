// src/compliance/prompt.ts — System prompts for DSA Art. 17 justifications

import type { AiCategory } from '../ai/types.js';

/**
 * Build a system prompt for generating user-facing justifications.
 * The facts are already determined; the model's job is only to phrase them.
 */
export function buildJustificationPrompt(options: {
  action: string;
  categories: AiCategory[];
  language: string;
  extraInstructions?: string;
} = {} as any): string {
  const languageNames: Record<string, string> = {
    en: 'English',
    de: 'German',
  };
  const lang = languageNames[options.language] || 'English';

  const parts = [
    'You are helping generate a legally compliant user notification for a moderation decision.',
    '',
    'The facts are FIXED and provided to you — do not invent, alter, or add new facts:',
    '- action: what was done',
    '- categories: what was found',
    '- quote: the exact problematic text',
    '- policyBases: which rules were broken',
    '- duration: how long the measure lasts',
    '',
    'Your only job is to phrase `reason` (one sentence explaining the action)',
    'and `factsSummary` (one or two sentences explaining what was found and why).',
    'Write in ' + lang + ', as a user facing explanation.',
    '',
    'Never invent categories, rules, or facts.',
    'Never apologize or soften the message.',
    'Be direct, clear, and respectful.',
    '',
    'Answer with the JSON object the schema describes and nothing else.',
  ];

  if (options.extraInstructions) {
    parts.push('', 'Additional rules:', options.extraInstructions);
  }

  return parts.join('\n');
}

/**
 * JSON schema for the justification prompt output.
 */
export function buildJustificationSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'One sentence explaining the action taken.',
      },
      factsSummary: {
        type: 'string',
        description: 'One or two sentences explaining what was found and why.',
      },
    },
    required: ['reason', 'factsSummary'],
    additionalProperties: false,
  };
}
