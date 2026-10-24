import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretCustomQuestion } from '../services/custom-provider.mjs';

test('custom OpenAI-compatible provider returns a normalized plan without exposing the key', async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ status: 'ready', kind: 'count', assumptions: [] }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await interpretCustomQuestion({
    question: 'How many rows are there?',
    schema: [{ name: 'amount', type: 'decimal', nullable: false }],
    apiKey: 'test-custom-secret',
    baseUrl: 'https://api.example.test/v1',
    model: 'example-model',
    fetchImpl: fakeFetch,
  });
  assert.equal(result.provider, 'custom-openai-compatible');
  assert.equal(result.model, 'example-model');
  assert.equal(result.plan.kind, 'count');
  assert.equal(request.url, 'https://api.example.test/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-custom-secret');
  assert.doesNotMatch(JSON.stringify(result), /test-custom-secret/);
});

test('custom provider rejects missing credentials before making a request', async () => {
  await assert.rejects(
    () => interpretCustomQuestion({ question: 'Count rows', schema: [{ name: 'id', type: 'integer' }], model: 'example-model' }),
    /custom API key/i,
  );
});
