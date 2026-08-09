import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  generateJustification,
  exportJustification,
  formatJustificationAsText,
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
