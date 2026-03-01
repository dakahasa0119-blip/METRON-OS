/**
 * Layer5.5: Integrity Monitor（完全性監視エンジン）
 * -----------------------------------------------
 * 目的:
 *  - GAS プロジェクトの全コードを Content API から取得
 *  - Firebase バックアップ（L4）と比較
 *  - 欠損・破損・構文エラーを自動検知
 *  - 必要なら自動復旧（RollbackManager_restoreVersion）
 *
 * 前提:
 *  - FIREBASE_PROJECT_ID が ScriptProperties に設定済み
 *  - L4 の VersioningSystem_createVersion が正常に動作している
 *  - L4 の METRON_LAST_VERSION が最新バックアップを指している
 */


/**
 * エントリポイント（5分 or 15分トリガーで回す）
 */
function runIntegrityMonitor() {
  try {
    const scriptState = IM_fetchCurrentProjectState();
    const backupState = IM_fetchLatestBackup();

    if (!scriptState || !backupState) {
      Logger.log("IntegrityMonitor: 状態取得に失敗。スキップ。");
      return;
    }

    const diff = IM_compareStates(scriptState, backupState);

    if (diff.hasIssue) {
      Logger.log("❌ IntegrityMonitor: 異常検知 → 自動復旧開始");
      RollbackManager_restoreVersion(backupState.versionId);
      IM_logEvent("AUTO_RESTORE", diff.summary);
    } else {
      Logger.log("✅ IntegrityMonitor: 完全一致（正常）");
    }

  } catch (e) {
    Logger.log("❌ IntegrityMonitor Error: " + e.toString());
  }
}


/**
 * 現在の GAS プロジェクトの全ファイルを Content API から取得
 */
function IM_fetchCurrentProjectState() {
  try {
    const scriptId = ScriptApp.getScriptId();
    const url = "https://script.googleapis.com/v1/projects/" + scriptId + "/content";

    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

    const json = JSON.parse(res.getContentText());
    if (!json.files) throw new Error("Content API からファイル取得失敗");

    const state = {};
    json.files.forEach(f => {
      if (f.type === "SERVER_JS") {
        state[f.name + ".gs"] = f.source;
      }
    });

    return state;

  } catch (e) {
    Logger.log("❌ IM_fetchCurrentProjectState Error: " + e.toString());
    return null;
  }
}


/**
 * Firebase から最新バックアップを取得
 */
function IM_fetchLatestBackup() {
  try {
    const props = PropertiesService.getScriptProperties();
    const projectId = props.getProperty("FIREBASE_PROJECT_ID");
    const versionId = props.getProperty("METRON_LAST_VERSION");

    if (!projectId || !versionId) return null;

    const url =
      "https://firestore.googleapis.com/v1/projects/" +
      projectId +
      "/databases/(default)/documents/backups/" +
      versionId;

    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

    const body = JSON.parse(res.getContentText());
    if (!body.fields || !body.fields.files) return null;

    return {
      versionId: versionId,
      files: JSON.parse(body.fields.files.stringValue)
    };

  } catch (e) {
    Logger.log("❌ IM_fetchLatestBackup Error: " + e.toString());
    return null;
  }
}


/**
 * 現在のコードとバックアップを比較
 */
function IM_compareStates(current, backup) {
  const diff = {
    hasIssue: false,
    summary: []
  };

  // 1. ファイル欠損チェック
  Object.keys(backup.files).forEach(name => {
    if (!current[name]) {
      diff.hasIssue = true;
      diff.summary.push("欠損ファイル: " + name);
    }
  });

  // 2. 内容差分チェック
  Object.keys(backup.files).forEach(name => {
    if (current[name] && current[name] !== backup.files[name]) {
      diff.hasIssue = true;
      diff.summary.push("差分検知: " + name);
    }
  });

  // 3. 構文エラーチェック（簡易）
  Object.keys(current).forEach(name => {
    const code = current[name];
    if (!IM_isValidJavaScript(code)) {
      diff.hasIssue = true;
      diff.summary.push("構文エラー: " + name);
    }
  });

  return diff;
}


/**
 * 簡易構文チェック（eval を使わず安全に）
 */
function IM_isValidJavaScript(code) {
  try {
    new Function(code);
    return true;
  } catch (e) {
    return false;
  }
}


function IM_logEvent(stage, summary) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Evolution_Timeline");
  if (!sheet) return;

  const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  sheet.appendRow([timestamp, stage, summary.join("\n"), "System_Integrity"]);
}


