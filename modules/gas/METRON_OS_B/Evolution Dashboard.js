/**
 * Evolution Dashboard Generator
 * 母艦の進化状況を1画面にまとめるダッシュボードを自動生成する
 */

function generateEvolutionDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = "Evolution_Dashboard";
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  sheet.clear();
  sheet.setTabColor("#6fa8dc");

  // タイトル
  sheet.getRange("A1").setValue("🧬 yumeSystem Evolution Dashboard")
    .setFontSize(20).setFontWeight("bold").setBackground("#cfe2f3");

  // --- 1. Injection Slot 状況 ---
  const injSheet = ss.getSheetByName("Injection_Slot");
  let injCount = 0, staged = 0, evolved = 0, failed = 0;

  if (injSheet) {
    const data = injSheet.getDataRange().getValues().slice(1);
    injCount = data.length;
    data.forEach(r => {
      const status = (r[4] || "").toString();
      if (status.includes("STAGED")) staged++;
      if (status.includes("EVOLVED")) evolved++;
      if (status.includes("FAILED") || status.includes("QUARANTINED")) failed++;
    });
  }

  sheet.getRange("A3").setValue("Injection Slot 状況").setFontWeight("bold");
  sheet.getRange("A4").setValue("総エントリ数");
  sheet.getRange("B4").setValue(injCount);
  sheet.getRange("A5").setValue("STAGED（未受肉）");
  sheet.getRange("B5").setValue(staged);
  sheet.getRange("A6").setValue("EVOLVED（受肉済）");
  sheet.getRange("B6").setValue(evolved);
  sheet.getRange("A7").setValue("FAILED / QUARANTINED");
  sheet.getRange("B7").setValue(failed);

  // --- 2. 進化成功率 ---
  const prioSheet = ss.getSheetByName("Evolution_Priority");
  let success = 0, fail = 0;

  if (prioSheet) {
    const rows = prioSheet.getDataRange().getValues().slice(1);
    rows.forEach(r => {
      if (r[5] === "SUCCESS") success++;
      if (r[5] === "FAIL") fail++;
    });
  }

  const total = success + fail;
  const rate = total > 0 ? (success / total) : 0;

  sheet.getRange("D3").setValue("進化成功率").setFontWeight("bold");
  sheet.getRange("D4").setValue("成功");
  sheet.getRange("E4").setValue(success);
  sheet.getRange("D5").setValue("失敗");
  sheet.getRange("E5").setValue(fail);
  sheet.getRange("D6").setValue("成功率");
  sheet.getRange("E6").setValue((rate * 100).toFixed(1) + "%");

  // --- 3. 最新 Sandbox テスト結果 ---
  const props = PropertiesService.getScriptProperties();
  const lastName = props.getProperty("LAST_TEST_NAME") || "なし";
  const lastSuccess = props.getProperty("LAST_TEST_SUCCESS") || "N/A";
  const lastError = props.getProperty("LAST_TEST_ERROR") || "";

  sheet.getRange("A10").setValue("Sandbox テスト結果").setFontWeight("bold");
  sheet.getRange("A11").setValue("最新テスト名");
  sheet.getRange("B11").setValue(lastName);
  sheet.getRange("A12").setValue("成功");
  sheet.getRange("B12").setValue(lastSuccess);
  sheet.getRange("A13").setValue("エラー内容");
  sheet.getRange("B13").setValue(lastError);

  // --- 4. 母艦の健康状態 ---
  const errCount = Number(props.getProperty("HEALTH_ERROR_COUNT") || 0);
  const pending = Number(props.getProperty("HEALTH_PENDING_COUNT") || 0);

  sheet.getRange("D10").setValue("母艦の健康状態").setFontWeight("bold");
  sheet.getRange("D11").setValue("エラー数");
  sheet.getRange("E11").setValue(errCount);
  sheet.getRange("D12").setValue("未処理タスク");
  sheet.getRange("E12").setValue(pending);

  // --- 5. 最新進化イベント ---
  const timeline = ss.getSheetByName("Evolution_Timeline");
  let latest = "なし";

  if (timeline && timeline.getLastRow() > 1) {
    const lastRow = timeline.getLastRow();
    latest = timeline.getRange(lastRow, 4).getValue();
  }

  sheet.getRange("A16").setValue("最新進化イベント").setFontWeight("bold");
  sheet.getRange("A17").setValue(latest);

  // レイアウト調整
  sheet.autoResizeColumns(1, 6);

  return "Evolution Dashboard を更新しました。";
}