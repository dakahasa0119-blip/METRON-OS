/**
 * //AUTHORIZATION_CODE: SINGULARITY_2026//
 * DeepContextBuilderPlusPlus (DCBPP)
 * 母艦の状態を「読むだけ」で収集し、
 * Firebase と VRAM（シート）に安全に書き込む独立観測ユニット。
 * [DeepContextBuilderPlusPlus Final / JST / L0-route 対応]
 */

// -------------------------------------------------------------
// 共通：JST（日本時間）を ISO8601 で返す
// -------------------------------------------------------------
function DCBPP_nowJST() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

//
// -------------------------------------------------------------
// L7 Integration: MainChat Reader
// -------------------------------------------------------------
function normalizeSpeaker(raw) {
  if (!raw) return "";
  const s = String(raw).toLowerCase();
  if (s.includes("captain")) return "Captain";
  if (s.includes("sovereign") || s.includes("ai")) return "AI_Sovereign";
  return s;
}

function DCBPP_scanMainChat() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("mainchat");
  if (!sheet) return {};

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  let lastCaptain = null;
  let lastAI = null;

  values.forEach(row => {
    const timestamp = row[0];
    const rawSpeaker = row[1];
    const message = row[2];
    const details = row[3];

    const speaker = normalizeSpeaker(rawSpeaker);

    if (speaker === "Captain") {
      lastCaptain = { timestamp, message, details };
    }
    if (speaker === "AI_Sovereign") {
      lastAI = { timestamp, message, details };
    }
  });

  return {
    lastCaptainMessage: lastCaptain,
    lastAISovereignMessage: lastAI
  };
}

//
// -------------------------------------------------------------
// エントリーポイント
// -------------------------------------------------------------
function DeepContextBuilderPlusPlus(forceRefresh = false) {

  const ctx = {
    meta: DCBPP_buildMeta(),                 // L7整合済み meta（JST）
    physicalConstraints: DCBPP_physicalConstraints(),
    structure: DCBPP_scanStructure(),        // 母艦＋外部プロジェクト
    runtimeState: DCBPP_scanRuntime(),
    anomalyProfile: DCBPP_scanTemporal(),
    diffInsights: {},
    patchHints: {}
  };

  ctx.diffInsights = DCBPP_deepDiff(ctx);
  ctx.patchHints = DCBPP_patchHints(ctx);

  DCBPP_saveToFirebase(ctx);
  DCBPP_saveToVRAM(ctx);

  return ctx;
}

//
// -------------------------------------------------------------
// 1. Meta 情報（L7整合：最新発話を含む）
// -------------------------------------------------------------
function DCBPP_buildMeta() {

  const chat = DCBPP_scanMainChat() || {};

  return {
    authCode: "SINGULARITY_2026",
    generatedAt: DCBPP_nowJST(),                 // JST
    generator: "DeepContextBuilderPlusPlus",
    motherShipVersion: "Gateway v8.0",

    lastCaptainMessage: chat.lastCaptainMessage || null,
    lastAISovereignMessage: chat.lastAISovereignMessage || null
  };
}

//
// -------------------------------------------------------------
// 2. Google の物理制約（檻）
// -------------------------------------------------------------
function DCBPP_physicalConstraints() {
  return {
    time: { maxExecutionSeconds: 360 },
    storage: {
      propertiesTotalKB: 100,
      cacheTotalKB: 100
    },
    communication: {
      urlFetchMaxPayloadMB: 10,
      maxUrlLengthBytes: 2048
    }
  };
}

