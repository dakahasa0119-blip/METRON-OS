/**
 * Gateway Evolution Receiver v1.0
 * 役割：MotherShip からの進化案を安全に取り込む
 */

function getPendingEvolutionMeta() {
  const props = PropertiesService.getScriptProperties();
  return {
    name: props.getProperty('PENDING_EVOLUTION_NAME'),
    desc: props.getProperty('PENDING_EVOLUTION_DESC'),
    code: props.getProperty('PENDING_EVOLUTION_CODE')
  };
}

function autoMergeApprovedPatch() {
  const props = PropertiesService.getScriptProperties();
  const name = props.getProperty('PENDING_EVOLUTION_NAME');
  const code = props.getProperty('PENDING_EVOLUTION_CODE');

  if (!name || !code) return;

  const safety = isEvolutionPatchSafe(code);
  if (!safety.safe) return;

  mergeIntoPatchSlots(name, code);
  props.deleteProperty('PENDING_EVOLUTION_NAME');
  props.deleteProperty('PENDING_EVOLUTION_CODE');
  props.deleteProperty('PENDING_EVOLUTION_DESC');
}

function mergeIntoPatchSlots(appName, newCode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PatchSlots") || ss.insertSheet("PatchSlots");

  sheet.appendRow([appName, newCode, new Date()]);
}

function isEvolutionPatchSafe(code) {
  try { new Function(code); return { safe: true }; }
  catch (e) { return { safe: false, reason: e.message }; }
}

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