import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCleaningPrompt, cleanWithGemini, normalizeCleaningPlan } from '../services/gemini-clean.mjs';

test('cleaning prompt asks Gemini for conservative safe operations', () => {
  const prompt = buildCleaningPrompt({
    datasetName: 'Admission.csv',
    schema: [{ name: 'gre_score', type: 'integer', nullable: false }],
    rows: [{ gre_score: '310' }],
  });
  assert.match(prompt, /conservative/i);
  assert.match(prompt, /drop_exact_duplicates/);
  assert.match(prompt, /gre_score/);
});

test('Gemini cleaning adapter normalizes a structured cleaning plan', async () => {
  const result = await cleanWithGemini({
    datasetName: 'Admission.csv',
    schema: [{ name: 'gre_score', type: 'integer', nullable: false }],
    rows: [{ gre_score: '310' }],
    apiKey: 'test-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({
        status: 'ready',
        summary: 'Normalize values and remove exact duplicates.',
        operations: [{ type: 'trim_text', columns: [], reason: 'Remove accidental surrounding whitespace.' }],
        warnings: [],
        assumptions: [],
      }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  assert.equal(result.provider, 'gemini');
  assert.equal(result.plan.status, 'ready');
  assert.equal(result.plan.operations[0].type, 'trim_text');
});

test('cleaning plan rejects unknown operations instead of executing them', () => {
  const plan = normalizeCleaningPlan({
    status: 'ready',
    summary: 'Test',
    operations: [{ type: 'invent_values', columns: [], reason: 'unsafe' }],
    warnings: [],
    assumptions: [],
  });
  assert.equal(plan.status, 'needs_clarification');
  assert.deepEqual(plan.operations, []);
});