//
// -------------------------------------------------------------
// 3. Structure Scan（静的構造・ハイブリッド版 + sourceCode対応）
// -------------------------------------------------------------
function DCBPP_scanStructure() {

  const structure = {
    modules: [],            // 母艦プロジェクトのモジュール
    externalProjects: [],   // 外部 GAS プロジェクト
    sheets: {},
    triggers: [],
    driveMetadata: {},
    propertiesUsage: {}
  };

  // 1. 母艦プロジェクト（このスクリプト）の本物のコードを取得（GAS API）
  try {
    const scriptId = ScriptApp.getScriptId();
    const token = ScriptApp.getOAuthToken();
    const url = "https://script.googleapis.com/v1/projects/" + scriptId + "/content";

    const raw = UrlFetchApp.fetch(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + token }
    });

    const project = JSON.parse(raw.getContentText());
    const files = project.files || [];

    files.forEach(f => {
      if (!f.name || !f.source) return;

      const lines = f.source.split("\n").length;

      structure.modules.push({
        name: f.name,
        fileName: f.name,
        lineCount: lines,
        type: DCBPP_classifyModule(f.name, f.source),  // sourceCode 渡し
        source: f.source
      });
    });

  } catch (e) {
    structure.modules.push({
      error: "motherShip-module-scan-failed",
      detail: e.toString()
    });
  }

  // 2. 外部プロジェクト探索（母艦フォルダの親フォルダ配下を動的スキャン）
  try {
    const ssFile = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
    const motherFolder = ssFile.getParents().next();
    const parentFolderIter = motherFolder.getParents();

    if (parentFolderIter.hasNext()) {
      const parentFolder = parentFolderIter.next();
      const siblingFolders = parentFolder.getFolders();

      while (siblingFolders.hasNext()) {
        const folder = siblingFolders.next();
        if (folder.getId() === motherFolder.getId()) continue;

        const externalProjectInfo = {
          folderName: folder.getName(),
          folderId: folder.getId(),
          modules: []
        };

        const files = folder.getFiles();
        while (files.hasNext()) {
          const file = files.next();

          if (file.getMimeType() === MimeType.GOOGLE_APPS_SCRIPT) {
            const projectId = file.getId();

            try {
              const token = ScriptApp.getOAuthToken();
              const url = "https://script.googleapis.com/v1/projects/" + projectId + "/content";

              const raw = UrlFetchApp.fetch(url, {
                method: "GET",
                headers: { Authorization: "Bearer " + token }
              });

              const project = JSON.parse(raw.getContentText());
              const extFiles = project.files || [];

              extFiles.forEach(f => {
                if (!f.name || !f.source) return;

                const lines = f.source.split("\n").length;

                externalProjectInfo.modules.push({
                  name: f.name,
                  fileName: f.name,
                  lineCount: lines,
                  type: DCBPP_classifyModule(f.name, f.source),
                  projectId: projectId,
                  source: f.source
                });
              });

            } catch (e2) {
              externalProjectInfo.modules.push({
                error: "external-project-scan-failed",
                detail: e2.toString(),
                projectId: projectId
              });
            }
          }
        }

        if (externalProjectInfo.modules.length > 0) {
          structure.externalProjects.push(externalProjectInfo);
        }
      }
    }

  } catch (e) {
    structure.externalProjects.push({
      error: "external-scan-failed",
      detail: e.toString()
    });
  }

  // 3. シート情報
  try {
    const ss = SpreadsheetApp.getActive();
    ss.getSheets().forEach(sh => {
      structure.sheets[sh.getName()] = {
        rows: sh.getMaxRows(),
        cols: sh.getMaxColumns(),
        usedRange:
          sh.getDataRange().getNumRows() +
          "x" +
          sh.getDataRange().getNumColumns()
      };
    });
  } catch (e) {
    structure.sheets["error"] = e.toString();
  }

  // 4. トリガー情報
  try {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => {
      structure.triggers.push({
        handler: t.getHandlerFunction(),
        type: t.getEventType(),
        source: t.getTriggerSource()
      });
    });
  } catch (e) {
    structure.triggers.push({ error: e.toString() });
  }

  // 5. Drive メタデータ（母艦シート）
  try {
    const file = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
    structure.driveMetadata = {
      name: file.getName(),
      sizeKB: Math.round(file.getSize() / 1024),
      lastUpdated: file.getLastUpdated()
    };
  } catch (e) {
    structure.driveMetadata = { error: e.toString() };
  }

  // 6. Properties 使用量
  try {
    const props = PropertiesService.getScriptProperties().getProperties();
    let totalBytes = 0;

    Object.keys(props).forEach(k => {
      totalBytes += k.length + props[k].length;
    });

    structure.propertiesUsage = {
      keys: Object.keys(props).length,
      approxKB: Math.round(totalBytes / 1024)
    };
  } catch (e) {
    structure.propertiesUsage = { error: e.toString() };
  }

  return structure;
}

