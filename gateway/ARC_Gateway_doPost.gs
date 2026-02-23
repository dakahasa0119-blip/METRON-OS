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

  const expectedAuth = props.getProperty("ARC_AUTH_KEY") || "";
  const requiresAuth = [
    "arc_result", "report_result",
    "arc_error", "report_error",
    "arc_learning",
    "arc_heartbeat", "register_worker", "lease_job",
    "arc_consult", "route_chat",
    "admin_status", "admin_cleanup"
  ];
  if (expectedAuth && requiresAuth.indexOf(mode) >= 0) {
    if (norm(data.auth_key) !== expectedAuth) {
      return jsonOut({ status: "error", error: "unauthorized" });
    }
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
    audit: ensureSheet("ARC_AUDIT", ["Timestamp", "TraceID", "Event", "JobID", "Worker", "Status", "Detail"]),
    dead: ensureSheet("ARC_DEAD_JOBS", ["Timestamp", "JobID", "TraceID", "Executor", "Target", "Prompt", "RetryCount", "ErrorType", "ErrorData", "FailedWorker", "Reason", "Payload"]),
    auditArchive: ensureSheet("ARC_AUDIT_ARCHIVE", ["ArchivedAt", "Timestamp", "TraceID", "Event", "JobID", "Worker", "Status", "Detail"])
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

    let route = "MOTHERSHIP";
    if (has("#arc") || has("@arc") || has("[arc]") || has("#proxy") || has("#baku") || has("@baku")) route = "ARC";
    if (has("#mother") || has("@mother") || has("#metron") || has("#osb")) route = "MOTHERSHIP";

    let executor = "AUTO";
    if (has("#baku") || has("@baku")) executor = "BAKU";
    else if (has("#arc") || has("@arc") || has("[arc]") || has("#proxy")) executor = "ARC";

    let target = "gemini";
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

  maybeRunDailyCleanup();

  if (mode === "arc_setup") {
    const setupSheets = (data.blueprint && data.blueprint.sheets) || {};
    Object.keys(setupSheets).forEach((name) => ensureSheet(name, setupSheets[name]));
    return textOut("Setup Success");
  }

  if (mode === "handshake") {
    return jsonOut({
      status: "ok",
      role: "gateway",
      version: "arc-gateway-18.0",
      control: "gateway_primary",
      lease_timeout_sec: leaseTimeoutSec,
      max_retry: maxRetry,
      retry_backoff_sec: retryBackoffSec,
      repair_executor: repairExecutor
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
    const routed = routePendingChatCommands();
    return jsonOut({ status: "ok", routed: routed.length, details: routed });
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
      gateway_version: "arc-gateway-18.0",
      lease_timeout_sec: leaseTimeoutSec,
      max_retry: maxRetry,
      retry_backoff_sec: retryBackoffSec,
      repair_executor: repairExecutor,
      jobs: counts,
      nodes: Math.max(0, sheets.nodes.getLastRow() - 1),
      dead_jobs: Math.max(0, sheets.dead.getLastRow() - 1),
      audit_rows: Math.max(0, sheets.audit.getLastRow() - 1)
    });
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
