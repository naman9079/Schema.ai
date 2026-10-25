// Groq AI adapter for Groq's fast inference API
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export const DEFAULT_GROQ_MODEL = 'llama-3.1-70b-versatile';

export async function interpretWithGroq({ question, schema, rows = [], timezone, now, apiKey, model = DEFAULT_GROQ_MODEL, fetchImpl = fetch, timeoutMs = 30000 }) {
  if (!apiKey) {
    const error = new Error('Groq is not configured. Set GROQ_API_KEY on the server.');
    error.code = 'GROQ_NOT_CONFIGURED';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = `You are Schema.ai, a data analysis assistant. Analyze the question and dataset schema to create a query plan.
Return ONLY valid JSON matching this schema:
{
  "status": "ready" | "needs_clarification" | "unsupported",
  "kind": "comparison" | "count" | "sum" | "average" | "top" | "answer" | "unsupported",
  "label": "column name for grouping",
  "measure": "column name for calculation",
  "currentYear": number,
  "previousYear": number,
  "clarification": "what needs clarification",
  "answer": "direct answer for general questions",
  "assumptions": ["assumption1", "assumption2"]
}`;

  const userPrompt = `Question: ${question}
Schema: ${JSON.stringify(schema.slice(0, 50).map(c => ({ name: c.name, type: c.type })))}
Timezone: ${timezone}
Current time: ${now}

Return only the JSON query plan.`;

  try {
    const response = await fetchImpl(GROQ_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = body?.error?.message || body?.message || `Groq request failed (${response.status})`;
      console.error('Groq API Error:', response.status, errorMsg, body);
      const error = new Error(errorMsg);
      error.code = 'GROQ_API_ERROR';
      error.status = response.status;
      error.details = body;
      throw error;
    }

    const text = body?.choices?.[0]?.message?.content || '';
    if (!text) {
      throw new Error('Groq returned no response content.');
    }

    const plan = JSON.parse(text);
    return { provider: 'groq', model, plan, usage: body.usage || null };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Groq timed out.');
      timeoutError.code = 'GROQ_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function cleanWithGroq({ datasetName, schema, rows, timezone, now, apiKey, model = DEFAULT_GROQ_MODEL, fetchImpl = fetch, timeoutMs = 30000 }) {
  if (!apiKey) {
    const error = new Error('Groq is not configured. Set GROQ_API_KEY on the server.');
    error.code = 'GROQ_NOT_CONFIGURED';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = `You are a data cleaning assistant. Analyze the dataset and create a safe cleaning plan.
Return ONLY valid JSON matching this schema:
{
  "status": "ready" | "needs_clarification" | "unsupported",
  "summary": "description of cleaning plan",
  "operations": [
    {
      "type": "trim_text" | "empty_to_null" | "normalize_null_tokens" | "coerce_values" | "drop_blank_rows" | "drop_exact_duplicates",
      "columns": ["column names"],
      "reason": "why this operation"
    }
  ],
  "nullTokens": ["NA", "N/A", "null"],
  "warnings": ["warning messages"],
  "assumptions": ["assumptions made"]
}

Only use safe operations. Never invent values or delete data unnecessarily.`;

  const userPrompt = `Dataset: ${datasetName}
Schema: ${JSON.stringify(schema.slice(0, 50))}
Sample rows: ${JSON.stringify(rows.slice(0, 10))}
Timezone: ${timezone}

Create a conservative cleaning plan. Return only the JSON object.`;

  try {
    const response = await fetchImpl(GROQ_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = body?.error?.message || body?.message || `Groq cleaning request failed (${response.status})`;
      console.error('Groq API Error:', response.status, errorMsg, body);
      const error = new Error(errorMsg);
      error.code = 'GROQ_CLEANING_API_ERROR';
      error.status = response.status;
      error.details = body;
      throw error;
    }

    const text = body?.choices?.[0]?.message?.content || '';
    if (!text) {
      throw new Error('Groq returned no cleaning plan.');
    }

    const plan = JSON.parse(text);
    return { provider: 'groq', model, plan, usage: body.usage || null };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Groq timed out.');
      timeoutError.code = 'GROQ_CLEANING_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
