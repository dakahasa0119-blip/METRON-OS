/**
 * 🧬 METRON_GENERATIONS (v8.0)
 * METRON OS の世代管理モジュール
 * - 世代番号の管理
 * - 世代ごとのバックアップ（メタ情報付き）
 * - 差分記録（MD5 + 行差分）
 * - 安定性スコアの記録
 * - 世代メタデータの保存
 * - 世代履歴の取得
 */

var METRON_GENERATIONS = METRON_GENERATIONS || {

  /** ============================
   *  現在の世代番号を取得
   * ============================ */
  getCurrentGeneration: function () {
    const props = PropertiesService.getScriptProperties();
    return Number(props.getProperty("METRON_GENERATION") || 1);
  },

  /** ============================
   *  世代番号を +1 して保存
   * ============================ */
  incrementGeneration: function () {
    const props = PropertiesService.getScriptProperties();
    const next = this.getCurrentGeneration() + 1;
    props.setProperty("METRON_GENERATION", String(next));
    return next;
  },

  /** ============================
   *  世代バックアップを保存（v8.0: メタ情報付き）
   * ============================ */
  saveGenerationBackup: function (coreSource) {
    const gen = this.getCurrentGeneration();
    const folderName = "METRON_GENERATION_BACKUPS";

    let folder;
    const existing = DriveApp.getFoldersByName(folderName);
    folder = existing.hasNext()
      ? existing.next()
      : DriveApp.createFolder(folderName);

    const timestamp = new Date().toISOString();
    const fileName = `METRON_CORE_v${gen}_${timestamp}.gs`;

    const file = folder.createFile(fileName, coreSource, MimeType.PLAIN_TEXT);

    // メタ情報を保存
    file.setDescription(
      JSON.stringify(
        {
          generation: gen,
          timestamp,
          size: coreSource.length,
        },
        null,
        2
      )
    );

    return fileName;
  },

  /** ============================
   *  差分を記録（v8.0: MD5 + 行差分）
   * ============================ */
  saveDiff: function (oldCore, newCore) {
    const gen = this.getCurrentGeneration();
    const props = PropertiesService.getScriptProperties();

    // MD5
    const md5 = Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5,
      newCore
    )
      .map((b) => ("0" + (b & 0xff).toString(16)).slice(-2))
      .join("");

    // 行差分（簡易）
    const oldLines = oldCore.split("\n");
    const newLines = newCore.split("\n");

    const diffLines = [];
    const max = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < max; i++) {
      if (oldLines[i] !== newLines[i]) {
        diffLines.push({
          line: i + 1,
          old: oldLines[i] || "",
          new: newLines[i] || "",
        });
      }
    }

    props.setProperty(`GEN_DIFF_${gen}`, md5);
    props.setProperty(`GEN_DIFF_LINES_${gen}`, JSON.stringify(diffLines));
  },

  /** ============================
   *  世代の安定性スコアを記録
   * ============================ */
  saveStabilityScore: function (score) {
    const gen = this.getCurrentGeneration();
    const props = PropertiesService.getScriptProperties();
    props.setProperty(`GEN_STABILITY_${gen}`, String(score));
  },

  /** ============================
   *  世代メタデータを保存（v8.0）
   * ============================ */
  saveGenerationMeta: function (meta) {
    const gen = this.getCurrentGeneration();
    const props = PropertiesService.getScriptProperties();
    props.setProperty(`GEN_META_${gen}`, JSON.stringify(meta));
  },

  /** ============================
   *  世代履歴を取得（v8.0）
   * ============================ */
  getGenerationHistory: function () {
    const props = PropertiesService.getScriptProperties();
    const gen = this.getCurrentGeneration();

    const history = [];

    for (let i = 1; i <= gen; i++) {
      history.push({
        generation: i,
        diff: props.getProperty(`GEN_DIFF_${i}`) || "",
        stability: props.getProperty(`GEN_STABILITY_${i}`) || "",
        meta: props.getProperty(`GEN_META_${i}`)
          ? JSON.parse(props.getProperty(`GEN_META_${i}`))
          : {},
      });
    }

    return history;
  },
};