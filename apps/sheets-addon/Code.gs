function onOpen() {
  SpreadsheetApp.getUi().createMenu('DataPilot').addItem('Open analyst sidebar', 'showSidebar').addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('sidebar').setTitle('DataPilot');
  SpreadsheetApp.getUi().showSidebar(html);
}

function getSelectedRangePayload() {
  const range = SpreadsheetApp.getActiveRange();
  if (!range) throw new Error('Select a non-empty range first.');
  const values = range.getDisplayValues();
  if (!values.length || !values[0].length) throw new Error('Select a non-empty range first.');
  return { address: range.getA1Notation(), headers: values[0], rows: values.slice(1) };
}
