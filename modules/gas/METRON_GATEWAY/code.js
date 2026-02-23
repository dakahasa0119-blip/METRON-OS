/**
 * METRON Gateway v12 – Gateway UI + MainChat + PatchSlots + Timeline
 * 役割：
 * - 文明の人格ログ（MainChat）
 * - PatchSlots / Forge / Timeline（母艦復活後のために保持）
 * - ARC 連携ロジックは gateway_questions.gs 側に集約
 * - JS テンプレートは削除（ARC は自前で操作するため）
 */

/* ==================================================
   母艦 ID 解決（v10 のまま）
================================================== */

const DEFAULT_OS_ID = "1lK9XN7DJ1G_RM0-GzsQ2v4Hti49er2rvAkR_eV8lr0M";

function getTargetId() {
  const cached = CacheService.getUserCache().get("ACTIVE_MOTHERSHIP_ID");
  return cached || DEFAULT_OS_ID;
}

/* ==================================================
   Gateway UI エントリポイント
================================================== */

function doGetGatewayUi(e) {

  // 母艦切り替え（UI）
  if (e && e.parameter && e.parameter.ship_id) {
    CacheService.getUserCache().put("ACTIVE_MOTHERSHIP_ID", e.parameter.ship_id, 21600);
  }

  // Gateway UI
  return HtmlService.createHtmlOutputFromFile("gateway")
    .setTitle("METRON Gateway v12")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/* ==================================================
   MainChat（人格ログ）
================================================== */

function fetchMainChat() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("MainChat");

    if (!sheet) {
      sheet = ss.insertSheet("MainChat");
      sheet.appendRow(["Timestamp", "Source", "Message"]);
      return [];
    }

    const last = sheet.getLastRow();
    if (last < 2) return [];

    const count = Math.min(50, last - 1);
    const startRow = Math.max(2, last - count + 1);

    return JSON.parse(JSON.stringify(
      sheet.getRange(startRow, 1, count, 3).getValues()
    ));

  } catch (e) {
    console.error("fetchMainChat error:", e);
    return [];
  }
}

function sendToMainChat(text) {
  const LOCK_KEY = "GW_WRITE_LOCK";
  const TTL = 3000;

  const props = PropertiesService.getScriptProperties();
  const now = Date.now();

  const raw = props.getProperty(LOCK_KEY);
  if (raw) {
    try {
      const info = JSON.parse(raw);
      if (now - info.timestamp < TTL) {
        console.warn("Gateway: sendToMainChat skipped (locked)");
        return false;
      }
    } catch (_) {}
  }
  props.setProperty(LOCK_KEY, JSON.stringify({ timestamp: now }));

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("MainChat");

    if (!sheet) {
      sheet = ss.insertSheet("MainChat");
      sheet.appendRow(["Timestamp", "Source", "Message"]);
    }

    sheet.appendRow([
      new Date(),
      "USER (GW)",
      text
    ]);

    SpreadsheetApp.flush();
    return true;

  } catch (e) {
    console.error("sendToMainChat error:", e);
    return false;

  } finally {
    props.deleteProperty(LOCK_KEY);
  }
}

/* ==================================================
   PatchSlots（母艦復活後のために保持）
================================================== */

function evaluateProposalsWithAI() {
  const METRON_OS_ID = getTargetId();
  const ss = SpreadsheetApp.openById(METRON_OS_ID);
  let sheet = ss.getSheetByName("PatchSlots");

  if (!sheet) {
    sheet = ss.insertSheet("PatchSlots");
    sheet.appendRow(["Timestamp","Filename","SlotName","Priority","Code","Status","Note"]);
    return [];
  }

  const last = sheet.getLastRow();
  if (last < 2) return [];

  const data = sheet.getRange(2, 1, last - 1, 7).getValues();

  return toJsonSafe(data.map((row, index) => ({
    id: index + 1,
    timestamp: Utilities.formatDate(new Date(row[0]), "JST", "yyyy-MM-dd HH:mm"),
    filename: row[1],
    slotName: row[2],
    preview: (row[4] || "").toString().slice(0, 80),
    status: row[5],
    note: row[6] || ""
  })));
}

/* ==================================================
   Forge_Staging（母艦復活後のために保持）
================================================== */

