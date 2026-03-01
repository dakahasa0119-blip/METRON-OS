/**
 * 母艦の初期化（必要シートを自動生成）
 */
function initMotherShip() {
  const ss = SpreadsheetApp.getActive();

  // App_Registry
  if (!ss.getSheetByName("App_Registry")) {
    const sheet = ss.insertSheet("App_Registry");
    sheet.appendRow([
      "created",
      "name",
      "id",
      "level",
      "mode",
      "version",
      "status",
      "update_flag"
    ]);
  }

  // App_Logs
  if (!ss.getSheetByName("App_Logs")) {
    const sheet = ss.insertSheet("App_Logs");
    sheet.appendRow(["日時", "アプリ名", "メッセージ"]);
  }

  // App_Profiles（将来拡張）
  if (!ss.getSheetByName("App_Profiles")) {
    const sheet = ss.insertSheet("App_Profiles");
    sheet.appendRow(["キー", "値"]);
  }

  Logger.log("MotherShip initialization complete.");
}

/**
 * 母艦の初期化（必要シートを自動生成）
 */
function initMotherShip() {
  const ss = SpreadsheetApp.getActive();

  // App_Registry
  if (!ss.getSheetByName("App_Registry")) {
    const sheet = ss.insertSheet("App_Registry");
    sheet.appendRow([
      "created",
      "name",
      "id",
      "level",
      "mode",
      "version",
      "status",
      "update_flag"
    ]);
  }

  // App_Logs
  if (!ss.getSheetByName("App_Logs")) {
    const sheet = ss.insertSheet("App_Logs");
    sheet.appendRow(["日時", "アプリ名", "メッセージ"]);
  }

  // App_Profiles
  if (!ss.getSheetByName("App_Profiles")) {
    const sheet = ss.insertSheet("App_Profiles");
    sheet.appendRow(["キー", "値"]);
  }

  // UI_Fields（UI 自動生成の設計図）
  if (!ss.getSheetByName("UI_Fields")) {
    const sheet = ss.insertSheet("UI_Fields");
    sheet.appendRow(["field_key", "label", "type", "required", "options", "order"]);
    sheet.appendRow(["name", "名前", "text", true, "", 1]);
    sheet.appendRow(["memo", "メモ", "textarea", false, "", 2]);
  }

  Logger.log("MotherShip initialization complete.");
}
