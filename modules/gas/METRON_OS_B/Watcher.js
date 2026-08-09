/**
 * Watcher.gs v10.1 (Dynamic Routing & Self-Structuring)
 * - v9.1 の全機能を完全維持
 * - シート欠損時の自動生成 (ensurePhysicalStructure)
 * - 自分宛の Gateway 信号のみを処理するフィルタリング
 * - 物理ガード：再帰呼び出しによるスタック爆発を防止
 */

// 物理ガードフラグ
var _CALL_STACK_GUARD = _CALL_STACK_GUARD || {};

/**
 * 物理的な依代
 */
function watchMotherShip() { handleDynamicCall("watchMotherShip"); }
function bootloaderTick() { handleDynamicCall("bootloaderTick"); }
function smartAutoDigest() { handleDynamicCall("smartAutoDigest"); }
function handleGatewayChat(msg) { return handleDynamicCall("handleGatewayChat", msg); }
function processIncomingSignal(rowIdx) { return handleDynamicCall("processIncomingSignal", rowIdx); }

/**
 * 【自律修復版】Self オブジェクトへ中継。再帰ガード付き。
 */
function handleDynamicCall(fnName, ...args) {
  // --- 物理ガード：無限ループ切断 ---
  if (_CALL_STACK_GUARD[fnName]) {
    console.warn(`[Stack Guard] ${fnName} の再帰呼び出しを検知。実行をスキップします。`);
    return null;
  }
  _CALL_STACK_GUARD[fnName] = true;

  try {
    if (typeof Self === 'undefined' || !Self) {
      if (typeof initializeSystemCore === 'function') {
        console.log(`[System Recovery] Self 不在のため initializeSystemCore を実行します...`);
        initializeSystemCore(); 
      }
    }
    if (typeof Self === 'undefined' || !Self) {
      console.warn(`[Scope Warning] ${fnName} 実行不可：Self が依然として未定義です。`);
      if (fnName === "watchMotherShip" && typeof refreshUIState === "function") refreshUIState();
      return null;
    }
    if (typeof Self[fnName] === 'function') {
      return Self[fnName](...args);
    } else {
      console.error(`[Function Error] Self 内に ${fnName} が見当たりません。`);
    }
  } catch (e) {
    console.error(`[Execution Error] ${fnName}: ${e.message}`);
    throw e;
  } finally {
    // 実行完了後に必ずフラグを解放
    _CALL_STACK_GUARD[fnName] = false;
  }
}

/* ==================================================
    物理構造の自動保全 (Self-Structuring)
================================================== */

function W_ensurePhysicalStructure() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = {
    "MainChat": ["Timestamp", "Role", "Message"],
    "Injection_Slot": ["Timestamp", "Target", "Command", "Payload", "Status", "Origin"],
    "Forge_Staging": ["記録日時", "生成物名称", "解説", "ソースコード", "状態", "バックアップURL"]
  };

  for (const [name, headers] of Object.entries(sheets)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      console.log(`[Auto-Structure] ${name} が見つかりません。生成します。`);
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    }
  }
}

/* ==================================================
    内部ユーティリティ (v9.1 維持)
================================================== */
function W_props() { return PropertiesService.getScriptProperties(); }
function W_hash(obj) { try { return JSON.stringify(obj); } catch (e) { return String(obj); } }
function W_chatHash(row) { try { return String(row[1]) + "::" + String(row[2]); } catch (e) { return String(row); } }
function W_safeAnnounce(msg, type) { try { if (typeof announce === "function") announce(msg, type || "SYSTEM"); } catch (_) {} }

/* ==================================================
    変更検知プロトコル (改変・省略なし。動的識別を追加)
================================================== */
function W_checkInjectionSlot() {
  W_ensurePhysicalStructure(); 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Injection_Slot");
  const last = sheet.getLastRow();
  if (last < 2) return;

  const row = sheet.getRange(last, 1, 1, 6).getValues()[0]; 
  const hash = W_hash(row);
  const props = W_props();
  if (hash === props.getProperty("WATCHER_LAST_SLOT_HASH")) return;
  props.setProperty("WATCHER_LAST_SLOT_HASH", hash);

  const status = row[4];
  const filename = row[2];
  const origin = row[5];

  if (origin && origin !== "BROADCAST" && origin !== ss.getId()) {
    console.log("Ignored: Signal for other mothership detected.");
    return;
  }

  if (status === "RECEIVED (GW)") {
    processIncomingSignal(last);
    W_safeAnnounce(`Watcher: Injection_Slot → 解析開始 (${filename})`, "SYSTEM");
  }
  if (status === "APPROVED") {
    try {
      if (typeof applyLatestPatch === "function") {
        applyLatestPatch();
        W_safeAnnounce(`Watcher: 承認済みパッチ適用 (${filename})`, "SYSTEM");
      }
    } catch (e) { W_safeAnnounce("Watcher Injector Error: " + e.message, "ERROR"); }
  }
}

function W_checkForgeStaging() {
  W_ensurePhysicalStructure();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Forge_Staging");
  const last = sheet.getLastRow();
  if (last < 2) return;

  const row = sheet.getRange(last, 1, 1, 6).getValues()[0];
  const hash = W_hash(row);
  const props = W_props();
  if (hash === props.getProperty("WATCHER_LAST_FORGE_HASH")) return;
  props.setProperty("WATCHER_LAST_FORGE_HASH", hash);

  const filename = row[1];
  const status = row[4];
  if (status === "STAGED") return;
  if (status === "APPROVED") {
    try {
      if (typeof applyLatestPatch === "function") {
        applyLatestPatch();
        W_safeAnnounce(`Watcher: Forge APPROVED → パッチ適用 (${filename})`, "SYSTEM");
      }
    } catch (e) { W_safeAnnounce("Watcher Injector Error: " + e.message, "ERROR"); }
    return;
  }
  W_safeAnnounce(`Watcher: Forge 状態変化 (${filename}, ${status})`, "FORGE");
}

function W_checkMainChat() {
  W_ensurePhysicalStructure();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MainChat");
  const last = sheet.getLastRow();
  if (last < 2) return;

  const row = sheet.getRange(last, 1, 1, 3).getValues()[0];
  const role = String(row[1]);
  const message = row[2];

  if (!role.includes("USER") || !role.includes("(GW")) return;

  const props = W_props();
  const h = W_chatHash(row);
  if (h === props.getProperty("WATCHER_LAST_GW_CHAT_HASH")) return;
  props.setProperty("WATCHER_LAST_GW_CHAT_HASH", h);

  try {
    handleGatewayChat(message);
    W_safeAnnounce(`Watcher: ${role} → Gateway 応答`, "SYSTEM");
  } catch (e) { W_safeAnnounce("Watcher Chat Error: " + e.message, "ERROR"); }
}

function onChange(e) {
  if (!e || !e.source) return;
  const sheet = e.source.getActiveSheet();
  const name = sheet.getName();

  if (name === "MainChat") { W_checkMainChat(); return; }
  if (name === "Injection_Slot") { W_checkInjectionSlot(); return; }
  if (name === "Forge_Staging") { W_checkForgeStaging(); return; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    W_chatHash
  };
}