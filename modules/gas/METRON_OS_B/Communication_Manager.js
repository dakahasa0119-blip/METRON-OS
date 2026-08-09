/**
 * ============================================================
 *  Communication_Manager.gs（UI非依存・自律会話対応版・安定化）
 * ============================================================
 */

// ★ スクリプトが紐づくスプレッドシートを動的に取得
function getSS() {
  const id = SpreadsheetApp.getActive().getId();
  return SpreadsheetApp.openById(id);
}

/* ------------------------------------------------------------
   1. Dispatcher（通信箱）
------------------------------------------------------------ */
function getDispatcherSheet() {
  var ss = getSS();
  var sheet = ss.getSheetByName("Dispatcher");
  if (!sheet) {
    sheet = ss.insertSheet("Dispatcher");
    sheet.appendRow(["Timestamp", "Target", "Type", "Payload", "Status"]);
  }
  return sheet;
}

/* ------------------------------------------------------------
   2. 母艦一覧
------------------------------------------------------------ */
function getMotherShipList() {
  return ["METRON-A", "METRON-B", "METRON-C"];
}

/* ------------------------------------------------------------
   3. Dispatcher → 母艦 Inbox へ配送
------------------------------------------------------------ */
function dispatchMessagesToMotherShips() {
  const dispatcher = getDispatcherSheet();
  const data = dispatcher.getDataRange().getValues();
  const motherShips = getMotherShipList();

  for (let i = 1; i < data.length; i++) {
    const [from, to, type, payload, timestamp] = data[i];

    if (!motherShips.includes(to)) continue;

    deliverToMotherShipInbox(to, {
      from,
      type,
      payload,
      timestamp
    });
  }
}

/* ------------------------------------------------------------
   4. 母艦 Inbox に書き込む
------------------------------------------------------------ */
function deliverToMotherShipInbox(name, message) {
  const ss = getSS();
  const sheet = ss.getSheetByName(name);
  if (!sheet) return;

  sheet.appendRow([
    message.from,
    message.type,
    message.payload,
    message.timestamp,
    "UNPROCESSED"
  ]);
}

/* ------------------------------------------------------------
   5. 母艦 → Dispatcher への返信
------------------------------------------------------------ */
function sendFromMotherShip(name, type, payload, to) {
  const dispatcher = getDispatcherSheet();

  dispatcher.appendRow([
    name,
    to,
    type,
    JSON.stringify(payload),
    new Date()
  ]);
}

/* ------------------------------------------------------------
   6. 母艦の人格ロジックを呼ぶ
------------------------------------------------------------ */
function processMotherShipMessages() {
  const motherShips = getMotherShipList();
  const ss = getSS();

  motherShips.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const row = data[i];

      const processed = row[4];
      if (processed !== "UNPROCESSED") continue;

      const message = {
        from: row[0],
        type: row[1],
        payload: row[2],
        timestamp: row[3]
      };

      const context = buildMotherShipContext(name);

      const reply = Strategic_AI.process({
        ship: name,
        context,
        message
      });

      // ★ 返信なし → 終了
      if (!reply) {
        sheet.getRange(i + 1, 5).setValue("PROCESSED");
        continue;
      }

      // ★ 配列対応
      const replies = Array.isArray(reply) ? reply : [reply];

      replies.forEach(r => {
        // ★ ACK に ACK を返さない
        if (message.type === "ACK" && r.type === "ACK") return;

        if (!r.to) return;

        sendFromMotherShip(name, r.type, r.payload, r.to);
      });

      sheet.getRange(i + 1, 5).setValue("PROCESSED");
    }
  });
}

/* ------------------------------------------------------------
   7. 通信サイクル（安定化版）
------------------------------------------------------------ */
function runMotherShipCommunicationCycle() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;

  try {
    // ★ 1回の実行で複数サイクル回す（A/B/C が確実に動く）
    for (let i = 0; i < 3; i++) {
      dispatchMessagesToMotherShips();
      processMotherShipMessages();
    }
  } finally {
    lock.releaseLock();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getSS,
    getDispatcherSheet,
    getMotherShipList,
    dispatchMessagesToMotherShips,
    deliverToMotherShipInbox,
    sendFromMotherShip,
    processMotherShipMessages,
    runMotherShipCommunicationCycle
  };
}
