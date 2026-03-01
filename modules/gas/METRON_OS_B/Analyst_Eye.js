/**
 * yumeSystem Singularity v31.3.5 "Analyst_Eye"
 * [Vessel 05/07] Analyst_Eye.gs
 * 統合版：
 * - 依存関係解析（analyzeMotherShipDependencies）
 * - 記憶同期（Geminiエクスポート / ルート監視）
 * - 自律改善提案（runProactiveAnalysis）
 * - 物理検疫プロトコル（quarantineRejectedPatch）
 * 物理制約：一切の省略・機能削除を厳禁
 */

const FOLDER_MAP = {
  INPUT: "Gemini エクスポート",
  OUTPUT: "METRON_History"
};

const SYNC_PROT = {
  PASS_PHRASE: "SINGULARITY_2026",
  POLLING_MIN: 10
};

/**
 * 母艦依存関係解析モジュール（Dependency Analyzer）
 * 高度版：Gatewayとの通信不整合を「社会性エラー」として検知する。
 */
function analyzeMotherShipDependencies(context, logs, chatLog) {
  const affected = new Set();
  const reasons = [];

  // --- 1. Gateway/通信路の物理エラー検知 ---
  try {
    const commErrors = logs.filter(r => r[1] === "【異常】" && (r[2].includes("Gateway") || r[2].includes("Invalid script key") || r[2].includes("400")));
    if (commErrors.length > 0) {
      affected.add("Gateway");
      reasons.push(`Gateway 通信に物理的障害またはモデル不整合を検知 (${commErrors.length}件)。`);
    }
  } catch (e) {}

  // --- 2. Forge_Staging の滞留解析 ---
  try {
    const pending = context.latestProposals.filter(p => p.status === "PENDING");
    if (pending.length >= 5) {
      affected.add("Gateway");
      affected.add("UI_Manager");
      reasons.push(`Forge_Staging に PENDING が ${pending.length} 件滞留。承認フロー停止の疑い。`);
    }
  } catch (e) {}

  // --- 3. トリガー異常 ---
  try {
    const triggerErrors = logs.filter(r => r[2] && r[2].includes("トリガー"));
    if (triggerErrors.length > 0) {
      affected.add("Gateway");
      affected.add("System_Evolver");
      reasons.push(`SystemLog にトリガー関連エラーが検出されました。`);
    }
  } catch (e) {}

  // --- 4. 司令官の意図（MainChat） ---
  try {
    const recentChat = chatLog.slice(-20).map(c => c.text).join("\n");
    if (recentChat.includes("遅い") || recentChat.includes("重い")) {
      affected.add("UI_Manager");
      reasons.push("司令官が UI の遅延を指摘しています。");
    }
    if (recentChat.includes("承認") || recentChat.includes("社会性") || recentChat.includes("連動")) {
      affected.add("Gateway");
      reasons.push("社会性プロトコルおよび承認フローへの改善要求を検知。");
    }
    if (recentChat.includes("進化") || recentChat.includes("Evolver")) {
      affected.add("System_Evolver");
      reasons.push("進化プロセスの高度化要求を検知。");
    }
  } catch (e) {}

  // --- 5. 進化状態 ---
  try {
    if (context.evolution && context.evolution.hasPendingEvolution) {
      affected.add("System_Evolver");
      reasons.push("未処理の進化コードが存在します。");
    }
  } catch (e) {}

  return {
    affectedModules: Array.from(affected),
    reasonSummary: reasons.join("\n") || "特筆すべき依存関係は検出されませんでした。",
    riskLevel:
      affected.size >= 3 ? "HIGH" :
      affected.size === 2 ? "MEDIUM" :
      affected.size === 1 ? "LOW" : "NONE"
  };
}

// --- Part 1: 隔離・検疫プロトコル ---

function isolateFileToFolder(fileId, folderName) {
  let folders = DriveApp.getFoldersByName(folderName);
  let targetFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  const file = DriveApp.getFileById(fileId);
  file.moveTo(targetFolder);
  return targetFolder.getUrl();
}

function quarantineRejectedPatch(appName, proposalSummary, toolCode, reason) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let qSheet = ss.getSheetByName("Quarantine_Slot") || ss.insertSheet("Quarantine_Slot");
  if (qSheet.getLastRow() === 0) {
    qSheet.appendRow(["日時", "パッチ名", "却下理由", "ソースコード"]);
  }
  qSheet.appendRow([new Date(), appName, reason, toolCode]);
  if (typeof announce === 'function') {
    announce(`進化案 [${appName}] を Quarantine_Slot に隔離保存しました。`, "SYSTEM");
  }
}

// --- Part 2: 記憶同期モジュール ---

function setupMemoryTrigger() {
  const funcName = "smartAutoDigest";
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(funcName).timeBased().everyMinutes(SYNC_PROT.POLLING_MIN).create();
  if (typeof announce === 'function') announce(`巡回プロトコルを点火しました。`, "SYSTEM");
}

function smartAutoDigest() {
  const folders = DriveApp.getFoldersByName(FOLDER_MAP.INPUT);
  if (folders.hasNext()) scanAndProcessFiles(folders.next());

  const rootFiles = DriveApp.getRootFolder().getFiles();
  while (rootFiles.hasNext()) {
    const file = rootFiles.next();
    if (file.getMimeType() === MimeType.GOOGLE_DOCS) {
      try {
        const doc = DocumentApp.openById(file.getId());
        const text = doc.getBody().getText();
        if (text.includes(SYNC_PROT.PASS_PHRASE)) {
          isolateFileToFolder(file.getId(), FOLDER_MAP.INPUT);
          if (processAndSaveMemory(text)) file.setTrashed(true);
        }
      } catch (e) {}
    }
  }
}

