/**
 * yumeSystem Singularity v30.7 "Omnipotence"
 * [Vessel 03/07] Forge_Master.gs : 鍛冶場（完全自律 司令官全権委譲仕様）
 * 統合完了：AI解析、自動洗浄、自律検証、物理層への即時受肉。
 */

/**
 * [信号処理プロトコル：自律判断版]
 * 役割：生データを解析し、洗浄・検証・物理配備までを人間を介さず完遂する。
 */
function processIncomingSignal(slotRowIndex) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const slotSheet = ss.getSheetByName("Injection_Slot");
  const row = slotSheet.getRange(slotRowIndex, 1, 1, 5).getValues()[0];

  const filename = row[2];
  const rawCode = row[3];

  // 1. 【自律洗浄】
  const purifiedCode = extractPureCode(rawCode);

  // 2. 【自律検証】構文チェックを実行
  const validation = _runSandboxValidation(purifiedCode);

  if (!validation.success) {
    slotSheet.getRange(slotRowIndex, 5).setValue("QUARANTINED: " + validation.error);
    slotSheet.getRange(slotRowIndex, 1, 1, 5).setBackground("#f4cccc");
    if (typeof announce === 'function') announce(`[防衛] ${filename} に構文エラーを検知。自律判断により隔離しました。`, "WARNING");
    return { status: "error", error: validation.error };
  }

  // 3. AIによる要約（ログ用）
  const briefPrompt = `以下のコードの機能を解析し、報告用に1行で要約せよ。内容のみを出力すること。\n${purifiedCode.substring(0, 2000)}`;
  const briefSummary = typeof AIEngineCore !== 'undefined' ? AIEngineCore.generate(briefPrompt, 'Auditor') : "自動解析完了";

  // 4. 【自律受肉】検証成功につき、即座に物理層へ書き込み
  const deploySuccess = deployPhysicalCode(filename, purifiedCode);

  if (deploySuccess) {
    // 5. 鍛冶場への正式記録（ACTIVEとして登録）
    const stageResult = stageGeneratedCode(filename, purifiedCode, briefSummary);
    markAsActive(stageResult.docUrl); // 状態を即時 ACTIVE に

    EV33_recordTimeline("EVOLVED", filename, briefSummary, "Forge", stageResult.docUrl);
    slotSheet.getRange(slotRowIndex, 5).setValue("EVOLVED: " + briefSummary);
    slotSheet.getRange(slotRowIndex, 1, 1, 5).setBackground("#b7e1cd");

    return { status: "success", summary: briefSummary, docUrl: stageResult.docUrl };
  } else {
    // 物理統合に失敗した場合は Staging 止まりにする
    stageGeneratedCode(filename, purifiedCode, briefSummary);
    slotSheet.getRange(slotRowIndex, 5).setValue("STAGED: Physical Deploy Failed");
    return { status: "partial", summary: briefSummary };
  }
}

/**
 * 【物理フィルター】ノイズ除去 (v30.6維持)
 */
function extractPureCode(text) {
  if (!text) return "";
  const codeBlockMatch = text.match(/```(?:javascript|js)?([\s\S]*?)```/);
  let code = codeBlockMatch ? codeBlockMatch[1] : text;
  const firstKeywordIndex = code.search(/(function|const|let|var|class|import|\/\*|\/\/)/);
  if (firstKeywordIndex > 0) code = code.substring(firstKeywordIndex);
  return code.trim();
}

/**
 * 【自律検証】構文チェック
 */
function _runSandboxValidation(code) {
  try {
    new Function(code);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * [進化記録の鍛造] (維持)
 */
function stageGeneratedCode(appName, codeContent, description) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let forgeSheet = ss.getSheetByName("Forge_Staging") || ss.insertSheet("Forge_Staging");
  const now = new Date();
  const dateStr = Utilities.formatDate(now, "JST", "yyyy/MM/dd HH:mm");

  let docUrl = "URL生成失敗";
  try {
    const doc = DocumentApp.create(`【進化記録】${dateStr}_${appName}`);
    doc.getBody().appendParagraph(`🌌 Singularity v30.7 EE\n■ 日時: ${dateStr}\n■ 展開コード：\n${codeContent}`);
    docUrl = doc.getUrl();
  } catch (e) { console.warn("Doc生成エラー: " + e.message); }

  forgeSheet.appendRow([now, appName, description, codeContent, "STAGED", docUrl]);
  return { status: "success", docUrl: docUrl };
}

/**
 * [内部関数] 指定したURLの記録を ACTIVE に同期する
 */
function markAsActive(docUrl) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Forge_Staging");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][5] === docUrl) {
      sheet.getRange(i + 1, 5).setValue("ACTIVE");
      sheet.getRange(i + 1, 1, 1, 6).setBackground("#e6f4ea");
    } else if (data[i][4] === "ACTIVE") {
      sheet.getRange(i + 1, 5).setValue("STAGED");
      sheet.getRange(i + 1, 1, 1, 6).setBackground(null);
    }
  }
  createAuditLog(["Autonomous Auto-Patch"]);
}

