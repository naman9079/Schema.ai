import { DEFAULT_GROK_MODEL } from '../services/grok.mjs';

export default function handler(req, res) {
  const grokModel = process.env.GROK_MODEL || DEFAULT_GROK_MODEL;
  const payload = {
    supabaseUrl: process.env.DATAPILOT_SUPABASE_URL || '',
    supabaseAnonKey: process.env.DATAPILOT_SUPABASE_ANON_KEY || '',
    apiBaseUrl: 'https://schemaai-delta.vercel.app/api',
    geminiConfigured: Boolean(process.env.GROK_API_KEY),
    geminiModel: grokModel,
  };
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(`window.DATAPILOT_CONFIG = ${JSON.stringify(payload)};`);
}
