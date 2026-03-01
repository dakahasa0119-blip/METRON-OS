/**
 * Layer8: Unified Kernel Layer (Timeline-Integrated)
 * --------------------------------------------------
 * - 母艦全体の構造を俯瞰し、「何を動かすか」「何を統合するか」を判断
 * - L0 に心拍候補を渡す
 * - L6 に統合候補を渡す
 * - すべての判断を Evolution_Timeline に記録
 */

function L8_UnifiedKernel() {
  const ctx = DeepContextBuilderPlusPlus();

  const files = ctx.files || [];
  const functions = ctx.functions || [];

  const mergeCandidates = L8_detectMergeCandidates(files);
  const essentialTriggers = L8_selectEssentialTriggers(functions);

  // mainchat ログ
  L8_log(
    `起動: files=${files.length}, functions=${functions.length}, ` +
    `mergeCandidates=${mergeCandidates.length}, essentialTriggers=${essentialTriggers.length}`
  );

  // Evolution Timeline ログ
  METRON_recordEvolution(
    "L8_ANALYSIS",
    "UnifiedKernel",
    `files=${files.length}, functions=${functions.length}`,
    "L8",
    `mergeCandidates=${mergeCandidates.length}, essentialTriggers=${essentialTriggers.length}`
  );

  return {
    mergeCandidates,
    essentialTriggers
  };
}


/**
 * L0 向け API:
 * 「心拍候補となる関数」を返す
 */
function L8_getEssentialTriggerTargets() {
  const ctx = DeepContextBuilderPlusPlus();
  const functions = ctx.functions || [];

  const selected = L8_selectEssentialTriggers(functions);

  METRON_recordEvolution(
    "L8_TRIGGER_SELECT",
    "UnifiedKernel",
    `Selected ${selected.length} essential triggers`,
    "L8",
    ""
  );

  return selected;
}


/**
 * L6 向け API:
 * 「統合候補となるモジュール群」を返す
 */
function L8_getMergeCandidates() {
  const ctx = DeepContextBuilderPlusPlus();
  const files = ctx.files || [];

  const candidates = L8_detectMergeCandidates(files);

  METRON_recordEvolution(
    "L8_MERGE_CANDIDATES",
    "UnifiedKernel",
    `Detected ${candidates.length} merge groups`,
    "L8",
    ""
  );

  return candidates;
}


/* ============================================================
   統合候補の検出（冗長・類似モジュール）
   ============================================================ */
function L8_detectMergeCandidates(files) {
  const names = files.map(f => f.name);
  const groups = {};
  const candidates = [];

  names.forEach(name => {
    if (name === "appsscript") return;

    let key = null;
    if (name.startsWith("Core_")) key = "Core";
    else if (name.startsWith("App_")) key = "App";
    else if (name.startsWith("MotherShip_")) key = "MotherShip";
    else if (/^L[0-9]/.test(name)) key = "Layer";
    else if (name.startsWith("System")) key = "System";
    else if (name.startsWith("Watcher") || name.startsWith("SystemMonitor") || name.startsWith("Debugger")) key = "Guardian";

    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(name);
  });

  Object.keys(groups).forEach(key => {
    if (groups[key].length > 1) {
      candidates.push({
        group: key,
        members: groups[key]
      });

      // Timeline ログ
      METRON_recordEvolution(
        "L8_GROUP_DETECTED",
        key,
        `Merge group detected`,
        "L8",
        `members=${groups[key].join(", ")}`
      );
    }
  });

  return candidates;
}


/* ============================================================
   「心拍候補となる関数」を選別（L0 向け）
   ============================================================ */
function L8_selectEssentialTriggers(functions) {
  const scored = functions.map(fn => {
    let score = 0;
    const n = fn.name || "";
    const file = fn.file || "";

    if (/run/i.test(n)) score += 5;
    if (/kernel/i.test(n)) score += 5;
    if (/heartbeat/i.test(n)) score += 4;
    if (/watcher/i.test(n)) score += 3;
    if (/init/i.test(n)) score += 2;
    if (/main/i.test(n)) score += 2;

    if (/L0/i.test(file)) score += 4;
    if (/Core_/i.test(file)) score += 3;
    if (/MotherShip_/i.test(file)) score += 2;

    return {
      name: fn.name,
      file: file,
      route: fn.route || inferRouteFromFile_L8(file),
      score
    };
  });

  const filtered = scored.filter(f => f.score > 0);
  filtered.sort((a, b) => b.score - a.score);

  const MAX = 20;
  const selected = filtered.slice(0, MAX);

  // Timeline ログ
  METRON_recordEvolution(
    "L8_TRIGGER_SCORING",
    "UnifiedKernel",
    `Scored ${filtered.length} functions`,
    "L8",
    `selected=${selected.length}`
  );

  return selected;
}


/* ============================================================
   ファイル名から route を推定（L8 側の補助）
   ============================================================ */
function inferRouteFromFile_L8(fileName) {
  const s = (fileName || "").toLowerCase();
  if (s.includes("satellite") || s.includes("link")) return "SATELLITE_C";
  if (s.includes("spreadsheet") || s.includes("data") || s.includes("app_data")) return "INFRA_A";
  if (s.includes("evolution") || s.includes("ai") || s.includes("strategic")) return "INTEL_B";
  if (s.includes("core") || s.includes("kernel") || s.includes("bootloader")) return "CORE_K";
  return "GENESIS_D";
}


/* ============================================================
   L8 用ログ（mainchat）
   ============================================================ */
function L8_log(msg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("mainchat");
  if (sheet) sheet.appendRow([new Date(), "System", `L8: ${msg}`, ""]);
}
