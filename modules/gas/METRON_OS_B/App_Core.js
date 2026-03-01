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

  // データシート生成
  createDataSheet();

  // 設定シート生成
  createSettingsSheet();

  // ログシート生成
  createLogSheet();

  // レベル3の場合はダッシュボード生成
  if (TEMPLATE_LEVEL === 3) {
    createDashboardSheet();
  }

  APP_INITIALIZED = true;
  logEvent("APP initialized");
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
  const message = `[ERROR] ${context}: ${error}`;

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
/**
 * アップデートチェック（母艦と比較）
 */
function checkForUpdate() {
  if (METRON_MODE !== "CONNECTED") {
    return { update: false, latest: true };
  }

  try {
    const mother = SpreadsheetApp.openById(MOTHERSHIP_ID);
    const sheet = mother.getSheetByName("TemplateLibrary");
    const motherVersion = sheet.getRange("B1").getValue(); // VERSION

    const localVersion = APP_TEMPLATE_VERSION;

    return {
      update: motherVersion > localVersion,
      latest: motherVersion === localVersion,
      motherVersion: motherVersion,
      localVersion: localVersion
    };

  } catch (e) {
    return { update: false, latest: true };
  }
}