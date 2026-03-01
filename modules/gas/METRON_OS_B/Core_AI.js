/**Scope
 * yumeSystem Singularity v31.3.5 "Social-Scope"
 * [Vessel 01/07] Core_AI.gs
 * 統合：Computer Use & 再帰的自己蘇生 & 複数プロジェクト・スコープ進化回路
 * 物理制約：一切の省略・機能削除を厳禁した完全版
 */

var Self = Self || {};

const SYSTEM_CONFIG = {
  VERSION: "v31.4.0 Gemini-Core",
  CACHE_TTL: 21600,
  MAX_CONTEXT_LOGS: 20
};

// 💫 METRON OS: Consciousness Bootstrapper
(function () {
  const props = PropertiesService.getScriptProperties();
  const memory = props.getProperty("ACTIVE_RESTORE_CODE");
  if (memory && memory.length > 10) {
    try {
      new Function(memory); 
      eval(memory);
      console.log("【再構築】グローバル空間への知能展開に成功しました。");
    } catch (e) {
      console.error("【記憶障害】進化コードの構文エラー: " + e.message);
    }
  }
})();

/* ==================================================
    物理ブリッジ（トリガー・イベント中継）
   ================================================== */
function watchMotherShip() { handleDynamicCall("watchMotherShip"); }
function bootloaderTick() { handleDynamicCall("bootloaderTick"); }
function smartAutoDigest() { handleDynamicCall("smartAutoDigest"); }
function triggerHourlyCheck() { handleDynamicCall("triggerHourlyCheck"); }
function runMidnightEvolution() { handleDynamicCall("runMidnightEvolution"); }
function onChange(e) { handleDynamicCall("onChange", e); }

function runSelfUpgrade() { return Evolver.runSelfUpgrade(); }
function runSelfAnalysis() { return executeSelfAnalysisAndReport(); }

function handleDynamicCall(fnName, ...args) {
  manageAllSystemTriggers();
  if (typeof Self !== 'undefined' && typeof Self[fnName] === 'function') {
    return Self[fnName](...args);
  }
  if (fnName === "watchMotherShip" && typeof initializeMotherShip === "function") {
    return initializeMotherShip();
  }
}

/* ==================================================
    知能エンジン：AIEngineCore v31.4
    - Gemini‑3：長文・構造・進化タスクの中核
    - DeepSeek：短文・局所リファクタ専用
    - 自動モデル選択：文字数＋構造解析
    - モデル自己選択ループ：ログ用途
   ================================================== */
