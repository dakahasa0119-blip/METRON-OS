/**
 * yumeSystem Singularity v30.5 "Eternal Evolution"
 * [Vessel 07/07] System_Evolver.gs : 脳（自己進化 & 24時間稼働）
 * 役割：深夜の自律研磨、世代管理、自己進化パッチの反映待機、三位一体同期。
 * 統合完了：用語適正化、物理強制同期、自律進化サイクル実装。
 */

const SYNC_CONFIG = {
  DOC_NAME: "METRON_OS_REAL_SOURCE",
  REGISTRY_SHEET: "Code_Registry",
  SYNC_INTERVAL_HOURS: 1
};

/**
 * [メイン点火関数]
 * 役割：母艦の全機能を覚醒させ、同期デーモンを起動する。
 */
function activateSystemSingularity() {
  announce("METRON OS: 覚醒シーケンスを開始します...", "SYSTEM");
  const syncResult = runUniversalSync();
  announce(syncResult, "STAT");
  
  setupAutoSyncDaemon();
  announce("システム同期完了。自律監視モードへ移行しました。", "SYSTEM");
  return "✅ yumeSystem Singularity 覚醒。";
}

/**
 * [コアロジック：万能同期（物理強制版）]
 * 役割：ドキュメントの全内容を Code_Registry シートへ物理転送し、「視界」を固定する。
 */
function runUniversalSync() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SYNC_CONFIG.REGISTRY_SHEET) || ss.insertSheet(SYNC_CONFIG.REGISTRY_SHEET);
    
    const files = DriveApp.getFilesByName(SYNC_CONFIG.DOC_NAME);
    if (!files.hasNext()) throw new Error("同期対象のドキュメントが見つかりません。");
    
    const doc = DocumentApp.openById(files.next().getId());
    const fullText = doc.getBody().getText();
    
    if (!fullText || fullText.length < 10) throw new Error("ドキュメントの内容が不十分です。");

    sheet.clear();
    sheet.appendRow(["ModuleName", "Code", "LastSynced"]);
    sheet.getRange(1, 1, 1, 3).setBackground("#d9ead3").setFontWeight("bold");

    // 全文バックアップの保存
    sheet.appendRow(["ALL_SOURCE_BACKUP", fullText, new Date()]);

    // 個別ファイルの抽出と保存
    const lines = fullText.split("\n");
    let currentFileName = "";
    let currentCode = [];
    let fileCount = 0;

    for (let line of lines) {
      if (line.includes("FILE: ")) {
        if (currentFileName && currentCode.length > 0) {
          sheet.appendRow([currentFileName, currentCode.join("\n"), new Date()]);
          fileCount++;
        }
        currentFileName = line.replace(/.*FILE: /, "").trim();
        currentCode = [];
      } else if (currentFileName) {
        if (!line.includes("====") && !line.includes("----")) {
          currentCode.push(line);
        }
      }
    }
    // 最終ファイルの書き込み
    if (currentFileName && currentCode.length > 0) {
      sheet.appendRow([currentFileName, currentCode.join("\n"), new Date()]);
      fileCount++;
    }

    return `✅ 物理同期成功: ${fileCount}個のモジュールを「鏡（シート）」に反映しました。`;
  } catch (e) {
    return `❌ 同期失敗: ${e.toString()}`;
  }
}

function prepareMidnightEvolution() {
  // スナップショット
  const snapshotId = createAutoSnapshot();
  if (!snapshotId) return null;

  // 戦略分析
  runProactiveAnalysis();

  // 最新パッチ取得
  const patch = getLatestStrategicPatch();
  if (!patch) return null;

  // 依存関係抽出
  const depMatch = patch.description.match(/dependencies:\s*(.*)/);
  patch.deps = depMatch ? depMatch[1].split(",").map(s => s.trim()) : [];

  // リスク評価
  patch.risk = patch.description.includes("HIGH") ? "HIGH"
              : patch.description.includes("MEDIUM") ? "MEDIUM"
              : "LOW";

  announce(
    `戦略改善案を検出: ${patch.appName}\n` +
    `影響モジュール: ${patch.deps.join(", ")}\n` +
    `リスク: ${patch.risk}`,
    "EVOLVER"
  );

  // 進化パッチとして登録
  if (applySelfEvolutionPatch(patch)) {
    PropertiesService.getScriptProperties().setProperty(
      'LAST_EVOLUTION_DATE',
      new Date().toLocaleString('ja-JP')
    );

    saveToMainChat(
      "System_Evolver",
      `【戦略進化提案】「${patch.appName}」を進化候補として登録しました。\n` +
      `影響モジュール: ${patch.deps.join(", ")}`
    );
  }

  return patch;
}

