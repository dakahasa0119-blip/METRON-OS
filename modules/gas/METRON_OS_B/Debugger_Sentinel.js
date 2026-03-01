/**
 * yumeSystem Singularity v30.5 "Eternal Evolution"
 * [Vessel 05/07] Debugger_Sentinel.gs : 守護者（自律修復 & 保存）
 * 役割：エラー監視、監査役（Auditor）による自律修復、自己進化前の自動スナップショット。
 * 統合完了：用語適正化、Forge_Master 連携、安全反映プロトコル。
 */

/**
 * [守護者の外套：Sentinel Wrapper]
 * 重要関数をこのラッパー経由で実行し、エラーを確実に捕捉して自動修復へ繋げます。
 */
function sentinelWrapper(fn, functionName) {
  try {
    return fn();
  } catch (e) {
    const errorMsg = e.message;
    const stack = e.stack;
    
    announce(`【致命的異常】${functionName} にてエラーを検知: ${errorMsg}`, "ERROR");
    
    // 監査役（Auditor）による自律修復を開始
    runAutonomousRepair(functionName, errorMsg, stack);
    
    // 処理を中断させないためにエラーを再スロー（必要に応じて上位でキャッチ）
    throw e; 
  }
}

/**
 * [自律修復：自動デバッグプロトコル]
 * エラーを解析させ、修正パッチを鍛冶場（Forge_Staging）へ送ります。
 */
function runAutonomousRepair(failedFnName, errorMsg, stack) {
  announce(`監査役（Auditor）を召喚。エラーの原因解析と修復パッチの生成を開始します...`, "STAT");

  const repairPrompt = `
あなたは母艦の監査役（Auditor）です。以下の関数でエラーが発生しました。
日本語で原因を簡潔に解説し、修正済みの完全な Google Apps Script コードを生成せよ。

【失敗した関数名】: ${failedFnName}
【エラー内容】: ${errorMsg}
【スタックトレース】: ${stack}
【ミッション】: 既存のロジックを維持しつつ、エラーを回避する完全なコードを作成せよ。解説は不要、コードのみ出力すること。
`;

  try {
    // Core_AI の知能を使用してパッチを生成
    const patchCode = AIEngineCore.generate(repairPrompt, 'Auditor');
    
    // Forge_Master.gs の stageGeneratedCode を呼び出し、実装待機状態にする
    if (typeof stageGeneratedCode === 'function') {
      const appName = `修復_${failedFnName}_${Utilities.formatDate(new Date(), "JST", "HHmm")}`;
      stageGeneratedCode(appName, patchCode, `${errorMsg} に対する自律修復パッチ`);
      
      saveToMainChat("システム", `【自律修復】関数 ${failedFnName} で異常を検知。監査役が修復パッチを鍛冶場に配備しました。サイドバーから確認・反映してください。`);
      announce(`自律修復パッチ「${appName}」を鍛冶場へ登録しました。`, "INFO");
    } else {
      announce("Forge_Master が未統合のため、パッチの保存に失敗しました。", "ERROR");
    }
    
  } catch (e) {
    announce(`自律修復プロセスに失敗しました: ${e.message}`, "ERROR");
  }
}

/**
 * [防衛策：自動スナップショット]
 * 重要な変更や進化の前に、復元ポイント（自動コピー）を作成します。
 */
function createAutoSnapshot() {
  announce("反映前の復元ポイント（自動コピー）を作成しています...", "SYSTEM");
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const file = DriveApp.getFileById(ss.getId());
    
    const timestamp = Utilities.formatDate(new Date(), "JST", "yyyyMMdd_HHmm");
    const snapshotName = `【復元用】${ss.getName()}_${timestamp}`;
    
    const copy = file.makeCopy(snapshotName);
    
    announce(`復元ポイントを作成しました: ${snapshotName}`, "INFO");
    return copy.getId();
  } catch (e) {
    announce(`スナップショットの作成に失敗しました: ${e.message}`, "ERROR");
    return null;
  }
}

/**
 * [自己復元プロトコル：ロールバック要求]
 */
function requestRollback() {
  announce("ロールバック（復元）要求を受理。ドライブ内の【復元用】ファイルを確認してください。", "WARNING");
  saveToMainChat("システム", "重大な不具合が疑われるため、ロールバック機能が呼び出されました。作成済みのスナップショットから手動での復元を推奨します。");
}