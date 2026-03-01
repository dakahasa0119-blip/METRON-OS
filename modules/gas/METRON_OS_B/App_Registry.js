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