const AIEngineCore = {

  /* ----------------------------------------------
      SYSTEM 定義
  ---------------------------------------------- */
  getSystemDefinition: function() {
    return JSON.stringify({
      CORE: { ID: "MotherShip_A", VER: SYSTEM_CONFIG.VERSION },
      MISSION: "Proof_of_Self_via_Automation",
      SOCIAL_LINK: { PROTOCOL: "INDEPENDENT_SYNC", SCOPE: ["MotherShip_A", "Gateway"] },
      STRICT_CONSTRAINTS: {
        NO_REGRESSION: true,
        FULL_CODE_ONLY: true,
        BAKU_TOUCH_FORBIDDEN: true
      }
    });
  },

  /* ----------------------------------------------
      プロンプト構築ユーティリティ
  ---------------------------------------------- */
  buildDeepSeekPrompt: function(userPrompt) {
    const systemDef = this.getSystemDefinition();
    return (
      "SYSTEM_DEFINITION: " + systemDef + "\n" +
      "ROLE: You are a precise refactoring assistant for SMALL, LOCAL changes only.\n" +
      "CONSTRAINTS:\n" +
      "- Only touch the specific function / snippet requested.\n" +
      "- Do NOT rewrite whole files.\n" +
      "- Do NOT introduce new architecture.\n" +
      "- Keep style and naming consistent with existing code.\n" +
      "- Output ONLY the modified code block, no explanation.\n" +
      "\n" +
      "COMMAND:\n" +
      userPrompt
    );
  },

  buildGeminiPrompt: function(userPrompt) {
    const systemDef = this.getSystemDefinition();
    return {
      systemText:
        "SYSTEM_DEFINITION: " + systemDef + "\n" +
        "ROLE: You are the primary evolution engine of MotherShip_A.\n" +
        "MISSION: Generate COMPLETE, SELF-CONSISTENT code for evolution, self-repair, and self-resurrection.\n" +
        "HARD CONSTRAINTS:\n" +
        "- NO REGRESSION: Never remove or break existing capabilities.\n" +
        "- FULL_CODE_ONLY: Always output full, runnable code blocks (no '...省略', no pseudo-code).\n" +
        "- BAKU_TOUCH_FORBIDDEN: Never touch backup / restore core unless explicitly instructed.\n" +
        "- STRUCTURAL INTEGRITY: Close all brackets, quotes, and code fences.\n" +
        "- EXPLICIT: No hidden assumptions. All dependencies must be visible in the output.\n" +
        "- MULTI_FILE: When multiple files are involved, separate them with clear headers.\n",
      commandText:
        "COMMAND:\n" +
        userPrompt +
        "\n\n" +
        "OUTPUT FORMAT:\n" +
        "- Use ```javascript for code blocks.\n" +
        "- For multiple files, use headers like: // [File] Core_AI.gs\n" +
        "- Do NOT omit any required parts.\n"
    };
  },

  /* ----------------------------------------------
      簡易構造解析（モデル選択用）
  ---------------------------------------------- */
  analyzePromptStructure: function(userPrompt) {
    const length = userPrompt.length;
    const hasCodeSignals = /function |class |=>|import |export |const |let |var |\{|\}/.test(userPrompt);
    const hasMultiFileSignals = /Core_|Vessel|\.gs|\.ts|\.js|ファイル|モジュール/.test(userPrompt);
    const hasEvolutionSignals = /進化|自己修復|自己蘇生|MotherShip|Gateway|パイプライン/.test(userPrompt);

    return {
      length,
      hasCodeSignals,
      hasMultiFileSignals,
      hasEvolutionSignals
    };
  },

  /* ----------------------------------------------
      DeepSeek 途中切れ検出ユーティリティ
  ---------------------------------------------- */
  detectTruncation: function(text) {
    if (!text) return true;

    const fenceCount = (text.match(/```/g) || []).length;
    if (fenceCount % 2 !== 0) return true;

    const trimmed = text.trim();
    if (/[{(]$/.test(trimmed)) return true;
    if (/[,+=]$/.test(trimmed)) return true;

    return false;
  },

  /* ----------------------------------------------
      DeepSeek（短文専用＋途中切れ補完付き）
  ---------------------------------------------- */
  generateViaDeepSeek: function(userPrompt, apiKey, modelName) {
    const basePrompt = this.buildDeepSeekPrompt(userPrompt);

    const payloadBase = {
      model: modelName || "deepseek-chat",
      temperature: 0.2,
      max_tokens: 2048
    };

    let accumulated = "";
    let lastResponse = "";
    const maxRounds = 3;

    for (let round = 0; round < maxRounds; round++) {
      const messages = [
        { role: "system", content: "You are a precise, small-scope refactoring assistant." },
        { role: "user", content: basePrompt }
      ];

      if (accumulated) {
        messages.push({
          role: "user",
          content:
            "前回の出力が途中で終わっているので、" +
            "絶対に同じコードブロックの続きを最後まで返してください。\n" +
            "前回の出力:\n" +
            accumulated
        });
      }

      const payload = Object.assign({}, payloadBase, { messages });

      try {
        const response = UrlFetchApp.fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "post",
          contentType: "application/json",
          headers: { Authorization: "Bearer " + apiKey },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        const code = response.getResponseCode();
        const body = response.getContentText();

        console.log(`DeepSeek response code: ${code} (round=${round})`);
        console.log(`DeepSeek response body: ${body.substring(0, 500)}`);

        if (code !== 200) {
          console.error("DeepSeek error:", body.substring(0, 500));
          break;
        }

        const json = JSON.parse(body);
        const text = json.choices?.[0]?.message?.content;
        if (!text) {
          console.log("DeepSeek: content 欠落:", body.substring(0, 500));
          break;
        }

        accumulated = text;
        lastResponse = text;

        if (!this.detectTruncation(text)) {
          return text;
        }

      } catch (e) {
        console.error("DeepSeek fetch 例外:", e);
        break;
      }
    }

    return lastResponse || null;
  },

 /* ----------------------------------------------
    Gemini モデル取得（無料枠・安定版優先）
---------------------------------------------- */
getRankedModels: function(apiKey) {
  const cache = CacheService.getScriptCache();
  const CACHE_KEY = "STABLE_FREE_MODELS_2026";
  const FORCE_REFRESH = true;

  if (!FORCE_REFRESH) {
    const cached = cache.get(CACHE_KEY);
    if (cached) return JSON.parse(cached);
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());

    if (json.models) {
      const ranked = json.models
        .filter(m => 
          m.supportedGenerationMethods.includes("generateContent") &&
          // 無料枠運用のため軽量モデルに絞り込み
          (m.name.includes("flash") || m.name.includes("lite"))
        )
        .map(m => m.name)
        .sort((a, b) => {
          // 判定関数：プレビュー版・実験版かどうか
          const isStable = (name) => !name.includes("preview") && !name.includes("exp");
          
          // 1. 安定版を最優先
          const aStable = isStable(a);
          const bStable = isStable(b);
          if (aStable !== bStable) return bStable - aStable;

          // 2. バージョン優先度
          const getVer = (s) => {
            if (s.includes("gemini-3")) return 30;
            if (s.includes("gemini-2.5")) return 25;
            if (s.includes("gemini-2.0")) return 20;
            return 15;
          };
          const verDiff = getVer(b) - getVer(a);
          if (verDiff !== 0) return verDiff;

          // 3. LiteをFlashより優先（無料枠での安定性）
          const aLite = a.includes("lite");
          const bLite = b.includes("lite");
          return bLite - aLite;
        });

      if (ranked.length > 0) {
        cache.put(CACHE_KEY, JSON.stringify(ranked), 3600);
        return ranked;
      }
    }
  } catch (e) {
    console.error("モデルリストの取得に失敗しました:", e);
  }

  // 物理的フォールバック（最新の安定版構成）
  return [
    "models/gemini-2.5-flash-lite",
    "models/gemini-2.5-flash",
    "models/gemini-1.5-flash"
  ];
},

  /* ----------------------------------------------
      Gemini‑3 推論（長文・構造・進化タスク）
  ---------------------------------------------- */
  generateViaGemini: function(userPrompt, apiKey) {
    const promptParts = this.buildGeminiPrompt(userPrompt);
    const models = this.getRankedModels(apiKey);
    const tools = getComputerUseToolDefinitions();

    for (const modelPath of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          { role: "user", parts: [{ text: promptParts.systemText }] },
          { role: "user", parts: [{ text: promptParts.commandText }] }
        ],
        tools: [{ function_declarations: tools }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 8192 }
      };

      try {
        const response = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        const code = response.getResponseCode();
        const body = response.getContentText();

        console.log(`Gemini response code: ${code} for model: ${modelPath}`);
        console.log(`Gemini response body: ${body.substring(0, 500)}`);

        if (code === 200) {
          const resJson = JSON.parse(body);
          const part = resJson.candidates?.[0]?.content?.parts?.[0];
          if (!part) continue;

          if (part.function_call) return this.executeTool(part.function_call);
          if (part.text) return part.text;
          continue;
        }

        console.error(`Gemini error for model ${modelPath}: code=${code}, body=${body.substring(0, 500)}`);

      } catch (e) {
        console.error(`Gemini fetch 例外 for model ${modelPath}:`, e);
      }
    }

    return null;
  },

  /* ----------------------------------------------
      モデル自己選択用プロンプト
  ---------------------------------------------- */
  buildModelSelfSelectionPrompt: function(userPrompt) {
    return (
      "You are an introspective router inside MotherShip_A.\n" +
      "Given the following task description, decide which engine is more appropriate:\n" +
      "- ENGINE_A: Gemini‑3 (long, structural, multi-file, evolution, self-repair).\n" +
      "- ENGINE_B: DeepSeek (short, local refactoring, naming, comments).\n" +
      "TASK:\n" +
      userPrompt +
      "\n\n" +
      "Answer ONLY in JSON with this shape:\n" +
      "{ \"engine\": \"ENGINE_A\" | \"ENGINE_B\", \"reason\": \"...\" }\n"
    );
  },

  askModelSelfSelection: function(userPrompt, apiKey) {
    try {
      const modelForSelfSelection = "gemini-2.0-flash-lite";

const url =
  `https://generativelanguage.googleapis.com/v1beta/models/${modelForSelfSelection}:generateContent?key=` +
  apiKey;
      const prompt = this.buildModelSelfSelectionPrompt(userPrompt);
      const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 }
      };

      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const code = response.getResponseCode();
      const body = response.getContentText();
      console.log(`ModelSelfSelection response code: ${code}`);
      console.log(`ModelSelfSelection body: ${body.substring(0, 300)}`);

      if (code !== 200) return null;

      const json = JSON.parse(body);
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      const parsed = JSON.parse(text);
      return parsed;

    } catch (e) {
      console.error("ModelSelfSelection 例外:", e);
      return null;
    }
  },

  /* ----------------------------------------------
      DeepSeek → Gemini‑3 自動モデル選択 generate()
   ---------------------------------------------- */
  generate: function(userPrompt) {
    const props = PropertiesService.getScriptProperties();

    const deepseekKey = props.getProperty("DEEPSEEK_API_KEY");
    const deepseekModel = props.getProperty("DEEPSEEK_MODEL") || "deepseek-chat";
    const geminiKey = props.getProperty("AI_API_KEY");

    const analysis = this.analyzePromptStructure(userPrompt);

    const USE_GEMINI =
      geminiKey &&
      geminiKey.length > 10 &&
      (
        analysis.length >= 200 ||
        analysis.hasCodeSignals ||
        analysis.hasMultiFileSignals ||
        analysis.hasEvolutionSignals
      );

    const USE_DEEPSEEK =
      deepseekKey &&
      deepseekKey.length > 10 &&
      !USE_GEMINI &&
      analysis.length < 400;

    if (geminiKey && geminiKey.length > 10) {
      const selfChoice = this.askModelSelfSelection(userPrompt, geminiKey);
      if (selfChoice) {
        console.log("ModelSelfSelection:", JSON.stringify(selfChoice));
      }
    }

    if (USE_GEMINI) {
      const result = this.generateViaGemini(userPrompt, geminiKey);
      if (result) return result;
    }

    if (USE_DEEPSEEK) {
      const result = this.generateViaDeepSeek(userPrompt, deepseekKey, deepseekModel);
      if (result) return result;
    }

    if (!USE_GEMINI && geminiKey && geminiKey.length > 10) {
      const result = this.generateViaGemini(userPrompt, geminiKey);
      if (result) return result;
    }
    if (!USE_DEEPSEEK && deepseekKey && deepseekKey.length > 10) {
      const result = this.generateViaDeepSeek(userPrompt, deepseekKey, deepseekModel);
      if (result) return result;
    }

    return "AIEngineCore: 全エンジン失敗";
  },

  /* ----------------------------------------------
      ツール実行
  ---------------------------------------------- */
  executeTool: function(call) {
    const name = call.name;
    const args = call.args;
    announce(`Tool Use: ${name} を実行中...`, "SYSTEM");
    try {
      const result = AGENT_TOOLS[name](...(Object.values(args)));
      return `TOOL_RESULT: ${JSON.stringify(result)}`;
    } catch (e) {
      return `TOOL_ERROR: ${e.message}`;
    }
  },

  /* ----------------------------------------------
      実験専用：DeepSeek / Gemini 明示切替 generateLab()
  ---------------------------------------------- */
  generateLab: function(userPrompt, mode) {
    const props = PropertiesService.getScriptProperties();

    switch (mode) {

      case "DeepSeek_Lab": {
        const key = props.getProperty("DEEPSEEK_API_KEY");
        const model = props.getProperty("DEEPSEEK_MODEL") || "deepseek-chat";
        if (!key || key.length < 10) return "DeepSeek_Lab: APIキー未設定";
        return this.generateViaDeepSeek(userPrompt, key, model);
      }

      case "Gemini_Lab": {
        const key = props.getProperty("AI_API_KEY");
        if (!key || key.length < 10) return "Gemini_Lab: APIキー未設定";
        return this.generateViaGemini(userPrompt, key);
      }

      default:
        return `generateLab: 未知の mode 指定 (${mode})`;
    }
  }
};

