/**
 * BAKU Multi-Domain Gateway Bridge (v3)
 *
 * Domains:
 * - ARC repair jobs (ARC_JOBS via lease_job)
 * - MOTHERSHIP messages (MOTHERSHIP_QUEUE via mothership_pull)
 * - Drive salvage operations through BAKU core scanner
 *
 * New in v3:
 * - External playbook rules from sheet `BAKU_PLAYBOOK`
 * - Structured report envelope `BAKU_REPORT_JSON:`
 * - Follow-up job proposal for Gateway orchestration
 */

var BAKU_GATEWAY = BAKU_GATEWAY || {
  ARC_EXECUTOR: "BAKU",
  REPORT_PREFIX: "BAKU_REPORT_JSON:",

  getProps_: function () {
    return PropertiesService.getScriptProperties();
  },

  ensureRecommendedDefaults_: function () {
    var p = this.getProps_();
    var defaults = {
      GATEWAY_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbyTZSv_X625o7T27_hQQ6eP_BztvrBDLx6kU_8cVLcmbvjWnhNYGFA2e8Wo7E0m7A/exec",
      BAKU_USE_SIGNATURE: "false",
      BAKU_ALLOW_REBUILD: "false",
      BAKU_MAX_LOOP_JOBS: "6"
    };

    Object.keys(defaults).forEach(function (k) {
      if (!String(p.getProperty(k) || "").trim()) p.setProperty(k, defaults[k]);
    });

    if (!String(p.getProperty("BAKU_WORKER_ID") || "").trim()) {
      p.setProperty("BAKU_WORKER_ID", "baku-node-" + Utilities.getUuid().slice(0, 8));
    }
  },

  getGatewayUrl_: function () {
    return String(this.getProps_().getProperty("GATEWAY_WEBAPP_URL") || "").trim();
  },

  getAuthKey_: function () {
    return String(this.getProps_().getProperty("ARC_AUTH_KEY") || "").trim();
  },

  getWorkerId_: function () {
    var id = String(this.getProps_().getProperty("BAKU_WORKER_ID") || "").trim();
    if (id) return id;
    id = "baku-gas-" + Utilities.getUuid().slice(0, 8);
    this.getProps_().setProperty("BAKU_WORKER_ID", id);
    return id;
  },

  getWorkerKey_: function () {
    return String(this.getProps_().getProperty("BAKU_WORKER_KEY") || this.getAuthKey_()).trim();
  },

  shouldUseSignature_: function () {
    return String(this.getProps_().getProperty("BAKU_USE_SIGNATURE") || "false").toLowerCase() === "true";
  },

  isRebuildAllowed_: function () {
    return String(this.getProps_().getProperty("BAKU_ALLOW_REBUILD") || "false").toLowerCase() === "true";
  },

  maxLoopJobs_: function () {
    var n = Number(this.getProps_().getProperty("BAKU_MAX_LOOP_JOBS") || "6");
    if (!isFinite(n) || n < 1) n = 6;
    if (n > 50) n = 50;
    return n;
  },

  sha256Hex_: function (str) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str);
    return bytes
      .map(function (b) {
        var v = (b + 256) % 256;
        return (v < 16 ? "0" : "") + v.toString(16);
      })
      .join("");
  },

  signPayload_: function (mode, payload) {
    if (!this.shouldUseSignature_()) return payload;

    var workerId = String(payload.worker_id || "").trim();
    var key = this.getWorkerKey_();
    if (!workerId || !key) return payload;

    var ts = String(Math.floor(Date.now() / 1000));
    var nonce = Utilities.getUuid().replace(/-/g, "").slice(0, 16);
    var canonical = [mode, workerId, ts, nonce].join("|");
    var sig = this.sha256Hex_(canonical + "|" + key);

    payload.request_ts = ts;
    payload.nonce = nonce;
    payload.signature = sig;
    return payload;
  },

  postGateway_: function (mode, payload) {
    var url = this.getGatewayUrl_();
    var auth = this.getAuthKey_();
    if (!url) throw new Error("GATEWAY_WEBAPP_URL is empty");
    if (!auth) throw new Error("ARC_AUTH_KEY is empty");

    var body = Object.assign({}, payload || {}, {
      mode: mode,
      auth_key: auth,
      worker_id: this.getWorkerId_()
    });

    body = this.signPayload_(mode, body);

    var res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify(body)
    });

    var code = res.getResponseCode();
    var text = res.getContentText() || "";
    var json = {};
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = { raw: text };
    }

    if (code < 200 || code >= 300) {
      throw new Error("Gateway HTTP " + code + ": " + text.slice(0, 500));
    }

    if (json && json.status === "error") {
      throw new Error("Gateway API error: " + JSON.stringify(json));
    }

    return json;
  },

  heartbeatArc: function () {
    return this.postGateway_("arc_heartbeat", {
      executor: this.ARC_EXECUTOR,
      status: "online",
      version: "baku-bridge-3.0",
      target: "salvage"
    });
  },

  leaseArcOne: function () {
    return this.postGateway_("lease_job", {
      executor: this.ARC_EXECUTOR
    });
  },

  heartbeatMothership: function () {
    return this.postGateway_("mothership_heartbeat", {
      status: "online",
      version: "baku-bridge-3.0"
    });
  },

  pullMothershipOne: function () {
    return this.postGateway_("mothership_pull", {});
  },

  getAdminStatus_: function () {
    return this.postGateway_("admin_status", {});
  },

  reportArcResult_: function (job, text) {
    return this.postGateway_("arc_result", {
      qid: String(job.job_id || job.qid || ""),
      mission_id: String(job.job_id || job.qid || ""),
      target: String(job.target || "baku"),
      prompt: String(job.prompt || ""),
      text: String(text || ""),
      trace_id: String(job.trace_id || "")
    });
  },

  reportArcError_: function (job, errType, errData) {
    return this.postGateway_("arc_error", {
      qid: String(job.job_id || job.qid || ""),
      mission_id: String(job.job_id || job.qid || ""),
      error_type: String(errType || "BAKU_FAIL"),
      data: String(errData || ""),
      trace_id: String(job.trace_id || "")
    });
  },

  reportMothershipResult_: function (msg, text) {
    return this.postGateway_("mothership_result", {
      message_id: String(msg.message_id || ""),
      result: String(text || "")
    });
  },

  reportMothershipError_: function (msg, text) {
    return this.postGateway_("mothership_error", {
      message_id: String(msg.message_id || ""),
      error: String(text || "")
    });
  },

  fetchDeadJobs_: function (limit) {
    return this.postGateway_("baku_salvage_dead_jobs", {
      limit: limit || 10
    });
  },

  archiveDeadJobs_: function (jobIds) {
    return this.postGateway_("baku_archive_dead_jobs", {
      job_ids: jobIds
    });
  },

  enqueueArcJob_: function (params) {
    return this.postGateway_("baku_enqueue_arc", {
      prompt: String(params.prompt || ""),
      target: String(params.target || ""),
      script: String(params.script || ""),
      arc_mode: String(params.mode || ""),
      user: String(params.user || "")
    });
  },

  putMemory_: function (key, value, tags, source) {
    return this.postGateway_("gateway_memory_put", {
      key: String(key || ""),
      value: String(value || ""),
      tags: tags ? JSON.stringify(tags) : "",
      source: String(source || "baku_salvage")
    });
  },

  ensurePlaybookSheet_: function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName("BAKU_PLAYBOOK") || ss.insertSheet("BAKU_PLAYBOOK");
    if (sh.getLastRow() === 0) {
      sh.appendRow(["Enabled", "Priority", "Domain", "Pattern", "Actions", "Notes"]);
      sh.appendRow(["Y", 10, "ARC", "arc_execute_js", "scan_drive,system_map", "JS実行不能時の代替"]);
      sh.appendRow(["Y", 20, "ARC", "timeout|selector|dom|send_fail|fill_fail", "scan_drive,analyze_dna", "DOM系失敗の復旧"]);
      sh.appendRow(["Y", 30, "MOTHERSHIP", "backup|salvage|inventory|drive", "scan_drive,system_map", "母艦からの保守要求"]);
    }
    return sh;
  },

  loadPlaybookRules_: function () {
    var sh = this.ensurePlaybookSheet_();
    var rows = sh.getDataRange().getValues();
    if (rows.length <= 1) return [];
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (String(r[0] || "").toUpperCase() !== "Y") continue;
      var priority = Number(r[1] || 100);
      var domain = String(r[2] || "ANY").toUpperCase();
      var pattern = String(r[3] || "").trim();
      var actions = String(r[4] || "").split(",").map(function (x) { return String(x || "").trim(); }).filter(function (x) { return x; });
      if (!pattern || actions.length === 0) continue;
      out.push({ priority: isFinite(priority) ? priority : 100, domain: domain, pattern: pattern, actions: actions });
    }
    out.sort(function (a, b) { return a.priority - b.priority; });
    return out;
  },

  detectActions_: function (text, mode, domain) {
    var raw = String(text || "");
    var l = raw.toLowerCase();
    var d = String(domain || "ARC").toUpperCase();
    var m = String(mode || "").toLowerCase();
    var actions = [];

    var push = function (x) {
      if (actions.indexOf(x) < 0) actions.push(x);
    };

    // Playbook first
    var rules = this.loadPlaybookRules_();
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.domain !== "ANY" && rule.domain !== d) continue;
      var re = null;
      try {
        re = new RegExp(rule.pattern, "i");
      } catch (_) {
        re = null;
      }
      if (!re) continue;
      if (re.test(raw) || re.test(m)) {
        rule.actions.forEach(push);
      }
    }

    // Heuristic fallback
    if (m === "arc_refresh") push("scan_drive");
    if (m === "arc_screenshot") push("system_map");

    if (/scan|salvage|recover|inventory|backup|drive/.test(l)) push("scan_drive");
    if (/dna|extract|analy|profile|vault/.test(l)) push("analyze_dna");
    if (/map|architecture|topology|構成|地図/.test(l)) push("system_map");
    if (/patrol|auto\s*evo|進化/.test(l)) push("patrol");
    if (/rebuild|self\s*rebuild|復元/.test(l)) push("rebuild");

    if (actions.length === 0) {
      push("scan_drive");
      push("system_map");
    }
    return actions;
  },

  runAction_: function (action) {
    if (action === "scan_drive") {
      BAKU.fullScan();
      return { action: action, status: "ok" };
    }

    if (action === "analyze_dna") {
      var source = BAKU.generateCoreFile_ ? String(BAKU.generateCoreFile_() || "") : "";
      var dna = [];
      if (typeof METRON_DNA_ANALYST !== "undefined" && METRON_DNA_ANALYST.extract) {
        dna = METRON_DNA_ANALYST.extract(source, "BAKU_CORE");
      }
      return { action: action, status: "ok", count: (dna && dna.length) || 0 };
    }

    if (action === "system_map") {
      var map = "{}";
      if (typeof METRON_ARCHITECT !== "undefined" && METRON_ARCHITECT.generateSystemMap) {
        map = String(METRON_ARCHITECT.generateSystemMap() || "{}");
      }
      return { action: action, status: "ok", size: map.length };
    }

    if (action === "patrol") {
      if (typeof METRON_AUTO_EVO !== "undefined" && METRON_AUTO_EVO.patrol) {
        METRON_AUTO_EVO.patrol();
        return { action: action, status: "ok" };
      }
      return { action: action, status: "skip", reason: "not_available" };
    }

    if (action === "rebuild") {
      if (!this.isRebuildAllowed_()) return { action: action, status: "skip", reason: "disabled" };
      if (typeof METRON_EVO !== "undefined" && METRON_EVO.selfRebuildOS) {
        var r = METRON_EVO.selfRebuildOS();
        return { action: action, status: "ok", detail: r || {} };
      }
      return { action: action, status: "skip", reason: "not_available" };
    }

    return { action: action, status: "skip", reason: "unknown" };
  },

  createFollowup_: function (ctx) {
    if (String(ctx.domain) !== "ARC") return null;
    if (String(ctx.mode || "") === "arc_execute_js") {
      return {
        auto_enqueue: true,
        mode: "request_arc",
        executor: "ARC",
        target: "chatgpt",
        prompt: "BAKU salvage completed. Retry browser-side execution safely for original task: " + String(ctx.id || "")
      };
    }
    return null;
  },

  composeSalvageReport_: function (ctx) {
    var report = {
      engine: "BAKU_GATEWAY_BRIDGE",
      version: "3.0",
      domain: String(ctx.domain || "ARC"),
      id: String(ctx.id || ""),
      mode: String(ctx.mode || ""),
      trace_id: String(ctx.traceId || ""),
      worker_id: this.getWorkerId_(),
      actions: ctx.actions || [],
      outputs: ctx.outputs || [],
      prompt_preview: String(ctx.prompt || "").slice(0, 480),
      recommendation: "continue via Gateway orchestration",
      followup: this.createFollowup_(ctx),
      ts: new Date().toISOString()
    };

    return this.REPORT_PREFIX + JSON.stringify(report);
  },

  executeArcInstruction_: function (job) {
    var prompt = String(job.prompt || "");
    var mode = String(job.mode || "request_arc");
    var actions = this.detectActions_(prompt, mode, "ARC");
    var outputs = [];

    if (mode === "arc_execute_js") {
      outputs.push({ action: "arc_execute_js", status: "skip", reason: "browser_side_only" });
    }

    for (var i = 0; i < actions.length; i++) {
      outputs.push(this.runAction_(actions[i]));
    }

    return this.composeSalvageReport_({
      domain: "ARC",
      id: job.job_id || job.qid || "",
      mode: mode,
      traceId: job.trace_id || "",
      actions: actions,
      outputs: outputs,
      prompt: prompt
    });
  },

  executeMothershipInstruction_: function (msg) {
    var content = String(msg.content || "");
    var actions = this.detectActions_(content, "mothership", "MOTHERSHIP");
    var outputs = [];

    for (var i = 0; i < actions.length; i++) {
      outputs.push(this.runAction_(actions[i]));
    }

    return this.composeSalvageReport_({
      domain: "MOTHERSHIP",
      id: msg.message_id || "",
      mode: "mothership",
      traceId: "",
      actions: actions,
      outputs: outputs,
      prompt: content
    });
  },

  processArcOne: function () {
    var lease = this.leaseArcOne();
    if (!lease || lease.status === "empty" || !lease.instruction) {
      return { status: "empty", domain: "ARC" };
    }

    var job = lease.instruction;
    try {
      var result = this.executeArcInstruction_(job);
      this.reportArcResult_(job, result);
      return { status: "ok", domain: "ARC", id: job.job_id || job.qid || "" };
    } catch (e) {
      this.reportArcError_(job, "BAKU_EXEC_FAIL", String(e && e.message || e));
      return { status: "error", domain: "ARC", id: job.job_id || job.qid || "", error: String(e && e.message || e) };
    }
  },

  processMothershipOne: function () {
    var lease = this.pullMothershipOne();
    if (!lease || lease.status === "empty" || !lease.instruction) {
      return { status: "empty", domain: "MOTHERSHIP" };
    }

    var msg = lease.instruction;
    try {
      var result = this.executeMothershipInstruction_(msg);
      this.reportMothershipResult_(msg, result);
      return { status: "ok", domain: "MOTHERSHIP", id: msg.message_id || "" };
    } catch (e) {
      this.reportMothershipError_(msg, String(e && e.message || e));
      return { status: "error", domain: "MOTHERSHIP", id: msg.message_id || "", error: String(e && e.message || e) };
    }
  },

  runLoop: function (maxJobs) {
    this.ensureRecommendedDefaults_();
    var n = Number(maxJobs || this.maxLoopJobs_());
    if (!isFinite(n) || n < 1) n = 1;
    if (n > 50) n = 50;

    var admin = this.getAdminStatus_();
    var arcHb = this.heartbeatArc();
    var msHb = this.heartbeatMothership();
    if (admin && admin.autonomy_paused === true) {
      return {
        status: "paused",
        heartbeat_arc: arcHb && arcHb.status || "ok",
        heartbeat_mothership: msHb && msHb.status || "ok",
        processed: 0,
        arc_processed: 0,
        mothership_processed: 0,
        events: []
      };
    }
    var processed = 0;
    var arcProcessed = 0;
    var msProcessed = 0;
    var events = [];

    for (var i = 0; i < n; i++) {
      var first = (i % 2 === 0) ? this.processArcOne() : this.processMothershipOne();
      if (first && first.status !== "empty") {
        events.push(first);
        processed++;
        if (first.domain === "ARC") arcProcessed++; else msProcessed++;
      }

      var second = (i % 2 === 0) ? this.processMothershipOne() : this.processArcOne();
      if (second && second.status !== "empty") {
        events.push(second);
        processed++;
        if (second.domain === "ARC") arcProcessed++; else msProcessed++;
      }

      if ((!first || first.status === "empty") && (!second || second.status === "empty")) {
        break;
      }
    }

    return {
      status: "ok",
      heartbeat_arc: arcHb && arcHb.status || "ok",
      heartbeat_mothership: msHb && msHb.status || "ok",
      processed: processed,
      arc_processed: arcProcessed,
      mothership_processed: msProcessed,
      events: events.slice(-10)
    };
  }
};

function BAKU_GatewayHeartbeat() {
  var arc = BAKU_GATEWAY.heartbeatArc();
  var ms = BAKU_GATEWAY.heartbeatMothership();
  var res = { status: "ok", arc: arc, mothership: ms };
  Logger.log(res);
  return res;
}

function BAKU_ProcessGatewayJob() {
  var arc = BAKU_GATEWAY.processArcOne();
  var ms = BAKU_GATEWAY.processMothershipOne();
  var res = { status: "ok", arc: arc, mothership: ms };
  Logger.log(res);
  return res;
}

function BAKU_RunGatewayLoop() {
  var res = BAKU_GATEWAY.runLoop();
  Logger.log(res);
  return res;
}

function BAKU_SetupGatewayTrigger() {
  var fn = "BAKU_RunGatewayLoop";
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === fn) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger(fn).timeBased().everyMinutes(1).create();
}