/**
 * 次世代 classifyModule（L0 route 統合版）
 * - ファイル名
 * - 関数名
 * - コード内容
 * の3層解析で CORE_K / INFRA_A / INTEL_B / SATELLITE_C / GENESIS_D を推定する。
 */
function DCBPP_classifyModule(name, sourceCode = "") {
  const n = name.toLowerCase();
  const s = (sourceCode || "").toLowerCase();

  // 1. ファイル名ベース
  if (n.includes("l0") || n.includes("kernel") || n.includes("core"))
    return "CORE_K";

  if (n.includes("firebase") || n.includes("drive") || n.includes("vram") ||
      n.includes("trigger") || n.includes("io") || n.includes("infra"))
    return "INFRA_A";

  if (n.includes("context") || n.includes("scan") || n.includes("analy") ||
      n.includes("diff") || n.includes("entropy") || n.includes("intel"))
    return "INTEL_B";

  if (n.includes("gateway") || n.includes("satellite") || n.includes("external") ||
      n.includes("api") || n.includes("webhook"))
    return "SATELLITE_C";

  if (n.includes("evolver") || n.includes("genesis") || n.includes("forge") ||
      n.includes("l6") || n.includes("l7") || n.includes("l8"))
    return "GENESIS_D";

  // 2. 関数名・内容ベース
  if (s.includes("function l0") || s.includes("metronselfawakening"))
    return "CORE_K";

  if (s.includes("urlfetchapp") || s.includes("propertiesservice") ||
      s.includes("cacheservice") || s.includes("driveapp") ||
      s.includes("scriptapp.getprojecttriggers"))
    return "INFRA_A";

  if (s.includes("scan") || s.includes("analy") || s.includes("diff") ||
      s.includes("entropy") || s.includes("observe"))
    return "INTEL_B";

  if (s.includes("fetch") || s.includes("external") || s.includes("api") ||
      s.includes("webhook") || s.includes("satellite"))
    return "SATELLITE_C";

  if (s.includes("evolve") || s.includes("mutate") || s.includes("synthesize") ||
      s.includes("generate") || s.includes("applypatch"))
    return "GENESIS_D";

  if (s.includes("context") && s.includes("save"))
    return "INFRA_A";

  if (s.includes("entropy") || s.includes("temporal") || s.includes("heartbeat"))
    return "INTEL_B";

  if (s.includes("patch") || s.includes("evolution"))
    return "GENESIS_D";

  return "INTEL_B";
}

