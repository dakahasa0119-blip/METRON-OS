/**
 * 🧨 記憶消去: 甘い採点の過去を清算する
 */
function runHardReset() {
  const universe = BAKU.getUniverse_();
  if (!universe.registry) return console.error("Registry not found.");
  
  const ss = SpreadsheetApp.openById(universe.registry);
  const sheets = ["BAKU_DNA_VAULT", "BAKU_IDEA_VAULT"];

  sheets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
      console.log(`🗑️ ${name} を初期化しました。`);
    }
  });
  console.log("✨ 全メモリの浄化完了。");
}
