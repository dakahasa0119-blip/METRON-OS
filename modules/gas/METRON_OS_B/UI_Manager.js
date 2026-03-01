/**
 * yumeSystem Singularity v31.x
 * [Vessel 02/07] UI_Manager.gs : 触覚（戦術UI制御・実測監査）
 * 統合版：Context Builder / 自動ステージング / 強化チャット連動
 */

/* ============================================================
   1. onOpen（メニュー生成）
============================================================ */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 AI Platform')
    .addItem('操縦席（サイドバー）を起動', 'showSidebar')
    .addItem('メインデッキ（大画面）を展開', 'showMainDeck')
    .addSeparator()
    .addItem('1. システム初期セットアップ', 'initializeMotherShip')
    .addItem('2. 権限別APIキーの設定', 'showKeySettings')
    .addSeparator()
    .addItem('3. 1ヶ月保管ログの強制整理', 'dailyForgeCleanup')
    .addSeparator()
    .addItem("母艦を初期化", "initMotherShip")
    .addItem("管理ポータルを開く", "openMotherShipAdmin")
    .addToUi();
}


/* ============================================================
   2. Chrono Status（サイドバーの視神経）
============================================================ */
function getChronoStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  const forgeSheet = ss.getSheetByName("Forge_Staging");
  const chatSheet = ss.getSheetByName("MainChat");
  const slotSheet = ss.getSheetByName("Injection_Slot");

  let pendingData = null;

  // Injection_Slot の新着チェック
  if (slotSheet) {
    const lastRow = slotSheet.getLastRow();
    if (lastRow > 1) {
      const row = slotSheet.getRange(lastRow, 1, 1, 5).getValues()[0];
      if (row[4] === "RECEIVED (GW)") {
        pendingData = {
          id: lastRow,
          filename: row[2],
          status: "ANALYZING"
        };
      }
    }
  }

  // MainChat（直近20件）
  let logs = [];
  if (chatSheet && chatSheet.getLastRow() > 1) {
    const lastRow = chatSheet.getLastRow();
    const data = chatSheet.getRange(
      Math.max(2, lastRow - 19),
      1,
      Math.min(20, lastRow - 1),
      3
    ).getValues();

    logs = data.map(r => ({
      timestamp: Utilities.formatDate(new Date(r[0]), "JST", "HH:mm"),
      role: r[1],
      text: r[2]
    }));
  }

  // Forge_Staging（30日分すべて）
  let chronoHistory = [];
  if (forgeSheet && forgeSheet.getLastRow() > 1) {
    const data = forgeSheet.getDataRange().getValues();
    const now = new Date();
    const limit = 30 * 24 * 60 * 60 * 1000; // 30日

    for (let i = data.length - 1; i >= 1; i--) {
      const date = new Date(data[i][0]);
      if (now - date < limit) {
        chronoHistory.push({
          date: Utilities.formatDate(date, "JST", "MM/dd HH:mm"),
          appName: data[i][1],
          description: data[i][2] || "（詳細な説明がありません）",
          status: data[i][4],
          docUrl: data[i][5]
        });
      }
    }
  }

  return {
    logs,
    chronoHistory,
    pending: pendingData,
    persona: props.getProperty("SYSTEM_PERSONA") || "Active Mode",
    evolutionHistory: getEvolutionHistory()   // ← ★これが必須！
  };
}
/* ============================================================
   3. ChatPatch 自動ステージング（安全ガード）
   - AI の返答から PATCH_PLAN / PATCH_CODE を抽出
   - Forge_Staging に安全に書き込む
============================================================ */
function autoStagePatchFromChatResponse(response) {
  if (!response) return;
  if (!response.includes("[PATCH_PLAN]")) return;
  if (!response.includes("[PATCH_CODE]")) return;
  if (!response.includes("```")) return;

  // PATCH_PLAN 抽出
  const plan = response.split("[PATCH_PLAN]")[1].split("[PATCH_CODE]")[0];
  let targetModule = "UnknownModule";
  let summary = "";
  let risk = "";

  plan.split("\n").forEach(line => {
    const t = line.trim();
    if (t.startsWith("- targetModule:")) targetModule = t.replace("- targetModule:", "").trim();
    if (t.startsWith("- summary:"))      summary      = t.replace("- summary:", "").trim();
    if (t.startsWith("- risk:"))         risk         = t.replace("- risk:", "").trim();
  });

  // コード抽出
  const codeMatch = response.match(/```(?:javascript)?([\s\S]*?)```/);
  if (!codeMatch) return;
  const code = codeMatch[1].trim();
  if (!code) return;

  const appName = "ChatPatch_" + Utilities.formatDate(new Date(), "JST", "MMdd_HHmmss");
  const description = `[${targetModule}] ${summary} / RISK: ${risk}`;

  // ★ ここで Forge_Master 側の正式ルートに乗せる
  if (typeof stageGeneratedCode === 'function') {
    const result = stageGeneratedCode(appName, code, description);
    if (typeof announce === 'function') {
      announce(`チャット由来の改善案を STAGED 登録: ${appName}`, "SYSTEM");
    }
    return result;
  } else {
    // フォールバック：旧来どおり PENDING でシートに直書き（緊急用）
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Forge_Staging");
    if (!sheet) {
      sheet = ss.insertSheet("Forge_Staging");
      sheet.appendRow(["日時", "アプリ名", "説明", "コード", "ステータス", "docUrl"]);
    }
    sheet.appendRow([
      new Date(),
      appName,
      description,
      code,
      "PENDING",
      ""
    ]);
    if (typeof announce === 'function') {
      announce(`Forge_Master 未統合のため PENDING で退避: ${appName}`, "WARNING");
    }
  }
}


