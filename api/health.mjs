import { DEFAULT_GEMINI_MODEL } from '../services/gemini.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  return res.status(200).json({
    status: 'ok',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    geminiModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  });
}
