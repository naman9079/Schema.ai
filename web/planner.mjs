const RESERVED_SQL_WORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'true', 'false',
  'join', 'on', 'group', 'by', 'order', 'limit', 'offset', 'union', 'with',
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'grant', 'revoke',
]);

export function normalizeHeader(value, index = 0) {
  const original = String(value ?? '').trim();
  const base = original
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || `column_${index + 1}`;
  return RESERVED_SQL_WORDS.has(base) ? `${base}_value` : base;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }
  if (rows.length < 2) return { headers: rows[0] || [], rows: [] };

  const rawHeaders = rows[0];
  const headers = [];
  const seen = new Map();
  rawHeaders.forEach((header, index) => {
    const base = normalizeHeader(header, index);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    headers.push(count ? `${base}_${count + 1}` : base);
  });

  const data = rows.slice(1).map((cells, rowIndex) => {
    const output = {};
    headers.forEach((header, index) => {
      output[header] = (cells[index] ?? '').trim();
    });
    output.__row_number = rowIndex + 2;
    return output;
  });
  return { headers, rows: data };
}

function isNullish(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

export function coerceValue(value) {
  if (isNullish(value)) return null;
  const text = String(value).trim();
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?(?:\d+\.\d+|\d+\.\d*e[+-]?\d+)$/i.test(text)) return Number(text);
  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.test(text)) return text;
  return text;
}

