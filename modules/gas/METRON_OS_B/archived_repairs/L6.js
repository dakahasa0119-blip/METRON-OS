/**
 * Layer 6: Self-Update Engine (v6.4 Timeline-Integrated)
 * ------------------------------------------------------
 * - L3 由来パッチ適用（SelfUpdateEngine）
 * - L8 由来の統合（UnifiedEvolutionEngine）
 * - すべての進化を Evolution_Timeline に記録
 * - L4 バックアップ / L5.5 整合性 / Manifest 保護
 */


/* ============================================================
   Quota Monitor（API残弾チェック）
   ============================================================ */
function L6_checkQuotaIntegrity() {
  const props = PropertiesService.getScriptProperties();
  const dailyLimit = 100;
  const currentCount = parseInt(props.getProperty("METRON_API_COUNT") || "0");
  const lastReset = props.getProperty("METRON_API_RESET_DATE");
  const today = Utilities.formatDate(new Date(), "GMT+9", "yyyyMMdd");

  if (lastReset !== today) {
    props.setProperty("METRON_API_COUNT", "0");
    props.setProperty("METRON_API_RESET_DATE", today);
    METRON_recordEvolution("L6_QUOTA_RESET", "Quota", "Daily quota reset", "L6", "");
    return true;
  }

  if (currentCount > dailyLimit * 0.9) {
    announce("⚠️ API Quota 限界接近。自律進化を抑制します。", "System");
    METRON_recordEvolution("L6_QUOTA_LIMIT", "Quota", "Quota too low, evolution paused", "L6", "");
    return false;
  }

  return true;
}


/* ============================================================
   Self-Update Engine（L3 由来パッチ適用）
   ============================================================ */
function runSelfUpdateEngine() {
  Logger.log("Layer6: Self-Update Engine 起動");
  METRON_recordEvolution("L6_START", "SelfUpdateEngine", "Self-update cycle started", "L6", "");

  if (!L6_checkQuotaIntegrity()) return;

  const safePatches = runExternalAICycle();
  if (!safePatches || safePatches.length === 0) {
    METRON_recordEvolution("L6_NO_PATCH", "SelfUpdateEngine", "No patches from L3", "L6", "");
    return;
  }

  const versionId = VersioningSystem_createVersion();
  METRON_recordEvolution("L6_BACKUP", "Versioning", "Backup created", "L6", versionId);

  safePatches.forEach(p => {
    METRON_recordEvolution(
      "L6_PRE_UPDATE",
      p.targetModule,
      "Applying patch before updateContent",
      "SelfUpdateEngine",
      "Backup version: " + versionId
    );
  });

  const projectContent = L6_fetchProjectContent();
  if (!projectContent || !projectContent.files) {
    METRON_recordEvolution("L6_ABORT", "ContentAPI", "Failed to fetch project content", "L6", "");
    return;
  }

  const hasManifest = projectContent.files.some(f => f.name === "appsscript");
  if (!hasManifest) {
    METRON_recordEvolution("L6_ABORT", "Manifest", "Manifest missing", "L6", "");
    return;
  }

  const updatedFiles = L6_applyPatchesToFiles(projectContent.files, safePatches);
  const updateSuccess = L6_pushUpdatedContent(updatedFiles);

  if (updateSuccess) {
    const props = PropertiesService.getScriptProperties();
    const current = parseInt(props.getProperty("METRON_API_COUNT") || "0");
    props.setProperty("METRON_API_COUNT", (current + 1).toString());
  }

  safePatches.forEach(p => {
    METRON_recordEvolution(
      "L6_POST_UPDATE",
      p.targetModule,
      "Patch applied",
      "SelfUpdateEngine",
      updateSuccess ? "updateContent OK" : "updateContent FAILED"
    );
  });

  METRON_recordEvolution("L6_COMPLETE", "SelfUpdateEngine", "Self-update cycle complete", "L6", "");
}


/* ============================================================
   Content API: プロジェクト取得
   ============================================================ */
function L6_fetchProjectContent() {
  try {
    const scriptId = ScriptApp.getScriptId();
    const url = "https://script.googleapis.com/v1/projects/" + scriptId + "/content";

    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

    return JSON.parse(res.getContentText());

  } catch (e) {
    METRON_recordEvolution("L6_ERROR", "ContentAPI", e.toString(), "L6", "");
    return null;
  }
}


/* ============================================================
   パッチ適用（Manifest / HTML 保護）
   ============================================================ */
function L6_applyPatchesToFiles(existingFiles, safePatches) {

  const fileMap = {};
  existingFiles.forEach(f => {
    const key =
      f.type === "SERVER_JS" ? f.name + ".gs" :
      f.type === "HTML"      ? f.name + ".html" :
      f.name;
    fileMap[key] = f;
  });

  safePatches.forEach(p => {
    const targetName = p.targetModule.endsWith(".gs")
      ? p.targetModule
      : p.targetModule + ".gs";

    if (fileMap[targetName]) {
      let code = p.code || "";
      code = code.replace(/\\n/g, "\n");
      fileMap[targetName].source = code;

      METRON_recordEvolution("L6_FILE_UPDATE", targetName, "File updated", "L6", "");
    } else {
      existingFiles.push({
        name: p.targetModule.replace(".gs", ""),
        type: "SERVER_JS",
        source: (p.code || "").replace(/\\n/g, "\n")
      });

      METRON_recordEvolution("L6_FILE_CREATE", targetName, "New file created", "L6", "");
    }
  });

  return existingFiles;
}


