/**
 * 🔁 METRON_AUTO_EVO (v8.0)
 * METRON OS 自律進化ループ（強化版）
 * - DNA Vault の監視（v8.0: dangerCount / dependencyCount も考慮）
 * - Sランクの自動進化（v8.0: DNA_ANALYST v8.0 と連携）
 * - エラー監視
 * - 自己再構築モードの自動起動（v8.0: 世代メタデータ保存）
 */

var METRON_AUTO_EVO = METRON_AUTO_EVO || {

  /** ============================
   *  自律進化ループ（v8.0）
   * ============================ */
  patrol: function () {
    try {
      console.log("🌐 AUTO_EVO パトロール開始...");

      // Universe 情報取得
      const universe = BAKU.getUniverse_();
      const ss = SpreadsheetApp.openById(universe.registry);
      const sheet = ss.getSheetByName("BAKU_DNA_VAULT");
      const data = sheet.getDataRange().getValues();

      let targetIndex = -1;
      let bestScore = -1;

      /** ----------------------------------------
       * v8.0: Sランクの中でも「最も優秀な DNA」を選ぶ
       * - dangerCount が低い
       * - dependencyCount が適正
       * - DNA_ANALYST のスコアが高い
       * ---------------------------------------- */
      for (let i = 1; i < data.length; i++) {
        const status = data[i][5] ? data[i][5].toString() : "";
        if (
          status.includes("S:") &&
          !status.includes("INSTALLED") &&
          !status.includes("DISCARDED") &&
          !status.includes("FAIL")
        ) {
          const dnaCode = data[i][3];
          const evalResult = DNA_ANALYST.evaluate(dnaCode);

          if (evalResult.rank === "S" && evalResult.score > bestScore) {
            bestScore = evalResult.score;
            targetIndex = i;
          }
        }
      }

      /** ----------------------------------------
       * 2. Sランクがなければ → 自己再構築モードへ
       * ---------------------------------------- */
      if (targetIndex === -1) {
        console.log("🌙 Sランクなし → OS 自己再構築モードへ移行");

        const rebuild = METRON_EVO.selfRebuildOS();

        if (rebuild.success) {
          console.log("🧬 OS 再構築成功（世代更新）");

          // v8.0: 世代メタデータ保存
          METRON_GENERATIONS.saveGenerationMeta({
            event: "selfRebuild",
            timestamp: new Date().toISOString(),
            reason: "No S-rank DNA",
          });

        } else {
          console.warn("⚠️ OS 再構築失敗:", rebuild.error);
        }
        return;
      }

      /** ----------------------------------------
       * 3. Sランク DNA を進化させる
       * ---------------------------------------- */
      const row = data[targetIndex];
      const physicalRow = targetIndex + 1;

      let dna = row[3];
      if (typeof dna === "string" && dna.startsWith("'")) {
        dna = dna.substring(1);
      }

      console.log(`🧬 Sランク進化: Row ${physicalRow}`);

      // v8.0: コンテキスト強化
      const decision = METRON_EVO.thinkWithContext(
        dna,
        METRON_SWARM.ROLES.CREATOR,
        {
          generation: METRON_GENERATIONS.getCurrentGeneration(),
          fileContext: row[2] || "UNKNOWN",
        }
      );

      const result = METRON_EVO.incarnate(decision);

      /** ----------------------------------------
       * 進化結果の処理
       * ---------------------------------------- */
      if (result.discarded) {
        sheet.getRange(physicalRow, 6).setValue("X: DISCARDED");
        console.log("🛑 却下");
        return;
      }

      if (result.success) {
        sheet.getRange(physicalRow, 6).setValue("∞: INSTALLED");
        console.log("✨ 進化成功 → INSTALLED");

        // v8.0: 世代メタデータ保存
        METRON_GENERATIONS.saveGenerationMeta({
          event: "install",
          dnaName: row[1],
          timestamp: new Date().toISOString(),
          score: bestScore,
        });

      } else {
        sheet.getRange(physicalRow, 6).setValue("FAIL: Re-evaluate");
        console.warn("💀 進化失敗");
      }

    } catch (e) {
      console.error("AUTO_EVO patrol error:", e.message);
    }
  },
};