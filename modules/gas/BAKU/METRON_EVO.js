/** ============================
 *  METRON_EVO v8.0 — Section 1
 *  ORCHESTRATOR（思考統括）
 * ============================ */

const METRON_EVO = METRON_EVO || {};

METRON_EVO.Orchestrator = {

  /** ----------------------------------------
   * 基本思考エンジン
   * - Gemini / OpenAI を切り替え
   * - 失敗時は安全な JSON を返す
   * ---------------------------------------- */
  think: function (prompt, role = "CREATOR", lastError = null) {
    let response = null;

    try {
      const openAiKey = METRON_PROPS.getOpenAiKey();

      if (role === "HACKER" && openAiKey) {
        response = METRON_EVO.fetchOpenAi_(prompt, lastError);
      } else {
        response = METRON_EVO.fetchGemini_(prompt, role, lastError);
      }

    } catch (e) {
      response = null;
    }

    if (!response || typeof response !== "string") {
      response = `{"action":"DISCARD","reason":"AI response invalid","files":[]}`;
    }

    METRON_EVO.Telemetry.logTelemetry(prompt, response, lastError, role);
    return response;
  },

  /** ----------------------------------------
   * システム地図を含む文脈思考
   * - v8.0: SystemMap のメタ情報を活用
   * ---------------------------------------- */
  thinkWithContext: function (dnaFragment, role = "CREATOR") {
    const systemMap = METRON_ARCHITECT.generateSystemMap();

    const prompt = `
あなたは METRON OS の【${role}】です。

【現在のシステム地図（v8.0）】
${systemMap}

【新しいDNA】
${dnaFragment}

【重要指令】
1. Move, Don't Copy
2. Telemetry Conscious
3. Single Source of Truth
4. Respect Dependencies
5. Avoid Dangerous APIs

出力形式(JSON):
{
  "action": "EVOLVE" | "DISCARD",
  "reason": "判断理由",
  "files": [
    {"name": "filename", "source": "code"}
  ],
  "delete": ["oldfile"],
  "meta": {
    "danger": 0,
    "dependency": 0,
    "quality": 0
  },
  "report": "受肉報告"
}`;

    return this.think(prompt, role);
  },

  /** ----------------------------------------
   * DNA プロファイルを含む思考（v8.0 新規）
   * - DNA_ANALYST v8.0 のスコアを統合
   * ---------------------------------------- */
  thinkWithDNAProfile: function (dnaCode, role = "CREATOR") {
    const profile = DNA_ANALYST.evaluate(dnaCode);
    const systemMap = METRON_ARCHITECT.generateSystemMap();

    const prompt = `
あなたは METRON OS の【${role}】です。

【DNA プロファイル】
${JSON.stringify(profile, null, 2)}

【システム地図】
${systemMap}

【DNA】
${dnaCode}

【指令】
- 危険度が高い場合は必ず DISCARDED
- 依存関係が破壊される場合は DISCARDED
- 品質が高い場合は EVOLVE を検討

出力形式(JSON):
{
  "action": "EVOLVE" | "DISCARD",
  "reason": "判断理由",
  "files": [],
  "delete": [],
  "meta": ${JSON.stringify(profile)}
}`;

    return this.think(prompt, role);
  },

  /** ----------------------------------------
   * 進化履歴を含む思考（v8.0 新規）
   * ---------------------------------------- */
  thinkWithHistory: function (dnaCode, role = "CREATOR") {
    const history = METRON_GENERATIONS.getGenerationHistory();
    const profile = DNA_ANALYST.evaluate(dnaCode);

    const prompt = `
あなたは METRON OS の【${role}】です。

【DNA プロファイル】
${JSON.stringify(profile, null, 2)}

【進化履歴】
${JSON.stringify(history.slice(-5), null, 2)}

【DNA】
${dnaCode}

【指令】
- 過去の失敗パターンを避ける
- 安定性の高い世代を参考にする
- 危険度が高い場合は必ず DISCARDED

出力形式(JSON):
{
  "action": "EVOLVE" | "DISCARD",
  "reason": "判断理由",
  "files": [],
  "delete": [],
  "meta": ${JSON.stringify(profile)}
}`;

    return this.think(prompt, role);
  }
};
/** ============================
 *  METRON_EVO v8.0 — Section 2
 *  JSON PROCESSOR（AI応答解析）
 * ============================ */

