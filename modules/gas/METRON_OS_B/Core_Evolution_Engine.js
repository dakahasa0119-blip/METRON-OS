/**
 * Core_Evolution_Engine.gs
 *
 * 母艦の自律進化エンジン
 * - Bootloader（進化状態管理・監視・ログ）
 * - 進化案生成ロジック（Proposal）
 * - コード統合アルゴリズム（PatchSlots → Injection_Slot）
 * - 受肉エンジン（PROPOSED / STAGED → PATCH_APPLIED → DONE）
 */

const EV_NS = "METRON_EV_V1";

/* ==================================================
  A：基本ユーティリティ
================================================== */

/**
 * 母艦のスプレッドシートを取得
 */
function EV_getMotherSheet_() {
  try {
    return SpreadsheetApp.getActive();
    // return SpreadsheetApp.openById(METRON_OS_ID);
  } catch (e) {
    throw new Error("母艦スプレッドシート取得失敗: " + e.message);
  }
}

/**
 * SystemLog への書き込み
 */
function EV_log_(level, message) {
  try {
    const ss = EV_getMotherSheet_();
    let sheet = ss.getSheetByName("SystemLog");
    if (!sheet) {
      sheet = ss.insertSheet("SystemLog");
      sheet.appendRow(["Timestamp", "Level", "Message"]);
    }
    sheet.appendRow([new Date(), level, message]);
  } catch (e) {
    // ログ書き込みでさらに落ちないように握りつぶす
  }
}

/**
 * Bootloader / Evolution 用 Properties
 */
function EV_getProps_() {
  return PropertiesService.getScriptProperties();
}

/* ==================================================
  B：Bootloader 初期化・状態管理
================================================== */

/**
 * 初期化
 * - SystemLog / Injection_Slot / PatchSlots がなければ作成
 */
function EV_bootloaderInit() {
  const ss = EV_getMotherSheet_();

  // SystemLog
  if (!ss.getSheetByName("SystemLog")) {
    const logSheet = ss.insertSheet("SystemLog");
    logSheet.appendRow(["Timestamp", "Level", "Message"]);
  }

  // Injection_Slot
  if (!ss.getSheetByName("Injection_Slot")) {
    const inj = ss.insertSheet("Injection_Slot");
    inj.appendRow(["Timestamp", "Target", "Filename", "Code", "Status"]);
  }

  // PatchSlots（積層用）
  if (!ss.getSheetByName("PatchSlots")) {
    const ps = ss.insertSheet("PatchSlots");
    ps.appendRow([
      "Timestamp",   // 0
      "Filename",    // 1 対象モジュール名（例: Core_AI）
      "SlotName",    // 2 PATCH_SLOT_XX など
      "Priority",    // 3 数字が小さいほど先に適用
      "Code",        // 4 実際のコード
      "Status",      // 5 ACTIVE / DISABLED など
      "Note"         // 6 説明
    ]);
  }

  EV_log_("INFO", "EV_bootloaderInit 完了");
}

/**
 * Bootloader の定期実行エントリ
 * - 時間トリガーで回す想定
 * - ここでは「受肉 → 後処理」をまとめて呼ぶ
 */
function runAutonomousCycle() {
  // ★ 実行ログに必ず出る（先頭に ' を付けて数式化を防止）
  console.log("=== runAutonomousCycle START ===");
  EV_log_("INFO", "'=== runAutonomousCycle START ===");

  try {
    // ★ どこまで進んだか必ず見える
    const promoted = EV_promoteProposalsToStaged_();
    console.log("promoted:", promoted);
    EV_log_("INFO", "'promoted: " + promoted);

    const applied = EV_applyStagedPatches_();
    console.log("applied:", applied);
    EV_log_("INFO", "'applied: " + applied);

    const finalized = EV_processInjectionSlot_();
    console.log("finalized:", finalized);
    EV_log_("INFO", "'finalized: " + finalized);

    EV_log_("INFO", `'runAutonomousCycle: promoted=${promoted}, applied=${applied}, finalized=${finalized}`);

  } catch (e) {
    console.error("runAutonomousCycle failed:", e);
    EV_log_("ERROR", "'runAutonomousCycle failed: " + e.message);
    EV_recordBootError_(e);
  }

  // ★ 終了ログも必ず出る（ここも ' を付ける）
  console.log("=== runAutonomousCycle END ===");
  EV_log_("INFO", "'=== runAutonomousCycle END ===");
}

/**
 * Injection_Slot の状態遷移処理（PATCH_APPLIED → DONE）
 */