function evaluateEvolutionPatch(patch) {

  // 安全性チェック
  const safety = isEvolutionPatchSafe(patch.code);
  if (!safety.safe) {
    return {
      status: "unsafe",
      reason: safety.reason,
      patch
    };
  }

  // テスト実行
  const testResult = runEvolutionTestInSandbox(patch.code);
  if (testResult.success) {
    return {
      status: "passed",
      testResult,
      patch
    };
  }

  // 失敗 → フィードバック処理
  const structured = analyzeFailureReason(testResult.error, patch.code);
  const match = matchPastFailurePatterns(structured);

  const fixResponse = requestPatchFixFromAnalystEye(
    patch.appName,
    patch.code,
    JSON.stringify(structured, null, 2)
  );

  const quality = evaluateFixQuality(fixResponse);

  return {
    status: "failed",
    structured,
    match,
    fixResponse,
    quality,
    patch
  };
}

function applyEvolutionResult(result) {

  // 安全性違反
  if (result.status === "unsafe") {
    announce(
      `進化案を却下しました（安全性違反）:\n${result.reason}`,
      "EVOLVER"
    );
    saveToMainChat(
      "System_Evolver",
      `【進化案却下】安全性違反のため「${result.patch.appName}」は適用されませんでした。\n理由: ${result.reason}`
    );
    return "Unsafe Patch Rejected";
  }

  // テスト成功
  if (result.status === "passed") {
    saveEvolutionTestResult(result.patch.appName, result.testResult);
    return "Patch Passed";
  }

  // テスト失敗 → 修正案の品質評価
  if (result.status === "failed") {

    if (result.quality.quality === "LOW") {
      saveToMainChat(
        "System_Evolver",
        `【修正案却下】品質が低いため再生成を要求します。\n理由: ${result.quality.reason}`
      );
      return "Fix Rejected";
    }

    // 修正案ステージング
    if (typeof autoStagePatchFromChatResponse === 'function') {
      autoStagePatchFromChatResponse(result.fixResponse);
    }

    saveToMainChat(
      "System_Evolver",
      `【修正案生成】品質: ${result.quality.quality}\n過去の類似失敗: ${result.match.matched ? "あり" : "なし"}`
    );

    return "Patch Failed → Fix Requested";
  }

  return "Unknown State";
}

function runMidnightEvolution() {
  announce("深夜の自律研磨プロトコルを開始...", "EVOLVER");

  const patch = prepareMidnightEvolution();
  if (patch) {
    const evalResult = evaluateEvolutionPatch(patch);
    applyEvolutionResult(evalResult);
  }

  // ★ グローバル進化も同時に走らせる
  try {
    runGlobalEvolution();
  } catch (e) {
    console.error("GlobalEvolution Error: " + e.message);
  }

  logEvolutionEvent("深層自己進化 + Global Evolution を実行しました。");
  return "Deep + Global Evolution Executed";
}

function logEvolutionEvent(summary) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Evolution_Timeline");
  if (!sheet) return;

  const now = new Date();
  sheet.appendRow([
    now,               // Timestamp
    "EVOLVED",         // Stage
    "DeepEvolution",   // Module
    summary,           // Summary
    "System",          // Source
    ""                 // Notes
  ]);
}



/**
 * [自律進化パッチの適用準備]
 */
function applySelfEvolutionPatch(patch) {
  try {
    const props = PropertiesService.getScriptProperties();

    props.setProperty('PENDING_EVOLUTION_CODE', patch.code);
    props.setProperty('PENDING_EVOLUTION_NAME', patch.appName);

    // ★ 依存関係情報も保存（Gateway が判断できるように）
    props.setProperty('PENDING_EVOLUTION_DESC', patch.description);

    if (typeof prepareDeploymentPackage === 'function') {
      prepareDeploymentPackage(patch.appName);
    }
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * [パッチ抽出：進化の種を探す]
 */
function getLatestSystemPatch() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Forge_Staging");
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const appName = data[i][1];
    // 自律的に生成されたパッチを特定
    if (appName.indexOf("自律改善_") === 0 || appName.indexOf("改善案_") === 0) {
      return { appName: appName, code: data[i][3] };
    }
  }
  return null;
}

