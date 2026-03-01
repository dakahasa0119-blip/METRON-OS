/**
 * Singularity v33.0 – Evolution Core
 * 母艦の進化を司る中枢器官（Timeline / Metadata / Promotion）
 * 既存の Forge_Master / Evolution_Engine と完全分離して動作
 * すべて EV33_ 名前空間で隔離
 */

/* ============================================================
   1. Evolution Timeline Engine
   - 進化の全ステージを時系列で記録
   - Forge → PatchSlots → Proposal → APPROVED → APPLIED → DONE
============================================================ */

function EV33_recordTimeline(stage, module, summary, source, notes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Evolution_Timeline");

  if (!sheet) {
    sheet = ss.insertSheet("Evolution_Timeline");
    sheet.appendRow(["Timestamp", "Stage", "Module", "Summary", "Source", "Notes"]);
  }

  sheet.appendRow([
    new Date(),
    stage,
    module || "",
    summary || "",
    source || "",
    notes || ""
  ]);
}


/* ============================================================
   2. Proposal Metadata Engine
   - Injection_Slot の F列に JSON メタ情報を付与
   - type / risk / impact / testPlan / author / confidence / summary
============================================================ */

function EV33_attachMetadataToProposal(rowIndex, metadata) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Injection_Slot");
  if (!sheet) return;

  const json = JSON.stringify(metadata || {});
  sheet.getRange(rowIndex, 6).setValue(json);
}


/* ============================================================
   3. Forge → PatchSlots Promotion Engine
   - Forge_Staging のコードを PatchSlots に昇格
   - SlotName / Priority 自動生成
   - Timeline に PROMOTED を記録
============================================================ */

function EV33_promoteStagedToPatchSlots(docUrl) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const forge = ss.getSheetByName("Forge_Staging");
  if (!forge) return "Forge_Staging が存在しません";

  const patch = ss.getSheetByName("PatchSlots") || ss.insertSheet("PatchSlots");

  const data = forge.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    if (row[5] === docUrl) { // F列: URL
      const filename = row[1];
      const code = row[3];
      const summary = row[2];

      // PatchSlots に昇格
      patch.appendRow([
        new Date(),
        filename,
        "PATCH_SLOT_AUTO_" + Date.now(),
        999,
        code,
        "ACTIVE",
        "Forge昇格"
      ]);

      // Forge_Staging の状態更新
      forge.getRange(i + 1, 5).setValue("PROMOTED");

      // Timeline 記録
      EV33_recordTimeline(
        "PROMOTED",
        filename,
        summary,
        "Forge → PatchSlots",
        docUrl
      );

      return "PROMOTED";
    }
  }

  return "NOT_FOUND";
}


/* ============================================================
   4. Gateway から呼べる昇格ラッパー
   - Gateway.gs から google.script.run で呼ぶ用
============================================================ */

function promoteStagedToPatchSlots(docUrl) {
  return EV33_promoteStagedToPatchSlots(docUrl);
}

function EV33_autoRebalancePriorities(filename) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PatchSlots");
  if (!sheet) return;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  let slots = [];

  data.forEach((r, i) => {
    if (r[1] === filename && r[5] === "ACTIVE") {
      slots.push({ row: i + 2, priority: r[3] });
    }
  });

  slots.sort((a, b) => a.priority - b.priority);

  slots.forEach((s, idx) => {
    sheet.getRange(s.row, 4).setValue((idx + 1) * 10);
  });
}

function EV33_autoPromoteIfSafe(docUrl) {
  const meta = EV33_extractMetadataFromDoc(docUrl);
  if (!meta) return;

  if (meta.risk === "LOW" && meta.confidence > 0.8) {
    EV33_promoteStagedToPatchSlots(docUrl);
    EV33_recordTimeline("AUTO_PROMOTED", meta.filename, "AI 自動昇格", "EvolutionCore", docUrl);
  }
}

/**
 * Forge_Staging の Doc URL からメタ情報を抽出する
 * - ドキュメント本文から JSON を探す
 * - または Forge_Staging の C列（説明）を fallback として使う
 */
function EV33_extractMetadataFromDoc(docUrl) {
  try {
    const doc = DocumentApp.openByUrl(docUrl);
    const text = doc.getBody().getText();

    // ■ メタ情報セクションを抽出（JSON が埋め込まれている場合）
    const marker = "■ META_JSON：";
    if (text.includes(marker)) {
      const jsonPart = text.split(marker)[1].trim();
      try {
        return JSON.parse(jsonPart);
      } catch (e) {
        // JSON パース失敗 → fallback
      }
    }

    // fallback：Forge_Staging から取得
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const forge = ss.getSheetByName("Forge_Staging");
    if (!forge) return null;

    const data = forge.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][5] === docUrl) {
        return {
          filename: data[i][1],
          summary: data[i][2],
          risk: "UNKNOWN",
          confidence: 0.5
        };
      }
    }

    return null;

  } catch (e) {
    return null;
  }
}