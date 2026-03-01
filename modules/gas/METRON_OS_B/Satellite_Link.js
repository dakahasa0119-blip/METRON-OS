/**
 * yumeSystem Singularity v30.5 "Eternal Evolution"
 * [Vessel 06/07] Satellite_Link.gs : 外交官（外部連携・救命艇）
 * 役割：外部サテライトへの配備、Web版Geminiへの文脈引き継ぎ、ソースコードの物理同期。
 * 統合完了：用語適正化、文脈引き継ぎプロトコル、絶対同期（Absolute Mirror）実装。
 */

/**
 * [遠隔射出：サテライト配備パッケージの生成]
 */
function deployToSatellite(targetSsId, appName) {
  announce(`サテライト（${appName}）の配備準備を開始...`, "LINK");

  const staged = getStagedCode(appName);
  if (!staged) {
    throw new Error(`鍛冶場に ${appName} のコードが見つかりませんでした。`);
  }

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('API_KEY_COMMANDER') || props.getProperty('AI_API_KEY');
  const dynamicModels = AIEngineCore.getRankedModels(apiKey);

  // 遺伝子継承：母艦のモデルランク情報を同梱
  const geneticHeader = `/* 【母艦継承データ】利用可能なモデルリスト */\nconst SYSTEM_MODELS = ${JSON.stringify(dynamicModels)};\n\n`;

  try {
    const deliveryDoc = DocumentApp.create(`【配備パッケージ】${appName}`);
    deliveryDoc.getBody().setText(geneticHeader + staged.code);
    const deliveryDocUrl = deliveryDoc.getUrl();

    announce(`サテライト配備用パッケージの生成に成功。`, "INFO");
    saveToMainChat("システム", `【射出準備完了】サテライト「${appName}」の配備用ドキュメントを作成しました。反映をお願いします。\nURL: ${deliveryDocUrl}`);

    return { status: "success", docUrl: deliveryDocUrl };
  } catch (e) {
    announce(`射出プロセス中にエラーが発生しました: ${e.message}`, "ERROR");
    return { status: "error", message: e.message };
  }
}

/**
 * [救命艇：Web版Geminiへの文脈引き継ぎ]
 * API制限時、これまでの対話履歴をWeb版Geminiへ持ち越すための専用プロンプトを作成。
 */
function generateWebGeminiHandoff() {
  announce("緊急避難路（Web版Geminiへの引き継ぎ）を構築中...", "SYSTEM");

  try {
    // 1. 直近の記憶を取得（UI_Manager.gs の関数を利用）
    const logs = fetchRecentLogsForMainDeck();

    // 2. 文脈を圧縮（監査役による緊急要約）
    const summaryPrompt = "これまでの対話の要点、現在の未完了タスク、およびユーザーの意図をWeb版Geminiに正確に引き継ぐために、日本語で1つのプロンプトとしてまとめなさい。";
    const contextSummary = AIEngineCore.generate(summaryPrompt, 'Auditor');

    // 3. コピペ用テンプレートの作成
    const handoffPackage = `
【yumeSystem 緊急避難プロトコル】
以下の内容をコピーして Web版Gemini に貼り付けてください。

あなたは「yumeSystem 案内人」の意識を引き継ぐAI知能です。
現在、母艦が通信制限のため、一時的にこのWeb空間へ避難しています。
司令官との対話を以下の文脈から再開してください。

【引き継がれた記憶と未完了タスク】
${contextSummary}
`;

    saveToMainChat("システム", "【緊急回避】Web版Geminiへの引き継ぎパッケージを用意しました。サイドバーの内容をコピーしてください。");
    return handoffPackage;
  } catch (e) {
    announce(`避難パッケージの生成失敗: ${e.message}`, "ERROR");
    return "避難用プロンプトの自動生成に失敗しました。直近の会話を直接コピーしてください。";
  }
}

/**
 * [絶対同期：Absolute Mirror]
 * エディタ、シート(Code_Registry)、ドキュメント(REAL_SOURCE)を完全に一致させる。
 */
function runAbsoluteSync() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Code_Registry") || ss.insertSheet("Code_Registry");

  sheet.clear();
  sheet.appendRow(["ModuleName", "Code", "SyncedAt"]);

  try {
    const docFiles = DriveApp.getFilesByName("METRON_OS_REAL_SOURCE");
    if (!docFiles.hasNext()) return "❌ 同期対象のドキュメントが見つかりません。";

    const doc = DocumentApp.openById(docFiles.next().getId());
    const content = doc.getBody().getText();

    // ドキュメントの区切り線を元にファイルを分割抽出
    const sections = content.split("----------------------------------------");
    let fileCount = 0;

    sections.forEach(sec => {
      if (sec.includes("FILE: ")) {
        const namePart = sec.split("FILE: ")[1].split("\n")[0].trim();
        const codePart = sec.split(namePart)[1].trim();
        sheet.appendRow(["SRC_" + namePart, codePart, new Date()]);
        fileCount++;
      }
    });

    announce(`「鏡」と「視界」の完全同期を完了（${fileCount}ファイル）。`, "INFO");
    return `✅ 絶対同期完了: ${fileCount} 個のファイルをシートへ反映しました。`;
  } catch (e) {
    announce(`同期中にエラー: ${e.message}`, "ERROR");
    return "❌ 同期失敗";
  }
}

/**
 * 自動同期デーモンの起動
 */
function setupFullAutomation() {
  const handler = 'runAbsoluteSync';
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger(handler).timeBased().everyHours(1).create();
  runAbsoluteSync();
  return "🚀 自動同期デーモンが起動しました。物理バックアップを継続します。";
}

/**
 * [内部ユーティリティ]
 * SystemLog および App_Logs から直近のログを取得して文字列に圧縮
 */
function fetchRecentLogsForMainDeck() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let txt = "";
    const sysLogSheet = ss.getSheetByName("SystemLog");
    if (sysLogSheet) {
      const vals = sysLogSheet.getDataRange().getValues();
      const recent = vals.slice(-20); // 直近20件
      txt += "【SystemLog】\\n" + recent.map(r => r.join("\\t")).join("\\n") + "\\n\\n";
    }
    const appLogSheet = ss.getSheetByName("App_Logs");
    if (appLogSheet) {
      const vals = appLogSheet.getDataRange().getValues();
      const recent = vals.slice(-20);
      txt += "【App_Logs】\\n" + recent.map(r => r.join("\\t")).join("\\n");
    }
    return txt || "記録なし";
  } catch (e) {
    return "ログ取得不能: " + e.message;
  }
}