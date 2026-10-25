// Groq AI adapter for Groq's fast inference API
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// Using GPT-OSS 120B - available on free/developer plan, good balance of speed and quality
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

export async function interpretWithGroq({ question, schema, rows = [], timezone, now, apiKey, model = DEFAULT_GROQ_MODEL, fetchImpl = fetch, timeoutMs = 60000 }) {
  if (!apiKey) {
    const error = new Error('Groq is not configured. Set GROQ_API_KEY on the server.');
    error.code = 'GROQ_NOT_CONFIGURED';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = `You are Schema.ai, a data analysis assistant. Analyze the question and dataset schema to create a query plan.

IMPORTANT RULES FOR CELL REFERENCES:
1. Users may ask about cell ranges like "G2 to G6" or "F2:F10"
2. Map these to column names: Column A=index 0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, etc.
3. Use the column name from the schema at that index as the "measure"
4. Always return status="ready" for cell range calculations, never needs_clarification

OPERATION MAPPING:
- SUM, ADD, TOTAL, CALCULATE → kind="sum"
- AVERAGE, MEAN, AVG → kind="average"  
- COUNT, "how many" → kind="count"
- COMPARE years/time periods → kind="comparison"
- TOP, HIGHEST, LOWEST, MAX, MIN → kind="top"
- Non-analytical questions → kind="answer"

CRITICAL: For kind="sum", "average", "count", "top":
- Set status="ready" (never needs_clarification for cell ranges)
- Set measure to the EXACT column name from schema
- Never use kind="answer" for mathematical calculations

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
Schema columns by position: ${schema.slice(0, 50).map((c, i) => `Column ${String.fromCharCode(65 + i)}="${c.name}"`).join(', ')}
Timezone: ${timezone}
Current time: ${now}

Analyze the question. If it mentions cell references (like G2:G6), map them to column names using the position mapping. For calculations, return status=ready with the appropriate kind and measure. Return only the JSON query plan.`;

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

  const systemPrompt = `You are an expert data cleaning assistant. Analyze the dataset thoroughly and create a comprehensive cleaning plan.

CRITICAL INSTRUCTIONS:
1. Examine the sample rows carefully for data quality issues
2. Look for: trailing/leading spaces, inconsistent null values, type mismatches, blank rows, duplicates
3. Be thorough but conservative - only suggest operations that improve data quality
4. ALWAYS include specific column names for each operation
5. Provide clear reasons for each operation

Common issues to detect:
- Text with extra spaces (use trim_text)
- Empty strings that should be null (use empty_to_null)
- Inconsistent null representations like "NA", "N/A", "null", "-", "?" (use normalize_null_tokens)
- Values in wrong types, like "123" in text column that should be number (use coerce_values)
- Completely empty rows (use drop_blank_rows)
- Exact duplicate rows (use drop_exact_duplicates)

Return ONLY valid JSON matching this schema:
{
  "status": "ready",
  "summary": "clear description of what will be cleaned and why",
  "operations": [
    {
      "type": "trim_text" | "empty_to_null" | "normalize_null_tokens" | "coerce_values" | "drop_blank_rows" | "drop_exact_duplicates",
      "columns": ["specific_column_name1", "specific_column_name2"],
      "reason": "specific explanation of the issue found"
    }
  ],
  "nullTokens": ["NA", "N/A", "null", "-", "?", "n/a", "N.A.", "na"],
  "warnings": ["potential risks or notable changes"],
  "assumptions": ["assumptions about data format or business rules"]
}

IMPORTANT: 
- List ALL relevant columns for each operation type
- Be specific about what issues you found in the sample data
- Include at least 3-5 operations if data quality issues exist`;

  const userPrompt = `Dataset: ${datasetName}
Schema: ${JSON.stringify(schema.slice(0, 50))}
Sample rows (first 10): ${JSON.stringify(rows.slice(0, 10))}
Timezone: ${timezone}

Analyze these rows thoroughly. Identify all data quality issues and create a comprehensive cleaning plan. Return only the JSON object with status="ready".`;

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
