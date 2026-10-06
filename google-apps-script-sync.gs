/**
 * Google Apps Script for syncing backend `/getall` data into Google Sheets.
 *
 * Setup:
 * 1. Open Apps Script from your target Google Sheet.
 * 2. Paste this file into the editor.
 * 3. In Apps Script, go to Project Settings -> Script Properties and add:
 *    - GOOGLE_SECRET: same value as backend env GOOGLE_SECRET
 *    - BACKEND_API_URL: full endpoint, e.g. https://your-domain.com/api/getall
 *    - SHEET_NAME: optional, defaults to "giving"
 * 4. Reload the spreadsheet, then use「奉獻資料」→「建立資料匯出試算表」.
 * 5. Optional: add a time-driven trigger for `syncGivingData`.
 */

const DEFAULT_SHEET_NAME = "giving";
const HEADER = [
  "id",
  "name",
  "amount",
  "currency",
  "date",
  "phone_number",
  "email",
  "receipt",
  "paymenttype",
  "upload",
  "receiptname",
  "nationalid",
  "company",
  "taxid",
  "note",
  "campus",
  "tp_trade_id",
  "is_success",
  "env",
  "imported",
  "siyuan_id",
  "created_at",
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("奉獻資料")
    .addItem("建立資料匯出試算表", "showGivingExportDialog_")
    .addToUi();
}

function showGivingExportDialog_() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: Arial, sans-serif; padding: 8px; }
      label { display: block; font-weight: 600; margin-top: 14px; }
      input { box-sizing: border-box; margin-top: 6px; padding: 8px; width: 100%; }
      button { background: #1a73e8; border: 0; border-radius: 4px; color: white; cursor: pointer; margin-top: 20px; padding: 9px 14px; }
      #message { margin-top: 12px; }
    </style>
    <form id="export-form">
      <label for="sheetName">新分頁名稱</label>
      <input id="sheetName" maxlength="100" required autofocus placeholder="例如：2026 奉獻紀錄">
      <label for="startDate">抓取記錄開始日期</label>
      <input id="startDate" type="date" required>
      <button id="submit" type="submit">建立並匯入</button>
    </form>
    <div id="message" role="status"></div>
    <script>
      const form = document.getElementById('export-form');
      const submit = document.getElementById('submit');
      const message = document.getElementById('message');
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        submit.disabled = true;
        message.textContent = '正在建立分頁並匯入資料…';
        google.script.run
          .withSuccessHandler(function (result) {
            message.textContent = '已在「' + result.sheetName + '」分頁匯入 ' + result.rowCount + ' 筆資料。';
            google.script.host.close();
          })
          .withFailureHandler(function (error) {
            message.textContent = '匯出失敗：' + (error.message || error);
            submit.disabled = false;
          })
          .createGivingExportSpreadsheet_({
            sheetName: document.getElementById('sheetName').value,
            startDate: document.getElementById('startDate').value
          });
      });
    </script>
  `).setWidth(420).setHeight(310);

  SpreadsheetApp.getUi().showModalDialog(html, "匯出奉獻資料");
}

function createGivingExportSpreadsheet_(options) {
  const sheetName = String(options && options.sheetName || "").trim();
  const startDate = String(options && options.startDate || "").trim();

  if (!sheetName) {
    throw new Error("請輸入新分頁名稱。");
  }
  if (/[\\\\/:?*\[\]]/.test(sheetName)) {
    throw new Error("分頁名稱不可包含 \\ / : ? * [ 或 ]。");
  }
  if (!isValidDate_(startDate)) {
    throw new Error("開始日期必須是有效的 YYYY-MM-DD 日期。");
  }

  const props = PropertiesService.getScriptProperties();
  const googleSecret = props.getProperty("GOOGLE_SECRET");
  const apiUrl = props.getProperty("BACKEND_API_URL");
  if (!googleSecret || !apiUrl) {
    throw new Error("請先設定 GOOGLE_SECRET 與 BACKEND_API_URL Script Properties。");
  }

  const rows = fetchGivingRows_(apiUrl, googleSecret, 0, startDate);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (spreadsheet.getSheetByName(sheetName)) {
    throw new Error(`分頁「${sheetName}」已存在，請使用其他名稱。`);
  }
  const sheet = spreadsheet.insertSheet(sheetName);
  writeGivingRows_(sheet, rows);
  spreadsheet.setActiveSheet(sheet);

  return { sheetName: sheetName, rowCount: rows.length };
}

function syncGivingData() {
  const props = PropertiesService.getScriptProperties();
  const googleSecret = props.getProperty("GOOGLE_SECRET");
  const apiUrl = props.getProperty("BACKEND_API_URL");
  const sheetName = props.getProperty("SHEET_NAME") || DEFAULT_SHEET_NAME;

  if (!googleSecret) {
    throw new Error("Missing Script Property: GOOGLE_SECRET");
  }
  if (!apiUrl) {
    throw new Error("Missing Script Property: BACKEND_API_URL");
  }

  const sheet = getOrCreateSheet_(sheetName);
  ensureHeader_(sheet);

  const lastRowId = getLastRowId_(sheet);
  const rows = fetchGivingRows_(apiUrl, googleSecret, lastRowId);

  if (!rows.length) {
    Logger.log("No new rows.");
    return;
  }

  appendGivingRows_(sheet, rows);

  Logger.log("Appended %s rows.", values.length);
}

function fetchGivingRows_(apiUrl, googleSecret, lastRowID, startDate) {
  const payload = {
    googleSecret: googleSecret,
    lastRowID: lastRowID,
  };
  if (startDate) {
    payload.startDate = startDate;
  }

  const response = UrlFetchApp.fetch(apiUrl, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
  });

  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error("API request failed: " + status + " " + text);
  }

  const json = JSON.parse(text);
  if (!json || !Array.isArray(json.data)) {
    throw new Error("Unexpected API response: " + text);
  }

  return json.data;
}

function writeGivingRows_(sheet, rows) {
  ensureHeader_(sheet);
  if (rows.length) {
    appendGivingRows_(sheet, rows);
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADER.length);
}

function appendGivingRows_(sheet, rows) {
  const values = rows.map(mapRowToSheetValues_);
  sheet
    .getRange(sheet.getLastRow() + 1, 1, values.length, HEADER.length)
    .setValues(values);
}

function isValidDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0]
    && date.getUTCMonth() === parts[1] - 1
    && date.getUTCDate() === parts[2];
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
  const headerMatches = HEADER.every(function (column, index) {
    return existingHeader[index] === column;
  });

  if (!headerMatches) {
    throw new Error("Sheet header does not match expected backend columns.");
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
    row.id || "",
    row.name || "",
    row.amount || "",
    row.currency || "",
    row.date || "",
    row.phone_number || "",
    row.email || "",
    normalizeBoolean_(row.receipt),
    row.paymenttype || "",
    row.upload || "",
    row.receiptname || "",
    row.nationalid || "",
    row.company || "",
    row.taxid || "",
    row.note || "",
    row.campus || "",
    row.tp_trade_id || "",
    normalizeBoolean_(row.is_success),
    row.env || "",
    normalizeBoolean_(row.imported),
    row.siyuan_id || "",
    row.created_at || "",
  ];
}

function normalizeBoolean_(value) {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  return value || "";
}
