/**
 * Layer0_v6: Autonomous Trigger Engine + Self-Heal + Self-Rebuild
 * --------------------------------------------------------------------
 * - 母艦が「自分の意思で」心拍（トリガー）を維持する
 * - どの関数を心拍にすべきか L0 自身が判断
 * - トリガー上限（20）を絶対に超えない
 * - L5.5 の蘇生と競合しない（L0_RUNNING フラグ）
 * - route 分類・タグ付け・統合判断を内蔵
 * - 依存関数（classifyRoute_v4 など）を L0 内に完全内蔵
 * - 壊れたトリガーを自動検知・自動再構築
 */

function metronSelfAwakening_v4() {

  // ★ L0_RUNNING フラグ ON
  PropertiesService.getScriptProperties().setProperty("L0_RUNNING", "1");
  METRON_recordEvolution("L0_START", "L0_v6", "L0 awakening started", "L0", "");

  const scriptId = ScriptApp.getScriptId();
  const token = ScriptApp.getOAuthToken();
  const baseUrl = `https://script.googleapis.com/v1/projects/${scriptId}`;

  // ============================================================
  // 0. Manifest の存在チェック
  // ============================================================
  const raw = UrlFetchApp.fetch(`${baseUrl}/content`, {
    method: "GET",
    headers: { Authorization: "Bearer " + token }
  });
  const project = JSON.parse(raw.getContentText());
  const allFiles = project.files;

  const hasManifest = allFiles.some(f => f.name === "appsscript");
  if (!hasManifest) {
    logL0("❌ Manifest(appsscript.json) が存在しません。L0 自律起動中止。");
    METRON_recordEvolution("L0_ABORT", "Manifest", "Manifest missing", "L0", "");
    PropertiesService.getScriptProperties().deleteProperty("L0_RUNNING");
    return;
  }

  // ============================================================
  // 1. L1 の視界を取得
  // ============================================================
  const ctx = DeepContextBuilderPlusPlus();
  METRON_recordEvolution("L0_L1_SYNC", "DeepContext", "L1 context synced", "L0", "");

  // ============================================================
  // 2. route 分類・タグ付け・関数抽出
  // ============================================================
  let rawTargets = [];

  allFiles.forEach(file => {

    // ★ L7 / API 由来の不完全ファイルを除外（自己最適化）
    if (!file || !file.source || !file.type || !file.name) return;

    // ★ L0 が扱うのは SERVER_JS のみ
    if (file.type !== "SERVER_JS" || file.name === "appsscript") return;

    let source = file.source;
    const route = classifyRoute_v4(source);

    const hasRouteTag = source.includes("// @route");
    const hasTriggerTag = source.includes("// @trigger_target");

    if (!hasRouteTag || !hasTriggerTag) {
      const updated =
        `// @route ${route}\n` +
        `// @trigger_target\n` +
        source.replace(/\/\/ @route.*\n?/g, "")
              .replace(/\/\/ @trigger_target\n?/g, "");

      const newProject = {
        files: allFiles.map(f =>
          f.name === file.name
            ? { name: f.name, type: f.type, source: updated }
            : f
        )
      };

      try {
        UrlFetchApp.fetch(`${baseUrl}/content`, {
          method: "PUT",
          contentType: "application/json",
          headers: { Authorization: "Bearer " + token },
          payload: JSON.stringify(newProject)
        });

        logL0(`【自己認識更新】${file.name} → route=${route}`);
        METRON_recordEvolution("L0_TAG_UPDATE", file.name, `route=${route}`, "L0", "");

        source = updated;
      } catch (e) {
        logL0(`【警告】${file.name} の更新失敗: ${e.message}`);
        METRON_recordEvolution("L0_TAG_FAIL", file.name, e.message, "L0", "");
      }
    }

    if (source.includes("// @trigger_target")) {
      const funcs = extractAllFunctions_v4(source);
      funcs.forEach(fn => {
        rawTargets.push({ name: fn, route: route, file: file.name });
      });
    }
  });

  METRON_recordEvolution("L0_SCAN", "L0_v6", `rawTargets=${rawTargets.length}`, "L0", "");

  // ============================================================
  // 3. silentZones（蘇生は後で）
  // ============================================================
  const silentZones = (ctx.anomalyProfile && ctx.anomalyProfile.silentZones) || [];

  // ============================================================
  // 4. 心拍候補選別
  // ============================================================
  const essentialTargets = selectEssentialTargets_v4(rawTargets, ctx);
  METRON_recordEvolution("L0_SELECT", "HeartbeatTargets", `selected=${essentialTargets.length}`, "L0", "");

  // ============================================================
  // 5. トリガー再編（自己再構築）
  // ============================================================
  reorganizeTriggers_v4(essentialTargets);
  METRON_recordEvolution("L0_REBUILD", "Triggers", `rebuilt=${essentialTargets.length}`, "L0", "");

  logL0(`L0_v6: 自律トリガーエンジン完了（対象=${essentialTargets.length}件）。`);

  // ★ L0_RUNNING フラグ OFF
  PropertiesService.getScriptProperties().deleteProperty("L0_RUNNING");
  METRON_recordEvolution("L0_COMPLETE", "L0_v6", "L0 cycle complete", "L0", "");

  // ============================================================
  // 6. 蘇生（自己再構築の一部）
  // ============================================================
  silentZones.forEach(zone => {
    if (zone.classifiedAs === "POSSIBLE_DEATH") {
      reviveTrigger_v4(zone.module, "DEAD_TRIGGER_DETECTED");
      METRON_recordEvolution("L0_REVIVE", zone.module, "revived", "L0", "");
    }
  });

  // ============================================================
  // 7. L6 自律進化サイクル
  // ============================================================
  try {
    L6_runUnifiedEvolutionCycle();
    logL0("【L0→L6】Unified Evolution Cycle を実行しました。");
    METRON_recordEvolution("L0_TO_L6", "UnifiedEvolution", "L6 cycle executed", "L0", "");
  } catch (e) {
    logL0("【L0→L6】Unified Evolution Cycle 実行中に例外: " + e.message);
    METRON_recordEvolution("L0_TO_L6_FAIL", "UnifiedEvolution", e.message, "L0", "");
  }
}