//
// -------------------------------------------------------------
// 4. Runtime Scan（動的状態）- JST統合版
// -------------------------------------------------------------
function DCBPP_scanRuntime() {

  const runtime = {
    pendingEvolutions: null,
    recentErrors: [],
    heartbeats: {}
  };

  // 1. pendingEvolutions
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName("Forge_Staging");

    if (sheet) {
      const data = sheet.getDataRange().getValues();
      const pending = data.filter(r => r[0] === "PENDING").length;
      runtime.pendingEvolutions = pending;
    } else {
      runtime.pendingEvolutions = "Forge_Staging_not_found";
    }
  } catch (e) {
    runtime.pendingEvolutions = "error:" + e.toString();
  }

  // 2. recentErrors
  try {
    const ss = SpreadsheetApp.getActive();
    const logSheet = ss.getSheetByName("SystemLog");

    if (logSheet) {
      const last20 = logSheet.getRange(
        Math.max(1, logSheet.getLastRow() - 20),
        1,
        20,
        3
      ).getValues();

      runtime.recentErrors = last20
        .filter(r => r[1] === "ERROR")
        .map(r => ({
          timestamp: r[0],   // SystemLog は JST で記録されている前提
          module: r[2]
        }));
    }
  } catch (e) {
    runtime.recentErrors.push({ error: e.toString() });
  }

  // 3. heartbeats
  try {
    const triggers = ScriptApp.getProjectTriggers();

    triggers.forEach(t => {
      const handler = t.getHandlerFunction();
      const lastRun = DCBPP_getLastRun(handler);  // JST or "unknown"

      runtime.heartbeats[handler] = {
        lastRunAt: lastRun,
        expectedIntervalSeconds: DCBPP_expectedInterval(t),
        jitterSeconds: DCBPP_calcJitter(lastRun, DCBPP_expectedInterval(t))
      };
    });
  } catch (e) {
    runtime.heartbeats["error"] = e.toString();
  }

  return runtime;
}

function DCBPP_getLastRun(handler) {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty("lastRun_" + handler) || "unknown";
}

function DCBPP_expectedInterval(trigger) {
  switch (trigger.getEventType()) {
    case ScriptApp.EventType.CLOCK:
      return 3600;   // 1時間
    default:
      return 86400;  // 24時間
  }
}

function DCBPP_calcJitter(lastRun, expected) {
  if (lastRun === "unknown") return null;

  const last = new Date(lastRun).getTime();
  const now = Date.now();
  const diff = Math.abs(now - last) / 1000;

  return Math.abs(diff - expected);
}

//
// -------------------------------------------------------------
// 5. Temporal Scan（沈黙の検知）- JST統合版
// -------------------------------------------------------------
function DCBPP_scanTemporal() {

  const temporal = {
    silentZones: [],
    entropyAnalysis: {}
  };

  // 1. SystemLog の沈黙
  try {
    const ss = SpreadsheetApp.getActive();
    const logSheet = ss.getSheetByName("SystemLog");

    if (logSheet) {
      const lastRow = logSheet.getLastRow();
      const lastLogTime = logSheet.getRange(lastRow, 1).getValue(); // JST
      const silenceSeconds = (Date.now() - new Date(lastLogTime).getTime()) / 1000;

      temporal.silentZones.push({
        module: "SystemLog",
        lastLogAt: lastLogTime,
        silenceSeconds: silenceSeconds,
        classifiedAs: silenceSeconds > 360 ? "POSSIBLE_DEATH" : "OK"
      });
    }
  } catch (e) {
    temporal.silentZones.push({ error: e.toString() });
  }

  // 2. トリガーの沈黙
  try {
    const triggers = ScriptApp.getProjectTriggers();

    triggers.forEach(t => {
      const handler = t.getHandlerFunction();
      const lastRun = DCBPP_getLastRun(handler); // JST

      if (lastRun !== "unknown") {
        const silence = (Date.now() - new Date(lastRun).getTime()) / 1000;
        const expected = DCBPP_expectedInterval(t);

        temporal.silentZones.push({
          module: handler,
          lastRunAt: lastRun,
          silenceSeconds: silence,
          expectedIntervalSeconds: expected,
          classifiedAs: silence > expected * 2 ? "POSSIBLE_DEATH" : "OK"
        });
      }
    });
  } catch (e) {
    temporal.silentZones.push({ error: e.toString() });
  }

  // 3. エントロピー解析
  try {
    const ss = SpreadsheetApp.getActive();
    const logSheet = ss.getSheetByName("SystemLog");

    if (logSheet) {
      const values = logSheet.getRange(
        Math.max(1, logSheet.getLastRow() - 200),
        1,
        200,
        3
      ).getValues();

      const entropy = DCBPP_calcEntropy(values);

      temporal.entropyAnalysis["SystemLog"] = {
        entropyScore: entropy,
        interpretation: entropy < 0.2 ? "UNNATURAL_SILENCE" : "NORMAL"
      };
    }
  } catch (e) {
    temporal.entropyAnalysis["SystemLog"] = { error: e.toString() };
  }

  return temporal;
}

