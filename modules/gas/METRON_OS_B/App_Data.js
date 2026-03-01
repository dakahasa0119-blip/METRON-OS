/**
 * ============================================================
 *  App_Data.gs
 *  データ層（CRUD + シート生成）
 * ============================================================
 */

/**
 * データシート生成
 */
function createDataSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(DATA_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(DATA_SHEET);
    // ID, 作成日時, 更新日時は共通
    sheet.appendRow(["ID", "作成日時", "更新日時", "フィールド1", "フィールド2", "フィールド3"]);
  }
}

/**
 * 設定シート生成
 */
function createSettingsSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SETTINGS_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET);
    sheet.appendRow(["キー", "値"]);
    sheet.appendRow(["APP_INITIALIZED", "TRUE"]);
    sheet.appendRow(["TEMPLATE_LEVEL", TEMPLATE_LEVEL]);
    sheet.appendRow(["METRON_MODE", METRON_MODE]);
  }
}

/**
 * ログシート生成
 */
function createLogSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(LOG_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow(["日時", "メッセージ"]);
  }
}

/**
 * ダッシュボードシート生成（レベル3のみ）
 */
function createDashboardSheet() {
  if (TEMPLATE_LEVEL !== 3) return;

  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(DASHBOARD_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(DASHBOARD_SHEET);
    sheet.appendRow(["メトリクス", "値"]);
    sheet.appendRow(["レコード数", 0]);
    sheet.appendRow(["最終更新", ""]);
  }
}

/**
 * 全データ取得（UI用）
 */
function readAllData() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(DATA_SHEET);
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) return [];

  const headers = values[0];
  const records = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0]) continue; // IDが空はスキップ

    const record = {};
    headers.forEach((h, idx) => {
      record[h] = row[idx];
    });
    records.push(record);
  }
  return records;
}

/**
 * データ登録
 * record は { フィールド1: "...", フィールド2: "..." } のようなオブジェクトを想定
 */
function insertData(record) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(DATA_SHEET);
  const lastRow = sheet.getLastRow();
  const now = new Date();

  const id = Utilities.getUuid();
  const row = [
    id,
    now,
    now,
    record["フィールド1"] || "",
    record["フィールド2"] || "",
    record["フィールド3"] || ""
  ];

  sheet.appendRow(row);

  // レベル3ならダッシュボード更新
  if (TEMPLATE_LEVEL === 3) {
    updateDashboard();
  }

  return { success: true, id: id };
}

/**
 * データ削除
 */
function removeData(id) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(DATA_SHEET);
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) {
    return { success: false, message: "データがありません" };
  }

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);

      if (TEMPLATE_LEVEL === 3) {
        updateDashboard();
      }
      return { success: true };
    }
  }
  return { success: false, message: "該当IDが見つかりません" };
}

/**
 * ダッシュボード更新（レベル3のみ）
 */
function updateDashboard() {
  if (TEMPLATE_LEVEL !== 3) return;

  const ss = SpreadsheetApp.getActive();
  const dataSheet = ss.getSheetByName(DATA_SHEET);
  const dashSheet = ss.getSheetByName(DASHBOARD_SHEET);
  if (!dashSheet) return;

  const lastRow = dataSheet.getLastRow();
  const count = lastRow > 1 ? lastRow - 1 : 0;

  dashSheet.getRange(2, 2).setValue(count);      // レコード数
  dashSheet.getRange(3, 2).setValue(new Date()); // 最終更新
}
