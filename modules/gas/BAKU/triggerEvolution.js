/**
 * 🔥 物理着火 (v3.4.1 Fix)
 * 行番号を正しく特定してステータス更新を行う修正版
 */
function triggerEvolution() {
  METRON_SWARM.shuffleRoles();
  const universe = BAKU.getUniverse_();
  const ss = SpreadsheetApp.openById(universe.registry);
  const sheet = ss.getSheetByName("BAKU_DNA_VAULT");
  const data = sheet.getDataRange().getValues();
  
  // 修正: findIndex で「何行目か」を探す
  // スコア（インデックス4）ではなくRANK（インデックス5）を見るように変更し、Sランクを探す
  const targetIndex = data.findIndex(row => row[5] && row[5].toString().includes("S:"));

  if (targetIndex === -1) return console.warn("🌙 Rank S が見つかりません。BAKU.fullScan() でDNAを解析してください。");

  const targetRow = data[targetIndex];
  const physicalRow = targetIndex + 1; // 実際の行番号

  console.log(`🧬 抽出 (Row ${physicalRow}): ${targetRow[1]}`);
  console.log(`🧠 システム地図(Map)と照合し、採用を審議中...`);

  let decision = METRON_EVO.thinkWithContext(targetRow[3], METRON_SWARM.ROLES.CREATOR);
  let result = METRON_EVO.incarnate(decision);

  if (result.discarded) {
      console.log("🛑 アーキテクトの判断により却下。");
      sheet.getRange(physicalRow, 6).setValue("X: DISCARDED");
      // スコアもリセットして再解析待ちにするか？ -> 今回は維持し、次回のスキャンで再評価させる
      return;
  }

  if (result.success) {
    console.log("✨ 安定した進化が物理宇宙へ定着しました。");
    // ここでエラーが出ないようになります
    sheet.getRange(physicalRow, 6).setValue("∞: INSTALLED");
    // DNA内容 (row[3]) は変更されないため、スコア（row[4]）は残す。
    console.log(`✅ DNAステータスを [∞: INSTALLED] に更新完了。`);
  } else {
    console.error("💀 進化失敗。ステータスは維持されます。");
    sheet.getRange(physicalRow, 6).setValue("FAIL: Re-evaluate");
  }
}