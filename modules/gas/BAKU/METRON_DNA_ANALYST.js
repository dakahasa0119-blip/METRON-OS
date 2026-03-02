/**
 * METRON_DNA_ANALYST v8.0
 * - コメントブロックDNA（A）を最優先
 * - function / class / アロー関数 / オブジェクトメソッド / クラス内メソッド を抽出
 * - BAKU v8.0 の抽出能力と完全同期
 */

var METRON_DNA_ANALYST = (function () {

  /** コメントブロックDNA抽出 */
  function extractBlockDNA(source, sourceLabel, dnaList) {
    const blockRegex =
      /\/\*\s*DNA:\s*name=([^\n*]+)[\s\S]*?\*\/\s*([\s\S]*?)(?=\/\*\s*DNA:|$)/g;

    let m;
    while ((m = blockRegex.exec(source)) !== null) {
      const name = m[1].trim();
      const code = m[2].trim();
      if (!name || !code) continue;

      dnaList.push({
        id: Utilities.getUuid(),
        name,
        source: sourceLabel || "BLOCK",
        code
      });
    }
  }

  /** function / class / アロー関数 / メソッド抽出 */
  function extractAutoDNA(source, sourceLabel, dnaList) {
    const existing = new Set(dnaList.map(d => d.name));

    const register = (name, code) => {
      if (!name || !code) return;
      if (existing.has(name)) return;
      existing.add(name);

      dnaList.push({
        id: Utilities.getUuid(),
        name,
        source: sourceLabel || "AUTO",
        code
      });
    };

    /** 1. function foo() { ... } */
    const funcRegex =
      /function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{[\s\S]*?\}/g;
    let m1;
    while ((m1 = funcRegex.exec(source)) !== null) {
      register(m1[1], m1[0]);
    }

    /** 2. class Foo { ... } */
    const classRegex =
      /class\s+([A-Za-z0-9_]+)\s*\{[\s\S]*?\}/g;
    let m2;
    while ((m2 = classRegex.exec(source)) !== null) {
      register(m2[1], m2[0]);
    }

    /** 3. const foo = (...) => { ... } */
    const arrowBlock =
      /(const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}/g;
    let m3;
    while ((m3 = arrowBlock.exec(source)) !== null) {
      register(m3[2], m3[0]);
    }

    /** 4. const foo = x => { ... } */
    const arrowBlock2 =
      /(const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*[A-Za-z0-9_]+\s*=>\s*\{[\s\S]*?\}/g;
    let m4;
    while ((m4 = arrowBlock2.exec(source)) !== null) {
      register(m4[2], m4[0]);
    }

    /** 5. const foo = (...) => expr; */
    const arrowOneLine =
      /(const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*\([^)]*\)\s*=>\s*([^;]+);/g;
    let m5;
    while ((m5 = arrowOneLine.exec(source)) !== null) {
      register(m5[2], m5[0]);
    }

    /** 6. const foo = x => expr; */
    const arrowOneLine2 =
      /(const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*[A-Za-z0-9_]+\s*=>\s*([^;]+);/g;
    let m6;
    while ((m6 = arrowOneLine2.exec(source)) !== null) {
      register(m6[2], m6[0]);
    }

    /** 7. const obj = { foo() { ... }, bar(x) { ... } } */
    const objectRegex =
      /(const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*\{([\s\S]*?)\};/g;
    let m7;
    while ((m7 = objectRegex.exec(source)) !== null) {
      const body = m7[3];
      const methodRegex =
        /([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{[\s\S]*?\}/g;
      let mm;
      while ((mm = methodRegex.exec(body)) !== null) {
        register(mm[1], mm[0]);
      }
    }

    /** 8. class Foo { bar() { ... } } のメソッド */
    const classBodyRegex =
      /class\s+[A-Za-z0-9_]+\s*\{([\s\S]*?)\}/g;
    let m8;
    while ((m8 = classBodyRegex.exec(source)) !== null) {
      const body = m8[1];
      const methodRegex =
        /([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{[\s\S]*?\}/g;
      let mm;
      while ((mm = methodRegex.exec(body)) !== null) {
        register(mm[1], mm[0]);
      }
    }
  }

  return {
    /**
     * ソース文字列からDNA配列を抽出する
     */
    extract: function (source, sourceLabel) {
      if (!source || typeof source !== "string") {
        console.warn("⚠️ METRON_DNA_ANALYST: 無効なソース");
        return [];
      }

      const dnaList = [];

      // A. コメントブロックDNA
      extractBlockDNA(source, sourceLabel, dnaList);

      // B. 自動抽出DNA（v8.0）
      extractAutoDNA(source, sourceLabel, dnaList);

      console.log(`🧬 DNA_ANALYST v8.0: 抽出完了 → ${dnaList.length} 個`);
      return dnaList;
    }
  };

})();