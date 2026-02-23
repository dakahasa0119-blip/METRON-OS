/**
 * 🌊 BAKU v8.0 — Universal Salvage Engine（DNA 抽出精度向上版）
 * - Drive 全域サルベージ
 * - Empty response 完全耐性（fullScan v7.8）
 * - 関数/クラス/メソッド/各種アロー関数 抽出対応
 * - オブジェクトメソッド / クラス内メソッド対応
 * - 重複関数の自動マージ
 * - 依存関係の自動解析
 * - INSTALLED DNA 抽出
 * - 依存順ソート
 * - OS コア自動生成
 */

var BAKU = {
  SIGN: "//AUTHORIZATION_CODE: SINGULARITY_2026//",
  get TARGET_ID() { return METRON_PROPS.REGISTRY_ID },
  SCRIPT_ID: ScriptApp.getScriptId(),

  knownKeys: new Set(),
  knownFunctions: new Map(),
  isInterrupted: false,

  /** ============================
   *  メモリ読み込み
   * ============================ */
  loadMemory_: function (id) {
    try {
      const props = PropertiesService.getScriptProperties();
      const json = props.getProperty("BAKU_MEMORY_" + id);
      if (!json) return new Set();
      return new Set(JSON.parse(json));
    } catch (e) {
      console.warn("loadMemory_ failed:", e.message);
      return new Set();
    }
  },

  /** ============================
   *  メモリ保存
   * ============================ */
  saveMemory_: function (id, setObj) {
    try {
      const props = PropertiesService.getScriptProperties();
      props.setProperty("BAKU_MEMORY_" + id, JSON.stringify([...setObj]));
    } catch (e) {
      console.warn("saveMemory_ failed:", e.message);
    }
  },

  /** ============================
   *  リトライ共通関数
   * ============================ */
  retryRequest_: function (func, label) {
    let lastError;
    for (let i = 0; i < 3; i++) {
      try {
        return func();
      } catch (e) {
        lastError = e;
        const msg = e.message || String(e);
        if (
          msg.includes("no servers") ||
          msg.includes("Backend Error") ||
          msg.includes("Internal error") ||
          msg.includes("Service invoked too many times")
        ) {
          console.warn(`⚠️ [${label}] サーバー負荷 → ${i + 1}回目待機`);
          Utilities.sleep((i + 1) * 3000);
          continue;
        }
        throw e;
      }
    }
    throw lastError;
  },

  /** ============================
   *  FULL SCAN（Drive API）
   *  v7.8 — Empty response 完全耐性版
   * ============================ */
  fullScan: function () {
    console.log("🚀 深層分析併用・Drive API 捕食開始...");

    this.knownKeys = this.loadMemory_(this.TARGET_ID);

    const props = PropertiesService.getScriptProperties();
    let pageToken = props.getProperty("BAKU_PAGE_TOKEN") || null;

    const start = Date.now();

    while (true) {
      const res = this.retryRequest_(
        () =>
          Drive.Files.list({
            q:
              'trashed = false and (' +
              'mimeType contains "text/" or ' +
              'mimeType = "application/vnd.google-apps.script" or ' +
              'mimeType = "application/vnd.google-apps.document" or ' +
              'mimeType = "application/vnd.google-apps.spreadsheet"' +
              ')',
            maxResults: 100,
            pageToken: pageToken,
            fields: "items(id,title,mimeType,version,etag),nextPageToken"
          }),
        "DriveList"
      );

      // Empty response 完全対策
      if (!res || Object.keys(res).length === 0) {
        console.warn("⚠️ DriveList: Empty response → retry");
        Utilities.sleep(1000);
        continue;
      }

      const files = res.items || [];
      for (const f of files) {
        if (Date.now() - start > 240000) {
          props.setProperty("BAKU_PAGE_TOKEN", pageToken);
          console.warn("⏳ タイムリミット → 次回に継続");
          this.isInterrupted = true;
          return;
        }
        this.processFileWithStreaming_(f);
      }

      if (!res.nextPageToken) break;
      pageToken = res.nextPageToken;
    }

    props.deleteProperty("BAKU_PAGE_TOKEN");
    console.log("⏳ BAKU fullScan 完了（Drive 全域サルベージ終了）");
  },

  /** ============================
   *  Apps Script ソース取得
   * ============================ */
  fetchScriptSource_: function (id) {
    return this.retryRequest_(() => {
      const res = UrlFetchApp.fetch(
        `https://script.googleapis.com/v1/projects/${id}/content`,
        {
          headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
          muteHttpExceptions: true,
        }
      );
      if (res.getResponseCode() !== 200)
        throw new Error("ScriptSourceFetch Error: " + res.getResponseCode());

      const data = JSON.parse(res.getContentText());
      if (!data.files) return "";

      return data.files
        .map((f) => `// File: ${f.name}\n${f.source || ""}`)
        .join("\n\n");
    }, "ScriptSourceFetch");
  },

  /** ============================
   *  ファイル捕食（Drive API）
   * ============================ */
  processFileWithStreaming_: function (meta) {
    const fileId = meta.id;
    if (fileId === this.TARGET_ID) return;

    const uniqueKey = fileId + "_v" + (meta.version || meta.etag || "0");
    if (this.knownKeys.has(uniqueKey)) return;

    let content = "";
    const mime = meta.mimeType;
    const title = meta.title || meta.name || "(unknown)";

    try {
      if (mime === "application/vnd.google-apps.script") {
        content = this.fetchScriptSource_(fileId);
      } else if (mime === "application/vnd.google-apps.document") {
        content = this.retryRequest_(
          () => DocumentApp.openById(fileId).getBody().getText(),
          "DocFetch"
        );
      } else if (mime === "application/vnd.google-apps.spreadsheet") {
        content = this.retryRequest_(() => {
          const ss = SpreadsheetApp.openById(fileId);
          return ss
            .getSheets()
            .map(
              (s) =>
                `### ${s.getName()}\n` +
                s.getDataRange().getValues().map((r) => r.join(",")).join("\n")
            )
            .join("\n\n");
        }, "SheetFetch");
      } else if (mime.includes("text/") || mime.includes("json")) {
        content = this.retryRequest_(
          () => DriveApp.getFileById(fileId).getBlob().getDataAsString(),
          "TextFetch"
        );
      }

      if (content && content.length > 0) {
        console.log(`📊 [Streaming] ${title}: ${content.length} 文字`);
        this.directExtract_(content, title);
      }

      this.knownKeys.add(uniqueKey);
      this.saveMemory_(this.TARGET_ID, this.knownKeys);
    } catch (e) {
      console.error("processFileWithStreaming_ failed:", e.message);
    }
  },

  /** ============================
   *  DNA抽出（v8.0 精度向上版）
   * ============================ */
  directExtract_: function (text, sourceName) {
    if (!text) return;

    const foundNames = new Set();
    let foundCount = 0;

    const registerDNA = (name, code) => {
      if (!name || !code) return;
      if (this.knownFunctions.has(name)) return;
      if (foundNames.has(name)) return;
      this.knownFunctions.set(name, code);
      foundNames.add(name);
      foundCount++;
    };

    // 1. 通常の function / class
    const patterns = [
      // function foo(...) { ... }
      /function\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{[\s\S]*?\}/g,
      // class Foo { ... }
      /class\s+([a-zA-Z0-9_]+)\s*\{[\s\S]*?\}/g,
      // const foo = (...) => { ... }
      /const\s+([a-zA-Z0-9_]+)\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}/g,
      // const foo = x => { ... }
      /const\s+([a-zA-Z0-9_]+)\s*=\s*[a-zA-Z0-9_]+\s*=>\s*\{[\s\S]*?\}/g,
      // let / var 版
      /let\s+([a-zA-Z0-9_]+)\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}/g,
      /var\s+([a-zA-Z0-9_]+)\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}/g,
      // const foo = function(...) { ... }
      /const\s+([a-zA-Z0-9_]+)\s*=\s*function\s*\([^)]*\)\s*\{[\s\S]*?\}/g,
      /let\s+([a-zA-Z0-9_]+)\s*=\s*function\s*\([^)]*\)\s*\{[\s\S]*?\}/g,
      /var\s+([a-zA-Z0-9_]+)\s*=\s*function\s*\([^)]*\)\s*\{[\s\S]*?\}/g,
    ];

    patterns.forEach((regex) => {
      let match;
      while ((match = regex.exec(text)) !== null) {
        const name = match[1];
        const code = match[0];
        registerDNA(name, code);
      }
    });

    // 2. 1 行アロー関数（ブロックなし）
    // const foo = (...) => expr;
    const arrowOneLiner =
      /(const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*\([^)]*\)\s*=>\s*([^;]+);/g;
    let m1;
    while ((m1 = arrowOneLiner.exec(text)) !== null) {
      const name = m1[2];
      const code = m1[0];
      registerDNA(name, code);
    }

    // const foo = x => expr;
    const arrowOneLinerNoParens =
      /(const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*[a-zA-Z0-9_]+\s*=>\s*([^;]+);/g;
    let m2;
    while ((m2 = arrowOneLinerNoParens.exec(text)) !== null) {
      const name = m2[2];
      const code = m2[0];
      registerDNA(name, code);
    }

    // 3. オブジェクトメソッド / クラス内メソッド（簡易版）
    // const obj = { foo() { ... }, bar(x) { ... } }
    const objectLike =
      /(const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*\{([\s\S]*?)\};/g;
    let mo;
    while ((mo = objectLike.exec(text)) !== null) {
      const body = mo[3];
      const methodRegex =
        /([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{[\s\S]*?\}/g;
      let mm;
      while ((mm = methodRegex.exec(body)) !== null) {
        const name = mm[1];
        const code = mm[0];
        registerDNA(name, code);
      }
    }

    // class Foo { bar() { ... } baz(x) { ... } }
    const classBodyRegex =
      /class\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/g;
    let mc;
    while ((mc = classBodyRegex.exec(text)) !== null) {
      const classBody = mc[2];
      const methodRegex =
        /([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{[\s\S]*?\}/g;
      let mm;
      while ((mm = methodRegex.exec(classBody)) !== null) {
        const name = mm[1];
        const code = mm[0];
        registerDNA(name, code);
      }
    }

    if (foundCount > 0) {
      console.log(
        `🧬 抽出: ${sourceName} から ${foundCount} 個のDNAを取得`
      );
      this.saveMemory_(this.TARGET_ID, new Set(this.knownFunctions.keys()));
    }
  },

  /** ============================
   *  INSTALLED DNA 抽出
   * ============================ */
  getInstalledDNA_: function () {
    const ss = SpreadsheetApp.openById(this.TARGET_ID);
    const sheet = ss.getSheetByName("BAKU_DNA_VAULT");
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    const results = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const status = row[5] ? row[5].toString() : "";

      if (!status.includes("∞: INSTALLED")) continue;

      let dna = row[3];
      if (typeof dna === "string" && dna.startsWith("'")) dna = dna.substring(1);

      let name = "(unknown)";
      const fnMatch = dna.match(/(?:function|class)\s+([a-zA-Z0-9_]+)/);
      const arrowMatch = dna.match(/const\s+([a-zA-Z0-9_]+)\s*=\s*\(/);

      if (fnMatch) name = fnMatch[1];
      else if (arrowMatch) name = arrowMatch[1];

      results.push({ name, code: dna });
    }

    return results;
  },

  /** ============================
   *  依存解析
   * ============================ */
  extractDependencies_: function (code, allNames) {
    const deps = [];
    allNames.forEach((name) => {
      const regex = new RegExp(`\\b${name}\\s*\\(`);
      if (regex.test(code)) deps.push(name);
    });
    return deps;
  },

  topologicalSort_: function (nodes, edges) {
    const sorted = [];
    const visited = new Set();

    const visit = (n, stack = []) => {
      if (visited.has(n)) return;
      if (stack.includes(n)) {
        console.warn("⚠️ 循環依存 detected:", stack.join(" → "), "→", n);
        return;
      }
      stack.push(n);
      (edges[n] || []).forEach((dep) => visit(dep, stack.slice()));
      visited.add(n);
      sorted.push(n);
    };

    nodes.forEach((n) => visit(n));
    return sorted;
  },

  sortInstalledDNA_: function (installedList) {
    const names = installedList.map((d) => d.name);
    const edges = {};

    installedList.forEach((d) => {
      edges[d.name] = this.extractDependencies_(d.code, names);
    });

    const order = this.topologicalSort_(names, edges);
    return order.map((name) => installedList.find((d) => d.name === name));
  },

  /** ============================
   *  OS コア自動生成
   * ============================ */
  generateCoreFile_: function () {
    const installed = this.getInstalledDNA_();
    if (installed.length === 0) return "// No INSTALLED DNA found.\n";

    const sorted = this.sortInstalledDNA_(installed);

    let output = "";
    output += "/**\n";
    output += " * 🚀 AUTO-GENERATED METRON CORE\n";
    output += " * Generated at: " + new Date().toISOString() + "\n";
    output += " * DO NOT EDIT MANUALLY\n";
    output += " */\n\n";

    sorted.forEach((d) => {
      output += `// === ${d.name} ===\n`;
      output += d.code + "\n\n";
    });

    return output;
  },
};