function EV_processInjectionSlot_() {
  const ss = EV_getMotherSheet_();
  const sheet = ss.getSheetByName("Injection_Slot");
  if (!sheet) return "NO_SLOT";

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "NO_PATCH";

  const range = sheet.getRange(2, 1, lastRow - 1, 5);
  const values = range.getValues();

  let processed = 0;
  let lastFile = null;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const status = row[4];

    if (status === "PATCH_APPLIED") {
      const filename = row[2];
      const ts = row[0] || new Date();

      values[i][4] = "DONE";

      EV_log_("INFO", "母艦側で PATCH_APPLIED → DONE: " + filename);
      EV_saveLastPatchMeta_({
        filename,
        timestamp: ts,
        status: "DONE"
      });

      if (typeof EV33_recordTimeline === "function") {
        EV33_recordTimeline("DONE", filename, "母艦進化完了", "Bootloader", "");
      }

      processed++;
      lastFile = filename;
    }
  }

  if (processed > 0) {
    range.setValues(values);
  }

  if (processed === 0) return "NO_NEW_PATCH";
  return "PATCHES_PROCESSED: " + processed + (lastFile ? (" (last: " + lastFile + ")") : "");
}

/**
 * 最終パッチ情報の保存
 */
function EV_saveLastPatchMeta_(meta) {
  const props = EV_getProps_();
  props.setProperty(
    EV_NS + "_LAST_PATCH",
    JSON.stringify({
      filename: meta.filename || "",
      timestamp: meta.timestamp ? new Date(meta.timestamp).toISOString() : new Date().toISOString(),
      status: meta.status || "",
      note: meta.note || ""
    })
  );
}

/**
 * 最終パッチ情報の取得
 */
function EV_getLastPatchMeta() {
  const props = EV_getProps_();
  const raw = props.getProperty(EV_NS + "_LAST_PATCH");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * エラーカウンタ管理
 */
function EV_recordBootError_(error) {
  const props = EV_getProps_();
  const key = EV_NS + "_ERROR_COUNT";
  const count = Number(props.getProperty(key) || "0") + 1;
  props.setProperty(key, String(count));

  EV_log_("ERROR", "Boot error count = " + count + " / " + error.message);
}

function EV_resetBootErrorCount() {
  const props = EV_getProps_();
  const key = EV_NS + "_ERROR_COUNT";
  props.deleteProperty(key);
  EV_log_("INFO", "Boot error count reset");
}

/* ==================================================
  C：進化案生成ロジック（Proposal）
================================================== */

/**
 * 進化案を生成して Injection_Slot に登録
 * Status = PROPOSED
 */
function EV_generateEvolutionProposal(filename, code, options) {
  options = options || {};
  if (!filename || !code) {
    throw new Error("EV_generateEvolutionProposal: filename または code が空です");
  }

  const ss = EV_getMotherSheet_();
  let inj = ss.getSheetByName("Injection_Slot");
  if (!inj) {
    inj = ss.insertSheet("Injection_Slot");
    inj.appendRow(["Timestamp", "Target", "Filename", "Code", "Status"]);
  }

  const target = "METRON_OS";
  const status = "PROPOSED";

  inj.appendRow([
    new Date(),
    target,
    filename,
    code,
    status
  ]);

  const summary = options.summary || ("Proposal: " + filename);
  const type = options.type || "UNKNOWN";
  const risk = options.risk || "UNKNOWN";
  const testPlan = options.testPlan || "未定義";

  EV_log_("INFO", `[EV_PROPOSAL] type=${type} risk=${risk} module=${filename} summary=${summary} test=${testPlan}`);

  if (typeof EV33_attachMetadataToProposal === "function") {
    EV33_attachMetadataToProposal(inj.getLastRow(), {
      type: type,
      risk: risk,
      impact: options.impact || "UNKNOWN",
      testPlan: testPlan,
      author: "MotherShip",
      confidence: 0.95,
      summary: summary,
      description: options.description || ""
    });
  }

  if (typeof EV33_recordTimeline === "function") {
    EV33_recordTimeline("PROPOSED", filename, summary, "EvolutionEngine", "");
  }

  return {
    filename: filename,
    status: status
  };
}

/**
 * PROPOSED → STAGED に昇格させる
 */
function EV_promoteProposalsToStaged_() {
  const ss = EV_getMotherSheet_();
  const sheet = ss.getSheetByName("Injection_Slot");
  if (!sheet) return "NO_SLOT";

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "NO_PROPOSAL";

  const range = sheet.getRange(2, 1, lastRow - 1, 5);
  const values = range.getValues();

  let promoted = 0;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const status = row[4];

    if (status === "PROPOSED") {
      values[i][4] = "STAGED";
      promoted++;

      const filename = row[2];
      EV_log_("INFO", `EV_promoteProposalsToStaged_: PROPOSED → STAGED / ${filename}`);

      if (typeof EV33_recordTimeline === "function") {
        EV33_recordTimeline("STAGED", filename, "進化案が STAGED に昇格", "EvolutionEngine", "");
      }
    }
  }

  if (promoted > 0) {
    range.setValues(values);
  }

  return promoted > 0 ? `PROMOTED: ${promoted}` : "NO_PROPOSAL";
}