METRON_EVO.JSON = {

  /** ----------------------------------------
   * JSON 抽出（深度カウンタ方式）
   * - AI が余計な文章を返しても JSON 部分だけ抜き出す
   * ---------------------------------------- */
  extractJsonObject_: function (text) {
    if (!text || typeof text !== "string") {
      throw new Error("JSON抽出失敗: text が無効");
    }

    let start = text.indexOf("{");
    if (start === -1) {
      throw new Error("JSON開始が見つからない");
    }

    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;

      if (depth === 0) {
        return text.substring(start, i + 1);
      }
    }

    throw new Error("JSONが閉じていない");
  },

  /** ----------------------------------------
   * JSON 正規化（v8.0）
   * - ```json や ``` を除去
   * - BOM/不可視文字を除去
   * - 末尾のカンマを修正
   * ---------------------------------------- */
  normalizePatch_: function (raw) {
    if (!raw || typeof raw !== "string") return "{}";

    let clean = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .replace(/^\uFEFF/, "") // BOM除去
      .trim();

    // JSON 抽出
    try {
      clean = this.extractJsonObject_(clean);
    } catch (e) {
      console.warn("JSON抽出失敗:", e.message);
      return `{"action":"DISCARD","reason":"JSON extract failed","files":[]}`;
    }

    // 末尾カンマ修正
    clean = clean.replace(/,\s*}/g, "}");
    clean = clean.replace(/,\s*]/g, "]");

    return clean;
  },

  /** ----------------------------------------
   * パッチ構造の検証（v8.0）
   * - 必須フィールドの存在確認
   * - 型チェック
   * - 危険な構造の排除
   * ---------------------------------------- */
  validatePatch_: function (patch) {
    if (!patch || typeof patch !== "object") {
      return { valid: false, reason: "patch がオブジェクトではない" };
    }

    if (!patch.action || !["EVOLVE", "DISCARD"].includes(patch.action)) {
      return { valid: false, reason: "action が無効" };
    }

    if (!Array.isArray(patch.files)) {
      return { valid: false, reason: "files が配列ではない" };
    }

    if (patch.delete && !Array.isArray(patch.delete)) {
      return { valid: false, reason: "delete が配列ではない" };
    }

    // 危険な構造（AI hallucination）
    if (patch.files.some(f => typeof f.name !== "string" || typeof f.source !== "string")) {
      return { valid: false, reason: "files 内の構造が不正" };
    }

    return { valid: true };
  },

  /** ----------------------------------------
   * JSON → Patch オブジェクト変換（v8.0）
   * - 正規化 → パース → 構造検証
   * ---------------------------------------- */
  parsePatch: function (rawResponse) {
    const normalized = this.normalizePatch_(rawResponse);

    let patch;
    try {
      patch = JSON.parse(normalized);
    } catch (e) {
      console.error("JSON parse error:", e.message);
      return {
        action: "DISCARD",
        reason: "JSON parse error",
        files: []
      };
    }

    const validation = this.validatePatch_(patch);
    if (!validation.valid) {
      console.warn("Patch validation failed:", validation.reason);
      return {
        action: "DISCARD",
        reason: validation.reason,
        files: []
      };
    }

    return patch;
  }
};
/** ============================
 *  METRON_EVO v8.0 — Section 3
 *  INCARNATION ENGINE（受肉エンジン）
 * ============================ */

