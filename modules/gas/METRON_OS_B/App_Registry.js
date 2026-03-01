/**
 * App_Registry.gs
 * 排出APPを母艦が管理するレジストリ
 */

function registerAppToMotherShip(name, id, level, mode) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Registry");
  const version = getTemplateVersion();

  sheet.appendRow([
    new Date(),   // A: 登録日時
    name,         // B: アプリ名
    id,           // C: スプレッドシートID
    level,        // D: テンプレートレベル
    mode,         // E: モード
    version,      // F: 発行時テンプレートバージョン
    "ACTIVE",     // G: ステータス
    ""            // H: UPDATE_FLAG
  ]);
}

function checkAppUpdates() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Registry");
  const values = sheet.getDataRange().getValues();
  const currentVersion = getTemplateVersion();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const appVersion = Number(row[5]);
    if (appVersion < currentVersion) {
      sheet.getRange(i + 1, 8).setValue("UPDATE_AVAILABLE");
    } else {
      sheet.getRange(i + 1, 8).setValue("");
    }
  }
}
/**
 * 指定行の排出APPを最新テンプレートで再生成（スクリプトだけ上書き）
 * rowIndex: App_Registry の行番号（ヘッダを1として、2行目なら2）
 */
function updateAppFromRegistry(rowIndex) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Registry");
  const row = sheet.getRange(rowIndex, 1, 1, 8).getValues()[0];

  const appName = row[1];
  const appId   = row[2];
  const level   = row[3];
  const mode    = row[4];

  const child = SpreadsheetApp.openById(appId);

  const TEMPLATE_CORE         = getTemplate("TEMPLATE_CORE");
  const TEMPLATE_DATA         = getTemplate("TEMPLATE_DATA");
  const TEMPLATE_UI           = getTemplate("TEMPLATE_UI");
  const TEMPLATE_CSS          = getTemplate("TEMPLATE_CSS");
  const TEMPLATE_INTEGRATION  = getTemplate("TEMPLATE_INTEGRATION");
  const TEMPLATE_STANDALONE   = getTemplate("TEMPLATE_STANDALONE");

  const project = AppsScriptProject.open(child);
  project.overwriteFile("App_Config.gs", buildConfig(appName, level, mode));
  project.overwriteFile("App_Core.gs", TEMPLATE_CORE);
  project.overwriteFile("App_Data.gs", TEMPLATE_DATA);
  project.overwriteFile("App_Integration.gs", TEMPLATE_INTEGRATION);
  project.overwriteFile("App_Standalone.gs", TEMPLATE_STANDALONE);
  project.overwriteFile("App_UI.html", TEMPLATE_UI);
  project.overwriteFile("App_Styles.css", TEMPLATE_CSS);

  sheet.getRange(rowIndex, 6).setValue(getTemplateVersion()); // VERSION
  sheet.getRange(rowIndex, 8).setValue("");                   // UPDATE_FLAG クリア
}