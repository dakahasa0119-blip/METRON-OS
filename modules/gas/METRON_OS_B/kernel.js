
/**
 * 初期セットアップ:
 * - MetronOS のトリガーを張る
 *   - 進化サイクル: runEvolutionKernel
 *   - 自己修復サイクル: runHealingKernel
 */
/**
 * initializeMetronOS (統合・最終安定版)
 */
function initializeMetronOS() {
  const triggers = ScriptApp.getProjectTriggers();
  const managedHandlers = ["runEvolutionKernel", "runHealingKernel", "METRON_FullSync_Automator"];

  // 1. 古いトリガーを掃除
  triggers.forEach(t => {
    if (managedHandlers.includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });

  // 2. 免疫サイクル (5分ごと)
  ScriptApp.newTrigger("runHealingKernel").timeBased().everyMinutes(5).create();

  // 3. 進化サイクル (15分ごとに実行)
  ScriptApp.newTrigger("runEvolutionKernel").timeBased().everyMinutes(15).create();

  announce("🚀 MetronOS 自律駆動モード点火。5分(免疫) / 15分(進化) サイクルを開始しました。", "SYSTEM");
}

/**
 * runHealingKernel: 母艦の免疫系（L6対応・完全統合版）
 */
function runHealingKernel() {
  Logger.log("🛡️ HealingKernel: 免疫スキャン開始...");

  // ① 比較と復旧 (L5.5: Integrity Monitor)
  if (typeof runIntegrityMonitor === 'function') {
    runIntegrityMonitor();
  }

  // ② L6 の後遺症チェック（Manifest / HTML / JSON の存在確認）
  if (typeof L6_postUpdateIntegrityCheck === 'function') {
    L6_postUpdateIntegrityCheck();
  }

  // ③ 正常性の同期 (L4: Backup)
  if (typeof METRON_FullSync_Automator === 'function') {
    METRON_FullSync_Automator();
  }

  // ④ 追加の自己修復ロジックがあれば実行
  if (typeof runSelfHealingCycle === 'function') {
    runSelfHealingCycle();
  }

  Logger.log("✅ HealingKernel: 免疫処理を正常に完了");
}



/**
 * L6_postUpdateIntegrityCheck:
 * - L6 の updateContent 後に、物理ファイルが欠損していないか確認
 * - Manifest / HTML / JSON が消えていたら即座に復旧
 */
function L6_postUpdateIntegrityCheck() {
  Logger.log("🔍 L6_postUpdateIntegrityCheck: L6後の整合性チェック開始");

  const projectContent = L6_fetchProjectContent();
  if (!projectContent || !projectContent.files) {
    Logger.log("❌ L6_postUpdateIntegrityCheck: Content API 取得失敗");
    return;
  }

  const names = projectContent.files.map(f => f.name);

  // Manifest が消えていたら即死級 → 即ロールバック
  if (!names.includes("appsscript")) {
    Logger.log("❌ Manifest(appsscript.json) が消失。即ロールバックします。");
    if (typeof runIntegrityMonitor === 'function') {
      runIntegrityMonitor();
    }
    return;
  }

  // HTML が全消失していたら異常
  const htmlCount = projectContent.files.filter(f => f.type === "HTML").length;
  if (htmlCount === 0) {
    Logger.log("⚠️ HTML ファイルが存在しません。異常の可能性あり。");
  }

  Logger.log("✅ L6_postUpdateIntegrityCheck: 整合性OK");
}





/**
 * Evolution Kernel:
 * L1 → L2 → L3 → L4 をつなぐ「進化サイクル」の中枢
 *
 * ポリシー:
 *  - 1回の実行で「1ステップだけ」進化するイメージ
 *  - ここでは L3（外部AI連携）と L4（パッチ適用）を呼ぶ
 */
function runEvolutionKernel() {
  Logger.log("EvolutionKernel: start");

  // L3: 外部AI連携（safePatches を取得）
  const safePatches = runExternalAICycle();

  if (!safePatches || safePatches.length === 0) {
    Logger.log("EvolutionKernel: no patches returned.");
    return;
  }

  // L4: パッチ適用（バックアップ＋サンドボックス＋適用＋ロールバック）
  runPatchApplicationCycle();

  Logger.log("EvolutionKernel: end");
}


/**
 * Healing Kernel:
 * L1 → L5 をつなぐ「自己修復サイクル」の中枢
 *
 * ポリシー:
 *  - 進化サイクルとは別トリガーで動かす（時間軸の直交化）
 *  - 進化中に自己修復が走っても「致命的な競合」を起こさないよう、
 *    L5 側は「直近の正常バージョン」へのロールバックに限定
 */
function runHealingKernel() {
  Logger.log("HealingKernel: start");

  // L5: 自己修復サイクル
  runSelfHealingCycle();

  Logger.log("HealingKernel: end");
}


/**
 * システムステータス確認用:
 * - ctx のサマリと、最後のバージョンIDをログに出す
 * - 手動で状況を確認したいときに使う
 */
function printMetronStatus() {
  const ctx = DeepContextBuilderPlusPlus();
  const props = PropertiesService.getScriptProperties();
  const lastVersion = props.getProperty("METRON_LAST_VERSION");

  Logger.log("=== MetronOS Status ===");
  Logger.log("Meta: " + JSON.stringify(ctx.meta || {}, null, 2));
  Logger.log("PhysicalConstraints: " + JSON.stringify(ctx.physicalConstraints || {}, null, 2));
  Logger.log("AnomalySummary: " + JSON.stringify((ctx.anomalyProfile && ctx.anomalyProfile.summary) || {}, null, 2));
  Logger.log("LastVersion: " + lastVersion);
}


/**
 * 認証と接続を物理的に強制するテスト
 */
function finalIgnitionTest() {
  const testId = "HANDSHAKE_" + new Date().getTime();
  const testPayload = { "Status": "Handshake successful" };
  
  try {
    Logger.log("Firebase への最終ハンドシェイクを開始...");
    METRON_backupToFirebase(testId, testPayload);
    Logger.log("✅ 成功！Firestore 画面を確認してください。");
  } catch (e) {
    Logger.log("❌ 失敗: " + e.message);
    Logger.log("原因の可能性: appsscript.json に 'datastore' スコープが不足している可能性があります。");
  }
}