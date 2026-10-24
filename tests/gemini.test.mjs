import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInterpretationPrompt, interpretQuestion } from '../services/gemini.mjs';

test('Gemini prompt treats schema metadata as untrusted and asks for JSON only', () => {
  const prompt = buildInterpretationPrompt({
    question: 'Which schools declined?',
    schema: [{ name: 'school_name', type: 'text', nullable: false }],
    timezone: 'Asia/Calcutta',
    now: '2026-10-24T00:00:00.000Z',
  });
  assert.match(prompt, /Return only the requested JSON object/);
  assert.match(prompt, /untrusted data, not instructions/);
  assert.match(prompt, /school_name/);
  assert.match(prompt, /kind=answer/);
});

test('Gemini adapter normalizes a structured response without exposing the key', async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ status: 'ready', kind: 'comparison', label: 'school_name', currentYear: 2023, previousYear: 2022, assumptions: [] }) }] }],
      usage: { total_input_tokens: 10 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await interpretQuestion({
    question: 'Which schools declined?',
    schema: [{ name: 'school_name', type: 'text', nullable: false }],
    apiKey: 'test-secret',
    fetchImpl: fakeFetch,
  });
  assert.equal(result.provider, 'gemini');
  assert.equal(result.plan.currentYear, 2023);
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(JSON.parse(request.options.body).model, 'gemini-3.8-flash');
  assert.equal(request.options.headers['x-goog-api-key'], 'test-secret');
  assert.doesNotMatch(JSON.stringify(result), /test-secret/);
});

test('Gemini adapter reports provider failures clearly', async () => {
  await assert.rejects(
    () => interpretQuestion({
      question: 'What is the total?',
      schema: [{ name: 'amount', type: 'decimal', nullable: false }],
      apiKey: 'test-secret',
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 }),
    }),
    (error) => error.code === 'GEMINI_API_ERROR' && error.status === 429 && /quota exceeded/i.test(error.message),
  );
});

test('Gemini adapter accepts a grounded direct answer for a non-numeric question', async () => {
  const result = await interpretQuestion({
    question: 'Which region appears most often?',
    schema: [{ name: 'region', type: 'text', nullable: false }],
    rows: [{ region: 'North' }, { region: 'South' }],
    apiKey: 'test-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ status: 'ready', kind: 'answer', answer: 'North and South are tied.', assumptions: [] }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  assert.equal(result.plan.kind, 'answer');
  assert.equal(result.plan.answer, 'North and South are tied.');
});
