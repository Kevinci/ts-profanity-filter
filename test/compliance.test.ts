import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  generateJustification,
  exportJustification,
  formatJustificationAsText,
  buildJustificationPrompt,
  buildJustificationSchema,
  InMemoryJustificationStore,
  type ComplianceJustification,
} from '../dist/compliance/index.js';
import { moderateText } from '../dist/ai/index.js';
import type { AiCompletion, AiRequest } from '../dist/ai/index.js';

function stubModel(
  answer: Record<string, unknown>,
  _capture?: { request?: AiRequest },
): AiCompletion {
  return async (request) => {
    if (_capture) _capture.request = request;
    return { json: JSON.stringify(answer), model: 'stub-model' };
  };
}

const CLEAN = { flagged: false, severity: 'none', categories: [], confidence: 0.9, reason: 'ok' };

/* ---------------------- justification generation ---------------------- */

test('generates a basic justification without AI', async () => {
  const result = await moderateText('hello world', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('hello world', result, {
    language: 'en',
    action: 'CONTENT_REMOVED',
  });

  assert.equal(justification.action, 'CONTENT_REMOVED');
  assert.equal(typeof justification.reason, 'string');
  assert.equal(justification.reason.length > 0, true);
  assert.equal(justification.language, 'en');
  assert.equal(typeof justification.timestamp, 'string');
  assert.equal(justification.duration, 'permanent');
});

test('auto-detects German text', async () => {
  const result = await moderateText('Das ist ein Test', {
    languages: ['de'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('Das ist ein Test', result);

  assert.equal(justification.language, 'de');
});

test('respects explicit language hint', async () => {
  const result = await moderateText('hello', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('hello', result, {
    language: 'de',
  });

  assert.equal(justification.language, 'de');
});

test('includes facts from moderation result', async () => {
  const result = await moderateText('some text', {
    languages: ['en'],
    ai: { complete: stubModel({ ...CLEAN, flagged: true, categories: ['harassment'] }) },
  });

  const justification = await generateJustification('some text', result);

  assert.equal(justification.facts.categories.length > 0, true);
  assert.equal(justification.facts.confidence >= 0, true);
});

test('includes custom policy bases', async () => {
  const result = await moderateText('text', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('text', result, {
    policyBases: [{ name: 'Code of Conduct', section: '§3.1' }],
  });

  assert.equal(justification.policyBases.length > 0, true);
  assert.equal(justification.policyBases[0].name, 'Code of Conduct');
  assert.equal(justification.policyBases[0].section, '§3.1');
});

test('accepts string policy bases and normalizes them', async () => {
  const result = await moderateText('text', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('text', result, {
    policyBases: ['Community Guidelines', 'Terms of Service'],
  });

  assert.equal(justification.policyBases.length, 2);
  assert.equal(justification.policyBases[0].name, 'Community Guidelines');
  assert.equal(justification.policyBases[1].name, 'Terms of Service');
});

test('includes appeal URL when provided', async () => {
  const result = await moderateText('text', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('text', result, {
    appealUrl: 'https://example.com/appeals',
  });

  assert.equal(justification.appealUrl, 'https://example.com/appeals');
});

test('sets duration from options', async () => {
  const result = await moderateText('text', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('text', result, {
    duration: '7 days',
  });

  assert.equal(justification.duration, '7 days');
});

/* ---------------------- formatting ---------------------- */

test('exports justification as valid JSON', async () => {
  const result = await moderateText('text', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('text', result);
  const json = exportJustification(justification);

  const parsed = JSON.parse(json);
  assert.equal(parsed.action, 'CONTENT_REMOVED');
});

test('formats as human-readable text in English', async () => {
  const result = await moderateText('text', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('text', result, {
    language: 'en',
    appealUrl: 'https://example.com/appeal',
  });

  const text = formatJustificationAsText(justification);

  assert.equal(text.includes('Action taken'), true);
  assert.equal(text.includes('Reason'), true);
  assert.equal(text.includes('Duration'), true);
  assert.equal(text.includes('https://example.com/appeal'), true);
});

test('formats as human-readable text in German', async () => {
  const result = await moderateText('text', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('text', result, {
    language: 'de',
  });

  const text = formatJustificationAsText(justification);

  assert.equal(text.includes('Maßnahme'), true);
  assert.equal(text.includes('Grund'), true);
});

/* ---------------------- the model, and its absence ---------------------- */

const WORDING = { reason: 'Modellformulierung.', factsSummary: 'Zusammenfassung.' };

test('no ai option means the wording comes from the template', async () => {
  // Mirrors moderateText: leaving `ai` out entirely is how you say "no model".
  // There is no key set in the test environment either, so a model call would
  // surface as an error rather than a sentence.
  const result = await moderateText('hello world', { languages: ['en'], ai: { enabled: false } });
  const justification = await generateJustification('hello world', result, { language: 'en' });

  assert.match(justification.reason, /removed for violating/);
});

test('the model writes the wording, never the facts', async () => {
  const result = await moderateText('some text', {
    languages: ['en'],
    ai: { complete: stubModel({ ...CLEAN, flagged: true, categories: ['harassment'], confidence: 0.8, quote: 'some' }) },
  });

  const justification = await generateJustification('some text', result, {
    action: 'ACCOUNT_SUSPENSION',
    duration: '7 days',
    policyBases: [{ name: 'Code of Conduct', section: '§3.1' }],
    language: 'de',
    ai: { complete: stubModel(WORDING) },
  });

  assert.equal(justification.reason, WORDING.reason, 'the sentence is the model’s');
  assert.equal(justification.action, 'ACCOUNT_SUSPENSION', 'the action is not');
  assert.equal(justification.duration, '7 days');
  assert.deepEqual(justification.facts.categories, ['harassment']);
  assert.equal(justification.facts.confidence, 0.8);
  assert.equal(justification.policyBases[0]!.section, '§3.1');
});

test('a failing model does not withhold the justification', async () => {
  const result = await moderateText('text', { languages: ['en'], ai: { enabled: false } });

  const justification = await generateJustification('text', result, {
    language: 'en',
    ai: { complete: async () => { throw new Error('network down'); } },
  });

  assert.match(justification.reason, /removed for violating/, 'fell back to the template');
  assert.equal(justification.action, 'CONTENT_REMOVED');
});

test('ai.enabled false keeps the config and skips the call', async () => {
  let called = false;
  const result = await moderateText('text', { languages: ['en'], ai: { enabled: false } });

  const justification = await generateJustification('text', result, {
    language: 'en',
    ai: {
      enabled: false,
      complete: async () => { called = true; return { json: JSON.stringify(WORDING) }; },
    },
  });

  assert.equal(called, false);
  assert.match(justification.reason, /removed for violating/);
});

/* ---------------------- what the notice must say ---------------------- */

test('the excerpt the decision rests on is in the notice', async () => {
  // No model here: the word list is the only thing that matched, so the quote
  // has to come from the flagged segments.
  const result = await moderateText('you are an ass', {
    languages: ['en'],
    ai: { enabled: false },
  });
  assert.equal(result.matchedList, true, 'precondition: the list matched');

  const justification = await generateJustification('you are an ass', result, { language: 'en' });
  assert.equal(justification.facts.quote.length > 0, true);
  assert.notEqual(justification.facts.quote, '[content]');

  const text = formatJustificationAsText(justification);
  assert.equal(text.includes('Facts:'), true);
  assert.equal(text.includes(justification.facts.quote), true, 'the excerpt is printed');
});

test('model-only fields are absent when no model was asked', async () => {
  const result = await moderateText('you are an ass', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const text = formatJustificationAsText(
    await generateJustification('you are an ass', result, { language: 'en' }),
  );

  // "0%" confidence reads as an uncertain decision rather than an unasked
  // question, and "(none)" categories reads as a search that found nothing.
  assert.equal(text.includes('Confidence:'), false);
  assert.equal(text.includes('Categories:'), false);
  assert.equal(text.includes('Automated detection: Yes'), true, 'the list is still automation');
});

test('model-only fields appear once a model has answered', async () => {
  const result = await moderateText('some text', {
    languages: ['en'],
    ai: { complete: stubModel({ ...CLEAN, flagged: true, categories: ['hate'], confidence: 0.75, quote: 'some' }) },
  });

  const text = formatJustificationAsText(
    await generateJustification('some text', result, { language: 'en' }),
  );

  assert.equal(text.includes('Categories: hate'), true);
  assert.equal(text.includes('Confidence: 75%'), true);
});

/* ---------------------- how the violation is weighed ---------------------- */

test('every justification carries an assessment, model or not', async () => {
  const result = await moderateText('you are an ass', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('you are an ass', result, {
    language: 'en',
  });

  assert.equal(typeof justification.assessment, 'string');
  assert.equal(justification.assessment.length > 40, true, 'a sentence, not a label');
  assert.equal(
    formatJustificationAsText(justification).includes('Assessment:'),
    true,
    'and it is printed in the notice',
  );
});

test('the word-list assessment does not claim a judgement it never made', async () => {
  const result = await moderateText('you are an ass', {
    languages: ['en'],
    ai: { enabled: false },
  });
  const { assessment } = await generateJustification('you are an ass', result, {
    language: 'en',
  });

  // The list knows which words were used, never what the sentence did with
  // them. A notice that claims otherwise is inventing its own grounds.
  assert.match(assessment, /does not establish what the/);
  assert.match(assessment, /appeal/, 'and it points at the way out');
});

test('the severity is carried into the record and the notice', async () => {
  const result = await moderateText('some text', {
    languages: ['en'],
    ai: {
      complete: stubModel({
        ...CLEAN,
        flagged: true,
        severity: 'high',
        categories: ['harassment'],
        confidence: 0.9,
        quote: 'some',
      }),
    },
  });

  const justification = await generateJustification('some text', result, { language: 'en' });

  assert.equal(justification.facts.severity, 'high');
  assert.match(justification.assessment, /weighs heavily/);
  assert.equal(formatJustificationAsText(justification).includes('Severity: high'), true);
});

test('an uncertain classification says so instead of overstating', async () => {
  const result = await moderateText('some text', {
    languages: ['en'],
    ai: {
      complete: stubModel({
        ...CLEAN,
        flagged: true,
        severity: 'medium',
        categories: ['hate'],
        confidence: 0.4,
        quote: 'some',
      }),
    },
  });

  const { assessment } = await generateJustification('some text', result, { language: 'en' });
  assert.match(assessment, /uncertain/);
});

test('a refused verdict is not graded as harmless', async () => {
  const result = await moderateText('some text', {
    languages: ['en'],
    ai: { complete: async () => ({ refused: true, refusalReason: 'declined' }) },
  });
  assert.equal(result.ai.status, 'refused');

  const justification = await generateJustification('some text', result, { language: 'en' });

  assert.equal(justification.facts.severity, 'none');
  // 'none' here means "never graded", not "found harmless" — so the notice must
  // not print a severity line at all.
  assert.equal(formatJustificationAsText(justification).includes('Severity:'), false);
});

test('the model writes the assessment when one is asked for', async () => {
  const result = await moderateText('some text', {
    languages: ['en'],
    ai: { complete: stubModel({ ...CLEAN, flagged: true, severity: 'high', categories: ['hate'], confidence: 0.9 }) },
  });

  const justification = await generateJustification('some text', result, {
    language: 'de',
    ai: { complete: stubModel({ reason: 'Kurzer Grund.', assessment: 'Die ausführliche Bewertung.' }) },
  });

  assert.equal(justification.assessment, 'Die ausführliche Bewertung.');
  assert.equal(justification.facts.severity, 'high', 'the grading is still the code’s');
});

test('the prompt asks for a graded assessment and forbids new facts', () => {
  const prompt = buildJustificationPrompt({
    action: 'ACCOUNT_SUSPENSION',
    categories: ['harassment'],
    language: 'de',
    severity: 'high',
  });

  assert.match(prompt, /assessment/);
  assert.match(prompt, /how serious/i);
  assert.match(prompt, /Never add a category/);
  assert.match(prompt, /"high"/, 'the grading is named in the prompt');
  assert.match(prompt, /German/, 'and so is the language');

  const schema = buildJustificationSchema() as {
    required: string[];
    additionalProperties: boolean;
  };
  assert.deepEqual(schema.required, ['reason', 'assessment']);
  assert.equal(schema.additionalProperties, false);
});

/* ---------------------- storage ---------------------- */

test('in-memory store saves and retrieves justifications', async () => {
  const store = new InMemoryJustificationStore();

  const result = await moderateText('text', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const justification = await generateJustification('text', result);

  await store.save('test-id-1', justification);
  const retrieved = await store.get('test-id-1');

  assert.deepEqual(retrieved, justification);
});

test('in-memory store returns null for missing ID', async () => {
  const store = new InMemoryJustificationStore();
  const retrieved = await store.get('nonexistent');

  assert.equal(retrieved, null);
});

test('in-memory store lists stored IDs', async () => {
  const store = new InMemoryJustificationStore();

  const result = await moderateText('text', {
    languages: ['en'],
    ai: { enabled: false },
  });

  const j1 = await generateJustification('text1', result);
  const j2 = await generateJustification('text2', result);

  await store.save('id-1', j1);
  await store.save('id-2', j2);

  const ids = await store.list();

  assert.equal(ids.length, 2);
  assert.equal(ids.includes('id-1'), true);
  assert.equal(ids.includes('id-2'), true);
});