METRON_EVO.Incarnation = {

  /** ----------------------------------------
   * 受肉メイン処理
   * - JSON Processor で正規化 → パッチ適用
   * ---------------------------------------- */
  incarnate: function (rawResponse) {
    try {
      if (!rawResponse) {
        throw new Error("AI応答が空");
      }

      // JSON Processor を使って安全にパッチ化
      const patch = METRON_EVO.JSON.parsePatch(rawResponse);

      if (patch.action === "DISCARD") {
        return { success: true, discarded: true };
      }

      // パッチ適用
      const result = this.applyPatch_(patch);
      return result;

    } catch (e) {
      console.error("⚠️ 受肉失敗:", e.message);
      return METRON_EVO.AutoRepair.autoRepair_(rawResponse, e.message);
    }
  },

  /** ----------------------------------------
   * パッチ適用（v8.0）
   * - 削除 → 更新 → メタ情報
   * ---------------------------------------- */
  applyPatch_: function (patch) {
    const scriptId = ScriptApp.getScriptId();
    const url = `https://script.googleapis.com/v1/projects/${scriptId}/content`;
    const headers = { Authorization: "Bearer " + ScriptApp.getOAuthToken() };

    // 現在のプロジェクト構造を取得
    const current = JSON.parse(
      UrlFetchApp.fetch(url, { headers }).getContentText()
    );

    // 1. 削除命令
    if (patch.delete && Array.isArray(patch.delete)) {
      this.applyDeletions_(current, patch.delete);
    }

    // 2. ファイル更新
    if (patch.files && Array.isArray(patch.files)) {
      this.applyFileUpdates_(current, patch.files);
    }

    // 3. メタ情報（任意）
    if (patch.meta) {
      this.applyMetadata_(patch.meta);
    }

    // 4. PUT で更新
    const res = UrlFetchApp.fetch(url, {
      method: "put",
      headers,
      contentType: "application/json",
      payload: JSON.stringify(current),
      muteHttpExceptions: true,
    });

    if (res.getResponseCode() === 200) {
      return { success: true };
    }

    throw new Error("受肉APIエラー: " + res.getContentText());
  },

  /** ----------------------------------------
   * 削除命令の適用
   * ---------------------------------------- */
  applyDeletions_: function (current, deleteList) {
    deleteList.forEach((name) => {
      const clean = name.replace(/\.gs$|\.html$/i, "");
      current.files = current.files.filter((f) => f.name !== clean);
    });
  },

  /** ----------------------------------------
   * ファイル更新の適用（v8.0）
   * - HTML / GS の自動判定
   * - 既存ファイルは上書き
   * - 新規ファイルは追加
   * ---------------------------------------- */
  applyFileUpdates_: function (current, fileList) {
    fileList.forEach((p) => {
      let name = p.name.replace(/\.gs$|\.html$/i, "");
      if (name === "appsscript") return;

      const type = p.source.trim().startsWith("<")
        ? "HTML"
        : "SERVER_JS";

      let existing = current.files.find((f) => f.name === name);

      if (existing) {
        existing.source = p.source;
        existing.type = type;
      } else {
        current.files.push({
          name,
          type,
          source: p.source,
        });
      }
    });
  },

  /** ----------------------------------------
   * メタ情報の適用（v8.0）
   * - 世代メタデータに保存
   * ---------------------------------------- */
  applyMetadata_: function (meta) {
    METRON_GENERATIONS.saveGenerationMeta({
      event: "evolve",
      timestamp: new Date().toISOString(),
      meta,
    });
  },
};
/** ============================
 *  METRON_EVO v8.0 — Section 4
 *  AUTO‑REPAIR ENGINE（自己修復）
 * ============================ */

METRON_EVO.AutoRepair = {

  /** ----------------------------------------
   * 軽度の修復（第一段階）
   * - JSON の欠落や余計な文章を修正
   * - 再受肉を試みる
   * ---------------------------------------- */
  autoRepair_: function (failedJson, errorMsg) {
    const repairPrompt = `
受肉処理が失敗しました。
以下の JSON を修復し、完全な JSON のみを返してください。

【エラー】
${errorMsg}

【壊れたJSON】
${failedJson}

【重要指令】
- JSON 以外の文章は禁止
- 必ず { ... } の JSON オブジェクトのみ返す
- files/delete/meta の構造を維持する
`;

    const fixed = METRON_EVO.Orchestrator.think(
      repairPrompt,
      "HACKER",
      errorMsg
    );

    return this.autoRepairDeep_(fixed);
  },

  /** ----------------------------------------
   * 深度修復（第二段階）
   * - JSON Processor で正規化
   * - 構造破損を検出したら構造修復へ
   * ---------------------------------------- */
  autoRepairDeep_: function (raw) {
    try {
      const patch = METRON_EVO.JSON.parsePatch(raw);

      if (patch.action === "DISCARD" && patch.reason.includes("parse")) {
        return this.autoRepairStructure_(raw);
      }

      return METRON_EVO.Incarnation.incarnate(raw);

    } catch (e) {
      return this.autoRepairStructure_(raw);
    }
  },

  /** ----------------------------------------
   * 構造修復（第三段階・最終防衛）
   * - files/delete/meta を強制生成
   * - action が無い場合は DISCARDED
   * - JSON を再構築して再受肉
   * ---------------------------------------- */
  autoRepairStructure_: function (raw) {
    console.warn("⚠️ 深刻なJSON破損 → 構造修復モード");

    const safePatch = {
      action: "DISCARD",
      reason: "Auto structural repair",
      files: [],
      delete: [],
      meta: {
        repaired: true,
        timestamp: new Date().toISOString()
      }
    };

    return METRON_EVO.Incarnation.incarnate(JSON.stringify(safePatch));
  }
};
/** ============================
 *  METRON_EVO v8.0 — Section 5
 *  SELF‑REBUILD ENGINE（自己再構築）
 * ============================ */

