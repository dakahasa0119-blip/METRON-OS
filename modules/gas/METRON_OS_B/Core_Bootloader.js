/**
 * Core_Bootloader.gs
 * 母艦の進化状態を管理する Bootloader / Self-Healer
 * - Injection_Slot の状態監視
 * - SystemLog への記録
 * - 最終パッチ情報の保存
 */

const BOOT_NS = "METRON_BOOT_V1";

/**
 * Bootloader の定期実行エントリ
 * - 時間トリガー（5分ごとなど）か手動で呼び出す
 */
function bootloaderTick() {
  try {
    bootLog_("INFO", "Bootloader tick start");
    const result = processInjectionSlot_();
    bootLog_("INFO", "Bootloader tick end: " + result);
  } catch (e) {
    bootLog_("ERROR", "Bootloader tick failed: " + e.message);
    recordBootError_(e);
  }
}

/**
 * 初期化用：シートなどの存在確認
 * 必要なら1回だけ手動実行
 */
function bootloaderInit() {
  const ss = getMotherSheet_();
  if (!ss.getSheetByName("SystemLog")) {
    ss.insertSheet("SystemLog").appendRow(["Timestamp", "Level", "Message"]);
  }
  if (!ss.getSheetByName("Injection_Slot")) {
    ss.insertSheet("Injection_Slot").appendRow([
      "Timestamp",
      "Target",
      "Filename",
      "Code",
      "Status"   // RECEIVED (GW) / PATCH_APPLIED / DONE / ERROR など
    ]);
  }
  bootLog_("INFO", "Bootloader initialized");
}

/**
 * Injection_Slot をスキャンして状態を更新
 * - PATCH_APPLIED の行を検出して DONE に進める
 * - 最終パッチ情報を PropertiesService に保存
 */
function processInjectionSlot_() {
  const ss = getMotherSheet_();
  const sheet = ss.getSheetByName("Injection_Slot");
  if (!sheet) return "NO SLOT";

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "NO PATCH";

  const range = sheet.getRange(2, 1, lastRow - 1, 5);
  const values = range.getValues();

  let processed = 0;
  let lastPatchedFile = null;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const status = row[4];

    // サテライトが PATCH_APPLIED と書き換えたものを処理対象にする
    if (status === "PATCH_APPLIED") {
      const filename = row[2];
      const ts = row[0] || new Date();

      // SystemLog に記録
      bootLog_("INFO", "Patch applied on mother ship: " + filename);

      // DONE に更新
      values[i][4] = "DONE";

      // 最後に適用されたパッチとして記録
      lastPatchedFile = filename;
      saveLastPatchMeta_({
        filename,
        timestamp: ts,
        note: "APPLIED & MARKED_DONE"
      });

      processed++;
    }
  }

  if (processed > 0) {
    range.setValues(values);
  }

  if (processed === 0) return "NO NEW PATCH";
  return "PATCHES PROCESSED: " + processed + (lastPatchedFile ? (" (last: " + lastPatchedFile + ")") : "");
}

/* ====== 内部ユーティリティ群 ====== */

/**
 * 母艦スプレッドシートを取得
 * - ここはあなたの既存の定義に合わせて書き換えてもOK
 */
function getMotherSheet_() {
  // 母艦自身なら通常は SpreadsheetApp.getActive() で良いが、
  // すでに METRON_OS_ID を使っている場合はそれを流用してもいい。
  try {
    return SpreadsheetApp.getActive();
  } catch (e) {
    // 必要ならここに METRON_OS_ID 版を入れる：
    // return SpreadsheetApp.openById(METRON_OS_ID);
    throw new Error("母艦スプレッドシート取得失敗: " + e.message);
  }
}

/**
 * SystemLog への書き込み
 */
function bootLog_(level, message) {
  const ss = getMotherSheet_();
  let sheet = ss.getSheetByName("SystemLog");
  if (!sheet) {
    sheet = ss.insertSheet("SystemLog");
    sheet.appendRow(["Timestamp", "Level", "Message"]);
  }
  sheet.appendRow([new Date(), level, message]);
}

/**
 * Bootloader 用の Properties オブジェクト取得
 */
function getBootProps_() {
  return PropertiesService.getScriptProperties();
}

/**
 * 最終パッチ情報を保存
 */
function saveLastPatchMeta_(meta) {
  const props = getBootProps_();
  props.setProperty(
    BOOT_NS + "_LAST_PATCH",
    JSON.stringify({
      filename: meta.filename || "",
      timestamp: meta.timestamp ? new Date(meta.timestamp).toISOString() : new Date().toISOString(),
      note: meta.note || ""
    })
  );
}

/**
 * 最終パッチ情報を取得（必要なら他のモジュールから呼べる）
 */
function getLastPatchMeta() {
  const props = getBootProps_();
  const raw = props.getProperty(BOOT_NS + "_LAST_PATCH");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * エラー発生時に記録（簡易的なロールバック検知用）
 */
function recordBootError_(error) {
  const props = getBootProps_();
  const key = BOOT_NS + "_ERROR_COUNT";
  const count = Number(props.getProperty(key) || "0") + 1;
  props.setProperty(key, String(count));

  bootLog_("ERROR", "Boot error count = " + count + " / " + error.message);
}

/**
 * エラーカウンタをリセット（人間 or 自動復旧後に呼ぶ想定）
 */
function resetBootErrorCount() {
  const props = getBootProps_();
  props.deleteProperty(BOOT_NS + "_ERROR_COUNT");
  bootLog_("INFO", "Boot error count reset");
}