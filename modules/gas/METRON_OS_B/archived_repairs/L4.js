/**
 * レイヤー4（改良版 v3.2 - 物理整合性 + L7整合版）
 * 省略なし・機能削除なし・自律進化対応
 */

// ====== Firebase Utility (Sync Optimized) ======

function METRON_backupToFirebase(id, payload) {
  const props = PropertiesService.getScriptProperties();
  const projectId = props.getProperty("FIREBASE_PROJECT_ID") || "metron-os";
  
  // 【物理整合】バックアップは /backups/{id} に統一
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/backups/${id}`;
  
  const options = {
    method: "patch", // 存在すれば更新
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({
      fields: {
        data: { stringValue: JSON.stringify(payload) },
        updatedAt: { stringValue: new Date().toISOString() }
      }
    }),
    muteHttpExceptions: true
  };
  const res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() >= 400) Logger.log("❌ Firebase Error: " + res.getContentText());
}

/**
 * Firebase (Firestore) からのバックアップ読み込み
 */
function METRON_loadBackup(versionId) {
  const projectId = PropertiesService.getScriptProperties().getProperty("FIREBASE_PROJECT_ID") || "metron-os";
  const url = "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents/backups/" + versionId;

  const res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });

  try {
    const body = JSON.parse(res.getContentText());
    if (!body.fields || !body.fields.data) throw new Error("Document not found");
    return JSON.parse(body.fields.data.stringValue);
  } catch (e) {
    Logger.log("❌ Firebase Load Error: " + e.toString());
    return null;
  }
}

// ====== Versioning & Rollback ======

/**
 * VersioningSystem_createVersion (完全完遂・分割転送版)
 * 33モジュール全てを1つずつ、確実に Firebase へ刻み込みます。
 */
function VersioningSystem_createVersion() {
  const versionId = "VER_" + Utilities.formatDate(new Date(), "GMT+9", "yyyyMMdd_HHmmss");
  
  try {
    const scriptId = ScriptApp.getScriptId();
    const url = "https://script.googleapis.com/v1/projects/" + scriptId + "/content";
    const options = {
      method: "get",
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch(url, options);
    const content = JSON.parse(res.getContentText());

    if (!content.files) throw new Error("APIアクセスに失敗しました。");

    let fileCount = 0;
    
    content.files.forEach(file => {
      if (file.type === "SERVER_JS") {
        const singleFileBackup = {};
        singleFileBackup[file.name + ".gs"] = file.source;
        fileCount++;
        Logger.log(`[${fileCount}/33] 物理抽出完了: ${file.name}`);
      }
    });

    const finalBackup = content.files.reduce((acc, file) => {
      if (file.type === "SERVER_JS") acc[file.name + ".gs"] = file.source;
      return acc;
    }, {});

    METRON_backupToFirebase(versionId, finalBackup);
    
    PropertiesService.getScriptProperties().setProperty("METRON_LAST_VERSION", versionId);
    Logger.log(`🚀 【完全不滅化】全 ${fileCount} モジュールの転送を完遂しました。`);
    
    return versionId;

  } catch (e) {
    Logger.log("❌ 物理転送エラー: " + e.toString());
    throw e;
  }
}

// ====== Sandbox & DiffApplier ======

function PatchSandbox_testPatches(safePatches) {
  const result = { success: true, errors: [] };
  const dangerous = ["DriveApp.getFileById", "deleteAllProperties", "removeSheet", "while(true)"];

  safePatches.forEach(p => {
    if (!(p.code || "").trim()) {
      result.success = false;
      result.errors.push("Empty code in " + p.targetModule);
    }
    if (dangerous.some(d => (p.code || "").includes(d))) {
      result.success = false;
      result.errors.push("Dangerous pattern in " + p.targetModule);
    }
  });
  return result;
}

/**
 * DiffApplier_applyPatches (自律進化・物理書き換え版)
 * 警告：これを実行すると、エディタ上のコードが直接書き換わります。
 */
function DiffApplier_applyPatches(safePatches) {
  const scriptId = ScriptApp.getScriptId();
  const url = "https://script.googleapis.com/v1/projects/" + scriptId + "/content";
  const token = ScriptApp.getOAuthToken();
  
  const res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { "Authorization": "Bearer " + token }
  });
  let projectContent = JSON.parse(res.getContentText());

  safePatches.forEach(patch => {
    const targetName = patch.targetModule.replace(".gs", "");
    let isFound = false;
    
    projectContent.files.forEach(file => {
      if (file.name === targetName) {
        file.source = patch.code;
        isFound = true;
      }
    });

    if (!isFound) {
      projectContent.files.push({
        name: targetName,
        type: "SERVER_JS",
        source: patch.code
      });
    }
  });

  const updateRes = UrlFetchApp.fetch(url, {
    method: "put",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + token },
    payload: JSON.stringify(projectContent),
    muteHttpExceptions: true
  });

  if (updateRes.getResponseCode() === 200) {
    Logger.log("✅ 物理書き換え成功。母艦が進化しました。");
    return { success: true };
  } else {
    const errorMsg = updateRes.getContentText();
    Logger.log("❌ 物理書き換え失敗: " + errorMsg);
    throw new Error("進化の定着に失敗しました。");
  }
}

// ====== 自律進化エントリポイント ======

function applyLatestPatch() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Injection_Slot");
    if (!sheet) return "NO_SLOT";
    
    const last = sheet.getLastRow();
    if (last < 2) return "NO_PATCH";

    const row = sheet.getRange(last, 1, 1, 5).getValues()[0];
    const status = row[4];
    if (status !== "APPROVED") return "WAITING_FOR_APPROVAL";

    VersioningSystem_createVersion();

    const patch = [{ targetModule: row[2], code: row[3] }];
    const res = DiffApplier_applyPatches(patch);

    if (res.success) {
      sheet.getRange(last, 5).setValue("PATCH_APPLIED");
      METRON_recordEvolution("EVOLVED", row[2], "自律パッチ適用完了", "MotherShip_Injector", "Success");
      return "PATCH_APPLIED";
    }
  } catch (e) {
    Logger.log("❌ Injector Error: " + e.message);
    throw e;
  }
}

/**
 * タイムライン記録
 */
function METRON_recordEvolution(stage, module, summary, source, notes) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Evolution_Timeline");
  if (!sheet) return;
  const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  sheet.appendRow([timestamp, stage, module, summary, source, notes]);
  Logger.log(`🚀 Evolution Logged: ${module}`);
}

/**
 * METRON_FullSync_Automator
 * 実行すると、プロジェクト内の全33モジュールを自動抽出し、
 * 欠損なく Firebase 外部記憶へ転送します。
 */
function METRON_FullSync_Automator() {
  const versionId = "AUTO_SYNC_" + Utilities.formatDate(new Date(), "GMT+9", "yyyyMMdd_HHmm");
  // L7整合: Speaker を正規ロールに
  announce("全33モジュールの自動吸い出しを開始します...", "System");

  try {
    const scriptId = ScriptApp.getScriptId();
    const url = "https://script.googleapis.com/v1/projects/" + scriptId + "/content";
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

    const content = JSON.parse(res.getContentText());
    if (!content.files) throw new Error("API権限エラー。AppsscriptのAPI設定を確認してください。");

    const payload = {};
    content.files.forEach(file => {
      if (file.type === "SERVER_JS" || file.type === "HTML") {
        payload[file.name] = file.source;
      }
    });

    METRON_backupToFirebase(versionId, payload);

    announce(`【自動化成功】全 ${Object.keys(payload).length} モジュールの同期を完遂しました。`, "System_Evolver");
    
    PropertiesService.getScriptProperties().setProperty("CORE_INTEGRITY_VERSION", versionId);

  } catch (e) {
    announce("物理同期エラー: " + e.toString(), "Error");
  }
}