export function inferSchema(rows, headers = Object.keys(rows[0] || {}).filter((key) => key !== '__row_number')) {
  return headers.map((name) => {
    const values = rows.map((row) => row[name]).filter((value) => !isNullish(value));
    const typed = values.map(coerceValue);
    const type = typed.length === 0 ? 'unknown'
      : typed.every((value) => Number.isInteger(value)) ? 'integer'
        : typed.every((value) => typeof value === 'number') ? 'decimal'
          : typed.every((value) => typeof value === 'boolean') ? 'boolean'
            : typed.every((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) ? 'date'
              : 'text';
    return {
      name,
      type,
      nullable: values.length !== rows.length,
      nullCount: rows.length - values.length,
    };
  });
}

function numberValue(row, column) {
  const value = coerceValue(row[column]);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function profileRows(rows, schema) {
  const checks = [];
  const nullColumns = schema
    .filter((column) => column.nullCount > 0)
    .map((column) => ({ column: column.name, affected: column.nullCount }));
  checks.push({
    code: 'NULL_VALUES',
    severity: nullColumns.length ? 'warning' : 'info',
    status: nullColumns.length ? 'warn' : 'pass',
    checkedCount: rows.length,
    affectedCount: nullColumns.reduce((sum, item) => sum + item.affected, 0),
    columns: nullColumns.map((item) => item.column),
    examples: nullColumns.slice(0, 5),
    explanation: nullColumns.length ? 'Some columns contain missing values; affected rows are not silently treated as zero.' : 'No missing values were detected in the supplied rows.',
  });

  const fingerprints = new Map();
  rows.forEach((row) => {
    const fingerprint = JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== '__row_number')));
    fingerprints.set(fingerprint, (fingerprints.get(fingerprint) || 0) + 1);
  });
  const exactDuplicateRows = [...fingerprints.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
  const keyColumns = schema.filter((column) => /(^id$|_id$|^sku$|code|school_name|email|business_key)/i.test(column.name));
  const businessKeyExamples = [];
  let businessKeyDuplicateRows = 0;
  for (const column of keyColumns) {
    const values = new Map();
    rows.forEach((row, index) => {
      if (isNullish(row[column.name])) return;
      const value = String(row[column.name]).trim().toLowerCase();
      values.set(value, [...(values.get(value) || []), row.__row_number ?? index + 1]);
    });
    for (const [value, rowNumbers] of values) {
      if (rowNumbers.length > 1) {
        businessKeyDuplicateRows += rowNumbers.length - 1;
        businessKeyExamples.push({ column: column.name, value, rows: rowNumbers });
      }
    }
  }
  const duplicateRows = Math.max(exactDuplicateRows, businessKeyDuplicateRows);
  checks.push({
    code: 'EXACT_DUPLICATES',
    severity: duplicateRows ? 'warning' : 'info',
    status: duplicateRows ? 'warn' : 'pass',
    checkedCount: rows.length,
    affectedCount: duplicateRows,
    columns: [...new Set(businessKeyExamples.map((item) => item.column))],
    examples: businessKeyExamples.slice(0, 5),
    explanation: duplicateRows ? `${duplicateRows} exact or likely business-key duplicate row(s) were detected. They remain in the source population.` : 'No exact or likely business-key duplicate rows were detected.',
  });

  const suspiciousNegative = [];
  for (const column of schema) {
    if (!/(enrollment|count|quantity|units|headcount|students?)/i.test(column.name)) continue;
    rows.forEach((row, index) => {
      const value = numberValue(row, column.name);
      if (value !== null && value < 0) suspiciousNegative.push({ row: row.__row_number ?? index + 1, column: column.name, value });
    });
  }
  checks.push({
    code: 'DOMAIN_RANGE',
    severity: suspiciousNegative.length ? 'error' : 'info',
    status: suspiciousNegative.length ? 'fail' : 'pass',
    checkedCount: rows.length,
    affectedCount: suspiciousNegative.length,
    columns: [...new Set(suspiciousNegative.map((item) => item.column))],
    examples: suspiciousNegative.slice(0, 5),
    explanation: suspiciousNegative.length ? 'A count-like field contains a negative value. It is excluded from comparison results and disclosed.' : 'No negative values were found in count-like fields.',
  });

  const dateColumns = schema.filter((column) => /date|year|time/i.test(column.name));
  const invalidDates = [];
  dateColumns.forEach((column) => rows.forEach((row, index) => {
    const value = row[column.name];
    if (!isNullish(value) && Number.isNaN(Date.parse(String(value))) && !/^\d{4}$/.test(String(value))) {
      invalidDates.push({ row: row.__row_number ?? index + 1, column: column.name, value });
    }
  }));
  checks.push({
    code: 'INVALID_DATES',
    severity: invalidDates.length ? 'warning' : 'info',
    status: invalidDates.length ? 'warn' : 'pass',
    checkedCount: rows.length,
    affectedCount: invalidDates.length,
    columns: [...new Set(invalidDates.map((item) => item.column))],
    examples: invalidDates.slice(0, 5),
    explanation: invalidDates.length ? 'Some date-like values cannot be parsed consistently.' : 'Date-like values are parseable or were not present.',
  });

  return { checks, score: calculateConfidence(checks, rows.length).score };
}