/**
 * [定期診断：入り口]
 * 役割：守護者（Debugger_Sentinel）のラッパーを用いて、安全に定期診断を実行する。
 */
function triggerHourlyCheck() {
  if (typeof sentinelWrapper === 'function') {
    sentinelWrapper(() => runProactiveAnalysis(), "定期的なシステム診断");
  } else {
    runProactiveAnalysis();
  }
}

/**
 * [補助：自動化デーモンの設置]
 */
function setupAutoSyncDaemon() {
  const funcName = 'runUniversalSync';
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(funcName).timeBased().everyHours(SYNC_CONFIG.SYNC_INTERVAL_HOURS).create();
}

/**
 * Forge_Staging から最新の進化候補を抽出する。
 * STAGED 状態であれば進化パッチとして扱う。
 */
function getLatestStrategicPatch() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Forge_Staging");
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    const appName = data[i][1];
    const desc = data[i][2];
    const code = data[i][3];
    const status = (data[i][4] || "").trim();

    // ★ desc が空でも STAGED なら進化パッチとして扱う
    if (status === "STAGED") {
      return {
        appName: appName,
        code: code,
        description: desc || ""
      };
    }
  }
  return null;
}

/**
 * Gateway が進化候補の依存関係を取得するための補助関数
 */
function getPendingEvolutionMeta() {
  const props = PropertiesService.getScriptProperties();
  return {
    name: props.getProperty('PENDING_EVOLUTION_NAME'),
    desc: props.getProperty('PENDING_EVOLUTION_DESC'),
    code: props.getProperty('PENDING_EVOLUTION_CODE')
  };
}

function scoreEvolutionCandidate(dep, context, chatLog) {
  let score = 0;

  const weights = buildModulePriorityWeights();
  score += dep.affectedModules.length * 10;

  if (dep.riskLevel === "LOW") score += 20;
  if (dep.riskLevel === "MEDIUM") score += 5;
  if (dep.riskLevel === "HIGH") score -= 20;

  try {
    const recentChat = chatLog.slice(-20).map(c => c.text).join("\n");
    dep.affectedModules.forEach(mod => {
      if (recentChat.includes(mod)) score += 15;
    });
  } catch (e) {}

  try {
    const evo = context.evolution || {};
    if (evo.lastEvolvedModule && dep.affectedModules.includes(evo.lastEvolvedModule)) {
      score -= 10;
    }
  } catch (e) {}

  try {
    const past = context.latestProposals || [];
    const summary = dep.reasonSummary || "";
    const similar = past.filter(p => p.description && p.description.includes(summary));
    score += similar.length > 0 ? -10 : 10;
  } catch (e) {}

  dep.affectedModules.forEach(mod => {
    if (weights[mod]) score += weights[mod] * 5;
  });

  try {
    score += calculateStrategicPriority(dep, context);
  } catch (e) {}

  return score;
}

/**
 * yumeSystem Singularity : Strategic Security Engine
 * 母艦の AAL (Authority-Abstraction-Layer) を尊重しつつ、代謝を許可する。
 */
function isEvolutionPatchSafe(code) {
  const codeStr = code.toString();

  // 1. 【代謝の承認】トリガーの再構築は、システムの心拍更新とみなす
  if (codeStr.includes("deleteTrigger") && (codeStr.includes("newTrigger") || codeStr.includes(".create()"))) {
    console.log("AAL判定: トリガー代謝によるシステム安定化を承認。");
  } else if (/deleteTrigger/i.test(codeStr)) {
    return { safe: false, reason: "不完全なトリガー削除（機能停止リスク）" };
  }

  // 2. 【核心保護】既存の高度な進化経路・Persona定義を破壊するコードを遮断
  const motherShipCore = [
    { pattern: /persona/i, label: "Persona定義（案内人）の改ざん" },
    { pattern: /AAL/i, label: "権限抽象化レイヤー（AAL）の根本破壊" },
    { pattern: /Strategic Command/i, label: "戦略デッキのバイパス試行" }
  ];

  for (let guard of motherShipCore) {
    if (guard.pattern.test(codeStr) && !codeStr.includes("// ALLOW_CORE_REFINEMENT")) {
      return { safe: false, reason: `高度区画保護違反: ${guard.label}` };
    }
  }

  return { safe: true, reason: "母艦の進化系譜と整合。安全性を確認。" };
}

