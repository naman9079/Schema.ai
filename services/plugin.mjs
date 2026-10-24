import {
  buildLocalAnswer,
  buildPlan,
  buildPlanFromInterpretation,
  calculateConfidence,
  executePlan,
  inferSchema,
  normalizeHeader,
  profileRows,
  validateSql,
} from '../web/planner.mjs';
import { interpretQuestion, DEFAULT_GEMINI_MODEL } from './gemini.mjs';

function payloadRows(payload) {
  const headers = Array.isArray(payload?.headers) ? payload.headers.map((header, index) => normalizeHeader(header, index)) : [];
  const rawRows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!headers.length || !rawRows.length) throw new Error('The plugin payload needs headers and at least one data row.');
  const rows = rawRows.slice(0, 5000).map((rawRow, rowIndex) => {
    if (Array.isArray(rawRow)) return Object.fromEntries(headers.map((header, index) => [header, rawRow[index] ?? null]).concat([['__row_number', rowIndex + 2]]));
    if (rawRow && typeof rawRow === 'object') return { ...rawRow, __row_number: rowIndex + 2 };
    throw new Error('Plugin rows must be arrays or objects.');
  });
  return rows;
}

export async function answerPluginQuestion({ question, payload, apiKey, model = DEFAULT_GEMINI_MODEL, timezone = 'UTC', now = new Date().toISOString(), fetchImpl = fetch }) {
  const text = String(question || '').trim();
  if (!text || text.length > 2000) throw new Error('Question must be between 1 and 2000 characters.');
  const rows = payloadRows(payload);
  const schema = inferSchema(rows);
  let interpretation;
  let providerNotice = '';
  try {
    interpretation = await interpretQuestion({ question: text, schema, rows, timezone, now, apiKey, model, fetchImpl });
  } catch (error) {
    interpretation = { provider: 'deterministic-plugin-fallback', model: 'local-planner', plan: buildLocalAnswer(text, schema, rows), fallback: true };
    providerNotice = `Gemini unavailable: ${error.message} Local plugin fallback used explicitly.`;
  }
  const plan = interpretation.fallback ? interpretation.plan : (interpretation.plan?.status === 'unsupported' || interpretation.plan?.kind === 'unsupported'
    ? buildLocalAnswer(text, schema, rows)
    : buildPlanFromInterpretation(text, schema, interpretation.plan, new Date(now)));
  if (plan.status !== 'ready') return { ...plan, provider: interpretation.provider, model: interpretation.model, providerNotice, schema };
  const policy = plan.sql ? validateSql(plan.sql, schema.map((column) => column.name)) : { safe: true, errors: [] };
  if (!policy.safe) return { status: 'blocked', message: policy.errors.join(' '), provider: interpretation.provider, model: interpretation.model, providerNotice, schema };
  const execution = executePlan(plan, rows);
  const quality = profileRows(rows, schema);
  const confidence = calculateConfidence(quality.checks, rows.length, execution.coverage, plan.assumptions || []);
  return {
    ...plan,
    ...execution,
    checks: quality.checks,
    confidence,
    status: quality.checks.some((check) => check.status === 'warn' || check.status === 'fail') ? 'answered_with_warnings' : 'answered',
    provider: interpretation.provider,
    model: interpretation.model,
    providerNotice,
    schema,
  };
}