function getStagedProposals() {
  const METRON_OS_ID = getTargetId();
  try {
    const ss = SpreadsheetApp.openById(METRON_OS_ID);
    let sheet = ss.getSheetByName("Forge_Staging");

    if (!sheet) {
      sheet = ss.insertSheet("Forge_Staging");
      sheet.appendRow(["記録日時","生成物名称","解説","ソースコード","状態","バックアップURL"]);
      return [];
    }

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];

    const headers = values.shift();

    return toJsonSafe(values.map((row, index) => {
      const obj = {};
      headers.forEach((h, i) => {
        const v = row[i];
        obj[h] = v instanceof Date
          ? Utilities.formatDate(v, "JST", "yyyy-MM-dd HH:mm:ss")
          : v;
      });

      obj.id = index + 1;
      obj.timestamp = obj["記録日時"] || "-";
      obj.filename = obj["生成物名称"] || "No Name";
      obj.description = obj["解説"] || "";
      obj.code = obj["ソースコード"] || "";
      obj.status = obj["状態"] || "";
      obj.backupUrl = obj["バックアップURL"] || "";

      return obj;
    }));

  } catch (err) {
    console.error("getStagedProposals Error:", err);
    return [];
  }
}

/* ==================================================
   承認・昇格（母艦復活後のために保持）
================================================== */

function approveStagedProposal(id) {
  const METRON_OS_ID = getTargetId();
  const LOCK_KEY = "GW_APPROVE_LOCK_" + id;
  const TTL = 5000;

  const props = GW_props();
  const now = Date.now();

  const raw = props.getProperty(LOCK_KEY);
  if (raw) {
    try {
      const info = JSON.parse(raw);
      if (now - info.timestamp < TTL) return "SKIPPED";
    } catch (_) {}
  }
  props.setProperty(LOCK_KEY, JSON.stringify({ timestamp: now }));

  try {
    const list = getStagedProposals();
    const p = list.find(x => x.id === id);
    if (!p) throw new Error("提案が見つかりません");

    const ss = SpreadsheetApp.openById(METRON_OS_ID);
    const forge = ss.getSheetByName("Forge_Staging");
    const patch = ss.getSheetByName("PatchSlots") || (function () {
      const s = ss.insertSheet("PatchSlots");
      s.appendRow(["Timestamp","Filename","SlotName","Priority","Code","Status","Note"]);
      return s;
    })();

    patch.appendRow([
      new Date(),
      p.filename,
      "PATCH_SLOT_GATEWAY_" + Date.now(),
      999,
      p.code,
      "ACTIVE",
      JSON.stringify({
        source: "Gateway_approveStagedProposal",
        description: p.description || "",
        backupUrl: p.backupUrl || ""
      })
    ]);

    forge.getRange(id + 1, 5).setValue("PROMOTED");

    EV33_recordTimeline(
      "APPROVED",
      p.filename,
      "Gateway承認（Staging→PatchSlots）",
      "Forge_Staging",
      `Target: ${METRON_OS_ID}`
    );

    return "APPROVED";

  } catch (e) {
    console.error("approveStagedProposal error:", e);
    throw e;
  } finally {
    props.deleteProperty(LOCK_KEY);
  }
}

/* ==================================================
   Timeline / SystemLog（文明の歴史）
================================================== */

function logToMother_(level, message) {
  const METRON_OS_ID = getTargetId();
  try {
    const ss = SpreadsheetApp.openById(METRON_OS_ID);
    const logSheet = ss.getSheetByName("SystemLog") || (function () {
      const s = ss.insertSheet("SystemLog");
      s.appendRow(["Timestamp","Level","Message"]);
      return s;
    })();

    logSheet.appendRow([new Date(), level, message]);

  } catch (e) {
    console.error("logToMother_ error:", e);
  }
}

function EV33_recordTimeline(stage, module, summary, source, notes) {
  const METRON_OS_ID = getTargetId();
  try {
    const ss = SpreadsheetApp.openById(METRON_OS_ID);
    let sheet = ss.getSheetByName("Evolution_Timeline");

    if (!sheet) {
      sheet = ss.insertSheet("Evolution_Timeline");
      sheet.appendRow(["Timestamp", "Stage", "Module", "Summary", "Source", "Notes"]);
    }

    sheet.appendRow([
      new Date(),
      stage || "",
      module || "",
      summary || "",
      source || "",
      notes || ""
    ]);

  } catch (e) {
    console.error("EV33_recordTimeline error:", e);
  }
}