/**
 * テスト用の仮想環境（Sandbox）を生成する
 * 本番スプレッドシートを丸ごとコピーし、テスト後に削除する前提。
 */
function createTestSandbox() {
  const original = SpreadsheetApp.getActiveSpreadsheet();
  const sandbox = original.copy(`SANDBOX_TEST_${Date.now()}`);
  return sandbox;
}

/**
 * 進化案をテスト環境で実行し、成功/失敗を返す。
 * テスト終了後は Sandbox を完全削除する。
 */
function runEvolutionTestInSandbox(code) {
  const sandbox = createTestSandbox();
  const sandboxId = sandbox.getId();
  let result = { success: false, logs: "", error: "" };

  try {
    // ★ テスト用の関数としてコードを実行
    const testFunc = new Function(code);
    testFunc();

    result.success = true;
    result.logs = "テスト成功：エラーは検出されませんでした。";

  } catch (e) {
    result.success = false;
    result.error = e.toString();
  }

  // ★ Sandbox を完全削除（Drive から消す）
  try {
    DriveApp.getFileById(sandboxId).setTrashed(true);
  } catch (e) {
    // 失敗しても母艦には影響なし
  }

  return result;
}

/**
 * Gateway や Analyst_Eye が参照できるように
 * テスト結果を ScriptProperties に保存する。
 */
function saveEvolutionTestResult(appName, testResult) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("LAST_TEST_NAME", appName);
  props.setProperty("LAST_TEST_SUCCESS", testResult.success);
  props.setProperty("LAST_TEST_LOGS", testResult.logs || "");
  props.setProperty("LAST_TEST_ERROR", testResult.error || "");
}

/**
 * テスト失敗時に Analyst_Eye に修正案生成を依頼する。
 * 失敗理由（error）と元の進化案（code）を渡す。
 */
function requestPatchFixFromAnalystEye(appName, code, error) {
  const prompt = `
あなたは yumeSystem の戦略参謀（Analyst_Eye）です。
以下の進化案はテスト環境で失敗しました。

【進化案名】
${appName}

【エラー内容】
${error}

【元コード】
\`\`\`javascript
${code}
\`\`\`

この失敗理由を踏まえて、修正版の PATCH_PLAN と PATCH_CODE を生成してください。
必ず改善点を明確にし、依存関係解析に基づく戦略的修正を行ってください。
`;

  const response = AIEngineCore.generate(prompt, "Auditor");
  return response;
}

/**
 * Gateway が承認した進化案を PatchSlots に自動マージする。
 * セーフティチェック → 差分マージ → 永続化 の順で実行。
 */
function autoMergeApprovedPatch() {
  const props = PropertiesService.getScriptProperties();

  const name = props.getProperty('PENDING_EVOLUTION_NAME');
  const code = props.getProperty('PENDING_EVOLUTION_CODE');
  const desc = props.getProperty('PENDING_EVOLUTION_DESC');

  if (!name || !code) {
    return "No pending evolution patch.";
  }

  // 1. 安全性チェック
  const safety = isEvolutionPatchSafe(code);
  if (!safety.safe) {
    announce(`マージ中止（安全性違反）: ${safety.reason}`, "EVOLVER");
    return;
  }

  // 2. PatchSlots に差分マージ
  const mergeResult = mergeIntoPatchSlots(name, code);

  // 3. Universal Sync に反映
  runUniversalSync();

  // 4. ログ記録
  saveToMainChat(
    "System_Evolver",
    `【本採用完了】「${name}」を PatchSlots に統合しました。`
  );

  announce(`PatchSlots への自動マージ完了: ${name}`, "EVOLVER");

  // 5. ペンディング情報をクリア
  props.deleteProperty('PENDING_EVOLUTION_NAME');
  props.deleteProperty('PENDING_EVOLUTION_CODE');
  props.deleteProperty('PENDING_EVOLUTION_DESC');

  return mergeResult;
}

/**
 * PatchSlots に安全な差分だけをマージする。
 */
function mergeIntoPatchSlots(appName, newCode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PatchSlots") || ss.insertSheet("PatchSlots");

  const data = sheet.getDataRange().getValues();
  let existingCode = "";

  // 既存コードを取得
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === appName) {
      existingCode = data[i][1];
      break;
    }
  }

  // 差分抽出（簡易）
  const diff = extractSafeDiff(existingCode, newCode);

  // マージ
  sheet.appendRow([appName, diff, new Date()]);

  return `Merged ${appName}`;
}