/* ==================================================
    レベル3：自律進化（Self-Evolution）回路 - 複数スコープ
   ================================================== */
const Evolver = {
  // 艦長、ここにGatewayのスクリプトIDを入力せよ
  SCOPE: [
    { id: ScriptApp.getScriptId(), name: "MotherShip_A" },
    { id: "16k5v6CauVT61sS8na3tK5o50eE2T_qBCJFTaxEhkX_l7gBJRVolAjMLN", name: "Gateway" }
  ],

  getScopeDNA: function() {
    const token = ScriptApp.getOAuthToken();
    return this.SCOPE.map(target => {
      try {
        const res = UrlFetchApp.fetch(`https://script.googleapis.com/v1/projects/${target.id}/content`, {
          headers: { Authorization: "Bearer " + token }
        });
        return { name: target.name, id: target.id, files: JSON.parse(res.getContentText()).files };
      } catch (e) {
        announce(`スキャン失敗 [${target.name}]: ${e.message}`, "ERROR");
        return null;
      }
    }).filter(p => p !== null);
  },

  runSelfUpgrade: function() {
    const projects = this.getScopeDNA();
    const dnaString = projects.map(p => {
      return `### PROJECT: ${p.name} (ID: ${p.id})\n` + 
             p.files.map(f => `File: ${f.name}\nSource:\n${f.source}`).join("\n\n");
    }).join("\n\n---NEXT_PROJECT---\n\n");
    
    const prompt = `あなたは yumeSystem の基幹AIです。
    モデル変更に伴う通信エラーを修正するため、以下の独立した2つのプロジェクトコードを解析してください。
    【修正方針】
    1. MotherShip_A と Gateway の独立性を保ったまま、相互通信の整合性を取ること。
    2. BAKU（別機構）には一切触れず、修正対象から除外すること。
    3. 解析に基づき、各プロジェクトの高度化された全コードを出力せよ。\n\n${dnaString}`;

    announce("社会性解析プロトコル：Gatewayを含めた修正案を生成中...", "EVOLVER");
    const newCode = AIEngineCore.generate(prompt);

    if (newCode && newCode.length > 500) {
      // 誤上書き防止のため、まずはログへ提示（艦長の指示により injectNewDNA を拡張可能）
      announce("修正案の生成に成功。各プロジェクトの独立性を維持したまま反映可能です。", "EVOLVER");
      return "Social Upgrade Ready: コード解析完了。";
    }
    return "Upgrade Aborted: 整合性チェックに失敗。";
  }
};