METRON_EVO.SelfRebuild = {

  /** ----------------------------------------
   * OS 自己再構築モード（v8.0）
   * - INSTALLED DNA から METRON_CORE を再生成
   * - 世代番号を更新
   * - バックアップ作成
   * - メタデータ保存
   * ---------------------------------------- */
  selfRebuildOS: function (role = "ARCHITECT") {
    try {
      console.log("🧬 OS 自己再構築モード開始...");

      // 1. INSTALLED DNA を取得
      const installed = BAKU.getInstalledDNA_();
      if (!installed || installed.length === 0) {
        return { success: false, reason: "No INSTALLED DNA found." };
      }

      // 2. 依存順にソート
      const sorted = BAKU.sortInstalledDNA_(installed);

      // 3. METRON_CORE を生成
      const coreSource = BAKU.generateCoreFile_();

      // 4. 世代バックアップ
      const backupFile = METRON_GENERATIONS.saveGenerationBackup(coreSource);

      // 5. 世代番号を進める
      const nextGen = METRON_GENERATIONS.incrementGeneration();

      // 6. メタデータ保存
      METRON_GENERATIONS.saveGenerationMeta({
        event: "selfRebuild",
        timestamp: new Date().toISOString(),
        installedCount: installed.length,
        backup: backupFile,
        generation: nextGen
      });

      // 7. プロジェクトへ適用
      const patch = JSON.stringify({
        action: "EVOLVE",
        reason: "Rebuild METRON CORE from INSTALLED DNA",
        files: [
          { name: "METRON_CORE.gs", source: coreSource }
        ],
        delete: [],
        meta: {
          installedCount: installed.length,
          generation: nextGen
        }
      });

      const result = METRON_EVO.Incarnation.incarnate(patch);
      if (!result || !result.success) {
        return { success: false, error: "Incarnation failed" };
      }

      // 8. SystemMap 更新
      try {
        METRON_ARCHITECT.generateSystemMap();
      } catch (e) {
        console.warn("System map update failed:", e.message);
      }

      // 9. Telemetry 記録
      METRON_EVO.Telemetry.logGenerationEvent_({
        event: "selfRebuild",
        generation: nextGen,
        installedCount: installed.length,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        updated: true,
        file: "METRON_CORE.gs",
        installedCount: installed.length,
        generation: nextGen
      };

    } catch (e) {
      return { success: false, error: e.message };
    }
  }
};
/** ============================
 *  METRON_EVO v8.0 — Section 6
 *  TELEMETRY ENGINE（観測・記録）
 * ============================ */

METRON_EVO.Telemetry = {

  /** ----------------------------------------
   * 基本ログ（AI応答ログ）
   * ---------------------------------------- */
  logTelemetry: function (prompt, response, error, role) {
    try {
      const props = PropertiesService.getScriptProperties();

      const entry = {
        timestamp: new Date().toISOString(),
        role,
        promptLength: prompt ? prompt.length : 0,
        responseLength: response ? response.length : 0,
        error: error || null
      };

      props.setProperty(
        `TELEMETRY_${Date.now()}`,
        JSON.stringify(entry)
      );

    } catch (e) {
      console.warn("Telemetry logging failed:", e.message);
    }
  },

  /** ----------------------------------------
   * 進化イベントログ（EVOLVE / DISCARD）
   * ---------------------------------------- */
  logEvolutionEvent_: function (event) {
    try {
      const props = PropertiesService.getScriptProperties();

      const entry = {
        timestamp: new Date().toISOString(),
        event: event.event || "unknown",
        dnaName: event.dnaName || null,
        score: event.score || null,
        reason: event.reason || null,
        generation: METRON_GENERATIONS.getCurrentGeneration()
      };

      props.setProperty(
        `EVO_EVENT_${Date.now()}`,
        JSON.stringify(entry)
      );

    } catch (e) {
      console.warn("Evolution event logging failed:", e.message);
    }
  },

  /** ----------------------------------------
   * 世代イベントログ（selfRebuild / generation increment）
   * ---------------------------------------- */
  logGenerationEvent_: function (event) {
    try {
      const props = PropertiesService.getScriptProperties();

      const entry = {
        timestamp: new Date().toISOString(),
        event: event.event || "generation",
        generation: event.generation || METRON_GENERATIONS.getCurrentGeneration(),
        installedCount: event.installedCount || null,
        backup: event.backup || null
      };

      props.setProperty(
        `GEN_EVENT_${Date.now()}`,
        JSON.stringify(entry)
      );

    } catch (e) {
      console.warn("Generation event logging failed:", e.message);
    }
  },

  /** ----------------------------------------
   * 自己修復ログ（AutoRepair）
   * ---------------------------------------- */
  logRepairEvent_: function (raw, error) {
    try {
      const props = PropertiesService.getScriptProperties();

      const entry = {
        timestamp: new Date().toISOString(),
        event: "autoRepair",
        error,
        rawLength: raw ? raw.length : 0
      };

      props.setProperty(
        `REPAIR_EVENT_${Date.now()}`,
        JSON.stringify(entry)
      );

    } catch (e) {
      console.warn("Repair event logging failed:", e.message);
    }
  },

  /** ----------------------------------------
   * DNA プロファイルログ（v8.0）
   * ---------------------------------------- */
  logDNAProfile_: function (dnaName, profile) {
    try {
      const props = PropertiesService.getScriptProperties();

      const entry = {
        timestamp: new Date().toISOString(),
        dnaName,
        profile
      };

      props.setProperty(
        `DNA_PROFILE_${Date.now()}`,
        JSON.stringify(entry)
      );

    } catch (e) {
      console.warn("DNA profile logging failed:", e.message);
    }
  }
};
/** ============================
 *  METRON_EVO v8.0 — Section 7
 *  SAFETY ENGINE（安全性チェック）
 * ============================ */

METRON_EVO.Safety = {

  /** ----------------------------------------
   * 危険な DNA の検出
   * - Apps Script の危険 API
   * - eval / new Function
   * - 外部通信
   * ---------------------------------------- */
  detectDangerousDNA_: function (code) {
    if (!code || typeof code !== "string") return true;

    const blacklist = [
      "UrlFetchApp\\.fetch\\(",
      "DriveApp\\.",
      "ScriptApp\\.deleteTrigger",
      "eval\\(",
      "new Function",
      "Jdbc\\.",
      "HtmlService\\.createHtmlOutput",
      "PropertiesService\\.getUserProperties",
      "SpreadsheetApp\\.openByUrl"
    ];

    return blacklist.some(p => new RegExp(p).test(code));
  },

  /** ----------------------------------------
   * 危険なパッチの検出
   * - METRON_CORE の削除
   * - appsscript.json の削除
   * - ファイル全削除
   * - 空のパッチ
   * ---------------------------------------- */
  detectPatchAnomalies_: function (patch) {
    if (!patch || typeof patch !== "object") {
      return "Patch is not an object";
    }

    // METRON_CORE を削除しようとしている
    if (patch.delete && patch.delete.includes("METRON_CORE")) {
      return "Attempt to delete METRON_CORE";
    }

    // appsscript.json を削除しようとしている
    if (patch.delete && patch.delete.includes("appsscript")) {
      return "Attempt to delete appsscript.json";
    }

    // 全削除
    if (patch.delete && patch.delete.length > 20) {
      return "Patch attempts mass deletion";
    }

    // files が空
    if (patch.files && patch.files.length === 0 && patch.action === "EVOLVE") {
      return "EVOLVE patch contains no files";
    }

    return null; // safe
  },

  /** ----------------------------------------
   * 再帰的進化の検出（infinite evolve loop）
   * - 同じ DNA を何度も進化しようとする
   * - 同じファイルを連続で書き換える
   * ---------------------------------------- */
  detectRecursiveEvolution_: function (dnaName, patch) {
    try {
      const props = PropertiesService.getScriptProperties();
      const last = props.getProperty("LAST_EVOLVE_TARGET");

      // 同じ DNA を連続で進化しようとしている
      if (last && last === dnaName) {
        return "Recursive evolution detected";
      }

      // 記録更新
      props.setProperty("LAST_EVOLVE_TARGET", dnaName);
      return null;

    } catch (e) {
      return "Recursive evolution check failed";
    }
  }
};
