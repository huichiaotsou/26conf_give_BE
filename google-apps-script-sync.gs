/**
 * Google Apps Script for syncing backend `/getall` data into Google Sheets.
 *
 * Setup:
 * 1. Open Apps Script from your target Google Sheet.
 * 2. Paste this file into the editor.
 * 3. In Apps Script, go to Project Settings -> Script Properties and add:
 *    - GOOGLE_SECRET: same value as backend env GOOGLE_SECRET
 *    - BACKEND_API_URL: full endpoint, e.g. https://your-domain.com/api/getall
 *    - SHEET_NAME: optional, defaults to "donations"
 * 4. Run `syncGivingData` once manually to authorize.
 * 5. Optional: add a time-driven trigger for `syncGivingData`.
 */

const DEFAULT_SHEET_NAME = 'donations';
const HEADER = [
  'id',
  'name',
  'amount',
  'currency',
  'date',
  'phone_number',
  'email',
  'receipt',
  'paymenttype',
  'upload',
  'receiptname',
  'nationalid',
  'company',
  'taxid',
  'note',
  'campus',
  'tp_trade_id',
  'is_success',
  'env',
  'imported',
  'siyuan_id',
  'created_at',
];

function syncGivingData() {
  const props = PropertiesService.getScriptProperties();
  const googleSecret = props.getProperty('GOOGLE_SECRET');
  const apiUrl = props.getProperty('BACKEND_API_URL');
  const sheetName = props.getProperty('SHEET_NAME') || DEFAULT_SHEET_NAME;

  if (!googleSecret) {
    throw new Error('Missing Script Property: GOOGLE_SECRET');
  }
  if (!apiUrl) {
    throw new Error('Missing Script Property: BACKEND_API_URL');
  }

  const sheet = getOrCreateSheet_(sheetName);
  ensureHeader_(sheet);

  const lastRowId = getLastRowId_(sheet);
  const rows = fetchGivingRows_(apiUrl, googleSecret, lastRowId);

  if (!rows.length) {
    Logger.log('No new rows.');
    return;
  }

  const values = rows.map(mapRowToSheetValues_);
  sheet
    .getRange(sheet.getLastRow() + 1, 1, values.length, HEADER.length)
    .setValues(values);

  Logger.log('Appended %s rows.', values.length);
}

function fetchGivingRows_(apiUrl, googleSecret, lastRowID) {
  const response = UrlFetchApp.fetch(apiUrl, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      googleSecret: googleSecret,
      lastRowID: lastRowID,
    }),
  });

  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('API request failed: ' + status + ' ' + text);
  }

  const json = JSON.parse(text);
  if (!json || !Array.isArray(json.data)) {
    throw new Error('Unexpected API response: ' + text);
  }

  return json.data;
}

function getOrCreateSheet_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    return;
  }

  const existingHeader = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0];
  const headerMatches = HEADER.every(function(column, index) {
    return existingHeader[index] === column;
  });

  if (!headerMatches) {
    throw new Error('Sheet header does not match expected backend columns.');
  }
}

function getLastRowId_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return 0;
  }

  const lastId = sheet.getRange(lastRow, 1).getValue();
  return Number(lastId) || 0;
}

function mapRowToSheetValues_(row) {
  return [
    row.id || '',
    row.name || '',
    row.amount || '',
    row.currency || '',
    row.date || '',
    row.phone_number || '',
    row.email || '',
    normalizeBoolean_(row.receipt),
    row.paymenttype || '',
    row.upload || '',
    row.receiptname || '',
    row.nationalid || '',
    row.company || '',
    row.taxid || '',
    row.note || '',
    row.campus || '',
    row.tp_trade_id || '',
    normalizeBoolean_(row.is_success),
    row.env || '',
    normalizeBoolean_(row.imported),
    row.siyuan_id || '',
    row.created_at || '',
  ];
}

function normalizeBoolean_(value) {
  if (value === true) return 'TRUE';
  if (value === false) return 'FALSE';
  return value || '';
}