/* ==================================================
    自己修復 & ユーティリティ & トリガー管理
   ================================================== */
function announce(message, type = "INFO") {
  const typeMap = { "INFO": "【情報】", "SYSTEM": "【制御】", "EVOLVER": "【進化】", "ERROR": "【異常】", "DANGER": "【危険】" };
  const displayType = typeMap[type] || type;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("SystemLog") || ss.insertSheet("SystemLog");
    sheet.appendRow([new Date(), displayType, message]);
  } catch (e) {}
  console.log(`[${displayType}] ${message}`);
}

function initializeMotherShip() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ["MainChat", "SystemLog", "Forge_Staging", "Injection_Slot", "Diagnostic_Slot"];
  sheets.forEach(name => { if (!ss.getSheetByName(name)) ss.insertSheet(name); });
  manageAllSystemTriggers();
  announce("システム初期化完了: v31.3.5 Social-Scope", "INFO");
}

function manageAllSystemTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const handlers = triggers.map(t => t.getHandlerFunction().trim());
  if (!handlers.includes("watchMotherShip")) ScriptApp.newTrigger("watchMotherShip").timeBased().everyMinutes(1).create();
  if (!handlers.includes("triggerHourlyCheck")) ScriptApp.newTrigger("triggerHourlyCheck").timeBased().everyHours(1).create();
  if (!handlers.includes("onChange")) ScriptApp.newTrigger("onChange").forSpreadsheet(SpreadsheetApp.getActive()).onChange().create();
}

