/**
 * METRON_DNA_INSTALL (v8.0対応版)
 * - BAKU v8.0 の大量DNA抽出に対応
 * - name/code のバリデーション強化
 * - 重複チェック強化
 * - sourceName が無い場合の補完
 * - BAKU.knownFunctions の登録順序を安定化
 */
function METRON_DNA_INSTALL(dnaList) {
  const ss = SpreadsheetApp.openById(METRON_PROPS.REGISTRY_ID);
  let sheet = ss.getSheetByName("BAKU_DNA_VAULT");

  // シートが無ければ作成
  if (!sheet) {
    sheet = ss.insertSheet("BAKU_DNA_VAULT");
    sheet.appendRow(["ID", "Name", "Source", "DNA", "Timestamp", "Status"]);
  }

  // 既存DNA名をセット化
  const existing = new Set();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const name = data[i][1];
    if (name) existing.add(name);
  }

  let count = 0;

  // dnaList が単体なら配列化
  if (!Array.isArray(dnaList)) {
    dnaList = dnaList ? [dnaList] : [];
  }

  /** ------------------------------
   * ① dnaList の DNA を登録
   * ------------------------------ */
  dnaList.forEach(dna => {
    if (!dna || !dna.name || !dna.code) {
      console.warn("⚠️ DNA_INSTALL skipped: invalid dna", dna);
      return;
    }

    if (existing.has(dna.name)) return;

    sheet.appendRow([
      dna.id || Utilities.getUuid(),
      dna.name,
      dna.source || "AUTO_IMPORTED",
      dna.code,
      new Date().toISOString(),
      "∞: INSTALLED"
    ]);

    existing.add(dna.name);
    count++;
  });

  /** ------------------------------
   * ② BAKU.knownFunctions の DNA を登録
   * ------------------------------ */
  if (typeof BAKU !== "undefined" && BAKU && BAKU.knownFunctions) {

    // Map → 安定した順序で登録（名前順）
    const sortedNames = [...BAKU.knownFunctions.keys()].sort();

    sortedNames.forEach(name => {
      const code = BAKU.knownFunctions.get(name);

      // name/code のバリデーション
      if (!name || typeof name !== "string") return;
      if (!code || typeof code !== "string") return;

      // 重複スキップ
      if (existing.has(name)) return;

      sheet.appendRow([
        Utilities.getUuid(),
        name,
        "AUTO_IMPORTED",
        code,
        new Date().toISOString(),
        "∞: INSTALLED"
      ]);

      existing.add(name);
      count++;
    });
  }

  console.log(`🟩 DNA_INSTALL 完了: ${count} 個のDNAをVaultに追加`);
}