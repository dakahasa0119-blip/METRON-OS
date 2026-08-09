/**
 * ============================================================
 *  SetupTemplates.gs
 *  母艦にテンプレートを初期登録 / 再登録するためのスクリプト
 *  必要なときに手動実行する（1回でも、何回でもOK）
 * ============================================================
 */

function setupTemplates() {

  // --- App_Core.gs ---
  updateTemplate("TEMPLATE_CORE", `
/**
 * ============================================================
 *  App_Core.gs
 *  排出APPの頭脳（初期化・モード判定・UI連携）
 * ============================================================
 */

/**
 * 初期化（初回起動時のみ実行）
 */
function initializeApp() {
  if (APP_INITIALIZED === true) return;

  createDataSheet();
  createSettingsSheet();
  createLogSheet();

  if (TEMPLATE_LEVEL === 3) {
    createDashboardSheet();
  }

  APP_INITIALIZED = true;
  logEvent("APP initialized");
}

function onOpen() {
  createDataSheet();
  createSettingsSheet();
  createLogSheet();
  createDashboardSheet();
}

/**
 * Webアプリのエントリーポイント
 */
function doGet() {
  initializeApp();

  const template = HtmlService.createTemplateFromFile("App_UI");
  template.config = getAppConfig();
  template.mode = METRON_MODE;
  template.templateLevel = TEMPLATE_LEVEL;

  return template.evaluate().setTitle(APP_NAME);
}

/**
 * モード判定（UI側が使用）
 */
function getMode() {
  return METRON_MODE;
}

/**
 * データ取得（UI側が使用）
 */
function getData() {
  return readAllData();
}

/**
 * データ登録（UI側が使用）
 */
function addData(record) {
  try {
    const result = insertData(record);

    if (METRON_MODE === "CONNECTED") {
      sendLogToMotherShip("Record added");
    } else {
      writeLocalLog("Record added");
    }

    return result;
  } catch (e) {
    handleError("addData", e);
    return { success: false, error: e.toString() };
  }
}

/**
 * データ削除
 */
function deleteData(id) {
  try {
    const result = removeData(id);

    if (METRON_MODE === "CONNECTED") {
      sendLogToMotherShip("Record deleted");
    } else {
      writeLocalLog("Record deleted");
    }

    return result;
  } catch (e) {
    handleError("deleteData", e);
    return { success: false, error: e.toString() };
  }
}

/**
 * エラー処理（母艦連携 or 独立ログ）
 */
function handleError(context, error) {
  const message = \`[ERROR] \${context}: \${error}\`;

  if (METRON_MODE === "CONNECTED") {
    sendLogToMotherShip(message);
  } else {
    writeLocalLog(message);
  }
}

/**
 * イベントログ（共通）
 */
function logEvent(message) {
  if (METRON_MODE === "CONNECTED") {
    sendLogToMotherShip(message);
  } else {
    writeLocalLog(message);
  }
}
  `);

 updateTemplate("TEMPLATE_DATA", `/**
 * ============================================================
 *  App_Data.gs（UI_Fields に基づく動的データ管理）
 * ============================================================
 */

/**
 * データシートを UI_Fields に基づいて生成
 */
function createDataSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(DATA_SHEET);

  const fields = getUIFieldsLocal(); // 動的フィールド定義

  if (!sheet) {
    sheet = ss.insertSheet(DATA_SHEET);

    // 動的ヘッダー生成
    const headers = ["ID", "作成日時", "更新日時"];
    fields.forEach(f => headers.push(f.label));

    sheet.appendRow(headers);
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
 * ダッシュボード生成（Level 3）
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
 * 動的データ保存
 */
function saveDataDynamic(formData) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(DATA_SHEET);
  const fields = getUIFieldsLocal();

  const now = new Date();
  const id = Utilities.getUuid();

  const row = [id, now, now];

  fields.forEach(f => {
    row.push(formData[f.field_key] || "");
  });

  sheet.appendRow(row);

  if (TEMPLATE_LEVEL === 3) updateDashboard();

  return { success: true, id: id };
}

/**
 * 動的データ読み込み
 */
function loadDataDynamic() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(DATA_SHEET);
  const fields = getUIFieldsLocal();

  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, fields.length + 3).getValues();

  return values.map(row => {
    const obj = {
      id: row[0],
      created: row[1],
      updated: row[2]
    };

    fields.forEach((f, i) => {
      obj[f.field_key] = row[i + 3];
    });

    return obj;
  });
}

/**
 * データ削除
 */
function removeData(id) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(DATA_SHEET);
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      sheet.deleteRow(i + 1);
      if (TEMPLATE_LEVEL === 3) updateDashboard();
      return { success: true };
    }
  }

  return { success: false, message: "該当IDが見つかりません" };
}

/**
 * ダッシュボード更新
 */
function updateDashboard() {
  if (TEMPLATE_LEVEL !== 3) return;

  const ss = SpreadsheetApp.getActive();
  const dataSheet = ss.getSheetByName(DATA_SHEET);
  const dashSheet = ss.getSheetByName(DASHBOARD_SHEET);

  const lastRow = dataSheet.getLastRow();
  const count = lastRow > 1 ? lastRow - 1 : 0;

  dashSheet.getRange(2, 2).setValue(count);
  dashSheet.getRange(3, 2).setValue(new Date());
}

`);
  // --- App_Integration.gs ---
  updateTemplate("TEMPLATE_INTEGRATION", `
/**
 * ============================================================
 *  App_Integration.gs
 *  母艦（METRON OS）との連携
 * ============================================================
 */

/**
 * 母艦から UI_Fields を取得
 */
function fetchUIFieldsFromMotherShip() {
  try {
    const mother = SpreadsheetApp.openById(MOTHERSHIP_ID);
    const sheet = mother.getSheetByName("UI_Fields");
    const values = sheet.getDataRange().getValues();

    const list = [];
    for (let i = 1; i < values.length; i++) {
      list.push({
        field_key: values[i][0],
        label: values[i][1],
        type: values[i][2],
        required: values[i][3],
        options: values[i][4] ? values[i][4].split(",") : [],
        order: values[i][5]
      });
    }

    list.sort((a, b) => a.order - b.order);
    return list;

  } catch (e) {
    Logger.log("Failed to fetch UI fields: " + e);
    return [];
  }
}

function sendLogToMotherShip(message) {
  if (METRON_MODE !== "CONNECTED" || !MOTHERSHIP_ID) return;

  try {
    const mother = SpreadsheetApp.openById(MOTHERSHIP_ID);
    const sheet = mother.getSheetByName("App_Logs");
    if (sheet) {
      sheet.appendRow([new Date(), APP_NAME, message]);
    }
  } catch (e) {
    writeLocalLog("[MotherShip Error] " + message + " / " + e);
  }
}

/**
 * 母艦からプロファイルを取得（強化版）
 */
function fetchProfileFromMotherShip() {
  if (METRON_MODE !== "CONNECTED" || !MOTHERSHIP_ID) return null;

  try {
    const mother = SpreadsheetApp.openById(MOTHERSHIP_ID);
    const sheet = mother.getSheetByName("App_Profiles");
    if (!sheet) return null;

    const values = sheet.getDataRange().getValues();
    const profile = {};

    values.forEach(row => {
      profile[row[0]] = row[1];
    });

    return profile;

  } catch (e) {
    writeLocalLog("[MotherShip Fetch Error] " + e);
    return null;
  }
}
  `);

  // --- App_Standalone.gs ---
  updateTemplate("TEMPLATE_STANDALONE", `
/**
 * ============================================================
 *  App_Standalone.gs
 *  独立モード（Standalone）のときに使う機能
 * ============================================================
 */

function writeLocalLog(message) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) return;

  sheet.appendRow([new Date(), message]);
}

function setLocalSetting(key, value) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) return;

  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function getLocalSetting(key, defaultValue) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) return defaultValue;

  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      return values[i][1];
    }
  }
  return defaultValue;
}
  `);

  

  // --- App_Styles.css ---
updateTemplate("TEMPLATE_CSS", `
/* ============================================================
   App_Styles.css
   iOS風デザイン（ライト / ダーク両対応）
   ============================================================ */

/* ---------------------------------------------
   基本色（iOS準拠）
--------------------------------------------- */
:root {
  --ios-blue: #007AFF;
  --ios-gray: #8E8E93;
  --ios-light-bg: #F2F2F7;
  --ios-dark-bg: #1C1C1E;
  --ios-card-light: #FFFFFF;
  --ios-card-dark: #2C2C2E;
  --ios-text-light: #000000;
  --ios-text-dark: #FFFFFF;
}

/* ---------------------------------------------
   全体
--------------------------------------------- */
body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--ios-light-bg);
  color: var(--ios-text-light);
}

/* ダークテーマ */
body.dark {
  background: var(--ios-dark-bg);
  color: var(--ios-text-dark);
}

/* ---------------------------------------------
   ヘッダー
--------------------------------------------- */
.header {
  text-align: center;
  padding: 20px;
  background: var(--ios-card-light);
  border-bottom: 1px solid #ddd;
}

body.dark .header {
  background: var(--ios-card-dark);
  border-bottom: 1px solid #444;
}

.logo {
  width: 60px;
  height: 60px;
}

.app-title {
  font-size: 20px;
  font-weight: 600;
  margin-top: 8px;
}

/* モードバッジ */
.mode-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  margin-top: 6px;
  color: white;
}

.connected {
  background: var(--ios-blue);
}

.standalone {
  background: var(--ios-gray);
}

/* ---------------------------------------------
   カード
--------------------------------------------- */
.card {
  background: var(--ios-card-light);
  margin: 12px;
  padding: 16px;
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

body.dark .card {
  background: var(--ios-card-dark);
  box-shadow: 0 1px 3px rgba(255,255,255,0.05);
}

.card-title {
  font-size: 16px;
  font-weight: 600;
}

.card-sub {
  font-size: 13px;
  color: var(--ios-gray);
  margin-top: 4px;
}

/* ---------------------------------------------
   入力欄
--------------------------------------------- */
.input-group input {
  width: calc(100% - 20px);
  padding: 10px;
  margin: 6px 10px;
  border-radius: 10px;
  border: 1px solid #ccc;
  font-size: 14px;
}

body.dark .input-group input {
  background: #3A3A3C;
  border: 1px solid #555;
  color: white;
}

/* ---------------------------------------------
   ボタン
--------------------------------------------- */
button {
  background: var(--ios-blue);
  color: white;
  border: none;
  padding: 10px 14px;
  margin: 10px;
  border-radius: 10px;
  font-size: 14px;
}

button.delete-btn {
  background: #FF3B30;
}

/* ---------------------------------------------
   タブバー
--------------------------------------------- */
.tab-bar {
  position: fixed;
  bottom: 0;
  width: 100%;
  background: var(--ios-card-light);
  display: flex;
  justify-content: space-around;
  padding: 10px 0;
  border-top: 1px solid #ddd;
}

body.dark .tab-bar {
  background: var(--ios-card-dark);
  border-top: 1px solid #444;
}

.tab {
  font-size: 14px;
  color: var(--ios-blue);
}

/* ---------------------------------------------
   タブコンテンツ
--------------------------------------------- */
.tab-content {
  padding: 20px;
  margin-bottom: 80px;
}
`);

  Logger.log("テンプレート初期登録 / 更新が完了しました。");
}