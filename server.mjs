import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpretQuestion, DEFAULT_GEMINI_MODEL } from './services/gemini.mjs';
import { interpretCustomQuestion } from './services/custom-provider.mjs';

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

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { status: 'ok', geminiConfigured: Boolean(process.env.GEMINI_API_KEY), geminiModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL });
  }
  if (url.pathname === '/api/ai/interpret' && req.method === 'POST') {
    const input = await readJson(req, 2 * 1024 * 1024);
    const question = typeof input.question === 'string' ? input.question.trim() : '';
    const schema = Array.isArray(input.schema) ? input.schema : [];
    if (!question || question.length > 2000) return sendJson(res, 400, { error: 'Question must be between 1 and 2000 characters.' });
    if (!schema.length || schema.length > 100) return sendJson(res, 400, { error: 'Authorized schema metadata is required.' });
    try {
      const interpretation = await interpretQuestion({
        question,
        schema,
        rows: Array.isArray(input.rows) ? input.rows.slice(0, 500) : [],
        timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
        now: new Date().toISOString(),
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      });
      return sendJson(res, 200, interpretation);
    } catch (error) {
      const status = error.code === 'GEMINI_NOT_CONFIGURED' ? 503 : error.status === 429 ? 429 : 502;
      return sendJson(res, status, { error: error.message, code: error.code || 'GEMINI_REQUEST_FAILED' });
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
  return sendJson(res, 404, { error: 'API route not found.' });
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);

  if (url.pathname === '/config.js') {
    const payload = {
      supabaseUrl: process.env.DATAPILOT_SUPABASE_URL || '',
      supabaseAnonKey: process.env.DATAPILOT_SUPABASE_ANON_KEY || '',
      apiBaseUrl: process.env.DATAPILOT_API_BASE_URL || '/api',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      geminiModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
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
