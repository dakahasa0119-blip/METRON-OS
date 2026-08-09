/**
 * ============================================================
 *  App_Standalone.gs
 *  独立モード（Standalone）のときに使う機能
 * ============================================================
 */

/**
 * ローカルログを書き込む
 */
function writeLocalLog(message) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) return;

  sheet.appendRow([new Date(), message]);
}

/**
 * ローカル設定を保存（必要に応じて拡張）
 */
function setLocalSetting(key, value) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) return;

  const range = sheet.getDataRange();
  const values = range.getValues();

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

/**
 * ローカル設定を取得
 */
function getLocalSetting(key, defaultValue) {
  var p = PropertiesService.getScriptProperties().getProperty(key);
  return p ? p : defaultValue;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getLocalSetting, writeLocalLog, setLocalSetting };
}