export function resolveRelativeYear(question, now = new Date()) {
  const text = question.toLowerCase();
  const explicit = [...text.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  // For period-over-period analysis, the later explicit year is the current
  // period even when the user phrases the request as “from 2023 to 2022”.
  // This keeps a decline comparison grounded in the available chronology.
  if (explicit.length >= 2) return { kind: 'comparison', current: Math.max(explicit[0], explicit[1]), previous: Math.min(explicit[0], explicit[1]), source: 'explicit' };
  if (text.includes('last year') || text.includes('previous year') || text.includes('year over year')) {
    const current = now.getFullYear() - 1;
    return { kind: 'comparison', current, previous: current - 1, source: 'relative' };
  }
  return null;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function columnMentioned(question, columnName) {
  const text = String(question || '').toLowerCase();
  const name = String(columnName || '').toLowerCase();
  const spaced = name.replaceAll('_', ' ');
  if (text.includes(name) || (spaced !== name && text.includes(spaced))) return true;
  const words = new Set(text.split(/[^a-z0-9]+/i).filter(Boolean));
  const meaningfulTokens = name.split('_').filter((token) => token.length >= 3 && !['score', 'value', 'count', 'number', 'total', 'data'].includes(token));
  return meaningfulTokens.some((token) => words.has(token));
}

function requestedNumericColumn(question, schema) {
  const numeric = schema.filter((column) => column.type === 'integer' || column.type === 'decimal');
  const exact = numeric.filter((column) => {
    const text = String(question || '').toLowerCase();
    const name = String(column.name || '').toLowerCase();
    const spaced = name.replaceAll('_', ' ');
    return text.includes(name) || (spaced !== name && text.includes(spaced));
  });
  if (exact.length === 1) return exact[0];
  const tokenMatches = numeric.filter((column) => columnMentioned(question, column.name));
  return tokenMatches.length === 1 ? tokenMatches[0] : numeric.length === 1 ? numeric[0] : null;
}

function findYearColumns(schema, prefix) {
  return schema
    .map((column) => column.name)
    .map((name) => ({ name, year: Number(name.match(new RegExp(`^${prefix}_(\\d{4})$`, 'i'))?.[1]) }))
    .filter((item) => Number.isInteger(item.year));
}

export function validateSql(sql, schemaNames = []) {
  const text = String(sql || '').trim();
  const lower = text.toLowerCase();
  const errors = [];
  if (!text) errors.push('SQL is empty.');
  if (text.includes(';')) errors.push('Multiple statements are not allowed.');
  if (!/^(select|with)\b/i.test(text)) errors.push('Only SELECT or WITH statements are allowed.');
  if (/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|pg_sleep)\b/i.test(text)) errors.push('The statement contains a blocked operation.');
  if (text.includes('--') || text.includes('/*') || text.includes('*/')) errors.push('SQL comments are not accepted in generated statements.');
  if (/\b(pg_read_file|lo_import|dblink|http_get|set_config)\s*\(/i.test(text)) errors.push('The statement contains a blocked side-effect or network function.');
  const identifiers = [...text.matchAll(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g)].map((match) => match[1]);
  const allowed = new Set(schemaNames);
  for (const identifier of identifiers) {
    const isGeneratedAggregateAlias = ['avg_', 'sum_'].some((prefix) => identifier.startsWith(prefix) && allowed.has(identifier.slice(prefix.length)));
    if (!allowed.has(identifier) && !['schools', 'dataset', 'decline_percent', 'count', 'sum', 'avg'].includes(identifier) && !isGeneratedAggregateAlias) {
      errors.push(`Identifier ${identifier} is not present in the authorized schema.`);
    }
  }
  return { safe: errors.length === 0, errors };
}

export function buildPlan(question, schema, now = new Date()) {
  const text = String(question || '').trim();
  const lower = text.toLowerCase();
  if (!text) return { status: 'needs_clarification', clarification: 'Ask a question about the selected dataset.' };
  const schemaNames = schema.map((column) => column.name);
  const year = resolveRelativeYear(text, now);
  const enrollmentColumns = findYearColumns(schema, 'enrollment');
  const isDecline = /(fall|declin|decreas|drop|lower)/i.test(text) && /(enrollment|student|count)/i.test(text);

  if (isDecline) {
    if (!year) return { status: 'needs_clarification', clarification: 'Which two years should be compared?', assumptions: [] };
    const currentColumn = `enrollment_${year.current}`;
    const previousColumn = `enrollment_${year.previous}`;
    if (!schemaNames.includes(currentColumn) || !schemaNames.includes(previousColumn)) {
      return {
        status: 'needs_clarification',
        clarification: `The question resolves to ${year.current} versus ${year.previous}, but the dataset does not contain both enrollment columns. Available year columns: ${enrollmentColumns.map((item) => item.name).join(', ') || 'none'}.`,
        resolvedTimeRange: year,
      };
    }
    const label = schemaNames.find((name) => /school|name|label|entity/i.test(name)) || schemaNames[0];
    const sql = `SELECT ${quoteIdentifier(label)}, ${quoteIdentifier(currentColumn)}, ${quoteIdentifier(previousColumn)}, ROUND(((${quoteIdentifier(previousColumn)} - ${quoteIdentifier(currentColumn)}) / NULLIF(${quoteIdentifier(previousColumn)}, 0)) * 100, 2) AS "decline_percent" FROM "schools" WHERE ${quoteIdentifier(currentColumn)} IS NOT NULL AND ${quoteIdentifier(previousColumn)} IS NOT NULL AND ${quoteIdentifier(currentColumn)} >= 0 AND ${quoteIdentifier(previousColumn)} >= 0 AND ${quoteIdentifier(currentColumn)} < ${quoteIdentifier(previousColumn)} ORDER BY "decline_percent" DESC`;
    return { status: 'ready', kind: 'comparison', sql, label, currentColumn, previousColumn, resolvedTimeRange: year, schemaNames };
  }

  const numeric = requestedNumericColumn(text, schema);
  const label = schemaNames.find((name) => /name|label|category|school|product/i.test(name));
  if (/\b(how many|count|number of)\b/i.test(lower)) {
    const sql = `SELECT COUNT(*) AS "count" FROM "schools"`;
    return { status: 'ready', kind: 'count', sql, schemaNames };
  }
  if (numeric && /\b(total|sum|revenue|sales|amount|value)\b/i.test(lower)) {
    const sql = `SELECT SUM(${quoteIdentifier(numeric.name)}) AS "sum_${numeric.name}" FROM "schools"`;
    return { status: 'ready', kind: 'sum', measure: numeric.name, sql, schemaNames };
  }
  if (numeric && /\b(average|avg|mean)\b/i.test(lower)) {
    const sql = `SELECT AVG(${quoteIdentifier(numeric.name)}) AS "avg_${numeric.name}" FROM "schools"`;
    return { status: 'ready', kind: 'average', measure: numeric.name, sql, schemaNames };
  }
  if (label && numeric && /\b(top|highest|largest|best)\b/i.test(lower)) {
    const sql = `SELECT ${quoteIdentifier(label)}, ${quoteIdentifier(numeric.name)} FROM "schools" ORDER BY ${quoteIdentifier(numeric.name)} DESC LIMIT 10`;
    return { status: 'ready', kind: 'top', label, measure: numeric.name, sql, schemaNames };
  }
  return {
    status: 'needs_clarification',
    clarification: 'I could not map that question to a supported filter, aggregate, ranking, or comparison. Try asking for a count, total, average, top values, or an explicit year-over-year comparison.',
    schemaNames,
  };
}

export function buildPlanFromInterpretation(question, schema, interpretation, now = new Date()) {
  const schemaNames = schema.map((column) => column.name);
  const assumptions = Array.isArray(interpretation?.assumptions) ? interpretation.assumptions : [];
  if (!interpretation || interpretation.status === 'unsupported' || interpretation.kind === 'unsupported') {
    return {
      status: 'needs_clarification',
      clarification: interpretation?.clarification || 'I could not safely map that question to the authorized schema.',
      assumptions,
      schemaNames,
    };
  }
  if (interpretation.status === 'needs_clarification') {
    return { status: 'needs_clarification', clarification: interpretation.clarification || 'Please clarify the requested metric, dimension, or time period.', assumptions, schemaNames };
  }

  if (interpretation.kind === 'answer') {
    return {
      status: 'ready',
      kind: 'answer',
      answer: interpretation.answer || 'The provider returned a direct answer without a SQL trace.',
      assumptions,
      schemaNames,
    };
  }

  if (interpretation.kind === 'comparison') {
    const relative = resolveRelativeYear(question, now);
    const currentYear = interpretation.currentYear || relative?.current;
    const previousYear = interpretation.previousYear || relative?.previous;
    if (!currentYear || !previousYear) return { status: 'needs_clarification', clarification: 'Which two years should be compared?', assumptions, schemaNames };
    const currentColumn = `enrollment_${currentYear}`;
    const previousColumn = `enrollment_${previousYear}`;
    if (!schemaNames.includes(currentColumn) || !schemaNames.includes(previousColumn)) {
      return { status: 'needs_clarification', clarification: `The requested comparison resolves to ${currentYear} versus ${previousYear}, but the authorized schema does not contain both enrollment columns.`, assumptions, resolvedTimeRange: { kind: 'comparison', current: currentYear, previous: previousYear, source: 'gemini' }, schemaNames };
    }
    const label = schemaNames.includes(interpretation.label) ? interpretation.label : schemaNames.find((name) => /school|name|label|entity/i.test(name)) || schemaNames[0];
    const sql = `SELECT ${quoteIdentifier(label)}, ${quoteIdentifier(currentColumn)}, ${quoteIdentifier(previousColumn)}, ROUND(((${quoteIdentifier(previousColumn)} - ${quoteIdentifier(currentColumn)}) / NULLIF(${quoteIdentifier(previousColumn)}, 0)) * 100, 2) AS "decline_percent" FROM "schools" WHERE ${quoteIdentifier(currentColumn)} IS NOT NULL AND ${quoteIdentifier(previousColumn)} IS NOT NULL AND ${quoteIdentifier(currentColumn)} >= 0 AND ${quoteIdentifier(previousColumn)} >= 0 AND ${quoteIdentifier(currentColumn)} < ${quoteIdentifier(previousColumn)} ORDER BY "decline_percent" DESC`;
    return { status: 'ready', kind: 'comparison', sql, label, currentColumn, previousColumn, resolvedTimeRange: { kind: 'comparison', current: currentYear, previous: previousYear, source: 'gemini' }, assumptions, schemaNames };
  }

  if (interpretation.kind === 'count') {
    return { status: 'ready', kind: 'count', sql: 'SELECT COUNT(*) AS "count" FROM "schools"', assumptions, schemaNames };
  }

  const explicitMeasure = requestedNumericColumn(question, schema);
  const interpretedMeasure = schema.find((column) => column.name === interpretation.measure && (column.type === 'integer' || column.type === 'decimal'));
  const measure = explicitMeasure || interpretedMeasure;
  if (interpretation.kind === 'sum' || interpretation.kind === 'average' || interpretation.kind === 'top') {
    if (!measure) return { status: 'needs_clarification', clarification: 'Which authorized numeric column should be used for that calculation?', assumptions, schemaNames };
    const label = schemaNames.includes(interpretation.label) ? interpretation.label : schemaNames.find((name) => /name|label|category|school|product/i.test(name));
    if (interpretation.kind === 'sum') return { status: 'ready', kind: 'sum', measure: measure.name, sql: `SELECT SUM(${quoteIdentifier(measure.name)}) AS "sum_${measure.name}" FROM "schools"`, assumptions, schemaNames };
    if (interpretation.kind === 'average') return { status: 'ready', kind: 'average', measure: measure.name, sql: `SELECT AVG(${quoteIdentifier(measure.name)}) AS "avg_${measure.name}" FROM "schools"`, assumptions, schemaNames };
    if (!label) return { status: 'needs_clarification', clarification: 'Which authorized label column should identify the ranked rows?', assumptions, schemaNames };
    return { status: 'ready', kind: 'top', label, measure: measure.name, sql: `SELECT ${quoteIdentifier(label)}, ${quoteIdentifier(measure.name)} FROM "schools" ORDER BY ${quoteIdentifier(measure.name)} DESC LIMIT 10`, assumptions, schemaNames };
  }

  return { status: 'needs_clarification', clarification: 'The requested operation is not supported for this dataset yet.', assumptions, schemaNames };
}

export function executePlan(plan, rows) {
  if (plan.status !== 'ready') return { rows: [], answer: null, coverage: { matched: 0, total: rows.length } };
  if (plan.kind === 'answer') return { rows: plan.rows || [], answer: plan.answer || 'No answer was returned.', coverage: { matched: rows.length, total: rows.length } };
  if (plan.kind === 'comparison') {
    const eligibleRows = rows.filter((row) => {
      const current = numberValue(row, plan.currentColumn);
      const previous = numberValue(row, plan.previousColumn);
      return current !== null && previous !== null && current >= 0 && previous >= 0;
    });
    const eligible = eligibleRows.filter((row) => numberValue(row, plan.currentColumn) < numberValue(row, plan.previousColumn)).map((row) => {
      const current = numberValue(row, plan.currentColumn);
      const previous = numberValue(row, plan.previousColumn);
      return {
        [plan.label]: row[plan.label],
        [plan.previousColumn]: previous,
        [plan.currentColumn]: current,
        decline_percent: Number((((previous - current) / previous) * 100).toFixed(2)),
      };
    }).sort((a, b) => b.decline_percent - a.decline_percent);
    const answer = eligible.length
      ? `Found ${eligible.length} ${plan.label.replaceAll('_', ' ')}(s) with falling values from ${plan.resolvedTimeRange.previous} to ${plan.resolvedTimeRange.current}.`
      : `No valid ${plan.label.replaceAll('_', ' ')} records show a decline for the selected years.`;
    return { rows: eligible, answer, coverage: { matched: eligible.length, total: rows.length, eligible: eligibleRows.length } };
  }
  if (plan.kind === 'count') return { rows: [{ count: rows.length }], answer: `There are ${rows.length} rows in this dataset.`, coverage: { matched: rows.length, total: rows.length } };
  if (plan.kind === 'sum' || plan.kind === 'average') {
    const values = rows.map((row) => numberValue(row, plan.measure)).filter((value) => value !== null);
    if (!values.length) return { rows: [], answer: `There are no numeric values available in ${plan.measure}.`, coverage: { matched: 0, total: rows.length } };
    const value = plan.kind === 'sum' ? values.reduce((sum, item) => sum + item, 0) : values.reduce((sum, item) => sum + item, 0) / values.length;
    const key = `${plan.kind === 'sum' ? 'sum' : 'avg'}_${plan.measure}`;
    return { rows: [{ [key]: Number(value.toFixed(2)) }], answer: `${plan.kind === 'sum' ? 'The total' : 'The average'} of ${plan.measure.replaceAll('_', ' ')} is ${Number(value.toFixed(2)).toLocaleString()}.`, coverage: { matched: values.length, total: rows.length } };
  }
  if (plan.kind === 'top') {
    const sorted = rows.map((row) => ({ [plan.label]: row[plan.label], [plan.measure]: numberValue(row, plan.measure) })).filter((row) => row[plan.measure] !== null).sort((a, b) => b[plan.measure] - a[plan.measure]).slice(0, 10);
    return { rows: sorted, answer: sorted.length ? `The highest ${plan.measure.replaceAll('_', ' ')} values are shown below.` : 'No numeric values are available for that ranking.', coverage: { matched: sorted.length, total: rows.length } };
  }
  return { rows: [], answer: null, coverage: { matched: 0, total: rows.length } };
}

function visibleRows(rows) {
  return rows.slice(0, 25).map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== '__row_number')));
}

