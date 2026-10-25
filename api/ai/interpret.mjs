import { interpretQuestion, DEFAULT_GEMINI_MODEL } from '../../services/gemini.mjs';
import { interpretWithGroq, DEFAULT_GROQ_MODEL } from '../../services/groq.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const input = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  const schema = Array.isArray(input.schema) ? input.schema : [];
  if (!question || question.length > 2000) return res.status(400).json({ error: 'Question must be between 1 and 2000 characters.' });
  if (!schema.length || schema.length > 100) return res.status(400).json({ error: 'Authorized schema metadata is required.' });
  
  // Try Groq first, fall back to Gemini
  const useGroq = Boolean(process.env.GROQ_API_KEY);
  
  try {
    const interpretation = useGroq
      ? await interpretWithGroq({
          question,
          schema,
          rows: Array.isArray(input.rows) ? input.rows.slice(0, 500) : [],
          timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
          now: new Date().toISOString(),
          apiKey: process.env.GROQ_API_KEY,
          model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
        })
      : await interpretQuestion({
          question,
          schema,
          rows: Array.isArray(input.rows) ? input.rows.slice(0, 500) : [],
          timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
          now: new Date().toISOString(),
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
        });
    return res.status(200).json(interpretation);
  } catch (error) {
    const notConfiguredCodes = ['GEMINI_NOT_CONFIGURED', 'GROQ_NOT_CONFIGURED'];
    const status = notConfiguredCodes.includes(error.code) ? 503 : error.status === 429 ? 429 : 502;
    return res.status(status).json({ error: error.message, code: error.code || 'AI_REQUEST_FAILED' });
  }
}
