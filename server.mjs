import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpretQuestion, DEFAULT_GEMINI_MODEL } from './services/gemini.mjs';
import { interpretCustomQuestion } from './services/custom-provider.mjs';
import { cleanWithGemini, DEFAULT_CLEANING_MODEL } from './services/gemini-clean.mjs';
import { interpretWithGroq, cleanWithGroq, DEFAULT_GROQ_MODEL } from './services/groq.mjs';
import { answerPluginQuestion } from './services/plugin.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const publicRoot = join(root, 'web');

function loadDotEnv() {
  try {
    const text = requireUnavailableRead('.env.local');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index < 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Environment variables are sufficient in hosted deployments.
  }
}

function requireUnavailableRead(path) {
  // This synchronous helper is intentionally tiny and avoids adding a dotenv dependency.
  const fs = process.getBuiltinModule('node:fs');
  return fs.readFileSync(path, 'utf8');
}

loadDotEnv();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function readJson(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

function sendJson(res, status, payload) {
  return send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
}

function sendPluginJson(res, status, payload) {
  return send(res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
}

function sendPluginNoContent(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end();
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/plugin/ask' && req.method === 'OPTIONS') return sendPluginNoContent(res);
  if (url.pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { 
      status: 'ok', 
      groqConfigured: Boolean(process.env.GROQ_API_KEY),
      aiConfigured: Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY),
      activeModel: process.env.GROQ_API_KEY ? (process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL) : 'none'
    });
  }
  if (url.pathname === '/api/ai/interpret' && req.method === 'POST') {
    const input = await readJson(req, 2 * 1024 * 1024);
    const question = typeof input.question === 'string' ? input.question.trim() : '';
    const schema = Array.isArray(input.schema) ? input.schema : [];
    if (!question || question.length > 2000) return sendJson(res, 400, { error: 'Question must be between 1 and 2000 characters.' });
    if (!schema.length || schema.length > 100) return sendJson(res, 400, { error: 'Authorized schema metadata is required.' });
    try {
      let interpretation;
      // Try Groq first if configured, fallback to Gemini
      if (process.env.GROQ_API_KEY) {
        interpretation = await interpretWithGroq({
          question,
          schema,
          rows: Array.isArray(input.rows) ? input.rows.slice(0, 500) : [],
          timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
          now: new Date().toISOString(),
          apiKey: process.env.GROQ_API_KEY,
          model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
        });
      } else if (process.env.GEMINI_API_KEY) {
        interpretation = await interpretQuestion({
          question,
          schema,
          rows: Array.isArray(input.rows) ? input.rows.slice(0, 500) : [],
          timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
          now: new Date().toISOString(),
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
        });
      } else {
        const error = new Error('No AI provider configured. Set GROQ_API_KEY or GEMINI_API_KEY.');
        error.code = 'AI_NOT_CONFIGURED';
        throw error;
      }
      return sendJson(res, 200, interpretation);
    } catch (error) {
      const status = (error.code === 'GEMINI_NOT_CONFIGURED' || error.code === 'GROQ_NOT_CONFIGURED' || error.code === 'AI_NOT_CONFIGURED') ? 503 : error.status === 429 ? 429 : 502;
      return sendJson(res, status, { error: error.message, code: error.code || 'AI_REQUEST_FAILED' });
    }
  }
  if (url.pathname === '/api/ai/custom-interpret' && req.method === 'POST') {
    const input = await readJson(req, 2 * 1024 * 1024);
    const question = typeof input.question === 'string' ? input.question.trim() : '';
    const schema = Array.isArray(input.schema) ? input.schema : [];
    if (!question || question.length > 2000) return sendJson(res, 400, { error: 'Question must be between 1 and 2000 characters.' });
    if (!schema.length || schema.length > 100) return sendJson(res, 400, { error: 'Authorized schema metadata is required.' });
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
      return sendJson(res, 200, interpretation);
    } catch (error) {
      return sendJson(res, 502, { error: error.message, code: 'CUSTOM_PROVIDER_FAILED' });
    }
  }
  if (url.pathname === '/api/ai/clean' && req.method === 'POST') {
    const input = await readJson(req, 8 * 1024 * 1024);
    const schema = Array.isArray(input.schema) ? input.schema : [];
    const rows = Array.isArray(input.rows) ? input.rows.slice(0, 2000) : [];
    if (!schema.length || !rows.length) return sendJson(res, 400, { error: 'Schema metadata and at least one row are required.' });
    try {
      let result;
      // Try Groq first if configured, fallback to Gemini
      if (process.env.GROQ_API_KEY) {
        result = await cleanWithGroq({
          datasetName: typeof input.datasetName === 'string' ? input.datasetName : 'uploaded data',
          schema,
          rows,
          timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
          now: new Date().toISOString(),
          apiKey: process.env.GROQ_API_KEY,
          model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
        });
      } else if (process.env.GEMINI_API_KEY) {
        result = await cleanWithGemini({
          datasetName: typeof input.datasetName === 'string' ? input.datasetName : 'uploaded data',
          schema,
          rows,
          timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
          now: new Date().toISOString(),
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL || DEFAULT_CLEANING_MODEL,
        });
      } else {
        const error = new Error('No AI provider configured. Set GROQ_API_KEY or GEMINI_API_KEY.');
        error.code = 'AI_NOT_CONFIGURED';
        throw error;
      }
      return sendJson(res, 200, result);
    } catch (error) {
      const status = (error.code === 'GEMINI_NOT_CONFIGURED' || error.code === 'GROQ_NOT_CONFIGURED' || error.code === 'AI_NOT_CONFIGURED') ? 503 : error.status === 429 ? 429 : 502;
      return sendJson(res, status, { error: error.message, code: error.code || 'AI_CLEANING_FAILED' });
    }
  }
  if (url.pathname === '/api/plugin/ask' && req.method === 'POST') {
    const input = await readJson(req, 8 * 1024 * 1024);
    try {
      const result = await answerPluginQuestion({
        question: input.question,
        payload: input.payload,
        groqApiKey: process.env.GROQ_API_KEY,
        groqModel: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
        timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
        now: new Date().toISOString(),
      });
      return sendPluginJson(res, 200, result);
    } catch (error) {
      return sendPluginJson(res, 400, { error: error.message, code: 'PLUGIN_REQUEST_FAILED' });
    }
  }
  return sendJson(res, 404, { error: 'API route not found.' });
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);

  if (url.pathname === '/config.js') {
    const groqModel = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
    const payload = {
      supabaseUrl: process.env.DATAPILOT_SUPABASE_URL || '',
      supabaseAnonKey: process.env.DATAPILOT_SUPABASE_ANON_KEY || '',
      apiBaseUrl: 'https://schemaai-delta.vercel.app/api',
      geminiConfigured: Boolean(process.env.GROQ_API_KEY),
      geminiModel: groqModel,
    };
    return send(res, 200, `window.DATAPILOT_CONFIG = ${JSON.stringify(payload)};`, {
      'Content-Type': 'text/javascript; charset=utf-8',
    });
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const candidate = normalize(join(publicRoot, pathname));
  if (!candidate.startsWith(publicRoot)) return send(res, 403, 'Forbidden');

  try {
    const file = await readFile(candidate);
    const extension = extname(candidate);
    return send(res, 200, file, { 'Content-Type': contentTypes[extension] || 'application/octet-stream' });
  } catch (error) {
    if (error.code === 'ENOENT' && pathname !== '/index.html') {
      const file = await readFile(join(publicRoot, 'index.html'));
      return send(res, 200, file, { 'Content-Type': contentTypes['.html'] });
    }
    return send(res, 404, 'Not found');
  }
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    send(res, 500, 'Internal server error');
  });
}).listen(port, '0.0.0.0', () => {
    console.log(`Schema.ai running at http://localhost:${port}`);
});
