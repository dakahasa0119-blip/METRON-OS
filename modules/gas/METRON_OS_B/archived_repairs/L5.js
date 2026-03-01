/**
 * レイヤー5: 自己修復レイヤー (Evolution Optimized)
 * - 自己修復アクションの実行とタイムラインへの物理記録を完全統合
 */

/**
 * 自己修復サイクルのエントリポイント
 * watchMotherShip から呼び出す、または 5〜15分おきに単独トリガー
 */
function runSelfHealingCycle() {
  const ctx = DeepContextBuilderPlusPlus(); 
  const actions = AnomalyResponder(ctx);

  if (!actions || actions.length === 0) {
    Logger.log("SelfHealing: 異常は検知されませんでした。");
    return;
  }

  SelfRepairEngine(actions);
}

/**
 * AnomalyResponder: 文脈から「治療すべき異常」を抽出
 */
function AnomalyResponder(ctx) {
  const actions = [];

  // 1. 致命エラー検知
  if (ctx.runtimeState && ctx.runtimeState.lastError && ctx.runtimeState.lastError.fatal) {
    actions.push({
      type: "ROLLBACK",
      reason: "Fatal error: " + ctx.runtimeState.lastError.message,
      scope: "GLOBAL"
    });
  }

  // 2. 沈黙ゾーン（死にかけているモジュール）の検知
  if (ctx.anomalyProfile && ctx.anomalyProfile.silentZones) {
    ctx.anomalyProfile.silentZones.forEach(function(zone) {
      if (zone.expectedIntervalSeconds && zone.silenceSeconds &&
          zone.silenceSeconds > zone.expectedIntervalSeconds * 2) {
        actions.push({
          type: "REVIVE_TRIGGER",
          reason: "Trigger silence in " + zone.module,
          handler: zone.module
        });
      }
      if (zone.classifiedAs === "POSSIBLE_DEATH") {
        actions.push({
          type: "ROLLBACK",
          reason: "Possible death in " + zone.module,
          scope: "GLOBAL"
        });
      }
    });
  }

  // 3. 物理限界（実行時間）の監視
  if (ctx.runtimeState && typeof ctx.runtimeState.executionTime === "number") {
    if (ctx.runtimeState.executionTime > 324) { // 360秒の90%
      actions.push({
        type: "ROLLBACK",
        reason: "Execution time near physical limit",
        scope: "GLOBAL"
      });
    }
  }

  return actions;
}

/**
 * SelfRepairEngine: 修復アクションの実行（ロールバック優先）
 */
function SelfRepairEngine(actions) {
  // 1. ロールバック実行
  actions.filter(a => a.type === "ROLLBACK").forEach(AutoRollback);
  
  // 2. トリガー蘇生実行
  actions.filter(a => a.type === "REVIVE_TRIGGER").forEach(RedundancyManager_reviveTrigger);

  Logger.log("SelfRepairEngine: 修復プロセス完了 " + JSON.stringify(actions));
}

/**
 * AutoRollback: 物理復元とタイムラインへの証跡記録
 */
function AutoRollback(action) {
  const props = PropertiesService.getScriptProperties();
  const versionId = props.getProperty("METRON_LAST_VERSION");

  if (!versionId) {
    Logger.log("AutoRollback: 復元ポイントが不在です。");
    return;
  }

  // L4の物理復元実行
  RollbackManager_restoreVersion(versionId);

  // ★ タイムライン記録：歴史の不連続性を説明する
  if (typeof METRON_recordEvolution === 'function') {
    METRON_recordEvolution(
      "SELF_HEALING", 
      "AutoRollback", 
      "異常検知により自動復元を実行。Version: " + versionId + " へ緊急退避。", 
      "SelfRepairEngine", 
      "Reason: " + action.reason
    );
  }
}


/**
 * RedundancyManager: トリガー蘇生（物理サイクル同期版）
 */
function RedundancyManager_reviveTrigger(action) {
  const handler = action.handler;
  if (!handler) return;

  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === handler);
  if (exists) return;

  // --- 物理的なトリガー再生成（ここを修正） ---
  if (handler === "runHealingKernel") {
    // 免疫系は最優先：5分おきに蘇生
    ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  } else if (handler === "runEvolutionKernel") {
    // 進化系は15分おきに蘇生
    ScriptApp.newTrigger(handler).timeBased().everyMinutes(15).create();
  } else {
    // その他の汎用モジュールは1時間おき
    ScriptApp.newTrigger(handler).timeBased().everyHours(1).create();
  }
  // ------------------------------------------

  // ★ タイムライン記録
  if (typeof METRON_recordEvolution === 'function') {
    METRON_recordEvolution(
      "HEALED", 
      "RedundancyManager", 
      "停止したトリガー [" + handler + "] を物理サイクルに従い自動蘇生しました。", 
      "SelfRepairEngine", 
      "Reason: " + action.reason
    );
  }
}

/**
 * RollbackManager_restoreVersion (艦長のL4関数を使用した最終形)
 */
function RollbackManager_restoreVersion(versionId) {
  Logger.log("🚨 復元シークエンス開始: " + versionId);
  
  // 1. 艦長の L4 関数でバックアップを取得
  const backupFiles = METRON_loadBackup(versionId); 
  
  if (!backupFiles) {
    throw new Error("復元失敗：Firebaseにデータがありません。");
  }

  // 2. Apps Script API (PUT) で自分を物理的に書き換える
  const scriptId = ScriptApp.getScriptId();
  const url = "https://script.googleapis.com/v1/projects/" + scriptId + "/content";
  
  // バックアップの JSON オブジェクトを GAS API のファイル形式に変換
  const files = Object.keys(backupFiles).map(name => ({
    name: name.replace(".gs", ""),
    type: "SERVER_JS",
    source: backupFiles[name]
  }));

  const res = UrlFetchApp.fetch(url, {
    method: "put",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ files: files }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() === 200) {
    METRON_recordEvolution("RESTORED", "CORE", "完全性復旧完了", "IntegrityMonitor", "Ver: " + versionId);
  } else {
    throw new Error("物理書き換え失敗: " + res.getContentText());
  }
}