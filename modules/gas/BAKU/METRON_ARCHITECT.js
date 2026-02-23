/**
 * 🧭 METRON_ARCHITECT (v8.0)
 * METRON OS のシステム地図生成モジュール
 * - ファイル構造の可視化（v8.0: DNA数・依存数も含む）
 * - METRON_CORE を最優先で解析
 * - 世代番号の統合
 * - JSON 形式で返す（EVO が利用）
 */

var METRON_ARCHITECT = METRON_ARCHITECT || {

  /** ============================
   *  システム地図生成（v8.0）
   * ============================ */
  generateSystemMap: function() {
    try {
      const url =
        "https://script.googleapis.com/v1/projects/" +
        ScriptApp.getScriptId() +
        "/content";

      const headers = {
        Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      };

      const project = JSON.parse(
        UrlFetchApp.fetch(url, { headers }).getContentText()
      );

      const files = project.files || [];
      const generation = METRON_GENERATIONS.getCurrentGeneration();

      /** ----------------------------------------
       * METRON_CORE を最優先で上に置く
       * ---------------------------------------- */
      const sorted = files.sort((a, b) => {
        if (a.name === "METRON_CORE") return -1;
        if (b.name === "METRON_CORE") return 1;
        return a.name.localeCompare(b.name);
      });

      /** ----------------------------------------
       * v8.0: DNA数・依存数・危険度を含むシステム地図
       * ---------------------------------------- */
      const map = {
        generation,
        fileCount: sorted.length,
        files: [],
      };

      sorted.forEach((f) => {
        const source = f.source || "";
        const dnaList = METRON_DNA_ANALYST.extract(source, f.name);
        const validDNA = METRON_DNA_VALIDATE.validate(dnaList);

        // 依存関係数（DNAごとに集計）
        let depCount = 0;
        validDNA.forEach((dna) => {
          const calls = dna.code.match(/[A-Za-z0-9_]+\s*\(/g) || [];
          depCount += new Set(calls.map((c) => c.replace("(", ""))).size;
        });

        // 危険度（危険コードを含むDNAの数）
        let dangerCount = 0;
        validDNA.forEach((dna) => {
          if (DNA_ANALYST.containsDangerousPatterns_(dna.code)) {
            dangerCount++;
          }
        });

        map.files.push({
          name: f.name,
          type: f.type,
          size: source.length,
          dnaCount: validDNA.length,
          dependencyCount: depCount,
          dangerCount: dangerCount,
        });
      });

      return JSON.stringify(map, null, 2);

    } catch (e) {
      console.error("System Map generation failed:", e.message);
      return "{}";
    }
  },
};