/**
 * 🧪 DNA_ANALYST v8.0
 * - BAKU v8.0 の多様なDNA形式に完全対応
 * - アロー関数 / オブジェクトメソッド / クラス内メソッドも評価
 * - 危険コード検出強化
 * - 重複検知強化
 * - 依存関係スコア精度向上
 * - S/A/B/C/X ランク付け
 */

var DNA_ANALYST = DNA_ANALYST || {

  /** ============================
   *  メイン評価関数
   * ============================ */
  evaluate: function(code) {
    if (!code || typeof code !== "string") {
      return { rank: "X", reason: "コードが空" };
    }

    const reasons = [];

    // 1. DNA としての構造があるか（v8.0対応）
    if (!this.isRecognizedStructure_(code)) {
      return { rank: "X", reason: "DNA構造ではない" };
    }

    // 2. 危険コード検出（強化版）
    if (this.containsDangerousPatterns_(code)) {
      return { rank: "X", reason: "危険なコードパターン" };
    }

    // 3. 重複検知（v8.0: アロー関数にも対応）
    if (this.isDuplicate_(code)) {
      return { rank: "C", reason: "既存DNAと重複" };
    }

    // 4. 依存関係スコア（精度向上）
    const depScore = this.estimateDependencyScore_(code);
    if (depScore < 0.3) reasons.push("依存関係が不明瞭");

    // 5. コード品質（長さ・構造・複雑度）
    const quality = this.estimateQuality_(code);
    if (quality < 0.3) reasons.push("品質が低い");

    // 6. 総合スコア
    const score = (depScore + quality) / 2;

    let rank = "B";
    if (score > 0.85) rank = "S";
    else if (score > 0.65) rank = "A";
    else if (score > 0.45) rank = "B";
    else rank = "C";

    return {
      rank,
      score,
      reason: reasons.join(", ") || "OK"
    };
  },

  /** ============================
   *  DNA構造判定（v8.0）
   * ============================ */
  isRecognizedStructure_: function(code) {
    return (
      /function\s+[A-Za-z0-9_]+\s*\(/.test(code) ||          // function foo()
      /class\s+[A-Za-z0-9_]+/.test(code) ||                 // class Foo
      /(const|let|var)\s+[A-Za-z0-9_]+\s*=\s*\(/.test(code) || // const foo = (...)
      /(const|let|var)\s+[A-Za-z0-9_]+\s*=\s*[A-Za-z0-9_]+\s*=>/.test(code) || // const foo = x =>
      /[A-Za-z0-9_]+\s*\([^)]*\)\s*\{[\s\S]*?\}/.test(code) // メソッド形式 foo() { ... }
    );
  },

  /** ============================
   *  危険コード検出（v8.0強化）
   * ============================ */
  containsDangerousPatterns_: function(code) {
    const blacklist = [
      "UrlFetchApp\\.fetch\\(",
      "DriveApp\\.",
      "SpreadsheetApp\\.openByUrl",
      "ScriptApp\\.deleteTrigger",
      "eval\\(",
      "new Function",
      "Jdbc\\.",                 // DB操作
      "PropertiesService\\.getUserProperties", // 個人情報
      "HtmlService\\.createHtmlOutput"         // XSSリスク
    ];
    return blacklist.some(p => new RegExp(p).test(code));
  },

  /** ============================
   *  重複検知（v8.0）
   * ============================ */
  isDuplicate_: function(code) {
    // function/class 名
    let match = code.match(/(?:function|class)\s+([A-Za-z0-9_]+)/);
    if (!match) {
      // アロー関数名
      match = code.match(/(const|let|var)\s+([A-Za-z0-9_]+)\s*=/);
      if (!match) return false;
      return BAKU.knownFunctions && BAKU.knownFunctions.has(match[2]);
    }
    return BAKU.knownFunctions && BAKU.knownFunctions.has(match[1]);
  },

  /** ============================
   *  依存関係スコア（v8.0強化）
   * ============================ */
  estimateDependencyScore_: function(code) {
    const calls = code.match(/[A-Za-z0-9_]+\s*\(/g) || [];
    const unique = new Set(calls.map(c => c.replace("(", "")));

    if (unique.size === 0) return 0.6;   // 単独関数
    if (unique.size > 20) return 0.2;    // 依存多すぎ
    if (unique.size > 10) return 0.4;
    return 0.8;
  },

  /** ============================
   *  コード品質スコア（v8.0）
   * ============================ */
  estimateQuality_: function(code) {
    const length = code.length;

    // 長さ
    let score = 0;
    if (length < 40) score = 0.2;
    else if (length < 200) score = 0.6;
    else if (length < 2000) score = 0.9;
    else score = 0.7;

    // 構造の複雑度
    const braceCount = (code.match(/\{/g) || []).length;
    if (braceCount > 20) score -= 0.2;

    return Math.max(0.1, Math.min(1.0, score));
  }
};