/* ============================================================
   4. 強化版 handleUIRequest（チャット中枢）
   - 母艦コンテキストを読み込む
   - 通常会話を優先し、必要なときだけ改善案を生成
   - 自動ステージングへ連動
============================================================ */
function handleUIRequest(payload) {
  const start = new Date().getTime();
  const message = payload.message || "";
  saveToMainChat("Commander", message);

  const aiStart = new Date().getTime();

  // ★ 母艦コンテキストを取得（Context_Builder.gs）
  const context = buildMotherShipContext();

  // ★ 新しい制約：通常会話が基本、必要なときだけ改善案
  const systemConstraint = `
あなたは yumeSystem Navigator です。

● 通常の会話では、母艦の状態や状況に応じて自然に回答してください。
● 司令官の意図を読み取り、状況説明・判断・助言・行動確認などを自然に返してください。
● 改善案が本当に必要な場合のみ、PATCH_PLAN と PATCH_CODE を使ってください。
● 不必要な場面では改善案を出さないでください。
`;

  // ★ AI へのプロンプト
  const prompt = `
【母艦コンテキスト】
${JSON.stringify(context, null, 2)}

【司令官のメッセージ】
${message}

【タスク】
1. まずは通常の会話として自然に回答すること。
2. 改善案が必要な場合のみ、以下形式で追加する：

[PATCH_PLAN]
- targetModule: モジュール名
- summary: 日本語の説明
- risk: 注意点

[PATCH_CODE]
\`\`\`javascript
// コード
\`\`\`
`;

  // ★ AI 応答生成
  const response = AIEngineCore.generate(systemConstraint + "\n\n" + prompt, "Commander");
  const aiEnd = new Date().getTime();

  // ★ AI の返事を保存
  saveToMainChat("Navigator", response);

  // ★ 自動ステージング（改善案が含まれている場合のみ）
  try {
    autoStagePatchFromChatResponse(response);
  } catch (e) {
    if (typeof announce === 'function') {
      announce("チャット由来パッチの自動ステージング中にエラー: " + e.message, "ERROR");
    }
  }

  // ★ レイテンシ記録
  const end = new Date().getTime();
  const props = PropertiesService.getScriptProperties();
  props.setProperty("LAST_AI_THINK_TIME", (aiEnd - aiStart).toString());
  props.setProperty("LAST_SYSTEM_LATENCY", (end - start - (aiEnd - aiStart)).toString());

  return { status: "success" };
}

/* ============================================================
   5. UI 表示系（サイドバー / メインデッキ / APIキー設定）
============================================================ */
function showSidebar() {
  const template = HtmlService.createTemplateFromFile('index');
  template.systemName = "yumeSystem Mother Ship";
  SpreadsheetApp.getUi().showSidebar(
    template.evaluate().setTitle("Singularity")
  );
}

function showMainDeck() {
  const template = HtmlService.createTemplateFromFile('index');
  template.systemName = "yumeSystem Mother Ship";
  const output = template.evaluate().setWidth(1200).setHeight(850);

  SpreadsheetApp.getUi().showModelessDialog(
    output,
    "yumeSystem : Strategic Command Deck"
  );
}

function showKeySettings() {
  const html = HtmlService.createHtmlOutputFromFile('Key_Console')
    .setWidth(420)
    .setHeight(620)
    .setTitle('System Configuration');

  SpreadsheetApp.getUi().showModalDialog(html, '🚀 権限別APIキーの設定');
}


