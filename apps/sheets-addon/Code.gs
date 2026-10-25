function apiBaseUrl_() {
  return PropertiesService.getScriptProperties().getProperty('SCHEMA_AI_API_BASE') || 'https://schemaai-delta.vercel.app';
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

function writeFormulaToCell(formula, cellAddress) {
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    const range = sheet.getRange(cellAddress);
    range.setFormula(formula);
    return `Formula written to ${cellAddress}: ${formula}`;
  } catch (error) {
    throw new Error(`Could not write to cell ${cellAddress}: ${error.message}`);
  }
}

function detectFormulaRequest(question) {
  // Check if question mentions writing to a specific cell like "in F12" or "to F12" or "at F12"
  const cellMatch = question.match(/\b(?:in|to|at|into|write to|put in)\s+([A-Z]+\d+)\b/i);
  if (cellMatch) {
    return {
      hasFormula: true,
      targetCell: cellMatch[1].toUpperCase(),
      cleanQuestion: question.replace(cellMatch[0], '').trim()
    };
  }
  return { hasFormula: false, targetCell: null, cleanQuestion: question };
}

function buildFormulaFromResult(result, payload) {
  // Build a Google Sheets formula based on the analysis result
  if (!result.kind || (result.status !== 'answered' && result.status !== 'answered_with_warnings')) {
    return null;
  }
  
  // Determine column letter from measure name
  const measureIndex = payload.headers.indexOf(result.measure);
  if (measureIndex < 0) return null;
  
  const columnLetter = String.fromCharCode(65 + measureIndex); // A=65
  
  // Parse the range to get first and last rows
  let rangeFormula = columnLetter + ':' + columnLetter; // Default to entire column
  
  if (payload.address) {
    // Try to parse range like "A1:G400"
    const match = payload.address.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (match) {
      const startRow = match[2];
      const endRow = match[4];
      rangeFormula = columnLetter + startRow + ':' + columnLetter + endRow;
    }
  }
  
  switch(result.kind) {
    case 'sum':
      return '=SUM(' + rangeFormula + ')';
    case 'average':
      return '=AVERAGE(' + rangeFormula + ')';
    case 'count':
      return '=COUNT(' + rangeFormula + ')';
    default:
      return null;
  }
}

function askSchemaAiWithFormula(question, payload) {
  // Detect if user wants to write formula to a cell
  const formulaRequest = detectFormulaRequest(question);
  const cleanQuestion = formulaRequest.cleanQuestion || question;
  
  Logger.log('Question: ' + question);
  Logger.log('Clean question: ' + cleanQuestion);
  Logger.log('Formula request: ' + JSON.stringify(formulaRequest));
  
  // Call the AI API
  try {
    const response = UrlFetchApp.fetch(apiBaseUrl_() + '/api/plugin/ask', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ source: 'sheets_selected_range_or_file', question: cleanQuestion, payload: payload }),
    });
    
    Logger.log('Response code: ' + response.getResponseCode());
    Logger.log('Response: ' + response.getContentText());
    
    const result = JSON.parse(response.getContentText() || '{}');
    if (response.getResponseCode() >= 400) {
      throw new Error(result.error || 'Schema.ai request failed (' + response.getResponseCode() + ')');
    }
    
    // Try to build a formula
    const formula = buildFormulaFromResult(result, payload);
    Logger.log('Built formula: ' + formula);
    
    if (formula) {
      result.formula = formula;
    }
    
    // If user specified a target cell and we have a formula, write it
    if (formulaRequest.hasFormula && formula && formulaRequest.targetCell) {
      try {
        const sheet = SpreadsheetApp.getActiveSheet();
        const range = sheet.getRange(formulaRequest.targetCell);
        range.setFormula(formula);
        result.formulaWritten = true;
        result.targetCell = formulaRequest.targetCell;
        Logger.log('Formula written to ' + formulaRequest.targetCell);
      } catch (error) {
        result.formulaError = 'Could not write to ' + formulaRequest.targetCell + ': ' + error.message;
        Logger.log('Formula write error: ' + error.message);
      }
    }
    
    // Add the calculated value to the result
    if (result.resultValue !== undefined) {
      result.resultValue = result.resultValue;
    } else if (result.rows && result.rows.length > 0 && result.rows[0].result !== undefined) {
      result.resultValue = result.rows[0].result;
    }
    
    return result;
  } catch (error) {
    Logger.log('Error: ' + error.message);
    throw error;
  }
}

function writePayloadToSheet(payload) {
  if (!payload || !Array.isArray(payload.headers) || !Array.isArray(payload.rows)) throw new Error('No imported file or selected range is ready.');
  const values = [payload.headers].concat(payload.rows);
  const sheet = SpreadsheetApp.getActiveSheet();
  sheet.getRange(1, 1, values.length, payload.headers.length).setValues(values);
  return `${values.length - 1} rows × ${payload.headers.length} columns written to ${sheet.getName()} starting at A1.`;
}
