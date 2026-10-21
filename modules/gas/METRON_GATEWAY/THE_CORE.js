/** 
 * Gateway THE_CORE v1.0
 * 役割：MotherShip と同じ物理受肉エンジンを Gateway に搭載
 */

function rewritePhysicalFile(filename, newContent) {
  const purified = extractPureCode(newContent);
  try { new Function(purified); } catch (e) { return false; }

  const scriptId = ScriptApp.getScriptId();
  const token = ScriptApp.getOAuthToken();
  const baseUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

  const res = UrlFetchApp.fetch(baseUrl, { headers: { Authorization: "Bearer " + token } });
  let project = JSON.parse(res.getContentText());

  let modified = false;
  project.files = project.files.map(file => {
    if (file.name === filename) {
      file.source = purified;
      modified = true;
    }
    return file;
  });

  if (!modified) {
    project.files.push({ name: filename, type: "SERVER_JS", source: purified });
  }

  UrlFetchApp.fetch(baseUrl, {
    method: "put",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ files: project.files })
  });

  return true;
}

function processIncomingSignal(rowIndex) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Injection_Slot");
  const row = sheet.getRange(rowIndex, 1, 1, 5).getValues()[0];

  const filename = row[2];
  const rawCode = row[3];

  const success = rewritePhysicalFile(filename, rawCode);
  if (success) {
    sheet.getRange(rowIndex, 5).setValue("EVOLVED (GW)");
  } else {
    sheet.getRange(rowIndex, 5).setValue("FAILED (GW)");
  }
}

function scanAndProcessInjectionSlot() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Injection_Slot");
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  for (let i = 2; i <= lastRow; i++) {
    const status = sheet.getRange(i, 5).getValue();
    if (status === "STAGED" || status === "PRE_VALIDATED: READY FOR APPROVAL") {
      processIncomingSignal(i);
    }
  }
}

function extractPureCode(text) {
  const match = text.match(/```(?:javascript|js)?([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}