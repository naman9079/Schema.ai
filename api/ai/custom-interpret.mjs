import { interpretCustomQuestion } from '../../services/custom-provider.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const input = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  const schema = Array.isArray(input.schema) ? input.schema : [];
  if (!question || question.length > 2000) return res.status(400).json({ error: 'Question must be between 1 and 2000 characters.' });
  if (!schema.length || schema.length > 100) return res.status(400).json({ error: 'Authorized schema metadata is required.' });
  try {
    const interpretation = await interpretCustomQuestion({
      question,
      schema,
      rows: Array.isArray(input.rows) ? input.rows.slice(0, 500) : [],
      timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
      now: new Date().toISOString(),
      apiKey: typeof input.apiKey === 'string' ? input.apiKey : '',
      baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : '',
      model: typeof input.model === 'string' ? input.model : '',
    });
    return res.status(200).json(interpretation);
  } catch (error) {
    return res.status(502).json({ error: error.message, code: 'CUSTOM_PROVIDER_FAILED' });
  }
}