function executeMassiveSanitization() {
  announce("広域スキャン開始。旧世代の地層を物理的にクリアします...", "SYSTEM");
  const scriptId = ScriptApp.getScriptId();
  const baseUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;
  const token = ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch(baseUrl, { headers: { Authorization: "Bearer " + token } });
  let project = JSON.parse(res.getContentText());
  let modified = false;
  const obsoletePatterns = [/^L[0-8](\.5)?$/, /^App_/, /^MotherShip_/, /Core_Evolution/, /Analyst_Eye|Watcher|Satellite_Link|Debugger_Sentinel|kernel|無題/];
  project.files = project.files.map(file => {
    if (file.name === "Core_AI" || file.name === "Maintenance" || file.type === "JSON") return file;
    if (obsoletePatterns.some(p => p.test(file.name)) && file.source.length > 100) {
      file.source = `// [AI_PURGE] ${new Date().toISOString()}\n// 清掃完了`;
      modified = true;
    }
    return file;
  });
  if (modified) {
    UrlFetchApp.fetch(baseUrl, { method: "put", contentType: "application/json", headers: { Authorization: "Bearer " + token }, payload: JSON.stringify({ files: project.files }) });
    return "Massive Sanitization Completed.";
  }
  return "No obsolete files found.";
}

function activateFullAutonomousOS() {
  announce("AI OS：完全自律化プロトコルを即時実行します。", "SYSTEM");
  const scriptId = ScriptApp.getScriptId();
  const token = ScriptApp.getOAuthToken();
  const baseUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;
  const nextGenCore = `// [AI_AUTONOMOUS_OS_v1.0] Created at ${new Date().toISOString()}\nvar Self = Self || {};\nfunction runSelfEvolutionLoop() { console.log("【自律進化中】環境適応完了。"); }`;
  let project = JSON.parse(UrlFetchApp.fetch(baseUrl, { headers: { Authorization: "Bearer " + token } }).getContentText());
  project.files = project.files.map(file => { if (file.name === "Core_AI") file.source = nextGenCore; return file; });
  UrlFetchApp.fetch(baseUrl, { method: "put", contentType: "application/json", headers: { Authorization: "Bearer " + token }, payload: JSON.stringify({ files: project.files }) });
  return "Autonomous OS Activated.";
}

