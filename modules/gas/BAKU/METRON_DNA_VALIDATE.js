/**
 * METRON_DNA_VALIDATE v8.0
 * - BAKU v8.0 の大量・多様なDNA抽出に対応
 * - name/code の厳格バリデーション
 * - JS識別子チェック
 * - code の最低品質チェック
 */
var METRON_DNA_VALIDATE = (function () {

  /** JS の識別子として有効かチェック */
  function isValidIdentifier(name) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
  }

  /** DNA の基本バリデーション */
  function isValidDNA(dna) {
    if (!dna) return false;

    // ID
    if (typeof dna.id !== "string" || dna.id.length === 0) return false;

    // name
    if (typeof dna.name !== "string" || dna.name.length === 0) return false;
    if (!isValidIdentifier(dna.name)) return false;

    // code
    if (typeof dna.code !== "string" || dna.code.length < 5) return false;

    // 最低限の構造チェック（{} または => を含む）
    const c = dna.code;
    if (!(c.includes("{") || c.includes("=>"))) return false;

    return true;
  }

  return {
    /**
     * DNA配列を検証し、有効なDNAのみ返す
     * @param {Array<Object>} dnaList
     * @returns {Array<Object>} validDNA
     */
    validate: function (dnaList) {
      if (!Array.isArray(dnaList)) {
        console.warn("⚠️ METRON_DNA_VALIDATE: dnaList が配列ではない", dnaList);
        return [];
      }

      const valid = [];
      let invalidCount = 0;

      dnaList.forEach(dna => {
        if (isValidDNA(dna)) {
          valid.push(dna);
        } else {
          invalidCount++;
          console.warn("⚠️ 無効なDNAをスキップ:", dna);
        }
      });

      console.log(`🧪 DNA_VALIDATE v8.0: 有効=${valid.length}, 無効=${invalidCount}`);
      return valid;
    }
  };

})();