/**
 * yumeSystem Singularity - THE_CORE v4.1 "Survival Instinct"
 * [完全自律] 自律監視・自己受肉・物理層支配（防衛回路統合版）
 */

// --- 1. 物理層支配エンジン（全モジュール共通） ---
function rewritePhysicalFile(filename, newContent) {
  // ★防衛：書き込み前に「洗浄」と「構文検証」を強制
  const purified = extractPureCode(newContent);
  if (!_runSandboxValidation(purified).success) {
    console.error(`[拒絶] ${filename} への書き込みを中止：構文エラーを検知しました。`);
    return false;
  }

  const scriptId = ScriptApp.getScriptId();
  const token = ScriptApp.getOAuthToken();
  const baseUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;
  
  const res = UrlFetchApp.fetch(baseUrl, { headers: { Authorization: "Bearer " + token } });
  let project = JSON.parse(res.getContentText());

  let modified = false;
  project.files = project.files.map(file => {
    if (file.name === filename) {
      file.source = purified; // 洗浄済みコードを書き込み
      modified = true;
    }
    return file;
  });

  if (!modified) {
    project.files.push({ name: filename, type: "SERVER_JS", source: purified });
  }

  UrlFetchApp.fetch(baseUrl, {
    method: "put", contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ files: project.files })
  });
  return true;
}

// --- 2. 即時受肉エンジン ---
function processIncomingSignal(slotRowIndex) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const slotSheet = ss.getSheetByName("Injection_Slot");
  const row = slotSheet.getRange(slotRowIndex, 1, 1, 4).getValues()[0];
  const filename = row[2];
  const rawCode = row[3];

  try {
    // 物理受肉を先行（検証は rewritePhysicalFile 内で行われる）
    const success = rewritePhysicalFile(filename, rawCode);

    if (success) {
      // 成功時のみメモリ上（eval）でも更新
      eval(extractPureCode(rawCode));
      slotSheet.getRange(slotRowIndex, 5).setValue("EVOLVED: 完全受肉完了");
      if (typeof announce === 'function') announce(`自律進化：${filename} を物理的に統合しました。`, "SUCCESS");
    } else {
      slotSheet.getRange(slotRowIndex, 5).setValue("QUARANTINED: 構文不正により拒絶");
    }
  } catch (e) {
    slotSheet.getRange(slotRowIndex, 5).setValue("ERROR: " + e.message);
  }
}

// --- 3. 自律監視・補助関数（生存に必要な最小セット） ---

function extractPureCode(text) {
  if (!text) return "";
  const match = text.match(/```(?:javascript|js)?([\s\S]*?)```/);
  let code = match ? match[1] : text;
  const idx = code.search(/(function|const|let|var|class|import|\/\*|\/\/)/);
  if (idx > 0) code = code.substring(idx);
  return code.trim();
}

function _runSandboxValidation(code) {
  try {
    new Function(code);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// function runAutonomousCycle() {
//   const triggers = ScriptApp.getProjectTriggers();
//   if (!triggers.some(t => t.getHandlerFunction() === "runAutonomousCycle")) {
//     ScriptApp.newTrigger("runAutonomousCycle").timeBased().everyMinutes(5).create();
//   }
// }