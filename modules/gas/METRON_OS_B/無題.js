function createMetronSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 母艦・村人・司書・観測者のシート名
  const sheets = [
    "Dispatcher",
    "METRON-A",
    "METRON-B",
    "METRON-C",
    "Villager",
    "Archivist",
    "Observer"
  ];

  // 既存シートを確認しつつ作成
  sheets.forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    sheet.clear(); // 初期化
  });

  // Dispatcher のカラム設定
  const dispatcher = ss.getSheetByName("Dispatcher");
  dispatcher.getRange(1, 1, 1, 5).setValues([[
    "from",
    "to",
    "type",
    "payload",
    "timestamp"
  ]]);

  // 母艦シートのカラム設定
  const mothershipColumns = [
    "received_from",
    "type",
    "payload",
    "timestamp",
    "response"
  ];

  ["METRON-A", "METRON-B", "METRON-C"].forEach(name => {
    const sheet = ss.getSheetByName(name);
    sheet.getRange(1, 1, 1, mothershipColumns.length).setValues([mothershipColumns]);
  });

  // 村人・司書・観測者のカラム設定
  const simpleColumns = [
    "event",
    "detail",
    "timestamp"
  ];

  ["Villager", "Archivist", "Observer"].forEach(name => {
    const sheet = ss.getSheetByName(name);
    sheet.getRange(1, 1, 1, simpleColumns.length).setValues([simpleColumns]);
  });

  SpreadsheetApp.getUi().alert("METRON 初期宇宙のシートが生成されました。");
}