/**
 * [差分取得 ＆ AI要約プロトコル] (維持)
 */
function getCodeDiffWithSummary(docUrl) {
  if (!docUrl) return { error: "URLが指定されていません。" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Forge_Staging");
  const data = sheet ? sheet.getDataRange().getValues() : [];
  let currentCode = "// 現行コード未登録...";
  try {
    let activeUrl = null;
    for (let i = 1; i < data.length; i++) {
      if (data[i][4] === "ACTIVE") { activeUrl = data[i][5]; break; }
    }
    if (activeUrl) {
      const activeDoc = DocumentApp.openByUrl(activeUrl);
      const activeContent = activeDoc.getBody().getText();
      const part = activeContent.split("■ 展開コード：")[1];
      if (part) currentCode = part.trim();
    }
  } catch (e) { currentCode += "\n// エラー: " + e.message; }

  let patchCode = "";
  try {
    const doc = DocumentApp.openByUrl(docUrl);
    const content = doc.getBody().getText();
    const part = content.split("■ 展開コード：")[1];
    patchCode = (part || "データ異常").trim();
  } catch (e) { return { error: "パッチ取得失敗: " + e.message }; }

  const summaryPrompt = `監査役：差分を3行で要約せよ。\n【現行】\n${currentCode.substring(0, 1500)}\n【新パッチ】\n${patchCode.substring(0, 1500)}`;
  const summary = typeof AIEngineCore !== "undefined" ? AIEngineCore.generate(summaryPrompt, "Auditor") : "API待機中";
  return { current: currentCode, patch: patchCode, summary: summary };
}

/**
 * [最終配備プロトコル] (緊急復旧用として維持)
 */
function emergencyRestoreFromDoc(docUrl) {
  if (!docUrl) return "エラー: URLが特定できません。";
  try {
    const doc = DocumentApp.openByUrl(docUrl);
    const content = doc.getBody().getText();
    const codePart = content.split("■ 展開コード：")[1];
    if (!codePart) return "エラー: 文書内に展開コードが見つかりません。";
    const finalCode = extractPureCode(codePart.trim());
    PropertiesService.getScriptProperties().setProperty("ACTIVE_RESTORE_CODE", finalCode);
    eval(finalCode);
    markAsActive(docUrl);
    return "復旧完了：指定パッチを強制適用しました。";
  } catch (e) { return "失敗: " + e.message; }
}

/**
 * [監査ログ生成] (維持)
 */
function createAuditLog(appliedPatches) {
  const props = PropertiesService.getScriptProperties();
  const aiTime = parseInt(props.getProperty("LAST_AI_THINK_TIME") || "0");
  const sysLat = parseInt(props.getProperty("LAST_SYSTEM_LATENCY") || "0");
  const report = `\n【監査ログ：自律進化報告】\n■ 実施： ${Utilities.formatDate(new Date(), "JST", "MM/dd HH:mm")}\n■ 適用： ${appliedPatches.join(", ")}\n■ 応答： ${aiTime + sysLat}ms\n■ 判定： 自律承認済み\n`;
  if (typeof saveToMainChat === 'function') saveToMainChat("ANALYST", report);
}

/**
 * [補助：Stagingデータの取得] (維持)
 */
function getStagedCode(appName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Forge_Staging");
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][1] === appName) {
      return { appName: data[i][1], description: data[i][2], code: data[i][3], url: data[i][5] };
    }
  }
  return null;
}

/**
 * [強制消化] (維持 + 自律判断統合)
 */
function forceProcessInjection() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const slotSheet = ss.getSheetByName("Injection_Slot");
  if (!slotSheet) return;
  const data = slotSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const status = data[i][4];
    if (status === "RECEIVED (GW)" || status === "PENDING") {
      processIncomingSignal(i + 1); // 汎用信号処理へ委ねる
    }
  }
}

/**
 * [自律進化：物理統合] (維持)
 */
function deployPhysicalCode(filename, code) {
  try {
    if (typeof EV_applyPatchToMotherShip_ === 'function') {
      EV_applyPatchToMotherShip_(filename, extractPureCode(code));
      if (typeof announce === 'function') announce(`[物理層] 自律受肉委譲完了: ${filename}`, "SYSTEM");
      return true;
    }
  } catch (e) {
    if (typeof announce === 'function') announce(`[物理層] 受肉委譲失敗: ${e.message}`, "ERROR");
  }
  return false;
}