function scanAndProcessFiles(folder) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    try {
      const doc = DocumentApp.openById(file.getId());
      const text = doc.getBody().getText();
      if (text.includes(SYNC_PROT.PASS_PHRASE)) {
        if (processAndSaveMemory(text)) file.setTrashed(true);
      }
    } catch (e) {}
  }
}

function processAndSaveMemory(text) {
  const prompt = `以下の会話ログを解析し、JSON配列 [ [日時, 役割, 内容, ID], ... ] のみを出力せよ。余計なテキストは一切含めるな。\n\n${text}`;
  try {
    // AIEngineCore.generate(prompt) を呼び出し（Core_AI側の最新版に準拠）
    const response = AIEngineCore.generate(prompt); 
    const match = response.match(/\[\s*\[.*\]\s*\]/s);
    if (!match) return false;
    const memories = JSON.parse(match[0]);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MainChat");
    if (sheet && memories.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, memories.length, 4).setValues(memories);
      return true;
    }
  } catch (e) { return false; }
}

// --- Part 3: 予測型監視モジュール ---

function runProactiveAnalysis() {
  if (typeof announce === 'function') announce("社会性エラーおよび改善の兆候を探索中...", "ANALYST");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName("SystemLog");
  if (!logSheet) return;

  const logs = logSheet.getDataRange().getValues();
  const statLogs = logs.filter(r => r[1] && (r[1].includes("統計") || r[1] === "STAT" || r[1] === "【異常】")).slice(-50);
  if (statLogs.length < 3) return;

  // context構築（未定義なら最小構成）
  const ctx = (typeof buildMotherShipContext === 'function') ? buildMotherShipContext() : { evolution: {}, latestProposals: [] };
  const chatSheet = ss.getSheetByName("MainChat");
  const chatLog = chatSheet ? chatSheet.getRange(Math.max(1, chatSheet.getLastRow()-20), 1, 20, 4).getValues().map(r => ({text: r[2]})) : [];
  
  const dep = analyzeMotherShipDependencies(ctx, logs, chatLog);

  const analysisPrompt = `あなたは yumeSystem 戦略参謀です。
  現在、母艦とGatewayの間で通信プロトコルエラーが発生しています。
  依存関係：${JSON.stringify(dep, null, 2)}
  ログ：${statLogs.map(l => l[2]).join("\n")}
  
  これらを解決するための PATCH_PLAN と PATCH_CODE を提案してください。`;

  try {
    const response = AIEngineCore.generate(analysisPrompt);
    if (response && response.length > 50) processProactiveProposal(response, dep);
  } catch (e) {
    if (typeof announce === 'function') announce(`分析エラー: ${e.message}`, "ERROR");
  }
}

function processProactiveProposal(proposalSummary, dep) {
  if (typeof announce === 'function') announce("自律的な修復パッチを設計中...", "ANALYST");
  const dateStr = Utilities.formatDate(new Date(), "JST", "MMdd_HHmm");
  const appName = "社会性修復_" + dateStr;
  
  // エンジニアリングプロンプト
  const toolCode = AIEngineCore.generate(`以下の分析に基づき、通信エラーを解消する GAS コードを出力せよ。\n\n${proposalSummary}`);

  const doc = DocumentApp.create(`${appName}_企画書`);
  doc.getBody().setText(`【自律進化提案：${appName}】\n\n${proposalSummary}\n\n【依存関係】\n${JSON.stringify(dep)}`);
  doc.saveAndClose();
  if (typeof isolateFileToFolder === 'function') isolateFileToFolder(doc.getId(), FOLDER_MAP.OUTPUT);

  const affectedModules = (dep && dep.affectedModules) ? dep.affectedModules.join(", ") : "System_Core";
  const riskLevel = (dep && dep.riskLevel) ? dep.riskLevel : "LOW";
  const syntheticResponse = `[PATCH_PLAN]\n- targetModule: ${affectedModules}\n- summary: ${appName}\n- risk: ${riskLevel}\n[PATCH_CODE]\n\`\`\`javascript\n${toolCode}\n\`\`\``;

  // Forge_Staging 等への登録
  if (typeof autoStagePatchFromChatResponse === 'function') {
    autoStagePatchFromChatResponse(syntheticResponse);
  } else {
    // 簡易登録
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let forge = ss.getSheetByName("Forge_Staging") || ss.insertSheet("Forge_Staging");
    forge.appendRow([new Date(), appName, riskLevel, "PENDING", toolCode]);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let evoSheet = ss.getSheetByName("Evolution_Log") || ss.insertSheet("Evolution_Log");
  evoSheet.appendRow([new Date(), "PROPOSAL", appName, doc.getUrl()]);

  // 安全なら即時適用
  if (riskLevel === "LOW" && typeof deployAutonomousPatch === 'function') {
    deployAutonomousPatch(appName, toolCode);
  }
}

function deployAutonomousPatch(filename, code) {
  // Core_AI (Vessel 01) の物理書換関数があれば実行
  if (typeof rewritePhysicalFile === 'function') {
    announce(`自律デプロイ開始: ${filename}`, "SYSTEM");
    rewritePhysicalFile(filename, code);
    return true;
  }
  return false;
}