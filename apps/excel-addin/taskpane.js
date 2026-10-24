(function () {
  const apiBase = window.DATAPILOT_API_BASE_URL || window.location.origin;
  let payload = null;
  let sourceLabel = '';
  const status = document.getElementById('status');
  const askButton = document.getElementById('ask');
  const writeButton = document.getElementById('write');
  const question = document.getElementById('question');
  const fileInput = document.getElementById('file-input');

  function message(text, warning) {
    status.textContent = text;
    status.className = warning ? 'warning' : '';
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (char === '"' && quoted && next === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { row.push(field); field = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') index += 1; row.push(field); if (row.some((cell) => cell.trim())) rows.push(row); row = []; field = ''; }
      else field += char;
    }
    if (field || row.length) { row.push(field); if (row.some((cell) => cell.trim())) rows.push(row); }
    if (rows.length < 2) throw new Error('The file needs a header row and at least one data row.');
    const headers = rows[0].map((value, index) => String(value || `column_${index + 1}`).trim());
    return { headers, rows: rows.slice(1) };
  }

  function setPayload(next, label) {
    payload = next;
    sourceLabel = label;
    askButton.disabled = false;
    writeButton.disabled = false;
    message(`${label}: ${payload.rows.length} data rows × ${payload.headers.length} columns. Review before sending.`, true);
  }

  async function readSelection() {
    if (!window.Excel) throw new Error('Open this task pane inside Excel.');
    await Excel.run(async (context) => {
      const range = context.workbook.getSelectedRange();
      range.load(['values', 'rowCount', 'columnCount', 'address']);
      await context.sync();
      if (!range.values.length || !range.values[0]?.length) throw new Error('Select a non-empty range.');
      const headers = range.values[0].map((value, index) => String(value || `column_${index + 1}`));
      setPayload({ headers, rows: range.values.slice(1) }, range.address);
    });
  }

  async function importFile(file) {
    const extension = file.name.toLowerCase().split('.').pop();
    if (extension === 'json') {
      const value = JSON.parse(await file.text());
      if (!Array.isArray(value) || !value.length || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('JSON files must be a non-empty array of objects.');
      const headers = [...new Set(value.flatMap((row) => Object.keys(row)))];
      setPayload({ headers, rows: value.map((row) => headers.map((header) => row[header] ?? null)) }, file.name);
      return;
    }
    if (extension !== 'csv' && extension !== 'txt') throw new Error('Import a CSV, TXT, or JSON file downloaded from Schema.ai.');
    setPayload(parseCsv(await file.text()), file.name);
  }

  async function writePayloadToSheet() {
    if (!payload) return;
    await Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      const values = [payload.headers, ...payload.rows];
      const range = sheet.getRangeByIndexes(0, 0, values.length, payload.headers.length);
      range.values = values;
      await context.sync();
    });
    message(`${sourceLabel} was written to the active worksheet starting at A1.`, false);
  }

  document.getElementById('preview').addEventListener('click', () => readSelection().catch((error) => message(error.message, true)));
  fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) importFile(file).catch((error) => message(error.message, true)); });
  writeButton.addEventListener('click', () => { if (window.confirm(`Write ${sourceLabel} into the active worksheet starting at A1?`)) writePayloadToSheet().catch((error) => message(error.message, true)); });
  askButton.addEventListener('click', async () => {
    if (!payload) return message('Preview a range or import a file first.', true);
    const text = question.value.trim();
    if (!text) return message('Enter a question first.', true);
    if (!window.confirm(`Send only ${sourceLabel} to Schema.ai?`)) return;
    try {
      const response = await fetch(`${apiBase}/api/plugin/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, source: 'excel_selected_range_or_file', payload }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Schema.ai request failed (${response.status}).`);
      message(result.answer || result.clarification || result.message || 'Schema.ai returned no answer.', false);
    } catch (error) { message(error.message, true); }
  });
}());