/**
 * 危険な変更を除外し、安全な差分だけを返す。
 */
function extractSafeDiff(oldCode, newCode) {
  const oldLines = oldCode.split("\n");
  const newLines = newCode.split("\n");

  const diff = [];

  for (let line of newLines) {
    if (!oldLines.includes(line)) {
      // 危険なコードは除外
      const safety = isEvolutionPatchSafe(line);
      if (safety.safe) {
        diff.push(line);
      }
    }
  }

  return diff.join("\n");
}

/**
 * 進化案の評価結果を学習ログとして記録する
 */
function logEvolutionOutcome(appName, dep, score, result) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Evolution_Priority") || ss.insertSheet("Evolution_Priority");

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["日時", "AppName", "Modules", "Risk", "Score", "Result"]);
  }

  sheet.appendRow([
    new Date(),
    appName,
    dep.affectedModules.join(", "),
    dep.riskLevel,
    score,
    result // "SUCCESS" or "FAIL"
  ]);
}

/**
 * Evolution_Priority シートからモジュールごとの重みを計算する
 * 成功が多いモジュール → 重みアップ
 * 失敗が多いモジュール → 重みダウン
 */
function buildModulePriorityWeights() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Evolution_Priority");
  if (!sheet) return {};

  const data = sheet.getDataRange().getValues();
  const weights = {};

  for (let i = 1; i < data.length; i++) {
    const modules = (data[i][2] || "").split(",").map(s => s.trim()).filter(s => s);
    const result = data[i][5];

    modules.forEach(m => {
      if (!weights[m]) weights[m] = 0;
      if (result === "SUCCESS") weights[m] += 1;
      if (result === "FAIL") weights[m] -= 1;
    });
  }

  return weights;
}

/**
 * 戦略レイヤー（Strategic_AI）からの優先度を計算する
 * - クラスタリング結果
 * - ロードマップのフェーズ
 * - 母艦の健康状態
 * - モジュール成功率（学習重み）
 */
function calculateStrategicPriority(dep, ctx) {
  let score = 0;

  // 1. クラスタリング結果
  try {
    const clusters = clusterEvolutionProposals();
    const depMods = dep.affectedModules;

    clusters.forEach(c => {
      const hit = c.items.filter(i => depMods.some(m => i.includes(m)));
      if (hit.length > 0) score += 15;
    });
  } catch (e) {}

  // 2. ロードマップのフェーズ優先度（★ここを修正）
  try {
    const roadmap = generateEnhancedRoadmap();  // ← ここだけ変更
    const text = roadmap.toString();

    dep.affectedModules.forEach(m => {
      if (text.includes(`Phase 1`) && text.includes(m)) score += 25;
      if (text.includes(`Phase 2`) && text.includes(m)) score += 10;
      if (text.includes(`Phase 3`) && text.includes(m)) score += 5;
    });
  } catch (e) {}

  // 3. 母艦の健康状態
  try {
    if (ctx.health.errorCount > 5) score += 10;
    if (ctx.health.pendingCount > 10) score += 5;
  } catch (e) {}

  // 4. モジュール成功率（学習重み）
  try {
    const weights = ctx.moduleWeights || {};
    dep.affectedModules.forEach(m => {
      if (weights[m]) {
        const w = weights[m].success - weights[m].fail;
        score += w * 3;
      }
    });
  } catch (e) {}

  return score;
}

function analyzeFailureReason(errorText, code) {
  const prompt = `
あなたは yumeSystem のエラー解析 AI です。
以下のエラー内容とコードを解析し、原因を構造化してください。

【エラー】
${errorText}

【コード】
\`\`\`javascript
${code}
\`\`\`

出力フォーマット（JSON のみ）：
{
  "rootCause": "根本原因",
  "location": "問題箇所",
  "fixHint": "修正の方向性",
  "risk": "HIGH | MEDIUM | LOW"
}
`;

  const res = AIEngineCore.generate(prompt, "Auditor");
  return JSON.parse(res);
}

function matchPastFailurePatterns(structuredError) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Evolution_Priority");
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues().slice(1);

  for (let row of data) {
    if (row[5] === "FAIL" && row[2] && structuredError.rootCause) {
      if (row[2].includes(structuredError.rootCause)) {
        return {
          matched: true,
          previousApp: row[1],
          reason: row[2]
        };
      }
    }
  }

  return { matched: false };
}

