// profanity-adversarial — a benchmark for profanity filters.
//
// Programmatic entry point. The CLI is the usual way in; this is here so a
// filter's own test suite can gate on the corpus.

export { CORPUS, CATEGORIES } from './corpus.js';
export { run, selectAttacks, type RunOptions } from './run.js';
export { formatReport, formatComparison, type FormatOptions } from './report.js';
export { preset, PRESET_NAMES, type PresetName } from './presets.js';
export type {
  Attack,
  AttackResult,
  Expectation,
  FilterAdapter,
  Language,
  RunReport,
  Score,
} from './types.js';