function columnLabel(column) {
  return String(column || '').replaceAll('_', ' ');
}

function chooseColumn(question, schema, predicate = () => true) {
  const lower = question.toLowerCase();
  return schema.find((column) => predicate(column) && lower.includes(column.name.toLowerCase()))
    || schema.find((column) => predicate(column) && lower.includes(column.name.replaceAll('_', ' ').toLowerCase()))
    || schema.find(predicate);
}

function answerTable(rows, column, limit = 25) {
  return rows.slice(0, limit).map((row) => ({ [column]: row[column] }));
}

export function buildLocalAnswer(question, schema, rows) {
  const text = String(question || '').trim();
  const lower = text.toLowerCase();
  const schemaNames = schema.map((column) => column.name);
  const assumptions = ['Gemini was unavailable, so this answer was computed locally from the uploaded rows.'];
  if (!text) return { status: 'needs_clarification', clarification: 'Ask a question about the selected dataset.', assumptions, schemaNames };

  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(lower)) {
    return { status: 'ready', kind: 'answer', answer: 'Hello! I am Schema.ai. I can chat with you normally and help you understand the attached data when you want.', rows: [], assumptions: [], schemaNames };
  }

  if (/\bhow are you\b|\bhow is it going\b|\bhow do you feel\b/i.test(lower)) {
    return { status: 'ready', kind: 'answer', answer: 'I am doing well and ready to help. You can ask me a general question or ask me to analyze the uploaded data.', rows: [], assumptions: [], schemaNames };
  }

  if (/\b(thank you|thanks|thx)\b/i.test(lower)) {
    return { status: 'ready', kind: 'answer', answer: 'You are welcome! Ask me anything else whenever you are ready.', rows: [], assumptions: [], schemaNames };
  }

  if (/\b(who are you|what are you|your name)\b/i.test(lower)) {
    return { status: 'ready', kind: 'answer', answer: 'I am Schema.ai, your AI data assistant. I can answer conversational questions and analyze your local dataset with visible evidence.', rows: [], assumptions: [], schemaNames };
  }

  if (/\b(what can you do|what do you do|help|capabilities)\b/i.test(lower)) {
    return { status: 'ready', kind: 'answer', answer: 'I can answer general questions, inspect uploaded files, summarize rows and columns, find patterns, calculate metrics, and explain the evidence behind a result.', rows: [], assumptions: [], schemaNames };
  }

  if (/\b(how many|count|number of)\b/.test(lower) && /\b(rows?|records?|entries?)\b/.test(lower)) {
    return { status: 'ready', kind: 'answer', answer: `There are ${rows.length} rows in this dataset.`, rows: [{ count: rows.length }], assumptions, schemaNames };
  }

  if (/\b(show|list|display|see|view|give me|what are)\b/.test(lower) && /\b(all|rows?|records?|entries?)\b/.test(lower)) {
    return { status: 'ready', kind: 'answer', answer: `Here are the first ${Math.min(rows.length, 25)} rows from the dataset${rows.length > 25 ? ' (showing 25 of ' + rows.length + ')' : ''}.`, rows: visibleRows(rows), assumptions, schemaNames };
  }

  if (/\b(column|columns|field|fields|schema|headers?)\b/.test(lower)) {
    const output = schema.map((column) => ({ column: column.name, type: column.type, nullable: column.nullable }));
    return { status: 'ready', kind: 'answer', answer: `The dataset has ${schema.length} columns: ${schema.map((column) => columnLabel(column.name)).join(', ')}.`, rows: output, assumptions, schemaNames };
  }

  if (/\b(missing|null|blank|empty)\b/.test(lower)) {
    const output = schema.map((column) => ({ column: column.name, missing: rows.filter((row) => row[column.name] === null || row[column.name] === undefined || String(row[column.name]).trim() === '').length }));
    return { status: 'ready', kind: 'answer', answer: 'I counted missing or blank values in every column. The detailed counts are shown below.', rows: output, assumptions, schemaNames };
  }

  if (/\b(most common|most frequent|appears most|popular|frequent)\b/.test(lower)) {
    const column = chooseColumn(text, schema, (item) => item.type === 'text' || item.type === 'boolean');
    if (column) {
      const counts = new Map();
      rows.forEach((row) => { const value = row[column.name]; if (value !== null && value !== undefined && String(value).trim()) counts.set(String(value), (counts.get(String(value)) || 0) + 1); });
      const output = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([value, count]) => ({ [column.name]: value, count }));
      const winner = output[0];
      return { status: 'ready', kind: 'answer', answer: winner ? `The most frequent value in ${columnLabel(column.name)} is ${winner[column.name]} with ${winner.count} occurrence(s).` : `There are no non-empty values in ${columnLabel(column.name)}.`, rows: output, assumptions, schemaNames };
    }
  }

  if (/\b(distinct|unique|different)\b/.test(lower)) {
    const column = chooseColumn(text, schema);
    if (column) {
      const values = [...new Set(rows.map((row) => row[column.name]).filter((value) => value !== null && value !== undefined && String(value).trim()).map((value) => String(value)))].sort();
      return { status: 'ready', kind: 'answer', answer: `${columnLabel(column.name)} has ${values.length} distinct non-empty value(s).`, rows: values.slice(0, 100).map((value) => ({ [column.name]: value })), assumptions, schemaNames };
    }
  }

  if (/\b(highest|lowest|largest|smallest|maximum|minimum|max|min)\b/.test(lower)) {
    const column = chooseColumn(text, schema, (item) => item.type === 'integer' || item.type === 'decimal');
    if (column) {
      const values = rows.map((row) => ({ value: numberValue(row, column.name), row })).filter((item) => item.value !== null);
      if (values.length) {
        const highest = /\b(highest|largest|maximum|max)\b/.test(lower);
        values.sort((a, b) => highest ? b.value - a.value : a.value - b.value);
        return { status: 'ready', kind: 'answer', answer: `The ${highest ? 'highest' : 'lowest'} ${columnLabel(column.name)} is ${values[0].value}.`, rows: visibleRows([values[0].row]), assumptions, schemaNames };
      }
    }
  }

  if (/\b(summary|summarize|overview|describe)\b/.test(lower)) {
    const numeric = schema.filter((column) => column.type === 'integer' || column.type === 'decimal').map((column) => {
      const values = rows.map((row) => numberValue(row, column.name)).filter((value) => value !== null);
      return { column: column.name, non_empty: values.length, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, average: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null };
    });
    return { status: 'ready', kind: 'answer', answer: `This dataset contains ${rows.length} rows and ${schema.length} columns. Numeric column statistics are shown below.`, rows: numeric.length ? numeric : [{ rows: rows.length, columns: schema.length }], assumptions, schemaNames };
  }

  return {
    status: 'ready',
    kind: 'answer',
    answer: `I can help with that. The local fallback does not have enough context to answer this particular question, but I can still see ${rows.length} rows and ${schema.length} columns in the active file. Try rephrasing it, or ask me about the data and I will show the evidence I used.`,
    rows: visibleRows(rows),
    assumptions,
    schemaNames,
  };
}

