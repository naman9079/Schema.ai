import { DEFAULT_GROQ_MODEL } from '../services/groq.mjs';

export default function handler(req, res) {
  const groqModel = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  const payload = {
    supabaseUrl: process.env.DATAPILOT_SUPABASE_URL || '',
    supabaseAnonKey: process.env.DATAPILOT_SUPABASE_ANON_KEY || '',
    apiBaseUrl: 'https://schemaai-delta.vercel.app/api',
    geminiConfigured: Boolean(process.env.GROQ_API_KEY),
    geminiModel: groqModel,
  };
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(`window.DATAPILOT_CONFIG = ${JSON.stringify(payload)};`);
}