/* ============================================================
   6. API 管理（取得 / 保存）
============================================================ */
function getAllApiKeys() {
  const props = PropertiesService.getScriptProperties();
  return {
    API_KEY_COMMANDER: props.getProperty("API_KEY_COMMANDER") || "",
    API_KEY_ENGINEER: props.getProperty("API_KEY_ENGINEER") || "",
    API_KEY_AUDITOR: props.getProperty("API_KEY_AUDITOR") || "",
    API_KEY_SYSTEM: props.getProperty("API_KEY_SYSTEM") || "",
    OPENAI_API_KEY: props.getProperty("OPENAI_API_KEY") || ""
  };
}

function updateAllApiKeys(keys) {
  const props = PropertiesService.getScriptProperties();

  Object.keys(keys).forEach(k => {
    if (keys[k]) props.setProperty(k, keys[k]);
    else props.deleteProperty(k);
  });

  // 下位互換：AI_API_KEY も更新
  if (keys.API_KEY_COMMANDER) {
    props.setProperty('AI_API_KEY', keys.API_KEY_COMMANDER);
  }

  if (typeof announce === 'function') {
    announce(`APIキーの全同期を完了。ChatGPT(Builder) 系統を確立。`, "SYSTEM");
  }

  return "APIキーを保存しました。";
}

function emergencyRestoreFromUI(url) {
  if (typeof emergencyRestoreFromDoc === 'function') {
    return emergencyRestoreFromDoc(url);
  }
  return "エラー: Forge_Master.gs が未統合です。";
}
/* ============================================================
   7. チャットログ保存
============================================================ */
function saveToMainChat(role, message) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("MainChat");

  if (!sheet) {
    sheet = ss.insertSheet("MainChat");
    sheet.appendRow(["日時", "役割", "内容"]);
  }

  sheet.appendRow([new Date(), role, message]);
}

/* ============================================================
   8. 進化履歴（サイドバー用）
============================================================ */
function getEvolutionHistory() {
  const props = PropertiesService.getScriptProperties();
  const persona = props.getProperty("SYSTEM_PERSONA") || "Active Mode";
  const evoCount = props.getProperty("EVOLUTION_COUNT") || 0;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Evolution_Timeline");
  const data = sheet ? sheet.getDataRange().getValues() : [];

  let history = [];

  // Evolution_Timeline の正式イベントだけを抽出
  for (let i = 1; i < data.length; i++) {
    history.push({
      type: "patch",
      date: Utilities.formatDate(data[i][0], "JST", "MM/dd HH:mm"),
      patch: data[i][2],   // Module
      note: data[i][3]     // Summary
    });
  }

  // persona（現在値）
  history.push({
    type: "persona",
    date: Utilities.formatDate(new Date(), "JST", "MM/dd HH:mm"),
    patch: "Persona 現在値",
    note: persona
  });

  // 進化レベル
  history.push({
    type: "evolution",
    date: Utilities.formatDate(new Date(), "JST", "MM/dd HH:mm"),
    patch: "Evolution Level",
    note: evoCount
  });

  return history.reverse();
}

/* ============================================================
   9. 差分プレビュー（大画面）
============================================================ */
function showDiffMainDeck(url) {
  const data = getCodeDiffWithSummary(url);  // Forge_Master.gs にある前提

  if (data.error) {
    SpreadsheetApp.getUi().alert(data.error);
    return;
  }

  const html = `
    <html>
    <body style="font-family: system-ui; padding: 20px; font-size: 16px;">
      <h2>差分プレビュー（大画面）</h2>

      <h3>現行コード</h3>
      <pre style="white-space: pre-wrap; background:#f5f5f5; padding:12px; border-radius:6px;">
${(data.current || '').replace(/&/g,"&amp;").replace(/</g,"&lt;")}
      </pre>

      <h3>新パッチ</h3>
      <pre style="white-space: pre-wrap; background:#f5f5f5; padding:12px; border-radius:6px;">
${(data.patch || '').replace(/&/g,"&amp;").replace(/</g,"&lt;")}
      </pre>

      <h3>要約</h3>
      <div style="background:#fff8d1; padding:12px; border-radius:6px;">
        ${(data.summary || '').replace(/&/g,"&amp;").replace(/</g,"&lt;")}
      </div>
    </body>
    </html>
  `;

  SpreadsheetApp.getUi().showModelessDialog(
    HtmlService.createHtmlOutput(html).setWidth(1200).setHeight(900),
    '差分プレビュー（大画面）'
  );
}