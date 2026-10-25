import { answerPluginQuestion } from '../../services/plugin.mjs';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const input = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  
  const useOllama = process.env.USE_OLLAMA !== 'false'; // Default to Ollama
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  
  try {
    const result = await answerPluginQuestion({
      question: input.question,
      payload: input.payload,
      apiKey: process.env.GEMINI_API_KEY,
      groqApiKey: process.env.GROQ_API_KEY,
      groqModel: process.env.GROQ_MODEL,
      ollamaModel: process.env.OLLAMA_MODEL || 'deepseek-r1:8b',
      ollamaBaseUrl,
      useOllama,
      model: process.env.GEMINI_MODEL,
      timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
      now: new Date().toISOString(),
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message, code: 'PLUGIN_REQUEST_FAILED' });
  }
}
