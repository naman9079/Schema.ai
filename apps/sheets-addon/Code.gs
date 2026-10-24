function apiBaseUrl_() {
  return PropertiesService.getScriptProperties().getProperty('SCHEMA_AI_API_BASE') || 'https://YOUR-VERCEL-DOMAIN.vercel.app';
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Schema.ai').addItem('Open analyst sidebar', 'showSidebar').addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('sidebar').setTitle('Schema.ai');
  SpreadsheetApp.getUi().showSidebar(html);
}

function getSelectedRangePayload() {
  const range = SpreadsheetApp.getActiveRange();
  if (!range) throw new Error('Select a non-empty range first.');
  const values = range.getDisplayValues();
  if (!values.length || !values[0].length || values.length < 2) throw new Error('Select a header row and at least one data row.');
  return { address: range.getA1Notation(), headers: values[0], rows: values.slice(1) };
}

function askSchemaAi(question, payload) {
  const response = UrlFetchApp.fetch(`${apiBaseUrl_()}/api/plugin/ask`, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ source: 'sheets_selected_range_or_file', question, payload }),
  });
  const body = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() >= 400) throw new Error(body.error || `Schema.ai request failed (${response.getResponseCode()})`);
  return body;
}

function writePayloadToSheet(payload) {
  if (!payload || !Array.isArray(payload.headers) || !Array.isArray(payload.rows)) throw new Error('No imported file or selected range is ready.');
  const values = [payload.headers].concat(payload.rows);
  const sheet = SpreadsheetApp.getActiveSheet();
  sheet.getRange(1, 1, values.length, payload.headers.length).setValues(values);
  return `${values.length - 1} rows × ${payload.headers.length} columns written to ${sheet.getName()} starting at A1.`;
}