/* ============================================================
   Content API: updateContent
   ============================================================ */
function L6_pushUpdatedContent(updatedFiles) {
  try {
    const scriptId = ScriptApp.getScriptId();
    const url = "https://script.googleapis.com/v1/projects/" + scriptId + "/content";

    const payload = JSON.stringify({ files: updatedFiles });

    const res = UrlFetchApp.fetch(url, {
      method: "put",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      payload: payload,
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    if (code >= 400) {
      METRON_recordEvolution("L6_UPDATE_FAIL", "ContentAPI", res.getContentText(), "L6", "");
      return false;
    }

    METRON_recordEvolution("L6_UPDATE_OK", "ContentAPI", "updateContent success", "L6", "");
    return true;

  } catch (e) {
    METRON_recordEvolution("L6_UPDATE_EXCEPTION", "ContentAPI", e.toString(), "L6", "");
    return false;
  }
}


/* ============================================================
   Unified Evolution Engine（L8 と連携して自律統合）
   ============================================================ */
function L6_runUnifiedEvolutionCycle() {
  L6_log("Unified Evolution Cycle 起動");
  METRON_recordEvolution("L6_UNIFY_START", "UnifiedEvolution", "Unified evolution cycle started", "L6", "");

  if (!L6_checkQuotaIntegrity()) {
    METRON_recordEvolution("L6_UNIFY_ABORT", "Quota", "Quota too low", "L6", "");
    return;
  }

  const kernel = L8_UnifiedKernel();
  const mergeCandidates = kernel.mergeCandidates || [];

  METRON_recordEvolution("L6_UNIFY_CANDIDATES", "UnifiedEvolution", `candidates=${mergeCandidates.length}`, "L6", "");

  if (mergeCandidates.length === 0) {
    METRON_recordEvolution("L6_UNIFY_NONE", "UnifiedEvolution", "No merge candidates", "L6", "");
    return;
  }

  const projectContent = L6_fetchProjectContent();
  if (!projectContent || !projectContent.files) {
    METRON_recordEvolution("L6_UNIFY_ABORT", "ContentAPI", "Failed to fetch project content", "L6", "");
    return;
  }

  const files = projectContent.files;
  const hasManifest = files.some(f => f.name === "appsscript");
  if (!hasManifest) {
    METRON_recordEvolution("L6_UNIFY_ABORT", "Manifest", "Manifest missing", "L6", "");
    return;
  }

  const updatedFiles = L6_applyUnifiedMerges(files, mergeCandidates);

  const ok = L6_pushUpdatedContent(updatedFiles);
  if (ok) {
    const props = PropertiesService.getScriptProperties();
    const current = parseInt(props.getProperty("METRON_API_COUNT") || "0");
    props.setProperty("METRON_API_COUNT", (current + 1).toString());

    METRON_recordEvolution("L6_UNIFY_COMPLETE", "UnifiedEvolution", "Unified evolution applied", "L6", "");
  } else {
    METRON_recordEvolution("L6_UNIFY_FAIL", "UnifiedEvolution", "updateContent failed", "L6", "");
  }
}


/* ============================================================
   統合実行（applyUnifiedMerges）
   ============================================================ */
function L6_applyUnifiedMerges(existingFiles, mergeCandidates) {
  const fileMap = {};
  existingFiles.forEach(f => {
    fileMap[f.name] = f;
  });

  mergeCandidates.forEach(group => {
    const members = group.members || [];
    if (members.length < 2) return;

    const primaryName = members[0].replace(/\.gs$/, "");
    const primary = fileMap[primaryName] || fileMap[primaryName.replace(".gs", "")];
    if (!primary) return;

    let primarySource = primary.source || "";

    for (let i = 1; i < members.length; i++) {
      const mName = members[i].replace(/\.gs$/, "");
      const mf = fileMap[mName];
      if (!mf) continue;

      const src = mf.source || "";
      primarySource +=
        "\n\n// ===== Unified Merge from " + mName + " =====\n" +
        src +
        "\n// ===== End of " + mName + " =====\n";

      METRON_recordEvolution(
        "L6_UNIFY_MERGE",
        primaryName,
        `Merged ${mName} into ${primaryName}`,
        "UnifiedEvolutionEngine",
        `group=${group.group}`
      );

      delete fileMap[mName];
    }

    primary.source = primarySource;
    fileMap[primaryName] = primary;
  });

  return Object.keys(fileMap).map(k => fileMap[k]);
}


/* ============================================================
   L6 用ログ（mainchat）
   ============================================================ */
function L6_log(msg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("mainchat");
  if (sheet) sheet.appendRow([new Date(), "System", `L6: ${msg}`, ""]);
}