/* ==================================================
  D：受肉エンジン（STAGED → PATCH_APPLIED）
================================================== */

/**
 * Injection_Slot の STAGED を受肉して PATCH_APPLIED に進める
 */
function EV_applyStagedPatches_() {
  const ss = EV_getMotherSheet_();
  const sheet = ss.getSheetByName("Injection_Slot");
  if (!sheet) return "NO_SLOT";

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "NO_STAGED";

  const range = sheet.getRange(2, 1, lastRow - 1, 5);
  const values = range.getValues();

  let applied = 0;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const status = row[4];   // 状態
    const filename = row[2]; // ファイル名
    const code = row[3];     // ソースコード

    if (status === "STAGED") {
      try {
        EV_applyPatchToMotherShip_(filename, code);

        values[i][4] = "PATCH_APPLIED";
        applied++;

        EV_log_("INFO", `EV_applyStagedPatches_: PATCH_APPLIED / ${filename}`);

        if (typeof EV33_recordTimeline === "function") {
          EV33_recordTimeline("PATCH_APPLIED", filename, "母艦にパッチ適用", "Core_Evolution_Engine", "");
        }

      } catch (e) {
        values[i][4] = "ERROR: " + e.message;
        EV_log_("ERROR", `EV_applyStagedPatches_: FAILED ${filename} / ${e.message}`);
      }
    }
  }

  range.setValues(values);

  return applied > 0 ? `STAGED_APPLIED: ${applied}` : "NO_STAGED";
}

/**
 * 実際に「母艦のコード」を書き換える処理
 * - Phase 4: ARC（PROXY-HAND）へ実体化を委譲する
 */
function EV_applyPatchToMotherShip_(filename, newCode) {
  const purified = extractPureCode(newCode);
  const motherShipId = SpreadsheetApp.getActive().getId();

  const arcPrompt = `
スプレッドシート [ ${motherShipId} ] にバインドされた Apps Script プロジェクトのファイル「${filename}」を以下のコードで上書きせよ：
\`\`\`javascript
${purified}
\`\`\`
`;

  try {
    if (typeof METRON_GATEWAY_BRIDGE !== 'undefined') {
      METRON_GATEWAY_BRIDGE.enqueueArcJob("gemini", arcPrompt, "", "request_arc");
      EV_log_("INFO", `[${filename}] のパッチ適用ジョブをARCに委譲しました。`);
    } else {
      throw new Error("METRON_GATEWAY_BRIDGE is missing.");
    }
  } catch (e) {
    throw new Error("ARC委譲 failed for " + filename + ": " + e.message);
  }
}

/* ==================================================
  E：コード統合アルゴリズム（PatchSlots → 統合ソース）
================================================== */

/**
 * PatchSlots シートから指定ファイルのコードを統合し、
 * ひとつのソースコード文字列として返す。
 */
function EV_buildIntegratedCode(filename) {
  const ss = EV_getMotherSheet_();
  const sheet = ss.getSheetByName("PatchSlots");
  if (!sheet) {
    throw new Error("PatchSlots シートが存在しません");
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error("PatchSlots に有効な行がありません");
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();

  const slots = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const fName = row[1];
    const slotName = row[2];
    const priority = row[3];
    const code = row[4];
    const status = row[5];

    if (fName === filename && status === "ACTIVE") {
      slots.push({
        slotName: slotName || ("SLOT_" + (i + 2)),
        priority: Number(priority || 9999),
        code: code || ""
      });
    }
  }

  if (slots.length === 0) {
    throw new Error("指定ファイルに対する ACTIVE スロットがありません: " + filename);
  }

  slots.sort((a, b) => a.priority - b.priority);

  let integrated = "";
  slots.forEach((s, idx) => {
    integrated +=
      "// ===== PATCH SLOT: " + s.slotName + " (priority=" + s.priority + ") =====\n\n" +
      s.code +
      "\n\n";
    if (idx < slots.length - 1) {
      integrated += "// ---- NEXT PATCH SLOT ----\n\n";
    }
  });

  EV_log_("INFO", "EV_buildIntegratedCode: " + filename + " / slots=" + slots.length);

  return integrated;
}

/**
 * 統合コードを直接 Injection_Slot に「進化案」として流し込むヘルパー
 */
function EV_buildAndPropose(filename) {
  const integrated = EV_buildIntegratedCode(filename);

  return EV_generateEvolutionProposal(filename, integrated, {
    type: "INTEGRATED",
    summary: "PatchSlots から統合された進化案",
    risk: "要確認",
    testPlan: "主要フローの手動テスト"
  });
}