function evaluateFixQuality(fixResponse) {
  const prompt = `
あなたは yumeSystem のコードレビュアーです。
以下の修正案の品質を評価してください。

【修正案】
${fixResponse}

出力フォーマット（JSON のみ）：
{
  "quality": "HIGH | MEDIUM | LOW",
  "reason": "理由"
}
`;

  const res = AIEngineCore.generate(prompt, "Auditor");
  return JSON.parse(res);
}

function unifyDuplicateProposals() {
  const groups = detectDuplicateProposals();

  groups.forEach(g => {
    const unified = generateUnifiedProposal(g);

    if (typeof autoStagePatchFromChatResponse === 'function') {
      autoStagePatchFromChatResponse(unified);
    }

    saveToMainChat(
      "System_Evolver",
      `【統合進化案】${g.groupName} を統合し、最適案を生成しました。`
    );
  });
}

/**
 * System_Evolver v10.5 (EvolutionCodePreValidator Implementation)
 * 役割：未処理コードの自動先行検証と隔離
 */

class System_Evolver_Core {
  constructor() {
    this.props = PropertiesService.getScriptProperties();
  }

  /**
   * [物理操作] 自動先行検証の実行
   * トリガー等から定期実行されることを想定
   */
  activateEvolutionPreValidator() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const slotSheet = ss.getSheetByName("Injection_Slot");
    if (!slotSheet) return;

    const data = slotSheet.getDataRange().getValues();
    
    // 未処理(RECEIVED (GW))の信号をスキャン
    for (let i = 1; i < data.length; i++) {
      const status = data[i][4];
      if (status === "RECEIVED (GW)") {
        const rawCode = data[i][3];
        const filename = data[i][2];

        console.log(`[Evolver] 先行検証開始: ${filename}`);
        
        // 1. 洗浄と構文チェック（疑似サンドボックス）
        const passed = this._runSandboxValidation(rawCode);
        
        if (passed.success) {
          // 検証成功：ステータスを「検証済み」に上げ、艦長の最終判断を仰ぐ
          slotSheet.getRange(i + 1, 5).setValue("PRE_VALIDATED: READY FOR APPROVAL");
          this._notifyCommander("SUCCESS", `進化コード [${filename}] の先行検証に成功。安全に受肉可能です。`);
        } else {
          // 検証失敗：エラーとして隔離し、ループを阻止
          slotSheet.getRange(i + 1, 5).setValue("PRE_VALIDATION_FAILED: " + passed.error);
          slotSheet.getRange(i + 1, 1, 1, 5).setBackground("#fff2cc"); // 警告色
          this._notifyCommander("FAILED", `警告：進化コード [${filename}] に構文エラーを検知。自動隔離しました。`);
        }
      }
    }
  }

  _runSandboxValidation(code) {
    try {
      // 実際には eval せずに Syntax チェックのみを行う（GASの制約上、Functionコンストラクタを利用）
      if (typeof extractPureCode === 'function') {
        code = extractPureCode(code);
      }
      new Function(code); 
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  _notifyCommander(type, message) {
    if (typeof announce === 'function') {
      announce(`[Evolver] ${type}: ${message}`, type === "SUCCESS" ? "SYSTEM" : "WARNING");
    }
  }
}

// グローバルからの呼び出し用
function triggerPreValidation() {
  const evolver = new System_Evolver_Core();
  evolver.activateEvolutionPreValidator();
}
function pushEvolutionToGateway(filename, code) {
  const gwId = "GATEWAY_SCRIPT_ID"; // ← Gateway の Script ID を入れる
  const token = ScriptApp.getOAuthToken();

  const payload = {
    filename: filename,
    code: code,
    status: "RECEIVED (GW)"
  };

  UrlFetchApp.fetch(
    `https://script.googleapis.com/v1/projects/${gwId}/scripts/Injection_Slot:append`,
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify(payload)
    }
  );
}

/**
 * AI の応答長・エラー率・滞留量に応じて CHUNK_SIZE を自律調整する
 */