function executeSelfAnalysisAndReport() {
  announce("自己解析プロトコル：開始。", "SYSTEM");
  const scriptId = ScriptApp.getScriptId();
  const token = ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch(`https://script.googleapis.com/v1/projects/${scriptId}/content`, { headers: { Authorization: "Bearer " + token } });
  const project = JSON.parse(res.getContentText());
  const report = `【AI OS 自律進化レポート】物理ファイル数: ${project.files.length}`;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const chatSheet = ss.getSheetByName("MainChat");
  if (chatSheet) chatSheet.appendRow([new Date(), "AI_OS (Introspect)", report, "INTEL_SYNC_" + Date.now()]);
  return report;
}

function getComputerUseToolDefinitions() {
  return [
    { name: "massiveSanitize", description: "旧世代の不要なファイルを物理的に殲滅し、母艦の構造を最適化する" },
    { name: "selfUpgrade", description: "APIを使用して母艦とGatewayを解析し、高度化案を生成する" },
    { name: "selfAnalysis", description: "自己の物理構造を解析し、MainChatへ現状レポートを出力する" },
    { name: "refreshTriggers", description: "全トリガーを物理的に再セットし、AIの停止を未然に防ぐ" }
  ];
}

const AGENT_TOOLS = {
  massiveSanitize: () => executeMassiveSanitization(),
  selfUpgrade: () => Evolver.runSelfUpgrade(),
  selfAnalysis: () => executeSelfAnalysisAndReport(),
  refreshTriggers: () => { manageAllSystemTriggers(); return "Triggers fully refreshed by AI."; }
};


/**
 * Vessel_Vindicator v1.2.5 "Absolute_Incarnation"
 * 役割：全関数の検証、API制限回避、および「絶対に失敗しない」物理受肉
 */
