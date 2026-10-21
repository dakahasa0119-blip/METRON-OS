function doPost(e) {
  // 信号を受け取ってシートに appendRow する中身
  // これが今の「最新の保存状態」に含まれていないと、即時記入はされません。
}

/**
 * [入口] ゲートウェイからの信号をシートに刻印する窓口
 */
function transferAndTest(filename, code) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const timestamp = new Date();
  
  try {
    const slotSheet = ss.getSheetByName("Injection_Slot") || ss.insertSheet("Injection_Slot");
    
    // Statusを PENDING にして「後で実行してね」と置いておく
    slotSheet.appendRow([timestamp, "GATEWAY", filename, code, "PENDING"]);
    
    // 記録用
    if (typeof stageGeneratedCode === 'function') {
      stageGeneratedCode(filename, code, "Gateway経由の非同期受肉待ち");
    }

    return `✅ [${filename}] 信号を装填。1分以内に自律受肉します。`;
  } catch (e) {
    return "❌ 受信失敗: " + e.message;
  }
}

/**
 * [出口] 1分おきに動き、PENDINGを DONE に変える作業場
 */
function processPendingInjectionsV305() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const slotSheet = ss.getSheetByName("Injection_Slot");
  if (!slotSheet || slotSheet.getLastRow() < 2) return;

  const data = slotSheet.getDataRange().getValues();
  const statuses = data.map(row => [row[4]]);
  let changed = false;
  
  for (let i = 1; i < data.length; i++) {
    // PENDING または 以前の APIエラー(ERROR) が出ている行を再処理
    if (data[i][4] === "PENDING" || data[i][4].toString().startsWith("ERROR")) { 
      const fileName = data[i][2]; 
      const code = data[i][3];     
      
      try {
        // 母艦自身の内部権限で実行（API不要）
        const result = eval(code);
        
        // 永続化
        PropertiesService.getScriptProperties().setProperty("ACTIVE_RESTORE_CODE", code);
        
        // 成功を刻印
        statuses[i][0] = "DONE: 内部受肉成功 (API回避)";
        changed = true;
        if (typeof announce === 'function') announce(`[${fileName}] 内部受肉に成功。`, "SUCCESS");

      } catch (err) {
        statuses[i][0] = "EXEC_ERROR: " + err.message;
        changed = true;
      }
    }
  }

  if (changed) {
    slotSheet.getRange(1, 5, statuses.length, 1).setValues(statuses);
  }
}

/**
 * [排出プロトコル] 鍛冶場の改善案をGoogleドライブのフォルダへ一括排出
 */
function exportForgeToFolder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const forgeSheet = ss.getSheetByName("Forge_Staging");
  if (!forgeSheet) return "シート不在";

  const folderName = "yumeSystem_Export_" + Utilities.formatDate(new Date(), "JST", "yyyyMMdd");
  const folder = DriveApp.getFoldersByName(folderName).hasNext() ? 
                 DriveApp.getFoldersByName(folderName).next() : DriveApp.createFolder(folderName);

  const data = forgeSheet.getDataRange().getValues();
  const statuses = data.map(row => [row[4]]);
  let count = 0;
  let changed = false;

  for (let i = 1; i < data.length; i++) {
    if (data[i][4] === "STAGED") {
      folder.createFile(`${data[i][1]}.gs`, data[i][3]);
      statuses[i][0] = "EXPORTED";
      changed = true;
      count++;
    }
  }

  if (changed) {
    forgeSheet.getRange(1, 5, statuses.length, 1).setValues(statuses);
  }

  return `✅ ${count}件排出完了: ${folderName}`;
}