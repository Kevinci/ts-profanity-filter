// src/compliance/index.ts — import from 'ts-profanity-filter/compliance'
//
// DSA (Digital Services Act) Art. 17 Begründungspflicht: when you moderate
// content or suspend an account, you must explain why in a way the user can
// save and understand. This module generates those explanations.

export {
  generateJustification,
  exportJustification,
  formatJustificationAsText,
} from './generator.js';

export { buildJustificationPrompt, buildJustificationSchema } from './prompt.js';

export { InMemoryJustificationStore, type JustificationStore } from './store.js';

export type {
  ComplianceAction,
  ComplianceJustification,
  FactsContext,
  GenerateJustificationOptions,
  PolicyBasis,
} from './types.js';
