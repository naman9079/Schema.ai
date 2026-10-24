import { cleanWithGemini, DEFAULT_CLEANING_MODEL } from '../../services/gemini-clean.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const input = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const schema = Array.isArray(input.schema) ? input.schema : [];
  const rows = Array.isArray(input.rows) ? input.rows.slice(0, 2000) : [];
  if (!schema.length || !rows.length) return res.status(400).json({ error: 'Schema metadata and at least one row are required.' });
  try {
    const result = await cleanWithGemini({
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
    const status = error.code === 'GEMINI_NOT_CONFIGURED' ? 503 : error.status === 429 ? 429 : 502;
    return res.status(status).json({ error: error.message, code: error.code || 'GEMINI_CLEANING_FAILED' });
  }
}