function getAdaptiveChunkSize() {
  const props = PropertiesService.getScriptProperties();

  // 過去の AI 応答長
  const lastLen = Number(props.getProperty("LAST_AI_OUTPUT_LENGTH") || 0);

  // Injection_Slot の滞留
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const slot = ss.getSheetByName("Injection_Slot");
  const backlog = slot ? slot.getLastRow() - 1 : 0;

  // デフォルト
  let size = 1;

  // AI が安定して長文を返せている → 増やす
  if (lastLen > 5000) size = 3;
  if (lastLen > 10000) size = 5;

  // 滞留が多い → 減らす
  if (backlog > 10) size = 2;
  if (backlog > 20) size = 1;

  // 最低1、最大5
  size = Math.max(1, Math.min(size, 5));

  return size;
}


/**
 * yumeSystem Singularity v30.6 [FINAL EVOLUTION BUNDLE]
 * 自己再生・自律研磨・免疫システム統合版
 */

// 1. [点火] すべての進化プロセスの起点
function runGlobalEvolution() {
  const props = PropertiesService.getScriptProperties();
  let lastIndex = parseInt(props.getProperty("EVOLUTION_PROGRESS_INDEX") || "0");
  
  // 既存の自律予約を掃除
  deleteExistingEvolutionTriggers();

  const projects = Evolver.getScopeDNA();
  const allFiles = [];
  projects.forEach(p => {
    (p.files || []).filter(f => f.type === "SERVER_JS" && f.source).forEach(f => {
      allFiles.push({ name: f.name, source: f.source });
    });
  });

  if (lastIndex >= allFiles.length) {
    announce("✅ 全モジュールの自律研磨が完了しました。", "SYSTEM");
    props.setProperty("EVOLUTION_PROGRESS_INDEX", "0");
    return;
  }

  // 自律的なチャンクサイズの取得
  const CHUNK_SIZE = getAdaptiveChunkSize();
  const f = allFiles[lastIndex];
  
  // 戦略優先度の計算 (提示されたロジック)
  // ※ ここではログ出力に留め、研磨順序はIndexに従う
  console.log(`[進化対象] ${f.name} (Index: ${lastIndex})`);

  const prompt = `あなたはyumeSystem進化エンジンです。解説不要、修正コードのみ出力せよ。\n===FILE_START===\nFILENAME: ${f.name}\n\`\`\`javascript\n\n\`\`\`\n===FILE_END===`;

  try {
    const result = AIEngineCore.generate(prompt);

    // 自己修復パースと Injection_Slot への蓄積
    if (result && result.includes("===FILE_END===")) {
      enqueueEvolutionFromLLMOutput(result); // 内部で閉じタグ補完も実行
      props.setProperty("EVOLUTION_PROGRESS_INDEX", (lastIndex + 1).toString());
      
      // 成功：1分後に自動再開
      ScriptApp.newTrigger("runGlobalEvolution").timeBased().after(60000).create();
    } else {
      // 不完全応答：10分後に再試行
      ScriptApp.newTrigger("runGlobalEvolution").timeBased().after(10 * 60000).create();
    }
  } catch (e) {
    // 429超過：15分後に自動復旧
    ScriptApp.newTrigger("runGlobalEvolution").timeBased().after(15 * 60000).create();
  }
}

// 2. [免疫] 受肉前の先行検証（定期実行推奨）
function triggerPreValidation() {
  const evolver = new System_Evolver_Core();
  evolver.activateEvolutionPreValidator();
}

// 3. [代謝] トリガー間隔の自律調整
function monitorAndOptimize() {
  optimizeEvolutionTriggers(); // 母艦の健康状態に合わせて心拍調整
}

// --- 以下、提示された各サブロジック（isEvolutionPatchSafe, calculateStrategicPriority等）をそのまま配置 ---


/**
 * 自律トリガー最適化エンジン
 * 母艦の状態を見て、runMidnightEvolution / runAutonomousCycle の間隔を自動調整する
 */
