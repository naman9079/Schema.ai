import { DEFAULT_GEMINI_MODEL } from '../services/gemini.mjs';

export default function handler(req, res) {
  const payload = {
    supabaseUrl: process.env.DATAPILOT_SUPABASE_URL || '',
    supabaseAnonKey: process.env.DATAPILOT_SUPABASE_ANON_KEY || '',
    apiBaseUrl: 'https://schemaai-delta.vercel.app/api',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    geminiModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  };
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(`window.DATAPILOT_CONFIG = ${JSON.stringify(payload)};`);
}
