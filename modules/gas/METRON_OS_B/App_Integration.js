/**
 * ============================================================
 *  App_Integration.gs
 *  母艦（METRON OS）との連携
 *  METRON_MODE === "CONNECTED" のときのみ意味を持つ
 * ============================================================
 */

/**
 * 母艦にログを送る
 */
function sendLogToMotherShip(message) {
  if (METRON_MODE !== "CONNECTED" || !MOTHERSHIP_ID) return;

  try {
    const payload = {
      appName: APP_NAME,
      templateLevel: TEMPLATE_LEVEL,
      message: message,
      timestamp: new Date()
    };

    // ここは母艦側の公開関数名に合わせて変更
    const motherShip = SpreadsheetApp.openById(MOTHERSHIP_ID);
    const scriptProps = PropertiesService.getScriptProperties();
    // 実際には母艦のWebAPIか、母艦側のdoPost等と連携させる想定
    // 今は「拡張ポイント」として残す
  } catch (e) {
    // 母艦に送れない場合はローカルログにフォールバック（安全側）
    writeLocalLog("[MotherShip Error] " + message + " / " + e);
  }
}

/**
 * 母艦から設定・プロファイルを取得（将来拡張用）
 */
function fetchProfileFromMotherShip() {
  if (METRON_MODE !== "CONNECTED" || !MOTHERSHIP_ID) return null;

  try {
    // ここも将来の拡張ポイント
    return null;
  } catch (e) {
    writeLocalLog("[MotherShip Fetch Error] " + e);
    return null;
  }
}
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