export function calculateConfidence(checks, totalRows, coverage = null, assumptions = []) {
  const components = [];
  const deduction = (code, points, evidence) => components.push({ code, points, evidence });
  const nulls = checks.find((check) => check.code === 'NULL_VALUES');
  const duplicates = checks.find((check) => check.code === 'EXACT_DUPLICATES');
  const domain = checks.find((check) => check.code === 'DOMAIN_RANGE');
  const dates = checks.find((check) => check.code === 'INVALID_DATES');
  if (nulls?.affectedCount) deduction('missing_values', Math.min(30, Math.ceil((nulls.affectedCount / Math.max(1, totalRows)) * 30)), `${nulls.affectedCount} affected cell(s)`);
  if (duplicates?.affectedCount) deduction('duplicates', Math.min(25, Math.ceil((duplicates.affectedCount / Math.max(1, totalRows)) * 25)), `${duplicates.affectedCount} duplicate row(s)`);
  if (domain?.affectedCount) deduction('domain_range', 25, `${domain.affectedCount} invalid count-like value(s)`);
  if (dates?.affectedCount) deduction('invalid_dates', 15, `${dates.affectedCount} invalid date-like value(s)`);
  if (coverage && coverage.total > 0 && coverage.eligible !== undefined && coverage.eligible < coverage.total) deduction('comparison_coverage', Math.min(25, Math.ceil(((coverage.total - coverage.eligible) / coverage.total) * 25)), `${coverage.eligible} of ${coverage.total} rows had both comparison values`);
  if (assumptions.length) deduction('assumptions', Math.min(15, assumptions.length * 5), assumptions.join('; '));
  const score = Math.max(0, 100 - components.reduce((sum, item) => sum + item.points, 0));
  return { score, version: 'heuristic-v1', label: score >= 85 ? 'high' : score >= 65 ? 'medium' : 'low', components };
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
}
