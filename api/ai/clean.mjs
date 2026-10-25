import { cleanWithGemini, DEFAULT_CLEANING_MODEL } from '../../services/gemini-clean.mjs';
import { cleanWithGroq, DEFAULT_GROQ_MODEL } from '../../services/groq.mjs';
import { cleanWithOllama, DEFAULT_OLLAMA_MODEL } from '../../services/ollama.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const input = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const schema = Array.isArray(input.schema) ? input.schema : [];
  const rows = Array.isArray(input.rows) ? input.rows.slice(0, 2000) : [];
  if (!schema.length || !rows.length) return res.status(400).json({ error: 'Schema metadata and at least one row are required.' });
  
  // Priority: Ollama (local) > Groq > Gemini
  const useOllama = process.env.USE_OLLAMA !== 'false'; // Default to Ollama
  const useGroq = Boolean(process.env.GROQ_API_KEY);
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  
  try {
    let result;
    
    // Try Ollama first (local, no API key needed)
    if (useOllama) {
      try {
        result = await cleanWithOllama({
          datasetName: typeof input.datasetName === 'string' ? input.datasetName : 'uploaded data',
          schema,
          rows,
          timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
          now: new Date().toISOString(),
          model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
          baseUrl: ollamaBaseUrl,
          timeoutMs: 120000,
        });
        return res.status(200).json(result);
      } catch (ollamaError) {
        console.warn('Ollama cleaning failed, trying fallback:', ollamaError.message);
        // Continue to fallback providers
      }
    }
    
    // Fallback to Groq or Gemini
    result = useGroq 
      ? await cleanWithGroq({
          datasetName: typeof input.datasetName === 'string' ? input.datasetName : 'uploaded data',
          schema,
          rows,
          timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
          now: new Date().toISOString(),
          apiKey: process.env.GROQ_API_KEY,
          model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
        })
      : await cleanWithGemini({
          datasetName: typeof input.datasetName === 'string' ? input.datasetName : 'uploaded data',
          schema,
          rows,
          timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
          now: new Date().toISOString(),
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL || DEFAULT_CLEANING_MODEL,
        });
    return res.status(200).json(result);
  } catch (error) {
    const notConfiguredCodes = ['GEMINI_NOT_CONFIGURED', 'GROQ_NOT_CONFIGURED', 'OLLAMA_NOT_CONFIGURED'];
    const status = notConfiguredCodes.includes(error.code) ? 503 : error.status === 429 ? 429 : 502;
    return res.status(status).json({ error: error.message, code: error.code || 'AI_CLEANING_FAILED' });
  }
}
