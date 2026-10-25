// Ollama adapter for local DeepSeek-R1 inference
const OLLAMA_ENDPOINT = 'http://localhost:11434/api/chat';
const OLLAMA_GENERATE_ENDPOINT = 'http://localhost:11434/api/generate';

export const DEFAULT_OLLAMA_MODEL = 'deepseek-r1:8b';

/**
 * Interpret a data question using Ollama + DeepSeek-R1
 */
export async function interpretWithOllama({ question, schema, rows = [], timezone, now, model = DEFAULT_OLLAMA_MODEL, fetchImpl = fetch, timeoutMs = 120000, baseUrl = 'http://localhost:11434' }) {
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

Return ONLY valid JSON matching this schema (no markdown, no explanation):
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

Analyze the question. If it mentions cell references (like G2:G6), map them to column names using the position mapping. For calculations, return status=ready with the appropriate kind and measure. Return only the JSON query plan, no other text.`;

  try {
    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        format: 'json',
        options: {
          temperature: 0.3,
          num_predict: 1000,
        }
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = new Error(`Ollama request failed (${response.status}): ${body || 'Unknown error'}`);
      error.code = 'OLLAMA_API_ERROR';
      error.status = response.status;
      throw error;
    }

    const body = await response.json();
    const text = body?.message?.content || '';
    
    if (!text) {
      throw new Error('Ollama returned no response content.');
    }

    // Parse JSON response
    const plan = parseJsonFromText(text);
    return { provider: 'ollama', model, plan, usage: null };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Ollama timed out. DeepSeek-R1 may be slow on first run.');
      timeoutError.code = 'OLLAMA_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Clean data using Ollama + DeepSeek-R1
 */
export async function cleanWithOllama({ datasetName, schema, rows, timezone, now, model = DEFAULT_OLLAMA_MODEL, fetchImpl = fetch, timeoutMs = 120000, baseUrl = 'http://localhost:11434' }) {
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

Return ONLY valid JSON matching this schema (no markdown, no explanation):
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

Analyze these rows thoroughly. Identify all data quality issues and create a comprehensive cleaning plan. Return only the JSON object with status="ready", no other text.`;

  try {
    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        format: 'json',
        options: {
          temperature: 0.3,
          num_predict: 2000,
        }
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = new Error(`Ollama cleaning request failed (${response.status}): ${body || 'Unknown error'}`);
      error.code = 'OLLAMA_CLEANING_API_ERROR';
      error.status = response.status;
      throw error;
    }

    const body = await response.json();
    const text = body?.message?.content || '';

    if (!text) {
      throw new Error('Ollama returned no cleaning plan.');
    }

    const rawPlan = parseJsonFromText(text);
    const plan = normalizeCleaningPlan(rawPlan);
    return { provider: 'ollama', model, plan, usage: null };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Ollama timed out during cleaning.');
      timeoutError.code = 'OLLAMA_CLEANING_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse JSON from text that might contain markdown or extra content
 */
function parseJsonFromText(text) {
  const cleaned = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  
  // Try to find JSON object boundaries
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  
  if (start < 0 || end <= start) {
    // Try parsing the whole text
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error('Could not extract valid JSON from response.');
    }
  }
  
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${error.message}`);
  }
}

/**
 * Normalize and validate cleaning plan
 */
function normalizeCleaningPlan(value) {
  const plan = value && typeof value === 'object' ? value : {};
  const status = ['ready', 'needs_clarification', 'unsupported'].includes(plan.status) ? plan.status : 'unsupported';
  const allowedOperations = new Set(['trim_text', 'empty_to_null', 'normalize_null_tokens', 'coerce_values', 'drop_blank_rows', 'drop_exact_duplicates']);
  
  const operations = Array.isArray(plan.operations) ? plan.operations.map((operation) => ({
    type: allowedOperations.has(operation?.type) ? operation.type : null,
    columns: Array.isArray(operation?.columns) ? operation.columns.map((column) => String(column).slice(0, 120)).slice(0, 100) : [],
    reason: String(operation?.reason || '').slice(0, 500),
  })).filter((operation) => operation.type && operation.columns.length > 0) : [];
  
  const output = {
    status,
    summary: String(plan.summary || 'No cleaning summary was returned.').slice(0, 1600),
    operations,
    nullTokens: Array.isArray(plan.nullTokens) ? plan.nullTokens.map((token) => String(token).trim().toLowerCase()).filter(Boolean).slice(0, 20) : ['na', 'n/a', 'null', '-', '?', 'n.a.'],
    warnings: Array.isArray(plan.warnings) ? plan.warnings.map((warning) => String(warning).slice(0, 500)).slice(0, 12) : [],
    assumptions: Array.isArray(plan.assumptions) ? plan.assumptions.map((item) => String(item).slice(0, 300)).slice(0, 8) : [],
  };
  
  if (output.status === 'ready' && !output.operations.length) {
    output.status = 'needs_clarification';
    output.summary = 'No cleaning operations were identified for this dataset.';
  }
  
  if (output.status === 'needs_clarification' && !output.summary) {
    output.summary = 'AI could not produce a safe cleaning plan.';
  }
  
  return output;
}

/**
 * Check if Ollama is running and DeepSeek model is available
 */
export async function checkOllamaHealth({ model = DEFAULT_OLLAMA_MODEL, fetchImpl = fetch, baseUrl = 'http://localhost:11434' } = {}) {
  try {
    // Check if Ollama is running
    const tagsResponse = await fetchImpl(`${baseUrl}/api/tags`, { 
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    
    if (!tagsResponse.ok) {
      return { available: false, error: 'Ollama API not responding' };
    }
    
    const tagsData = await tagsResponse.json();
    const models = tagsData?.models || [];
    const hasModel = models.some(m => m.name === model || m.name.startsWith(model.split(':')[0]));
    
    if (!hasModel) {
      return { 
        available: false, 
        error: `Model ${model} not found. Run: ollama run ${model}` 
      };
    }
    
    return { available: true, model, models: models.map(m => m.name) };
  } catch (error) {
    return { 
      available: false, 
      error: `Ollama not running: ${error.message}. Start with: ollama serve` 
    };
  }
}