function DCBPP_calcEntropy(values) {
  const flat = values.flat().join("");
  const freq = {};

  for (let c of flat) freq[c] = (freq[c] || 0) + 1;

  const total = flat.length;
  let entropy = 0;

  for (let k in freq) {
    const p = freq[k] / total;
    entropy -= p * Math.log2(p);
  }

  return entropy / 8;
}

//
// -------------------------------------------------------------
// 6. DeepDiff（期待値 vs 実測）- L0 route 対応版
// -------------------------------------------------------------
function DCBPP_deepDiff(ctx) {

  const diff = {
    code: [],
    performance: [],
    data: []
  };

  // 1. Code Diff（母艦 + 外部プロジェクト）
  try {
    const allModules = []
      .concat(ctx.structure.modules || [])
      .concat((ctx.structure.externalProjects || []).flatMap(p => p.modules || []));

    allModules.forEach(m => {
      if (!m.lineCount || !m.type) return;

      const expected = DCBPP_expectedLines(m.type);
      const measured = m.lineCount;

      if (measured > expected * 1.5) {
        diff.code.push({
          module: m.name,
          routeType: m.type,
          expectedLines: expected,
          actualLines: measured,
          interpretation: "MODULE_TOO_LARGE",
          suggestion: "分割または責務の再配置を検討"
        });
      }
    });
  } catch (e) {
    diff.code.push({ error: e.toString() });
  }

  // 2. Performance Diff
  try {
    const triggers = ctx.runtimeState.heartbeats || {};

    Object.keys(triggers).forEach(handler => {
      const hb = triggers[handler];
      if (!hb.lastRunAt || !hb.expectedIntervalSeconds) return;

      const jitter = hb.jitterSeconds;
      if (jitter != null && jitter > hb.expectedIntervalSeconds * 2) {
        diff.performance.push({
          module: handler,
          expectedIntervalSeconds: hb.expectedIntervalSeconds,
          jitterSeconds: jitter,
          interpretation: "TRIGGER_DELAYED",
          suggestion: "処理負荷の分散または分割が必要"
        });
      }
    });
  } catch (e) {
    diff.performance.push({ error: e.toString() });
  }

  // 3. Data Diff
  try {
    const pending = ctx.runtimeState.pendingEvolutions;

    if (typeof pending === "number" && pending > 10) {
      diff.data.push({
        sheet: "Forge_Staging",
        expectedPendingMax: 5,
        actualPending: pending,
        interpretation: "PENDING_OVERFLOW",
        suggestion: "承認フローの詰まりを解消する必要あり"
      });
    }
  } catch (e) {
    diff.data.push({ error: e.toString() });
  }

  return diff;
}

function DCBPP_expectedLines(type) {
  switch (type) {
    case "CORE_K":      return 400;
    case "INFRA_A":     return 250;
    case "INTEL_B":     return 300;
    case "SATELLITE_C": return 220;
    case "GENESIS_D":   return 350;
    default:            return 250;
  }
}

