import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan,
  buildLocalAnswer,
  buildPlanFromInterpretation,
  calculateConfidence,
  executePlan,
  inferSchema,
  parseCsv,
  profileRows,
  resolveRelativeYear,
  validateSql,
} from '../web/planner.mjs';

const schools = [
  { school_name: 'School A', enrollment_2022: 1000, enrollment_2023: 950, region: 'North' },
  { school_name: 'School B', enrollment_2022: 1200, enrollment_2023: 1100, region: 'South' },
  { school_name: 'School C', enrollment_2022: null, enrollment_2023: 1050, region: 'East' },
  { school_name: 'School D', enrollment_2022: 800, enrollment_2023: 900, region: 'West' },
  { school_name: 'School D', enrollment_2022: 800, enrollment_2023: 900, region: 'West' },
  { school_name: 'School E', enrollment_2022: -50, enrollment_2023: 40, region: 'Central' },
];

test('CSV parser preserves quoted commas and duplicate headers safely', () => {
  const parsed = parseCsv('Name,Name,Notes\nAlpha,1,"Hello, world"\nBeta,2,"line 1\nline 2"');
  assert.deepEqual(parsed.headers, ['name', 'name_2', 'notes']);
  assert.equal(parsed.rows[0].notes, 'Hello, world');
  assert.equal(parsed.rows[1].notes, 'line 1\nline 2');
});

test('schema inference detects nullable numeric columns', () => {
  const schema = inferSchema(schools);
  assert.equal(schema.find((column) => column.name === 'enrollment_2022').type, 'integer');
  assert.equal(schema.find((column) => column.name === 'enrollment_2022').nullable, true);
});

test('quality profile reports nulls, duplicates, and invalid count values', () => {
  const schema = inferSchema(schools);
  const profile = profileRows(schools, schema);
  assert.equal(profile.checks.find((check) => check.code === 'NULL_VALUES').status, 'warn');
  assert.equal(profile.checks.find((check) => check.code === 'EXACT_DUPLICATES').affectedCount, 1);
  assert.equal(profile.checks.find((check) => check.code === 'DOMAIN_RANGE').status, 'fail');
  assert.ok(profile.score < 100);
});

test('relative last year resolves against the injected clock', () => {
  assert.deepEqual(resolveRelativeYear('last year', new Date('2026-10-24T00:00:00Z')), { kind: 'comparison', current: 2025, previous: 2024, source: 'relative' });
  assert.deepEqual(resolveRelativeYear('compare 2023 with 2022', new Date('2026-10-24T00:00:00Z')), { kind: 'comparison', current: 2023, previous: 2022, source: 'explicit' });
});

test('planner asks for clarification when relative years are absent', () => {
  const plan = buildPlan('Which schools had falling enrollment last year?', inferSchema(schools), new Date('2026-10-24T00:00:00Z'));
  assert.equal(plan.status, 'needs_clarification');
  assert.match(plan.clarification, /2025 versus 2024|does not contain/i);
});

test('comparison planner generates safe SQL and grounded result rows', () => {
  const schema = inferSchema(schools);
  const plan = buildPlan('Which schools had falling enrollment from 2023 to 2022?', schema, new Date('2026-10-24T00:00:00Z'));
  assert.equal(plan.status, 'ready');
  assert.equal(validateSql(plan.sql, schema.map((column) => column.name)).safe, true);
  const result = executePlan(plan, schools);
  assert.deepEqual(result.rows.map((row) => row.school_name), ['School B', 'School A']);
  assert.equal(result.rows[0].decline_percent, 8.33);
  assert.equal(result.coverage.eligible, 4);
});