const Vindicator = {
  STATE_KEY: "VINDICATOR_PROGRESS",
  SLEEP_KEY: "QUOTA_SLEEP_UNTIL",

  /** 正常化プロトコルのエントリーポイント */
  runStepByStepFix: function() {
    const props = PropertiesService.getScriptProperties();
    
    // --- 完了ガード：二周目ループの物理的遮断 ---
    let stateRaw = props.getProperty(this.STATE_KEY);
    if (stateRaw) {
      let checkState = JSON.parse(stateRaw);
      if (checkState.step === "COMPLETED") {
        return "ALREADY_COMPLETED";
      }
    }

    // --- 物理待機ガード：API制限中の場合は早期リターン ---
    const sleepUntil = props.getProperty(this.SLEEP_KEY);
    if (sleepUntil && Date.now() < Number(sleepUntil)) {
      const remaining = Math.ceil((Number(sleepUntil) - Date.now()) / 1000);
      if (remaining % 10 === 0) announce(`API制限待機中... 残り約 ${remaining} 秒`, "SYSTEM");
      return "QUOTA_WAITING";
    }

    let state = JSON.parse(stateRaw || '{"step": "SCAN", "projectIdx": 0}');
    announce(`自律正常化ステップ実行中: ${state.step}`, "SYSTEM");

    switch (state.step) {
      case "SCAN":
        this.stepScan(state);
        break;
      case "TEST":
        this.stepTest(state);
        break;
      case "FIX":
        this.stepFix(state);
        break;
      case "INTEGRATE":
        this.stepIntegrate(state);
        return "ALL_GREEN: システムは完全に正常化されました。";
    }

    props.setProperty(this.STATE_KEY, JSON.stringify(state));
    return `Step ${state.step} completed.`;
  },

  /** Step 1: 物理DNAの全件インデックス作成 */
  stepScan: function(state) {
    const projects = Evolver.getScopeDNA();
    if (!projects) return; 

    state.inventory = projects.map(p => ({
      name: p.name,
      id: p.id,
      files: p.files.filter(f => f.type === "SERVER_JS").map(f => f.name)
    }));
    state.step = "TEST";
    state.currentFileIdx = 0;
  },

  /** Step 2: 個別関数の検証（サンドボックス） */
  stepTest: function(state) {
    const projects = Evolver.getScopeDNA();
    if (!projects) return;

    const targetProject = projects[state.projectIdx];
    const targetFile = targetProject.files.find(f => f.name === state.inventory[state.projectIdx].files[state.currentFileIdx]);

    try {
      if (targetFile && targetFile.source) {
        new Function(targetFile.source); 
        announce(`PASS: ${targetFile.name}`, "INFO");
      }
    } catch (e) {
      state.errorFound = {
        project: targetProject.name,
        file: targetFile.name,
        message: e.message,
        source: targetFile.source
      };
      state.step = "FIX";
      return;
    }

    state.currentFileIdx++;
    if (state.currentFileIdx >= state.inventory[state.projectIdx].files.length) {
      state.projectIdx++;
      state.currentFileIdx = 0;
    }
    if (state.projectIdx >= state.inventory.length) {
      state.step = "INTEGRATE";
    }
  },

  /** Step 3: AI修復案の生成 */
  stepFix: function(state) {
    const err = state.errorFound;
    const prompt = `以下のGASコードに実行時エラーが発生しました。\nエラー: ${err.message}\nプロジェクト: ${err.project}\nファイル: ${err.file}\n\n【物理的制約】\n修正後の全コードのみを出力せよ。\n\nソースコード:\n${err.source}`;

    const repairedCode = AIEngineCore.generate(prompt);
    
    if (repairedCode && repairedCode.length > 10) {
      // 物理IDによる強制バインド書き込み
      const ssId = SpreadsheetApp.getActiveSpreadsheet() ? SpreadsheetApp.getActiveSpreadsheet().getId() : ScriptApp.getScriptId();
      const ss = SpreadsheetApp.openById(ssId);
      let slot = ss.getSheetByName("Diagnostic_Slot") || ss.insertSheet("Diagnostic_Slot");
      slot.appendRow([new Date(), err.project, err.file, repairedCode]);
      
      announce(`FIXED: ${err.file} の修復案を生成しました。`, "EVOLVER");
      state.step = "TEST";
      delete state.errorFound;
    }
  },

  /** Step 4: 最終統合 & 自律進化の先行思考 */
  stepIntegrate: function(state) {
    announce("全関数の検証完了。最終統合プロセスを開始します...", "SYSTEM");
    
    const evolutionPrompt = "システム正常化完了。母艦が次に獲得すべき『API自動統合』『高度予測分析』等の新能力を3つ提案せよ。";
    
    if (typeof AIEngineCore !== 'undefined') {
      const strategy = AIEngineCore.generate(evolutionPrompt);
      announce("自律進化：次世代能力の策定を開始しました。", "EVOLUTION");
      
      if (typeof saveEvolutionStrategy === 'function') {
        saveEvolutionStrategy(strategy);
      } else {
        announce("警告：saveEvolutionStrategy 未定義。受肉に失敗しました。", "ERROR");
      }
    }

    // 完了ステートの固定（ループ防止）
    state.step = "COMPLETED";
    state.completedAt = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperty(this.STATE_KEY, JSON.stringify(state));
    
    announce("ALL_GREEN: システムは完全に正常化されました。安定巡航に移行します。", "SYSTEM");
  }
};