//
// -------------------------------------------------------------
// 7. PatchHints（外部AIへの注文書）
// -------------------------------------------------------------
function DCBPP_patchHints(ctx) {

  const hints = {
    goals: [],
    hardConstraints: [],
    allowedActions: [],
    forbiddenActions: []
  };

  // 1. goals
  try {
    if (typeof ctx.runtimeState.pendingEvolutions === "number" &&
        ctx.runtimeState.pendingEvolutions > 10) {
      hints.goals.push("Forge_Staging の PENDING を正常値（5以下）に戻す");
    }

    Object.keys(ctx.runtimeState.heartbeats).forEach(handler => {
      const hb = ctx.runtimeState.heartbeats[handler];
      if (hb.jitterSeconds && hb.jitterSeconds > hb.expectedIntervalSeconds * 2) {
        hints.goals.push(handler + " の遅延を解消する");
      }
    });

    ctx.diffInsights.code.forEach(diff => {
      if (diff.interpretation === "MODULE_TOO_LARGE") {
        hints.goals.push(diff.module + " の肥大化を解消する");
      }
    });
  } catch (e) {
    hints.goals.push("goal-scan-error: " + e.toString());
  }

  // 2. hardConstraints
  hints.hardConstraints = [
    "単一実行は 360 秒以内に収めること",
    "PropertiesService の使用は 100KB を超えないこと",
    "UrlFetch のペイロードは 300KB 以下に抑えること",
    "GET URL は 2048 バイト以内に収めること"
  ];

  // 3. allowedActions
  hints.allowedActions = [
    "モジュールの分割",
    "トリガーの再配線",
    "処理の分散化",
    "サテライトへの機能オフロード",
    "ログ出力ポイントの追加",
    "VRAM（シート）への一時退避",
    "Firebase への長期保存"
  ];

  // 4. forbiddenActions
  hints.forbiddenActions = [
    "Gateway v7.0 系統の直接改変",
    "SystemLog の全量削除",
    "PropertiesService の全クリア",
    "母艦のコアモジュールの削除",
    "トリガーの無断削除"
  ];

  return hints;
}

//
// -------------------------------------------------------------
// 8. Firebase 保存（長期記憶）- JST版
// -------------------------------------------------------------
function DCBPP_saveToFirebase(ctx) {
  const props = PropertiesService.getScriptProperties();
  const projectId = props.getProperty("FIREBASE_PROJECT_ID") || "metron-os";

  if (!projectId) {
    Logger.log("SKIPPED: FIREBASE_PROJECT_ID is not set.");
    return;
  }

  const url =
    "https://firestore.googleapis.com/v1/projects/" +
    projectId +
    "/databases/(default)/documents/context/latest";

  const payload = {
    fields: {
      context: { stringValue: JSON.stringify(ctx) },
      updatedAt: { stringValue: DCBPP_nowJST() }   // JST
    }
  };

  const options = {
    method: "patch",
    contentType: "application/json",
    headers: {
      "Authorization": "Bearer " + ScriptApp.getOAuthToken()
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    const resCode = res.getResponseCode();

    if (resCode >= 400) {
      Logger.log("❌ Firebase L1 Error (" + resCode + "): " + res.getContentText());
    } else {
      Logger.log("✅ Firebase L1 Success: Context synced to 'latest'.");
    }
  } catch (e) {
    Logger.log("Firebase L1 save error: " + e.toString());
  }
}

//
// -------------------------------------------------------------
// 9. VRAM 保存（スプレッドシートのキャッシュタブ）- JST & 軽量版
// -------------------------------------------------------------
function DCBPP_saveToVRAM(ctx) {

  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName("VRAM");

  if (!sheet) {
    sheet = ss.insertSheet("VRAM");
  }

  sheet.clear();

  sheet.getRange(1, 1).setValue("DeepContextBuilderPlusPlus Cache (JST)");
  sheet.getRange(2, 1).setValue(DCBPP_nowJST());

  // ctx 全体は巨大になりがちなので省略
  sheet.getRange(3, 1).setValue("ctx 全体はサイズ制限のため省略");

  // externalProjects だけ保存
  const ext = JSON.stringify(ctx.structure.externalProjects, null, 2);
  if (ext.length > 50000) {
    sheet.getRange(4, 1).setValue("externalProjects too large (" + ext.length + ")");
  } else {
    sheet.getRange(4, 1).setValue(ext);
  }

  // 母艦 modules も保存
  const mods = JSON.stringify(ctx.structure.modules, null, 2);
  if (mods.length <= 50000) {
    sheet.getRange(5, 1).setValue(mods);
  } else {
    sheet.getRange(5, 1).setValue("modules too large (" + mods.length + ")");
  }
}
