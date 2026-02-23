function doPost(e) {
  let data = {};
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (_) {
    data = {};
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

  const MAX_CHAT_CONTENT = 4000;
  const MAX_USER = 64;
  const MAX_PROMPT = 8000;
  const TZ = "Asia/Tokyo";

  const ensureSheet = (name, header) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0 && header) sh.appendRow(header);
    return sh;
  };
  const jsonOut = (obj) => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  const textOut = (txt) => ContentService.createTextOutput(txt);
  const nowIso = () => new Date().toISOString();
  const norm = (v) => String(v || "").trim();
  const lower = (v) => norm(v).toLowerCase();
  const upper = (v) => norm(v).toUpperCase();
  const mode = norm(data.mode);

  const parseJsonSafe = (raw) => {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return { raw: String(raw || "") };
    }
  };

  const makeTraceId = () => "TRC_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  const toTraceId = (v) => {
    const t = norm(v);
    return /^TRC_[A-Za-z0-9_-]{6,64}$/.test(t) ? t : makeTraceId();
  };

  const leaseTimeoutSecRaw = parseInt(norm(props.getProperty("ARC_LEASE_TIMEOUT_SEC")) || "300", 10);
  const leaseTimeoutSec = Number.isFinite(leaseTimeoutSecRaw) && leaseTimeoutSecRaw >= 30 ? leaseTimeoutSecRaw : 300;
  const leaseTimeoutMs = leaseTimeoutSec * 1000;

  const maxRetryRaw = parseInt(norm(props.getProperty("ARC_MAX_RETRY")) || "2", 10);
  const maxRetry = Number.isFinite(maxRetryRaw) && maxRetryRaw >= 0 ? maxRetryRaw : 2;
  const retryBackoffSecRaw = parseInt(norm(props.getProperty("ARC_RETRY_BACKOFF_SEC")) || "30", 10);
  const retryBackoffSec = Number.isFinite(retryBackoffSecRaw) && retryBackoffSecRaw >= 5 ? retryBackoffSecRaw : 30;
  const repairExecutor = (() => {
    const v = upper(norm(props.getProperty("ARC_REPAIR_EXECUTOR") || "BAKU"));
    return v === "ARC" || v === "BAKU" || v === "AUTO" ? v : "BAKU";
  })();
  const defaultRoute = (() => {
    const v = upper(norm(props.getProperty("ARC_DEFAULT_ROUTE") || "MOTHERSHIP"));
    return v === "ARC" ? "ARC" : "MOTHERSHIP";
  })();
  const defaultExecutor = (() => {
    const v = upper(norm(props.getProperty("ARC_DEFAULT_EXECUTOR") || "AUTO"));
    return v === "ARC" || v === "BAKU" || v === "AUTO" ? v : "AUTO";
  })();
  const defaultTarget = (() => {
    const v = lower(norm(props.getProperty("ARC_DEFAULT_TARGET") || "gemini"));
    return v === "chatgpt" || v === "copilot" || v === "all" || v === "gemini" ? v : "gemini";
  })();
  const requireSignature = lower(norm(props.getProperty("ARC_REQUIRE_SIGNATURE") || "false")) === "true";
  const autonomyPaused = lower(norm(props.getProperty("ARC_AUTONOMY_PAUSED") || "false")) === "true";
  const deadAlertThresholdRaw = parseInt(norm(props.getProperty("ARC_DEAD_JOB_ALERT_THRESHOLD")) || "20", 10);
  const deadAlertThreshold = Number.isFinite(deadAlertThresholdRaw) && deadAlertThresholdRaw >= 1 ? deadAlertThresholdRaw : 20;
  const leaseAlertThresholdRaw = parseInt(norm(props.getProperty("ARC_LEASED_ALERT_THRESHOLD")) || "50", 10);
  const leaseAlertThreshold = Number.isFinite(leaseAlertThresholdRaw) && leaseAlertThresholdRaw >= 1 ? leaseAlertThresholdRaw : 50;
  const signatureWindowSecRaw = parseInt(norm(props.getProperty("ARC_SIGNATURE_WINDOW_SEC")) || "180", 10);
  const signatureWindowSec = Number.isFinite(signatureWindowSecRaw) && signatureWindowSecRaw >= 30 ? signatureWindowSecRaw : 180;
  const nonceTtlSecRaw = parseInt(norm(props.getProperty("ARC_NONCE_TTL_SEC")) || "300", 10);
  const nonceTtlSec = Number.isFinite(nonceTtlSecRaw) && nonceTtlSecRaw >= 60 ? nonceTtlSecRaw : 300;

  const parseKeyMap = (raw) => {
    const txt = norm(raw);
    if (!txt) return {};
    try {
      const obj = JSON.parse(txt);
      return obj && typeof obj === "object" ? obj : {};
    } catch (_) {
      return {};
    }
  };
  const workerAuthMap = parseKeyMap(props.getProperty("ARC_WORKER_AUTH_MAP"));
  const mothershipAuthMap = parseKeyMap(props.getProperty("MOTHERSHIP_WORKER_AUTH_MAP"));

  const parseAllowlist = (raw) => {
    const txt = norm(raw);
    if (!txt) return [];
    return txt.split(",").map((x) => norm(x)).filter((x) => x);
  };
  const arcWorkerAllowlist = parseAllowlist(props.getProperty("ARC_WORKER_ALLOWLIST"));
  const mothershipWorkerAllowlist = parseAllowlist(props.getProperty("MOTHERSHIP_WORKER_ALLOWLIST"));

  const expectedAuth = props.getProperty("ARC_AUTH_KEY") || "";
  const requiresAuth = [
    "arc_result", "report_result",
    "arc_error", "report_error",
    "arc_learning",
    "arc_heartbeat", "register_worker", "lease_job",
    "arc_consult", "route_chat",
    "mothership_submit", "mothership_heartbeat", "mothership_pull", "mothership_result", "mothership_error",
    "admin_status", "admin_cleanup", "admin_pause", "admin_resume"
  ];

  const getRequestTsMs = (v) => {
    const s = norm(v);
    if (!s) return NaN;
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      // Accept sec or ms.
      return s.length <= 10 ? n * 1000 : n;
    }
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  };
  const digestHex = (str) => {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str);
    return bytes.map((b) => {
      const v = (b + 256) % 256;
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  };
  const resolveSigningKey = (modeName, workerId) => {
    const w = norm(workerId);
    if (modeName.indexOf("mothership_") === 0) return norm(mothershipAuthMap[w] || expectedAuth);
    return norm(workerAuthMap[w] || expectedAuth);
  };
  const validateWorkerAllowlist = (modeName, workerId) => {
    const wid = norm(workerId);
    if (!wid) return { ok: true };
    if (modeName.indexOf("mothership_") === 0) {
      if (mothershipWorkerAllowlist.length > 0 && mothershipWorkerAllowlist.indexOf(wid) < 0) {
        return { ok: false, error: "worker_not_allowed" };
      }
      return { ok: true };
    }
    if (arcWorkerAllowlist.length > 0 && arcWorkerAllowlist.indexOf(wid) < 0) {
      return { ok: false, error: "worker_not_allowed" };
    }
    return { ok: true };
  };
  const validateSignature = (modeName, payload) => {
    if (!requireSignature || requiresAuth.indexOf(modeName) < 0) return { ok: true };
    const workerId = norm(payload.worker_id);
    if (!workerId) return { ok: false, error: "worker_id_required" };
    const tsRaw = norm(payload.request_ts);
    const nonce = norm(payload.nonce);
    const sig = lower(norm(payload.signature));
    if (!tsRaw || !nonce || !sig) return { ok: false, error: "signature_fields_required" };
    const tsMs = getRequestTsMs(tsRaw);
    if (!Number.isFinite(tsMs)) return { ok: false, error: "invalid_request_ts" };
    if (Math.abs(Date.now() - tsMs) > signatureWindowSec * 1000) return { ok: false, error: "signature_expired" };

    const cache = CacheService.getScriptCache();
    const nonceKey = "sig_nonce:" + modeName + ":" + workerId + ":" + nonce;
    if (cache.get(nonceKey)) return { ok: false, error: "replay_blocked" };

    const key = resolveSigningKey(modeName, workerId);
    if (!key) return { ok: false, error: "signing_key_missing" };
    const canonical = [modeName, workerId, tsRaw, nonce].join("|");
    const expected = digestHex(canonical + "|" + key);
    if (sig !== expected) return { ok: false, error: "bad_signature" };
    cache.put(nonceKey, "1", nonceTtlSec);
    return { ok: true };
  };

  if (expectedAuth && requiresAuth.indexOf(mode) >= 0) {
    if (norm(data.auth_key) !== expectedAuth) {
      return jsonOut({ status: "error", error: "unauthorized" });
    }
  }
  if (requiresAuth.indexOf(mode) >= 0) {
    const allow = validateWorkerAllowlist(mode, data.worker_id);
    if (!allow.ok) return jsonOut({ status: "error", error: allow.error });
    const sig = validateSignature(mode, data);
    if (!sig.ok) return jsonOut({ status: "error", error: sig.error });
  }

  const submitAuth = norm(props.getProperty("SUBMIT_AUTH_KEY"));
  if (submitAuth && mode === "submit_chat" && norm(data.submit_key) !== submitAuth) {
    return jsonOut({ status: "error", error: "submit_unauthorized" });
  }

  const sheets = {
    main: ensureSheet("MAIN_CHAT", ["Timestamp", "User", "Content", "Status", "Response", "MissionID"]),
    nodes: ensureSheet("ARC_NODES", ["LastSeen", "IP", "Port", "Status", "Capabilities", "Version"]),
    jobs: ensureSheet("ARC_JOBS", ["Timestamp", "JobID", "Worker", "Mode", "Payload", "Status", "LeasedAt"]),
    results: ensureSheet("ARC_RESULTS", ["Timestamp", "MissionID", "Target", "Prompt", "Result", "ImageURL"]),
    errors: ensureSheet("ARC_ERRORS", ["Timestamp", "QID", "Type", "Data"]),
    learning: ensureSheet("ARC_LEARNING", ["Timestamp", "Target", "Learned"]),
    mothership: ensureSheet("MOTHERSHIP_QUEUE", ["Timestamp", "MessageID", "User", "Content", "Status"]),
    mothershipNodes: ensureSheet("MOTHERSHIP_NODES", ["LastSeen", "WorkerID", "Status", "Version"]),
    audit: ensureSheet("ARC_AUDIT", ["Timestamp", "TraceID", "Event", "JobID", "Worker", "Status", "Detail"]),
    dead: ensureSheet("ARC_DEAD_JOBS", ["Timestamp", "JobID", "TraceID", "Executor", "Target", "Prompt", "RetryCount", "ErrorType", "ErrorData", "FailedWorker", "Reason", "Payload"]),
    auditArchive: ensureSheet("ARC_AUDIT_ARCHIVE", ["ArchivedAt", "Timestamp", "TraceID", "Event", "JobID", "Worker", "Status", "Detail"]),
    alerts: ensureSheet("ARC_ALERTS", ["Timestamp", "Level", "Type", "Message", "Value", "Threshold", "TraceID"])
  };

  const addAudit = (traceId, event, jobId, worker, status, detail) => {
    try {
      sheets.audit.appendRow([
        new Date(),
        norm(traceId),
        norm(event),
        norm(jobId),
        norm(worker),
        norm(status),
        norm(detail)
      ]);
    } catch (_) {
      // keep main flow alive
    }
  };
  const addAlert = (level, type, message, value, threshold, traceId) => {
    const key = "alert:" + String(type) + ":" + Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return;
    cache.put(key, "1", 60 * 30); // de-dup for 30 minutes
    sheets.alerts.appendRow([
      new Date(),
      norm(level || "WARN"),
      norm(type),
      norm(message),
      String(value || ""),
      String(threshold || ""),
      norm(traceId)
    ]);
  };

  const evaluateRuntimeAlerts = () => {
    const rows = sheets.jobs.getDataRange().getValues();
    let leased = 0;
    for (let i = 1; i < rows.length; i++) {
      if (lower(rows[i][5]) === "leased") leased++;
    }
    const dead = Math.max(0, sheets.dead.getLastRow() - 1);
    if (dead >= deadAlertThreshold) {
      addAlert("WARN", "dead_jobs_threshold", "Dead jobs reached threshold", dead, deadAlertThreshold, "");
    }
    if (leased >= leaseAlertThreshold) {
      addAlert("WARN", "leased_jobs_threshold", "Leased jobs reached threshold", leased, leaseAlertThreshold, "");
    }
  };

  const todayKey = () => Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");

  const runDailyCleanup = () => {
    const retentionRaw = parseInt(norm(props.getProperty("ARC_AUDIT_RETENTION_DAYS")) || "14", 10);
    const retentionDays = Number.isFinite(retentionRaw) && retentionRaw >= 1 ? retentionRaw : 14;
    const thresholdMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const rows = sheets.audit.getDataRange().getValues();
    if (rows.length <= 1) return { archived: 0, kept: 0, retention_days: retentionDays };

    const kept = [rows[0]];
    const archived = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const ts = new Date(row[0]).getTime();
      if (Number.isFinite(ts) && ts < thresholdMs) {
        archived.push([new Date()].concat(row));
      } else {
        kept.push(row);
      }
    }

    if (archived.length > 0) {
      sheets.auditArchive.getRange(sheets.auditArchive.getLastRow() + 1, 1, archived.length, archived[0].length).setValues(archived);
      sheets.audit.clearContents();
      sheets.audit.getRange(1, 1, kept.length, kept[0].length).setValues(kept);
    }

    props.setProperty("ARC_LAST_DAILY_CLEANUP", todayKey());
    addAudit("", "DAILY_CLEANUP", "", "", "ok", "archived=" + archived.length + ",kept=" + (kept.length - 1));
    return { archived: archived.length, kept: kept.length - 1, retention_days: retentionDays };
  };

  const maybeRunDailyCleanup = () => {
    const done = norm(props.getProperty("ARC_LAST_DAILY_CLEANUP"));
    if (done === todayKey()) return;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return;
    try {
      const done2 = norm(props.getProperty("ARC_LAST_DAILY_CLEANUP"));
      if (done2 !== todayKey()) runDailyCleanup();
    } finally {
      lock.releaseLock();
    }
  };

  const parseCommandTags = (text) => {
    const raw = norm(text);
    const l = raw.toLowerCase();
    const has = (t) => l.indexOf(t) >= 0;

    let route = defaultRoute;
    if (has("#arc") || has("@arc") || has("[arc]") || has("#proxy") || has("#baku") || has("@baku")) route = "ARC";
    if (has("#mother") || has("@mother") || has("#metron") || has("#osb")) route = "MOTHERSHIP";

    let executor = defaultExecutor;
    if (has("#baku") || has("@baku")) executor = "BAKU";
    else if (has("#arc") || has("@arc") || has("[arc]") || has("#proxy")) executor = "ARC";

    let target = defaultTarget;
    if (has("#chatgpt") || has("@chatgpt")) target = "chatgpt";
    else if (has("#copilot") || has("@copilot")) target = "copilot";
    else if (has("#all") || has("@all")) target = "ALL";
    else if (has("#gemini") || has("@gemini")) target = "gemini";

    let opMode = "request_arc";
    if (has("#refresh")) opMode = "arc_refresh";
    else if (has("#screenshot") || has("#shot")) opMode = "arc_screenshot";

    let script = "";
    const jsStart = raw.indexOf("```js");
    if (jsStart >= 0) {
      const jsEnd = raw.indexOf("```", jsStart + 5);
      if (jsEnd > jsStart) {
        script = raw.substring(jsStart + 5, jsEnd).trim();
        if (script) opMode = "arc_execute_js";
      }
    }

    let cleanPrompt = raw
      .replace(/#[a-zA-Z0-9_:-]+/g, " ")
      .replace(/@[a-zA-Z0-9_:-]+/g, " ")
      .replace(/\[arc\]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleanPrompt) cleanPrompt = raw;
    if (cleanPrompt.length > MAX_PROMPT) cleanPrompt = cleanPrompt.slice(0, MAX_PROMPT);

    return { route: route, target: target, opMode: opMode, script: script, prompt: cleanPrompt, executor: executor };
  };

  const upsertMothershipNode = (workerId, status, version) => {
    const wid = norm(workerId);
    if (!wid) return;
    const rows = sheets.mothershipNodes.getDataRange().getValues();
    let found = -1;
    for (let i = 1; i < rows.length; i++) {
      if (norm(rows[i][1]) === wid) {
        found = i + 1;
        break;
      }
    }
    const row = [new Date(), wid, norm(status || "online"), norm(version)];
    if (found > 0) sheets.mothershipNodes.getRange(found, 1, 1, row.length).setValues([row]);
    else sheets.mothershipNodes.appendRow(row);
  };

  const claimMothershipMessage = (workerId) => {
    if (autonomyPaused) return null;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return null;
    try {
      const rows = sheets.mothership.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        const status = lower(rows[i][4]);
        if (status !== "pending") continue;
        const msgId = norm(rows[i][1]);
        const user = norm(rows[i][2]);
        const content = norm(rows[i][3]);
        sheets.mothership.getRange(i + 1, 5).setValue("leased:" + norm(workerId));
        addAudit("", "MOTHERSHIP_LEASED", msgId, norm(workerId), "leased", user);
        return { message_id: msgId, user: user, content: content };
      }
      return null;
    } finally {
      lock.releaseLock();
    }
  };

  const completeMothershipMessage = (messageId, isError, workerId) => {
    const mid = norm(messageId);
    if (!mid) return false;
    const rows = sheets.mothership.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (norm(rows[i][1]) !== mid) continue;
      sheets.mothership.getRange(i + 1, 5).setValue(isError ? "error" : "done");
      addAudit("", "MOTHERSHIP_DONE", mid, norm(workerId), isError ? "error" : "done", "");
      return true;
    }
    return false;
  };

  const enqueueArcJob = (job) => {
    const jobId = norm(job.jobId) || ("JOB_" + Utilities.getUuid().slice(0, 8));
    const traceId = toTraceId(job.traceId);
    const retryCountRaw = parseInt(norm(job.retryCount) || "0", 10);
    const retryCount = Number.isFinite(retryCountRaw) && retryCountRaw >= 0 ? retryCountRaw : 0;
    const payload = {
      qid: norm(job.qid) || jobId,
      target: norm(job.target) || "gemini",
      prompt: norm(job.prompt).slice(0, MAX_PROMPT),
      script: norm(job.script),
      executor: norm(job.executor) || "AUTO",
      requested_by: norm(job.user) || "gateway",
      trace_id: traceId,
      retry_count: retryCount,
      max_retry: maxRetry,
      ts: nowIso()
    };
    sheets.jobs.appendRow([new Date(), jobId, norm(job.workerId), norm(job.mode) || "request_arc", JSON.stringify(payload), "pending", ""]);
    addAudit(traceId, "JOB_ENQUEUED", jobId, norm(job.workerId), "pending", payload.executor + " / " + payload.target + " / retry=" + retryCount);
    return { jobId: jobId, traceId: traceId, payload: payload };
  };

  const findJobRowById = (jobId) => {
    const rows = sheets.jobs.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (norm(rows[i][1]) === norm(jobId)) {
        return { rowIndex: i + 1, row: rows[i], payload: parseJsonSafe(norm(rows[i][4])) };
      }
    }
    return null;
  };

  const markDeadJob = (jobId, traceId, failedWorker, errorType, errorData, reason) => {
    const found = findJobRowById(jobId);
    if (!found) return;
    const row = found.row;
    const payload = found.payload;
    sheets.jobs.getRange(found.rowIndex, 6).setValue("dead");
    if (!norm(row[6])) sheets.jobs.getRange(found.rowIndex, 7).setValue(new Date());

    sheets.dead.appendRow([
      new Date(),
      norm(jobId),
      norm(traceId) || norm(payload.trace_id),
      norm(payload.executor),
      norm(payload.target),
      norm(payload.prompt).slice(0, MAX_PROMPT),
      norm(payload.retry_count),
      norm(errorType),
      norm(errorData),
      norm(failedWorker),
      norm(reason),
      JSON.stringify(payload)
    ]);
    addAudit(norm(traceId) || norm(payload.trace_id), "JOB_DEAD", norm(jobId), norm(failedWorker), "dead", norm(reason));
  };

  const tryScheduleRetry = (jobId, traceId, errorType, errorData, failedWorker) => {
    const found = findJobRowById(jobId);
    if (!found) return { retried: false, reason: "job_not_found" };

    const row = found.row;
    const payload = found.payload;
    const retryCountRaw = parseInt(norm(payload.retry_count) || "0", 10);
    const retryCount = Number.isFinite(retryCountRaw) && retryCountRaw >= 0 ? retryCountRaw : 0;

    if (retryCount >= maxRetry) {
      markDeadJob(jobId, traceId, failedWorker, errorType, errorData, "retry_exhausted");
      return { retried: false, reason: "retry_exhausted", retry_count: retryCount };
    }

    const nextRetryAt = new Date(Date.now() + retryBackoffSec * 1000).toISOString();
    payload.retry_count = retryCount + 1;
    payload.last_error = norm(errorType);
    payload.last_error_data = norm(errorData).slice(0, 1200);
    payload.next_retry_at = nextRetryAt;

    // Repair path can be rerouted to BAKU (default) so BAKU can salvage failed jobs.
    payload.executor = repairExecutor;

    const keepWorker = lower(payload.pin_worker) === "true";
    sheets.jobs.getRange(found.rowIndex, 5).setValue(JSON.stringify(payload));
    sheets.jobs.getRange(found.rowIndex, 6).setValue("pending");
    sheets.jobs.getRange(found.rowIndex, 7).setValue("");
    if (!keepWorker) sheets.jobs.getRange(found.rowIndex, 3).setValue("");

    addAudit(norm(traceId) || norm(payload.trace_id), "JOB_RETRY_SCHEDULED", norm(jobId), norm(failedWorker), "pending", "retry=" + payload.retry_count + ",executor=" + payload.executor);
    return { retried: true, retry_count: payload.retry_count, next_retry_at: nextRetryAt, executor: payload.executor };
  };

  const routeOneChatRow = (rowIndex, rowValues) => {
    const content = norm(rowValues[2]);
    const status = lower(rowValues[3]);
    const user = norm(rowValues[1]) || "operator";
    const missionId = norm(rowValues[5]);
    if (!content) return null;
    if (status && status !== "new" && status !== "pending") return null;

    const cmd = parseCommandTags(content);
    const traceId = toTraceId(missionId);

    if (cmd.route === "ARC") {
      const effectiveMode = cmd.opMode;
      const jobRes = enqueueArcJob({
        jobId: missionId || ("CHAT_" + rowIndex + "_" + Date.now()),
        qid: missionId || ("CHAT_" + rowIndex),
        target: cmd.target,
        prompt: cmd.prompt,
        script: cmd.script,
        mode: effectiveMode,
        executor: cmd.executor,
        user: user,
        workerId: "",
        traceId: traceId,
        retryCount: 0
      });
      sheets.main.getRange(rowIndex, 4).setValue("QUEUED_ARC");
      sheets.main.getRange(rowIndex, 5).setValue("ARC queued: " + effectiveMode + " / " + cmd.target + " / " + cmd.executor + " / " + jobRes.traceId);
      sheets.main.getRange(rowIndex, 6).setValue(jobRes.jobId);
      return { routed: "ARC", jobId: jobRes.jobId, mode: effectiveMode, traceId: jobRes.traceId };
    }

    const msgId = missionId || ("MS_" + rowIndex + "_" + Date.now());
    sheets.mothership.appendRow([new Date(), msgId, user, content, "pending"]);
    sheets.main.getRange(rowIndex, 4).setValue("ROUTED_MOTHERSHIP");
    sheets.main.getRange(rowIndex, 5).setValue("Forwarded to MOTHERSHIP / " + traceId);
    sheets.main.getRange(rowIndex, 6).setValue(msgId);
    addAudit(traceId, "MOTHERSHIP_ROUTED", msgId, "", "pending", user);
    return { routed: "MOTHERSHIP", jobId: msgId, mode: "mothership_queue", traceId: traceId };
  };

  const routePendingChatCommands = () => {
    const rows = sheets.main.getDataRange().getValues();
    const routed = [];
    for (let i = 1; i < rows.length; i++) {
      const rowIndex = i + 1;
      const res = routeOneChatRow(rowIndex, rows[i]);
      if (res) routed.push(res);
    }
    return routed;
  };

  const requeueExpiredLeases = () => {
    const rows = sheets.jobs.getDataRange().getValues();
    const now = Date.now();
    let recovered = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const status = lower(row[5]);
      if (status !== "leased") continue;
      const leasedAt = new Date(row[6]).getTime();
      if (!Number.isFinite(leasedAt) || now - leasedAt < leaseTimeoutMs) continue;

      const payload = parseJsonSafe(norm(row[4]));
      const keepWorker = lower(payload.pin_worker) === "true";
      if (!keepWorker) sheets.jobs.getRange(i + 1, 3).setValue("");
      sheets.jobs.getRange(i + 1, 6).setValue("pending");
      sheets.jobs.getRange(i + 1, 7).setValue("");
      recovered++;
      addAudit(norm(payload.trace_id), "LEASE_EXPIRED", norm(row[1]), norm(row[2]), "pending", "timeout_sec=" + leaseTimeoutSec);
    }
    return recovered;
  };

  const claimNextInstruction = (workerId, consumer) => {
    if (autonomyPaused) return null;
    const lock = LockService.getScriptLock();
    const locked = lock.tryLock(5000);
    if (!locked) {
      addAudit("", "LEASE_LOCK_TIMEOUT", "", workerId, "busy", consumer);
      return null;
    }

    try {
      requeueExpiredLeases();
      routePendingChatCommands();

      const rows = sheets.jobs.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowWorker = norm(row[2]);
        const rowMode = norm(row[3]) || "request_arc";
        const payloadRaw = norm(row[4]);
        const status = lower(row[5]);
        if (status !== "pending") continue;

        if (rowWorker && (!workerId || rowWorker !== workerId)) continue;

        const payload = parseJsonSafe(payloadRaw);
        const wanted = upper(payload.executor || "AUTO");
        const mine = upper(consumer || "ARC");
        if (wanted !== "AUTO" && wanted !== mine) continue;

        const nextRetryAtMs = new Date(norm(payload.next_retry_at)).getTime();
        if (Number.isFinite(nextRetryAtMs) && Date.now() < nextRetryAtMs) continue;

        sheets.jobs.getRange(i + 1, 6).setValue("leased");
        sheets.jobs.getRange(i + 1, 7).setValue(new Date());
        if (!rowWorker && workerId) sheets.jobs.getRange(i + 1, 3).setValue(workerId);

        addAudit(norm(payload.trace_id), "JOB_LEASED", norm(row[1]), workerId, "leased", mine);
        return Object.assign({ mode: rowMode, job_id: norm(row[1]) }, payload);
      }
      return null;
    } finally {
      lock.releaseLock();
    }
  };

  const findTraceByMissionId = (missionId) => {
    const found = findJobRowById(missionId);
    if (!found) return "";
    return norm(found.payload.trace_id);
  };

  const completeLinkedChat = (missionId, output, type) => {
    const mid = norm(missionId);
    if (!mid) return;
    const rows = sheets.main.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (norm(rows[i][5]) !== mid) continue;
      sheets.main.getRange(i + 1, 4).setValue(type === "error" ? "ARC_ERROR" : "ARC_DONE");
      sheets.main.getRange(i + 1, 5).setValue(output);
      return;
    }
  };

  const completeArcJob = (missionId, status) => {
    const found = findJobRowById(missionId);
    if (!found) return;
    const row = found.row;
    sheets.jobs.getRange(found.rowIndex, 6).setValue(status);
    if (!norm(row[6])) sheets.jobs.getRange(found.rowIndex, 7).setValue(new Date());
    addAudit(norm(found.payload.trace_id), "JOB_COMPLETED", norm(missionId), norm(row[2]), status, "");
  };

  const parseBakuStructuredReport = (text) => {
    const raw = norm(text);
    const prefix = "BAKU_REPORT_JSON:";
    if (!raw.startsWith(prefix)) return null;
    try {
      const obj = JSON.parse(raw.substring(prefix.length));
      return obj && typeof obj === "object" ? obj : null;
    } catch (_) {
      return null;
    }
  };

  const maybeEnqueueBakuFollowup = (missionId, traceId, bakuReport) => {
    if (!bakuReport || !bakuReport.followup) return null;
    const enabled = lower(norm(props.getProperty("ARC_ENABLE_BAKU_FOLLOWUP") || "false")) === "true";
    if (!enabled) return null;

    const follow = bakuReport.followup;
    if (follow.auto_enqueue !== true) return null;
    const modeName = norm(follow.mode) || "request_arc";
    const target = lower(norm(follow.target) || "chatgpt");
    const executor = upper(norm(follow.executor) || "ARC");
    const prompt = norm(follow.prompt || "");
    if (!prompt) return null;

    const parent = norm(missionId);
    const followupId = parent ? (parent + "_FU_" + Utilities.getUuid().slice(0, 6)) : ("FU_" + Utilities.getUuid().slice(0, 8));
    const enq = enqueueArcJob({
      jobId: followupId,
      qid: followupId,
      target: target,
      prompt: prompt,
      script: "",
      mode: modeName,
      executor: executor,
      user: "baku_followup",
      workerId: "",
      traceId: norm(traceId) || norm(bakuReport.trace_id),
      retryCount: 0
    });
    addAudit(enq.traceId, "BAKU_FOLLOWUP_ENQUEUED", enq.jobId, "", "pending", executor + " / " + target);
    return enq;
  };

  maybeRunDailyCleanup();
  evaluateRuntimeAlerts();

  if (mode === "arc_setup") {
    const setupSheets = (data.blueprint && data.blueprint.sheets) || {};
    Object.keys(setupSheets).forEach((name) => ensureSheet(name, setupSheets[name]));
    return textOut("Setup Success");
  }

  if (mode === "handshake") {
    return jsonOut({
      status: "ok",
      role: "gateway",
      version: "arc-gateway-20.0",
      control: "gateway_primary",
      lease_timeout_sec: leaseTimeoutSec,
      max_retry: maxRetry,
      retry_backoff_sec: retryBackoffSec,
      repair_executor: repairExecutor,
      default_route: defaultRoute,
      require_signature: requireSignature,
      autonomy_paused: autonomyPaused
    });
  }

  if (mode === "submit_chat") {
    const user = norm(data.user || "operator").slice(0, MAX_USER);
    const content = norm(data.content);
    if (!content) return jsonOut({ status: "error", error: "content_required" });
    if (content.length > MAX_CHAT_CONTENT) return jsonOut({ status: "error", error: "content_too_large" });
    sheets.main.appendRow([new Date(), user, content, "NEW", "", ""]);
    addAudit(toTraceId(data.trace_id), "CHAT_SUBMITTED", "", "", "new", user);
    return jsonOut({ status: "ok" });
  }

  if (mode === "route_chat") {
    if (autonomyPaused) return jsonOut({ status: "paused", routed: 0 });
    const routed = routePendingChatCommands();
    return jsonOut({ status: "ok", routed: routed.length, details: routed });
  }

  if (mode === "mothership_submit") {
    const user = norm(data.user || "mothership");
    const content = norm(data.content);
    if (!content) return jsonOut({ status: "error", error: "content_required" });
    const msgId = norm(data.message_id) || ("MS_" + Utilities.getUuid().slice(0, 8));
    sheets.mothership.appendRow([new Date(), msgId, user, content, "pending"]);
    addAudit(norm(data.trace_id), "MOTHERSHIP_SUBMIT", msgId, "", "pending", user);
    return jsonOut({ status: "ok", message_id: msgId });
  }

  if (mode === "mothership_heartbeat") {
    const workerId = norm(data.worker_id);
    upsertMothershipNode(workerId, data.status || "online", data.version || "");
    const instruction = claimMothershipMessage(workerId);
    return jsonOut(instruction ? { status: "ok", instruction: instruction } : { status: "ok" });
  }

  if (mode === "mothership_pull") {
    const workerId = norm(data.worker_id);
    const instruction = claimMothershipMessage(workerId);
    return jsonOut(instruction ? { status: "ok", instruction: instruction } : { status: "empty" });
  }

  if (mode === "mothership_result") {
    const messageId = norm(data.message_id);
    const output = norm(data.result);
    if (!messageId) return jsonOut({ status: "error", error: "message_id_required" });
    const ok = completeMothershipMessage(messageId, false, norm(data.worker_id));
    if (output) sheets.main.appendRow([new Date(), "MOTHERSHIP", output, "DONE", "", messageId]);
    return jsonOut({ status: ok ? "ok" : "not_found" });
  }

  if (mode === "mothership_error") {
    const messageId = norm(data.message_id);
    const output = norm(data.error || data.data || "mothership_error");
    if (!messageId) return jsonOut({ status: "error", error: "message_id_required" });
    const ok = completeMothershipMessage(messageId, true, norm(data.worker_id));
    sheets.main.appendRow([new Date(), "MOTHERSHIP", "[ERR] " + output, "ERROR", "", messageId]);
    return jsonOut({ status: ok ? "ok" : "not_found" });
  }

  if (mode === "admin_status") {
    const rows = sheets.jobs.getDataRange().getValues();
    const counts = { pending: 0, leased: 0, done: 0, error: 0, dead: 0, other: 0 };
    for (let i = 1; i < rows.length; i++) {
      const s = lower(rows[i][5]);
      if (counts.hasOwnProperty(s)) counts[s]++;
      else counts.other++;
    }
    return jsonOut({
      status: "ok",
      gateway_version: "arc-gateway-20.0",
      lease_timeout_sec: leaseTimeoutSec,
      max_retry: maxRetry,
      retry_backoff_sec: retryBackoffSec,
      repair_executor: repairExecutor,
      default_route: defaultRoute,
      default_executor: defaultExecutor,
      default_target: defaultTarget,
      require_signature: requireSignature,
      autonomy_paused: autonomyPaused,
      jobs: counts,
      nodes: Math.max(0, sheets.nodes.getLastRow() - 1),
      dead_jobs: Math.max(0, sheets.dead.getLastRow() - 1),
      audit_rows: Math.max(0, sheets.audit.getLastRow() - 1),
      mothership_nodes: Math.max(0, sheets.mothershipNodes.getLastRow() - 1)
    });
  }

  if (mode === "admin_pause") {
    props.setProperty("ARC_AUTONOMY_PAUSED", "true");
    addAudit(norm(data.trace_id), "AUTONOMY_PAUSED", "", norm(data.worker_id), "ok", "manual");
    return jsonOut({ status: "ok", autonomy_paused: true });
  }

  if (mode === "admin_resume") {
    props.setProperty("ARC_AUTONOMY_PAUSED", "false");
    addAudit(norm(data.trace_id), "AUTONOMY_RESUMED", "", norm(data.worker_id), "ok", "manual");
    return jsonOut({ status: "ok", autonomy_paused: false });
  }

  if (mode === "admin_cleanup") {
    const res = runDailyCleanup();
    return jsonOut({ status: "ok", cleanup: res });
  }

  if (mode === "arc_result" || mode === "report_result") {
    const missionId = norm(data.qid || data.mission_id);
    const result = norm(data.text);
    const traceId = norm(data.trace_id) || findTraceByMissionId(missionId);
    sheets.results.appendRow([new Date(), missionId, data.target || "", data.prompt || "", result, data.image || ""]);
    completeArcJob(missionId, "done");
    completeLinkedChat(missionId, result, "result");
    const bakuReport = parseBakuStructuredReport(result);
    if (bakuReport) {
      addAudit(traceId, "BAKU_REPORT_PARSED", missionId, norm(data.worker_id), "ok", norm(bakuReport.domain) + " / " + norm(bakuReport.mode));
      maybeEnqueueBakuFollowup(missionId, traceId, bakuReport);
    }
    addAudit(traceId, "ARC_RESULT", missionId, norm(data.worker_id), "done", norm(data.target));
    return jsonOut({ status: "ok", trace_id: traceId });
  }

  if (mode === "arc_error" || mode === "report_error") {
    const missionId = norm(data.qid || data.mission_id);
    const err = norm(data.error_type);
    const errData = norm(data.data);
    const traceId = norm(data.trace_id) || findTraceByMissionId(missionId);
    const workerId = norm(data.worker_id);

    sheets.errors.appendRow([new Date(), missionId, err, errData]);
    completeLinkedChat(missionId, "[" + err + "] " + errData, "error");

    const retry = tryScheduleRetry(missionId, traceId, err, errData, workerId);
    if (retry.retried) {
      addAudit(traceId, "ARC_ERROR_RETRY", missionId, workerId, "pending", "retry=" + retry.retry_count + ",executor=" + retry.executor);
      return jsonOut({ status: "retry_scheduled", trace_id: traceId, retry: retry });
    }

    completeArcJob(missionId, "error");
    addAudit(traceId, "ARC_ERROR", missionId, workerId, "error", err + " / " + retry.reason);
    return jsonOut({ status: "ok", trace_id: traceId, retry: retry });
  }

  if (mode === "arc_learning") {
    sheets.learning.appendRow([new Date(), data.target || "", data.learned || ""]);
    addAudit(norm(data.trace_id), "ARC_LEARNING", "", norm(data.worker_id), "ok", norm(data.target));
    return jsonOut({ status: "ok" });
  }

  if (mode === "arc_heartbeat" || mode === "register_worker") {
    const ip = norm(data.ip);
    const port = norm(data.port);
    const workerId = norm(data.worker_id) || (ip && port ? (ip + ":" + port) : "");
    const consumer = upper(data.executor || "ARC");
    const all = sheets.nodes.getDataRange().getValues();
    let foundRow = -1;
    for (let i = 1; i < all.length; i++) {
      if (norm(all[i][1]) === ip && norm(all[i][2]) === port) {
        foundRow = i + 1;
        break;
      }
    }
    const row = [new Date(), ip, port, data.status || "", data.target || "", data.version || ""];
    if (foundRow > 0) sheets.nodes.getRange(foundRow, 1, 1, row.length).setValues([row]);
    else sheets.nodes.appendRow(row);

    const instruction = claimNextInstruction(workerId, consumer);
    addAudit(norm(data.trace_id), "ARC_HEARTBEAT", "", workerId, "ok", consumer);
    return jsonOut(instruction ? { status: "ok", instruction: instruction } : { status: "ok" });
  }

  if (mode === "lease_job") {
    const workerId = norm(data.worker_id);
    const consumer = upper(data.executor || "ARC");
    const instruction = claimNextInstruction(workerId, consumer);
    return jsonOut(instruction ? { status: "ok", instruction: instruction } : { status: "empty" });
  }

  if (mode === "arc_consult") {
    return jsonOut({ advice: "" });
  }

  return jsonOut({ status: "ok" });
}
