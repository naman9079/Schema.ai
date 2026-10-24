import { buildInterpretationPrompt, normalizePlan } from './gemini.mjs';

function parseJsonText(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The custom provider did not return a JSON query plan.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function endpointFor(baseUrl) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('Custom provider base URL must start with http:// or https://.');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

export async function interpretCustomQuestion({ question, schema, rows = [], timezone = 'UTC', now, apiKey, baseUrl, model, fetchImpl = fetch, timeoutMs = 20000 }) {
  if (!apiKey) throw new Error('A custom API key is required. Add it in Settings.');
  if (!model) throw new Error('A custom model name is required. Add it in Settings.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpointFor(baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${buildInterpretationPrompt({ question, schema, rows, timezone, now })}\nReturn only one JSON object with status, kind, label, measure, currentYear, previousYear, clarification, answer, and assumptions.` },
          { role: 'user', content: question },
        ],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `Custom provider request failed (${response.status}).`);
    const content = body?.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((part) => part?.text || '').join('') : content;
    if (!text) throw new Error('The custom provider returned no query plan.');
    return { provider: 'custom-openai-compatible', model, plan: normalizePlan(parseJsonText(text)) };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Custom provider timed out before returning a query plan.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