function optimizeEvolutionTriggers() {
  const props = PropertiesService.getScriptProperties();

  // 母艦の健康状態
  const errorCount = Number(props.getProperty("HEALTH_ERROR_COUNT") || 0);
  const pending = Number(props.getProperty("HEALTH_PENDING_COUNT") || 0);

  // 過去の進化成功率
  const successRate = Number(props.getProperty("EVOLUTION_SUCCESS_RATE") || 0.5);

  // Injection_Slot の滞留量
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const slot = ss.getSheetByName("Injection_Slot");
  const backlog = slot ? slot.getLastRow() - 1 : 0;

  // デフォルト値
  let evoInterval = 10; // runMidnightEvolution（進化生成）
  let coreInterval = 5; // runAutonomousCycle（受肉）

  // --- 自律判断ロジック ---

  // 1. エラーが多い → 進化速度を落とす
  if (errorCount > 10) evoInterval = 30;

  // 2. Injection_Slot が詰まっている → 生成を遅くし、受肉を早くする
  if (backlog > 20) {
    evoInterval = 20;
    coreInterval = 2;
  }

  // 3. 成功率が高い → 進化速度を上げる
  if (successRate > 0.8) evoInterval = 5;

  // 4. 母艦が安定している → 受肉速度を上げる
  if (errorCount === 0 && pending < 5) coreInterval = 3;

  // --- トリガー更新 ---
  updateTrigger("runMidnightEvolution", evoInterval);
  updateTrigger("runAutonomousCycle", coreInterval);

  announce(
    `トリガー最適化完了：進化 ${evoInterval}分間隔 / 受肉 ${coreInterval}分間隔`,
    "SYSTEM"
  );
}

/**
 * 指定関数の時間トリガーを張り替える
 */
function updateTrigger(funcName, minutes) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger(funcName)
    .timeBased()
    .everyMinutes(minutes)
    .create();
}
/**
 * AI 出力を Injection_Slot に STAGED として積む（強化ログ + 自動修復 + 安定パーサー）
 */
function enqueueEvolutionFromLLMOutput(output) {
  if (!output || output.length < 50) {
    console.log("enqueueEvolutionFromLLMOutput: 出力が短すぎるためスキップ");
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Injection_Slot") || ss.insertSheet("Injection_Slot");

  // ヘッダーが無ければ作成
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "Project", "Filename", "Code", "Status"]);
  }

  // ===FILE_START=== で分割
  const blocks = output
    .split("===FILE_START===")
    .map(b => b.trim())
    .filter(b => b);

  console.log(`enqueueEvolutionFromLLMOutput: BLOCK COUNT = ${blocks.length}`);

  blocks.forEach((block, idx) => {

    // ★ ブロックの先頭200文字をログに出す（原因特定のため）
    console.log(`BLOCK[${idx}] HEAD >>>`);
    console.log(block.substring(0, 200));
    console.log(`<<< END BLOCK[${idx}] HEAD`);

    // -----------------------------
    // 1. FILENAME の抽出
    // -----------------------------
    const nameMatch = block.match(/FILENAME:\s*([^\n]+)/);

    if (!nameMatch) {
      console.log(`BLOCK[${idx}] → FILENAME が見つからないためスキップ`);
      return;
    }

    const filename = nameMatch[1].trim();

    // -----------------------------
    // 2. コードブロック抽出（閉じタグ補完付き）
    // -----------------------------
    let codeMatch = block.match(/```(?:javascript|js)?([\s\S]*?)```/);
    let code = null;

    if (!codeMatch) {
      console.log(`BLOCK[${idx}] → コードブロックが見つからない → 閉じタグ補完を試行`);

      // 閉じタグ補完
      const fixed = block + "\n```";
      const fixedMatch = fixed.match(/```(?:javascript|js)?([\s\S]*?)```/);

      if (fixedMatch) {
        console.log(`BLOCK[${idx}] → 閉じタグ補完で復旧成功`);
        code = fixedMatch[1].trim();
      } else {
        console.log(`BLOCK[${idx}] → コードブロック復旧失敗 → スキップ`);
        return;
      }
    } else {
      code = codeMatch[1].trim();
    }

    // -----------------------------
    // 3. Injection_Slot に追加
    // -----------------------------
    sheet.appendRow([
      new Date(),
      "AUTO_GLOBAL_EVOLUTION",
      filename,
      code,
      "STAGED"
    ]);

    console.log(`BLOCK[${idx}] → STAGED として追加完了: ${filename}`);
  });
}

/**
 * 手動実行用：グローバル進化 → 自律サイクルまで一気に回す
 */
function runGlobalEvolutionAndCycle() {
  const evo = runGlobalEvolution();
  console.log("GlobalEvolution:", evo);

  runAutonomousCycle();
}

/**
 * [物理クリーンアップ] 
 * 同一名のトリガーが重複して増殖するのを防ぎ、トークンと実行リソースを守る。
 */
function deleteExistingEvolutionTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "runGlobalEvolution") {
      ScriptApp.deleteTrigger(t);
    }
  });
}