test('Gemini interpretation becomes a schema-bound comparison plan', () => {
  const schema = inferSchema(schools);
  const plan = buildPlanFromInterpretation('Which schools had falling enrollment?', schema, {
    status: 'ready',
    kind: 'comparison',
    label: 'school_name',
    currentYear: 2023,
    previousYear: 2022,
    assumptions: ['The question asks for a year-over-year comparison.'],
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.resolvedTimeRange.source, 'gemini');
  assert.match(plan.sql, /enrollment_2023/);
});

test('Gemini interpretation cannot invent a measure', () => {
  const schema = inferSchema(schools);
  const plan = buildPlanFromInterpretation('What is the average profit?', schema, {
    status: 'ready',
    kind: 'average',
    measure: 'profit',
    assumptions: [],
  });
  assert.equal(plan.status, 'needs_clarification');
  assert.match(plan.clarification, /authorized numeric column/i);
});

test('average questions use the explicitly requested numeric column', () => {
  const rows = [
    { serial_no: 1, gre: 310 },
    { serial_no: 2, gre: 290 },
  ];
  const schema = inferSchema(rows);
  const localPlan = buildPlan('What is the average of GRE?', schema);
  assert.equal(localPlan.status, 'ready');
  assert.equal(localPlan.measure, 'gre');
  assert.match(localPlan.sql, /AVG\("gre"\)/);

  const providerPlan = buildPlanFromInterpretation('What is the average of GRE?', schema, {
    status: 'ready',
    kind: 'average',
    measure: 'serial_no',
    assumptions: [],
  });
  assert.equal(providerPlan.status, 'ready');
  assert.equal(providerPlan.measure, 'gre');
  assert.match(providerPlan.sql, /AVG\("gre"\)/);
});

test('average questions match meaningful tokens in normalized headers', () => {
  const rows = [
    { serial_no: 1, gre_score: 310, toefl_score: 100 },
    { serial_no: 2, gre_score: 290, toefl_score: 105 },
  ];
  const plan = buildPlan('What is the average of GRE?', inferSchema(rows));
  assert.equal(plan.status, 'ready');
  assert.equal(plan.measure, 'gre_score');
  assert.match(plan.sql, /AVG\("gre_score"\)/);
});

test('local fallback answers non-numeric categorical questions', () => {
  const rows = [
    { region: 'North', school_name: 'A' },
    { region: 'North', school_name: 'B' },
    { region: 'South', school_name: 'C' },
  ];
  const plan = buildLocalAnswer('Which region appears most often?', inferSchema(rows), rows);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.kind, 'answer');
  assert.match(plan.answer, /North/);
  assert.equal(plan.rows[0].count, 2);
});

test('direct answer plans execute without requiring numeric columns or SQL', () => {
  const rows = [{ note: 'Ready' }, { note: 'Needs review' }];
  const plan = buildLocalAnswer('Show all rows', inferSchema(rows), rows);
  const result = executePlan(plan, rows);
  assert.equal(result.answer.startsWith('Here are'), true);
  assert.equal(result.rows.length, 2);
});

test('local fallback answers general conversation instead of returning a schema error', () => {
  const rows = [{ note: 'Ready' }];
  const plan = buildLocalAnswer('How are you?', inferSchema(rows), rows);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.kind, 'answer');
  assert.match(plan.answer, /ready to help/i);
});

test('SQL policy rejects multiple statements, writes, comments, and side effects', () => {
  const schema = ['school_name', 'enrollment_2022', 'enrollment_2023'];
  assert.equal(validateSql('SELECT "school_name" FROM "schools";', schema).safe, false);
  assert.equal(validateSql('DELETE FROM "schools"', schema).safe, false);
  assert.equal(validateSql('SELECT "school_name" FROM "schools" -- no', schema).safe, false);
  assert.equal(validateSql('SELECT pg_sleep(10)', schema).safe, false);
});

test('SQL policy allows aggregate aliases generated from authorized measures', () => {
  const schema = ['serial_no', 'amount'];
  assert.equal(validateSql('SELECT AVG("serial_no") AS "avg_serial_no" FROM "schools"', schema).safe, true);
  assert.equal(validateSql('SELECT SUM("amount") AS "sum_amount" FROM "schools"', schema).safe, true);
  assert.equal(validateSql('SELECT AVG("serial_no") AS "avg_secret" FROM "schools"', schema).safe, false);
});

test('confidence is deterministic and exposes deductions', () => {
  const checks = profileRows(schools, inferSchema(schools)).checks;
  const first = calculateConfidence(checks, schools.length, { total: 6, eligible: 5 }, []);
  const second = calculateConfidence(checks, schools.length, { total: 6, eligible: 5 }, []);
  assert.deepEqual(first, second);
  assert.ok(first.components.some((component) => component.code === 'missing_values'));
  assert.ok(first.components.some((component) => component.code === 'duplicates'));
});
