(function () {
  const apiBase = window.DATAPILOT_API_BASE_URL || 'https://your-datapilot-api.example.com';
  let selection = null;
  const status = document.getElementById('status');
  const askButton = document.getElementById('ask');
  const question = document.getElementById('question');

  function message(text, warning) {
    status.textContent = text;
    status.className = warning ? 'warning' : '';
  }

  async function readSelection() {
    if (!window.Excel) throw new Error('Open this task pane inside Excel.');
    await Excel.run(async (context) => {
      const range = context.workbook.getSelectedRange();
      range.load(['values', 'rowCount', 'columnCount', 'address']);
      await context.sync();
      selection = { values: range.values, rowCount: range.rowCount, columnCount: range.columnCount, address: range.address };
    });
    if (!selection.values.length || !selection.values[0]?.length) throw new Error('Select a non-empty range.');
    const headers = selection.values[0].map((value, index) => String(value || `column_${index + 1}`));
    message(`${selection.address}: ${selection.rowCount} rows × ${selection.columnCount} columns. Review before sending.`, true);
    askButton.disabled = false;
    return { headers, rows: selection.values.slice(1) };
  }

  document.getElementById('preview').addEventListener('click', () => readSelection().catch((error) => message(error.message, true)));
  askButton.addEventListener('click', async () => {
    if (!selection) return;
    const text = question.value.trim();
    if (!text) return message('Enter a question first.', true);
    if (!window.confirm(`Send only the selected range (${selection.address}) to DataPilot?`)) return;
    try {
      const payload = await readSelection();
      const response = await fetch(`${apiBase}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, source: 'excel_selected_range', payload }) });
      if (!response.ok) throw new Error(`DataPilot request failed (${response.status}).`);
      const result = await response.json();
      message(result.answer || result.clarification || 'DataPilot returned no answer.', false);
      // Result insertion is deliberately a separate, explicit step in the production adapter.
    } catch (error) { message(error.message, true); }
  });
}());