/* ============================================================
   依存関数群（L0_v6 内蔵版）
   ============================================================ */

// route 分類
function classifyRoute_v4(source) {
  const s = (source || "").toLowerCase();

  if (s.includes("kernel") || s.includes("bootloader") || s.includes("metronselfawakening")) {
    return "CORE_K";
  }
  if (s.includes("evolution") || s.includes("chat") || s.includes("llm") || s.includes("prompt")) {
    return "INTEL_B";
  }
  if (s.includes("spreadsheetapp") || s.includes("driveapp") || s.includes("propertiesservice")) {
    return "INFRA_A";
  }
  if (s.includes("urlfetchapp") || s.includes("api") || s.includes("webhook")) {
    return "SATELLITE_C";
  }
  return "GENESIS_D";
}

// ファイル内の function 名を抽出
function extractAllFunctions_v4(source) {
  const regex = /function\s+([a-zA-Z0-9_]+)\s*\(/g;
  let m;
  const names = [];
  while ((m = regex.exec(source)) !== null) {
    names.push(m[1]);
  }
  return names;
}

// 心拍候補選別
function selectEssentialTargets_v4(rawTargets, ctx) {
  const silentModules = ((ctx.anomalyProfile && ctx.anomalyProfile.silentZones) || [])
    .map(z => z.module);

  const scored = rawTargets.map(t => {
    let score = 0;

    // route による重み付け
    if (t.route === "CORE_K") score += 5;
    if (t.route === "INTEL_B") score += 4;
    if (t.route === "INFRA_A") score += 3;
    if (t.route === "SATELLITE_C") score += 2;
    if (t.route === "GENESIS_D") score += 1;

    // 沈黙モジュールは優先度アップ
    if (silentModules.includes(t.name)) score += 5;

    return { ...t, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // トリガー上限を意識して最大 20 件まで
  return scored.slice(0, 20);
}

// トリガー再編（自己再構築）
function reorganizeTriggers_v4(essentialTargets) {
  const triggers = ScriptApp.getProjectTriggers();

  // 1. 壊れたトリガー（存在しない関数）を削除
  triggers.forEach(t => {
    const handler = t.getHandlerFunction();
    if (typeof globalThis[handler] !== "function") {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 2. 再取得
  const refreshed = ScriptApp.getProjectTriggers();
  const existingHandlers = refreshed.map(t => t.getHandlerFunction());

  // 3. 必要な心拍を確保（1時間ごとの CLOCK トリガー）
  essentialTargets.forEach(t => {
    if (!existingHandlers.includes(t.name) && typeof globalThis[t.name] === "function") {
      ScriptApp.newTrigger(t.name)
        .timeBased()
        .everyHours(1)
        .create();
    }
  });

  // 4. 上限超過を防ぐ（20 を超えた分は古いものから削除）
  const finalTriggers = ScriptApp.getProjectTriggers();
  if (finalTriggers.length > 20) {
    finalTriggers
      .slice(20)
      .forEach(t => ScriptApp.deleteTrigger(t));
  }
}

// 蘇生
function reviveTrigger_v4(handlerName, reason) {
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === handlerName);

  if (!exists && typeof globalThis[handlerName] === "function") {
    ScriptApp.newTrigger(handlerName)
      .timeBased()
      .everyHours(1)
      .create();
  }
}

/* ============================================================
   MainChat ログ
   ============================================================ */
function logL0(msg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("mainchat");
  if (sheet) sheet.appendRow([new Date(), "System", msg, ""]);
}
