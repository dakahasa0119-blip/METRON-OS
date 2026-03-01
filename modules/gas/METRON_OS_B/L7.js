/**
 * Layer7: External Interface (Speaker Normalization Layer)
 * ---------------------------------------------------------
 * 役割:
 *  - MainChat の Speaker 列を公式ロールへ正規化する
 *  - L1/L3/L6 が誤認しないように「発話主体の統一」を行う
 *  - MetronOS の社会性レイヤー（Communication Identity Layer）
 */

const SPEAKER_MAP = {

  // Captain（人間）
  "おーい": "Captain",
  "おい": "Captain",
  "ユーザー": "Captain",
  "user": "Captain",
  "User": "Captain",
  "USER": "Captain",
  "USER (GW)": "Captain",

  // AI（AI_Sovereign）
  "AI応答": "AI_Sovereign",
  "ai": "AI_Sovereign",
  "AI": "AI_Sovereign",

  // System
  "システム": "System",
  "SYSTEM": "System",
  "system": "System",
  "System": "System",
  "System Message": "System",
  "System Report": "System",
  "System Command": "System",
  "System Protocol Definition": "System",
  "System Code Description": "System",
  "System Log Header": "System",

  // Analyst
  "ANALYST": "Analyst",
  "Analyst_Eye": "Analyst",

  // Evolver
  "System_Evolver": "Evolver",

  // Commander / Navigator / Forge
  "Commander": "Commander",
  "Navigator": "Navigator",
  "FORGE": "Forge",

  // Error
  "ERROR": "Error"
};


/* ============================================================
   normalizeSpeaker: 1つの文字列を公式ロールへ変換
   ============================================================ */
function normalizeSpeaker(raw) {
  if (!raw) return "System";
  const key = raw.trim();
  return SPEAKER_MAP[key] || "System"; // ★ 未知ロールは System に統一
}


/* ============================================================
   normalizeMainChatSpeakers:
   MainChat 全行の Speaker 列を正規化する
   ============================================================ */
function normalizeMainChatSpeakers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("mainchat");
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, 2, lastRow - 1, 1);
  const values = range.getValues();

  const updated = values.map(row => [normalizeSpeaker(row[0])]);
  range.setValues(updated);

  logL7("MainChat の Speaker 列を正規化しました。");
}


/* ============================================================
   L7 のログ（Sender = System）
   ============================================================ */
function logL7(msg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("mainchat");
  if (sheet) sheet.appendRow([new Date(), "System", msg, ""]);
}
