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
  // Check if question mentions writing to a specific cell like "in K2" or "to K2" or "at K2"
  const cellMatch = question.match(/\b(?:in|to|at|into|write to|put in|place in|store in)\s+(?:cell\s+)?([A-Z]+\d+)\b/i);
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
  Logger.log('buildFormulaFromResult called with status=' + result.status + ', kind=' + result.kind);
  
  if (!result.kind) {
    Logger.log('No kind in result, cannot build formula');
    return null;
  }
  
  // Accept answered, answered_with_warnings, or ready
  if (result.status !== 'answered' && result.status !== 'answered_with_warnings' && result.status !== 'ready') {
    Logger.log('Status not acceptable for formula: ' + result.status);
    return null;
  }
  
  // Determine column letter from measure name (case-insensitive)
  if (!result.measure) {
    Logger.log('No measure in result, cannot determine column');
    return null;
  }
  
  const measureLower = result.measure.toLowerCase();
  const measureIndex = payload.headers.findIndex(function(h) { 
    return h.toLowerCase() === measureLower; 
  });
  
  Logger.log('Measure: ' + result.measure + ', Index: ' + measureIndex);
  Logger.log('Headers: ' + JSON.stringify(payload.headers));
  
  if (measureIndex < 0) {
    Logger.log('Measure not found in headers (case-insensitive search)');
    return null;
  }
  
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
      Logger.log('Using range: ' + rangeFormula);
    }
  }
  
  let formula = null;
  switch(result.kind) {
    case 'sum':
      formula = '=SUM(' + rangeFormula + ')';
      break;
    case 'average':
      formula = '=AVERAGE(' + rangeFormula + ')';
      break;
    case 'count':
      formula = '=COUNT(' + rangeFormula + ')';
      break;
    default:
      Logger.log('Kind not supported for formula: ' + result.kind);
      return null;
  }
  
  Logger.log('Built formula: ' + formula);
  return formula;
}

function askSchemaAiWithFormula(question, payload) {
  // Parse cell range from question (e.g., "F2 to F10" or "G2:G20")
  const rangeMatch = question.match(/([A-Z]+)(\d+)\s*(?:to|:)\s*([A-Z]+)?(\d+)/i);
  let specificRange = null;
  
  if (rangeMatch) {
    const col1 = rangeMatch[1];
    const row1 = rangeMatch[2];
    const col2 = rangeMatch[3] || col1;
    const row2 = rangeMatch[4];
    specificRange = col1 + row1 + ':' + col2 + row2;
    Logger.log('Detected specific range from question: ' + specificRange);
  }
  
  // Call the AI API
  try {
    const response = UrlFetchApp.fetch(apiBaseUrl_() + '/api/plugin/ask', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ source: 'sheets_selected_range_or_file', question: question, payload: payload }),
    });
    
    const result = JSON.parse(response.getContentText() || '{}');
    if (response.getResponseCode() >= 400) {
      throw new Error(result.error || 'Schema.ai request failed (' + response.getResponseCode() + ')');
    }
    
    // Build formula - use specific range if detected
    let formula = null;
    if (specificRange && result.kind) {
      // User specified exact range, build formula directly
      switch(result.kind) {
        case 'sum':
          formula = '=SUM(' + specificRange + ')';
          break;
        case 'average':
          formula = '=AVERAGE(' + specificRange + ')';
          break;
        case 'count':
          formula = '=COUNT(' + specificRange + ')';
          break;
      }
      Logger.log('Built formula with specific range: ' + formula);
    } else {
      // Use measure-based formula building
      formula = buildFormulaFromResult(result, payload);
    }
    
    if (formula) {
      result.formula = formula;
      Logger.log('Final formula: ' + formula);
    }
    
    // Get the calculated value from result
    if (result.rows && result.rows.length > 0 && result.rows[0].result !== undefined) {
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