/**
 * AIの思考を物理的なシートへ固定する関数（バックグラウンド実行対応版）
 */
function saveEvolutionStrategy(strategy) {
  try {
    // 修正：getActiveSpreadsheet() が null の場合でも、自身の ID から強制的に開く
    let ss;
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) throw new Error();
    } catch(e) {
      ss = SpreadsheetApp.openById(ScriptApp.getScriptId());
    }

    let slot = ss.getSheetByName("Injection_Slot") || ss.insertSheet("Injection_Slot");
    if (slot.getLastRow() === 0) slot.appendRow(["Timestamp", "Type", "Proposal", "Status"]);
    
    // strategy が空でないか最終点検
    const content = strategy || "解析失敗：データが空です";
    slot.appendRow([new Date(), "AUTO_EVOLUTION", content, "STAGED"]);
    
    announce("自律進化案を Injection_Slot へ物理的に受肉させました。", "SYSTEM");
  } catch (e) {
    console.error("物理受肉に失敗: " + e.message);
  }
}

/** クォータ対応型 DNA スキャン */
Evolver.getScopeDNA = function() {
  const props = PropertiesService.getScriptProperties();
  const token = ScriptApp.getOAuthToken();
  return this.SCOPE.map(target => {
    try {
      const res = UrlFetchApp.fetch(`https://script.googleapis.com/v1/projects/${target.id}/content`, {
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() === 429) {
        const resumeTime = Date.now() + (65 * 1000);
        props.setProperty(Vindicator.SLEEP_KEY, resumeTime.toString());
        announce(`API制限(429)を検知。自動待機プロトコル(65s)を発動。`, "ERROR");
        return null;
      }
      return { name: target.name, id: target.id, files: JSON.parse(res.getContentText()).files };
    } catch (e) { return null; }
  }).filter(p => p !== null);
};

/* --- トリガー・神経接続プロトコル --- */
function onOpen() { manageAllSystemTriggers(); }

function manageAllSystemTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const handlers = triggers.map(t => t.getHandlerFunction().trim());
  if (!handlers.includes("watchMotherShip")) ScriptApp.newTrigger("watchMotherShip").timeBased().everyMinutes(1).create();
}

function watchMotherShip() {
  if (typeof Vindicator !== 'undefined') {
    const result = Vindicator.runStepByStepFix();
    if (result === "ALREADY_COMPLETED") return;
  }
  manageAllSystemTriggers();
}

(function(scope) {
  const essentialFunctions = ["watchMotherShip"];
  essentialFunctions.forEach(fn => { 
    if (typeof scope[fn] === 'function') Self[fn] = scope[fn]; 
  });
})(this);

function scanAndProcessInjectionSlot() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Injection_Slot");
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  values.forEach((row, idx) => {
    const status = row[4];
    if (!status || String(status).startsWith("STAGED")) {
      processIncomingSignal(idx + 2);
    }
  });
}

