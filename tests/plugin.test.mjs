import test from 'node:test';
import assert from 'node:assert/strict';
import { answerPluginQuestion } from '../services/plugin.mjs';

test('plugin endpoint adapter answers a question from an imported file payload', async () => {
  const result = await answerPluginQuestion({
    question: 'What is the average of GRE?',
    payload: {
      headers: ['Serial No', 'GRE Score'],
      rows: [[1, 310], [2, 290]],
    },
    apiKey: 'test-secret',
    fetchImpl: async () => new Response(JSON.stringify({
      steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ status: 'ready', kind: 'average', measure: 'gre_score', assumptions: [] }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  assert.equal(result.status, 'answered');
  assert.match(result.answer, /average/i);
  assert.match(result.sql, /gre_score/);
});
