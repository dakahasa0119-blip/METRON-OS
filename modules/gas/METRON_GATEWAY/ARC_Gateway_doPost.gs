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
  const MAX_MEMORY_KEY = 128;
  const MAX_MEMORY_VALUE = 4000;
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
  const leaseExpireMaxRaw = parseInt(norm(props.getProperty("ARC_LEASE_EXPIRE_MAX")) || "2", 10);
  const leaseExpireMax = Number.isFinite(leaseExpireMaxRaw) && leaseExpireMaxRaw >= 1 ? leaseExpireMaxRaw : 2;
  const pendingTimeoutSecRaw = parseInt(norm(props.getProperty("ARC_PENDING_TIMEOUT_SEC")) || "420", 10);
  const pendingTimeoutSec = Number.isFinite(pendingTimeoutSecRaw) && pendingTimeoutSecRaw >= 60 ? pendingTimeoutSecRaw : 420;
  const pendingTimeoutMs = pendingTimeoutSec * 1000;
  const targetFailoverEnabled = lower(norm(props.getProperty("ARC_TARGET_FAILOVER_ENABLED") || "true")) === "true";

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

  const ensureRecommendedDefaults = () => {
    const defaults = {
      ARC_DEFAULT_ROUTE: "ARC",
      ARC_DEFAULT_EXECUTOR: "AUTO",
      ARC_DEFAULT_TARGET: "chatgpt",
      ARC_REPAIR_EXECUTOR: "BAKU",
      ARC_LEASE_TIMEOUT_SEC: "180",
      ARC_PENDING_TIMEOUT_SEC: "420",
      ARC_TARGET_FAILOVER_ENABLED: "true",
      ARC_MAX_RETRY: "2",
      ARC_RETRY_BACKOFF_SEC: "30",
      ARC_AUDIT_RETENTION_DAYS: "14",
      ARC_ENABLE_BAKU_FOLLOWUP: "true",
      ARC_AUTONOMY_PAUSED: "false",
      ARC_DEAD_JOB_ALERT_THRESHOLD: "20",
      ARC_LEASED_ALERT_THRESHOLD: "50",
      ARC_REQUIRE_SIGNATURE: "false",
      ARC_SIGNATURE_WINDOW_SEC: "180",
      ARC_NONCE_TTL_SEC: "300"
      ,ARC_LEASE_EXPIRE_MAX: "2"
    };
    Object.keys(defaults).forEach((k) => {
      if (!norm(props.getProperty(k))) props.setProperty(k, defaults[k]);
    });
  };

  const expectedAuth = props.getProperty("ARC_AUTH_KEY") || "";
  const requiresAuth = [
    "arc_result", "report_result",
    "arc_error", "report_error",
    "arc_learning",
    "arc_heartbeat", "register_worker", "lease_job",
    "arc_consult", "route_chat",
    "mothership_submit", "mothership_heartbeat", "mothership_pull", "mothership_result", "mothership_error",
    "admin_status", "admin_cleanup", "admin_pause", "admin_resume", "admin_recover_queues", "admin_debug_snapshot", "admin_job_probe", "admin_chat_probe", "admin_mission_timing", "admin_set_timeouts",
    "gateway_memory_put", "gateway_memory_get", "memory_put", "memory_get",
    "arc_memory_put", "arc_memory_get", "arc_short_memory_put", "arc_short_memory_get"
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
    nodes: ensureSheet("ARC_NODES", ["LastSeen", "IP", "Port", "Status", "Capabilities", "Version", "WorkerID", "Executor", "CurrentHost", "CurrentUrl", "CurrentTitle", "HudTail"]),
    jobs: ensureSheet("ARC_JOBS", ["Timestamp", "JobID", "Worker", "Mode", "Payload", "Status", "LeasedAt"]),
    results: ensureSheet("ARC_RESULTS", ["Timestamp", "MissionID", "Target", "Prompt", "Result", "ImageURL"]),
    errors: ensureSheet("ARC_ERRORS", ["Timestamp", "QID", "Type", "Data"]),
    learning: ensureSheet("ARC_LEARNING", ["Timestamp", "Target", "Learned"]),
    mothership: ensureSheet("MOTHERSHIP_QUEUE", ["Timestamp", "MessageID", "User", "Content", "Status"]),
    mothershipNodes: ensureSheet("MOTHERSHIP_NODES", ["LastSeen", "WorkerID", "Status", "Version"]),
    audit: ensureSheet("ARC_AUDIT", ["Timestamp", "TraceID", "Event", "JobID", "Worker", "Status", "Detail"]),
    dead: ensureSheet("ARC_DEAD_JOBS", ["Timestamp", "JobID", "TraceID", "Executor", "Target", "Prompt", "RetryCount", "ErrorType", "ErrorData", "FailedWorker", "Reason", "Payload"]),
    auditArchive: ensureSheet("ARC_AUDIT_ARCHIVE", ["ArchivedAt", "Timestamp", "TraceID", "Event", "JobID", "Worker", "Status", "Detail"]),
    alerts: ensureSheet("ARC_ALERTS", ["Timestamp", "Level", "Type", "Message", "Value", "Threshold", "TraceID"]),
    gatewayMemory: ensureSheet("GATEWAY_LONG_MEMORY", ["Timestamp", "Key", "Value", "Source", "TraceID", "Tags"]),
    arcShortMemory: ensureSheet("ARC_SHORT_MEMORY", ["Timestamp", "WorkerID", "SessionID", "Key", "Value", "TTL_SEC", "ExpiresAt", "TraceID"])
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

  const parseIntSafe = (v, fallback) => {
    const n = parseInt(norm(v), 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const clamp = (n, minV, maxV) => Math.max(minV, Math.min(maxV, n));

  const setGatewayLongMemory = (key, value, source, traceId, tags) => {
    const k = norm(key).slice(0, MAX_MEMORY_KEY);
    if (!k) return { ok: false, error: "key_required" };
    const val = norm(value).slice(0, MAX_MEMORY_VALUE);
    sheets.gatewayMemory.appendRow([new Date(), k, val, norm(source), norm(traceId), norm(tags)]);
    return { ok: true, key: k };
  };

  const getGatewayLongMemory = (key, limitRaw) => {
    const k = norm(key).slice(0, MAX_MEMORY_KEY);
    if (!k) return [];
    const limit = clamp(parseIntSafe(limitRaw, 1), 1, 50);
    const rows = sheets.gatewayMemory.getDataRange().getValues();
    const out = [];
    for (let i = rows.length - 1; i >= 1; i--) {
      if (norm(rows[i][1]) !== k) continue;
      out.push({
        timestamp: rows[i][0],
        key: norm(rows[i][1]),
        value: norm(rows[i][2]),
        source: norm(rows[i][3]),
        trace_id: norm(rows[i][4]),
        tags: norm(rows[i][5])
      });
      if (out.length >= limit) break;
    }
    return out;
  };

  const cleanupArcShortMemory = (maxRowsToScan) => {
    const limit = clamp(parseIntSafe(maxRowsToScan, 500), 50, 5000);
    const last = sheets.arcShortMemory.getLastRow();
    if (last <= 1) return 0;
    const startRow = Math.max(2, last - limit + 1);
    const rows = sheets.arcShortMemory.getRange(startRow, 1, last - startRow + 1, 8).getValues();
    const now = Date.now();
    let removed = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const expiresAtMs = new Date(rows[i][6]).getTime();
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
        sheets.arcShortMemory.deleteRow(startRow + i);
        removed++;
      }
    }
    return removed;
  };

  const putArcShortMemory = (workerId, sessionId, key, value, ttlSecRaw, traceId) => {
    const worker = norm(workerId).slice(0, MAX_USER);
    const session = norm(sessionId).slice(0, 120);
    const k = norm(key).slice(0, MAX_MEMORY_KEY);
    if (!worker) return { ok: false, error: "worker_id_required" };
    if (!k) return { ok: false, error: "key_required" };
    const ttlSec = clamp(parseIntSafe(ttlSecRaw, 1800), 30, 86400);
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    sheets.arcShortMemory.appendRow([
      new Date(),
      worker,
      session,
      k,
      norm(value).slice(0, MAX_MEMORY_VALUE),
      ttlSec,
      expiresAt,
      norm(traceId)
    ]);
    return { ok: true, worker_id: worker, key: k, ttl_sec: ttlSec, expires_at: expiresAt.toISOString() };
  };

  const getArcShortMemory = (workerId, sessionId, key, limitRaw) => {
    const worker = norm(workerId);
    const session = norm(sessionId);
    const k = norm(key);
    const limit = clamp(parseIntSafe(limitRaw, 5), 1, 50);
    const rows = sheets.arcShortMemory.getDataRange().getValues();
    const now = Date.now();
    const out = [];
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      const expiresAtMs = new Date(r[6]).getTime();
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) continue;
      if (worker && norm(r[1]) !== worker) continue;
      if (session && norm(r[2]) !== session) continue;
      if (k && norm(r[3]) !== k) continue;
      out.push({
        timestamp: r[0],
        worker_id: norm(r[1]),
        session_id: norm(r[2]),
        key: norm(r[3]),
        value: norm(r[4]),
        ttl_sec: parseIntSafe(r[5], 0),
        expires_at: r[6],
        trace_id: norm(r[7])
      });
      if (out.length >= limit) break;
    }
    return out;
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
    let targetPinned = false;
    if (has("#chatgpt") || has("@chatgpt") || has("[chatgpt]")) target = "chatgpt";
    else if (has("#copilot") || has("@copilot") || has("[copilot]")) target = "copilot";
    else if (has("#all") || has("@all")) target = "ALL";
    else if (has("#gemini") || has("@gemini") || has("[gemini]")) target = "gemini";
    if (
      has("#chatgpt") || has("@chatgpt") || has("[chatgpt]") ||
      has("#gemini") || has("@gemini") || has("[gemini]") ||
      has("#copilot") || has("@copilot") || has("[copilot]")
    ) targetPinned = true;
    if (has("#pin_target") || has("@pin_target") || has("#locktarget") || has("#target_fixed")) targetPinned = true;
    if (has("#allow_failover") || has("@allow_failover")) targetPinned = false;

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

    return { route: route, target: target, opMode: opMode, script: script, prompt: cleanPrompt, executor: executor, pinTarget: targetPinned };
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
      pin_target: lower(norm(job.pinTarget || "false")) === "true" ? "true" : "false",
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

  const findJobIdByPayloadQid = (qid) => {
    const targetQid = norm(qid);
    if (!targetQid) return "";
    const rows = sheets.jobs.getDataRange().getValues();
    // 新しい行を優先して逆順検索
    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      const payload = parseJsonSafe(norm(row[4]));
      if (norm(payload.qid) === targetQid) return norm(row[1]);
    }
    return "";
  };

  const resolveMissionJobId = (rawId) => {
    const direct = norm(rawId);
    if (!direct) return "";
    if (findJobRowById(direct)) return direct;
    const viaQid = findJobIdByPayloadQid(direct);
    return viaQid || direct;
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

  const countActiveArcNodes = (activeSec) => {
    const limitSec = Number.isFinite(activeSec) ? activeSec : 240;
    const now = Date.now();
    const rows = sheets.nodes.getDataRange().getValues();
    let n = 0;
    for (let i = 1; i < rows.length; i++) {
      const ts = new Date(rows[i][0]).getTime();
      if (!Number.isFinite(ts)) continue;
      if ((now - ts) / 1000 > limitSec) continue;
      n++;
    }
    return n;
  };

  const countActiveMothershipNodes = (activeSec) => {
    const limitSec = Number.isFinite(activeSec) ? activeSec : 240;
    const now = Date.now();
    const rows = sheets.mothershipNodes.getDataRange().getValues();
    let n = 0;
    for (let i = 1; i < rows.length; i++) {
      const ts = new Date(rows[i][0]).getTime();
      const st = lower(rows[i][2]);
      if (!Number.isFinite(ts)) continue;
      if ((now - ts) / 1000 > limitSec) continue;
      if (st === "offline" || st === "error") continue;
      n++;
    }
    return n;
  };

  const resolveRetryExecutor = () => {
    const arcActive = countActiveArcNodes(240);
    const mothershipActive = countActiveMothershipNodes(240);

    if (repairExecutor === "BAKU") {
      if (mothershipActive > 0) return { executor: "BAKU", reason: "repair_baku_available" };
      if (arcActive > 0) return { executor: "ARC", reason: "repair_baku_unavailable_fallback_arc" };
      return { executor: "AUTO", reason: "no_active_worker_auto" };
    }
    if (repairExecutor === "ARC") {
      if (arcActive > 0) return { executor: "ARC", reason: "repair_arc_available" };
      if (mothershipActive > 0) return { executor: "BAKU", reason: "repair_arc_unavailable_fallback_baku" };
      return { executor: "AUTO", reason: "no_active_worker_auto" };
    }
    if (arcActive > 0) return { executor: "ARC", reason: "repair_auto_pick_arc" };
    if (mothershipActive > 0) return { executor: "BAKU", reason: "repair_auto_pick_baku" };
    return { executor: "AUTO", reason: "no_active_worker_auto" };
  };

  const tryScheduleRetry = (jobId, traceId, errorType, errorData, failedWorker) => {
    const found = findJobRowById(jobId);
    if (!found) return { retried: false, reason: "job_not_found" };

    const row = found.row;
    const payload = found.payload;
    const target = lower(payload.target || "");
    const errType = upper(errorType || "");
    const loginNoRetry = errType.indexOf("LOGIN_REQUIRED") >= 0;
    if (loginNoRetry) {
      return { retried: false, reason: "login_required_no_retry", retry_count: Number(parseInt(norm(payload.retry_count) || "0", 10) || 0) };
    }
    const allPipelineNoRetry =
      target === "all" &&
      errType.indexOf("ALL_PIPELINE_FAILED") >= 0;
    if (allPipelineNoRetry) {
      return { retried: false, reason: "all_pipeline_failed_no_retry", retry_count: Number(parseInt(norm(payload.retry_count) || "0", 10) || 0) };
    }
    const copilotNoRetry =
      target === "copilot" &&
      (
        errType.indexOf("STALL_NO_PROGRESS") >= 0 ||
        errType.indexOf("COPILOT_BOT_BLOCKED") >= 0 ||
        errType.indexOf("TARGET_STALL") >= 0
      );
    if (copilotNoRetry) {
      return { retried: false, reason: "copilot_block_or_stall_no_retry", retry_count: Number(parseInt(norm(payload.retry_count) || "0", 10) || 0) };
    }

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

    const retryExec = resolveRetryExecutor();
    payload.executor = retryExec.executor;

    const keepWorker = lower(payload.pin_worker) === "true";
    sheets.jobs.getRange(found.rowIndex, 5).setValue(JSON.stringify(payload));
    sheets.jobs.getRange(found.rowIndex, 6).setValue("pending");
    sheets.jobs.getRange(found.rowIndex, 7).setValue("");
    if (!keepWorker) sheets.jobs.getRange(found.rowIndex, 3).setValue("");

    addAudit(
      norm(traceId) || norm(payload.trace_id),
      "JOB_RETRY_SCHEDULED",
      norm(jobId),
      norm(failedWorker),
      "pending",
      "retry=" + payload.retry_count + ",executor=" + payload.executor + ",reason=" + retryExec.reason
    );
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
      const resolvedId = missionId || ("CHAT_" + rowIndex + "_" + Date.now());
      const jobRes = enqueueArcJob({
        // qid と jobId は同一にして、結果報告の突合失敗を防ぐ
        jobId: resolvedId,
        qid: resolvedId,
        target: cmd.target,
        prompt: cmd.prompt,
        script: cmd.script,
        mode: effectiveMode,
        executor: cmd.executor,
        pinTarget: cmd.pinTarget ? "true" : "false",
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

  const requeueExpiredLeases = (leaseThresholdMsOverride) => {
    const rows = sheets.jobs.getDataRange().getValues();
    const now = Date.now();
    const thresholdMs = Number.isFinite(leaseThresholdMsOverride) && leaseThresholdMsOverride > 0
      ? leaseThresholdMsOverride
      : leaseTimeoutMs;
    const thresholdSec = Math.floor(thresholdMs / 1000);
    let recovered = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const status = lower(row[5]);
      if (status !== "leased") continue;
      const leasedAt = new Date(row[6]).getTime();
      if (!Number.isFinite(leasedAt) || now - leasedAt < thresholdMs) continue;

      const payload = parseJsonSafe(norm(row[4]));
      const leaseExpiredCountRaw = parseInt(norm(payload.lease_expire_count) || "0", 10);
      const leaseExpiredCount = (Number.isFinite(leaseExpiredCountRaw) ? leaseExpiredCountRaw : 0) + 1;
      payload.lease_expire_count = leaseExpiredCount;
      const failoverRes = maybeSwitchJobTargetForRecovery(i + 1, row, payload, "lease_expire_" + leaseExpiredCount);

      if (leaseExpiredCount >= leaseExpireMax) {
        if (failoverRes.switched && leaseExpiredCount === leaseExpireMax) {
          const keepWorkerFailover = lower(payload.pin_worker) === "true";
          if (!keepWorkerFailover) sheets.jobs.getRange(i + 1, 3).setValue("");
          sheets.jobs.getRange(i + 1, 5).setValue(JSON.stringify(payload));
          sheets.jobs.getRange(i + 1, 6).setValue("pending");
          sheets.jobs.getRange(i + 1, 7).setValue("");
          recovered++;
          addAudit(norm(payload.trace_id), "LEASE_EXPIRED_FAILOVER", norm(row[1]), norm(row[2]), "pending", "count=" + leaseExpiredCount);
          noteLinkedChatProgress(norm(row[1]), "ARC再投入: lease timeout で " + failoverRes.to + " へ切替");
          continue;
        }
        sheets.jobs.getRange(i + 1, 5).setValue(JSON.stringify(payload));
        markDeadJob(norm(row[1]), norm(payload.trace_id), norm(row[2]), "LEASE_EXPIRE_MAX", "lease_expire_count=" + leaseExpiredCount, "lease_expire_max");
        completeLinkedChat(norm(row[1]), "[LEASE_EXPIRE_MAX] ARC実行が完了しませんでした", "error");
        continue;
      }

      const keepWorker = lower(payload.pin_worker) === "true";
      if (!keepWorker) sheets.jobs.getRange(i + 1, 3).setValue("");
      sheets.jobs.getRange(i + 1, 5).setValue(JSON.stringify(payload));
      sheets.jobs.getRange(i + 1, 6).setValue("pending");
      sheets.jobs.getRange(i + 1, 7).setValue("");
      recovered++;
      addAudit(norm(payload.trace_id), "LEASE_EXPIRED", norm(row[1]), norm(row[2]), "pending", "timeout_sec=" + thresholdSec);
      noteLinkedChatProgress(norm(row[1]), "ARC待機再投入: lease timeout / " + thresholdSec + "秒");
    }
    return recovered;
  };

  const touchLeaseFromHeartbeat = (workerId, hb) => {
    const candidates = [
      norm(hb.mission_id),
      norm(hb.mission),
      norm(hb.qid),
      norm(hb.arc_qid)
    ].filter((v, idx, arr) => v && arr.indexOf(v) === idx);
    if (candidates.length === 0) return { touched: false, reason: "no_mission" };

    const rows = sheets.jobs.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      if (lower(row[5]) !== "leased") continue;
      const rowWorker = norm(row[2]);
      if (rowWorker && workerId && rowWorker !== workerId) continue;

      const payload = parseJsonSafe(norm(row[4]));
      const jobId = norm(row[1]);
      const payloadQid = norm(payload.qid);
      const matched = candidates.some((id) => id === jobId || id === payloadQid);
      if (!matched) continue;

      if (!rowWorker && workerId) sheets.jobs.getRange(i + 1, 3).setValue(workerId);
      sheets.jobs.getRange(i + 1, 7).setValue(new Date());
      return { touched: true, job_id: jobId };
    }
    // フォールバック: running heartbeat なら同一workerの最新 leased を延命
    const hbStatus = lower(norm(hb.status || ""));
    if (hbStatus === "running" && workerId) {
      let latest = null;
      for (let i = rows.length - 1; i >= 1; i--) {
        const row = rows[i];
        if (lower(row[5]) !== "leased") continue;
        const rowWorker = norm(row[2]);
        if (!rowWorker || rowWorker !== workerId) continue;
        latest = { rowIndex: i + 1, jobId: norm(row[1]) };
        break;
      }
      if (latest) {
        sheets.jobs.getRange(latest.rowIndex, 7).setValue(new Date());
        return { touched: true, job_id: latest.jobId, reason: "running_fallback_latest_leased" };
      }
    }
    return { touched: false, reason: "not_found" };
  };

  const recoverStalePendingJobs = (pendingThresholdMsOverride) => {
    const rows = sheets.jobs.getDataRange().getValues();
    const now = Date.now();
    const thresholdMs = Number.isFinite(pendingThresholdMsOverride) && pendingThresholdMsOverride > 0
      ? pendingThresholdMsOverride
      : pendingTimeoutMs;
    const thresholdSec = Math.floor(thresholdMs / 1000);
    let touched = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (lower(row[5]) !== "pending") continue;
      const createdAtMs = new Date(row[0]).getTime();
      if (!Number.isFinite(createdAtMs) || now - createdAtMs < thresholdMs) continue;

      const payload = parseJsonSafe(norm(row[4]));
      const nextRetryAtMs = new Date(norm(payload.next_retry_at)).getTime();
      if (Number.isFinite(nextRetryAtMs) && now < nextRetryAtMs) continue;

      const pendingRecoverCount = (parseInt(norm(payload.pending_recover_count) || "0", 10) || 0) + 1;
      payload.pending_recover_count = pendingRecoverCount;

      const switched = maybeSwitchJobTargetForRecovery(i + 1, row, payload, "pending_timeout_" + pendingRecoverCount);
      if (switched.switched && pendingRecoverCount <= 2) {
        sheets.jobs.getRange(i + 1, 5).setValue(JSON.stringify(payload));
        sheets.jobs.getRange(i + 1, 6).setValue("pending");
        sheets.jobs.getRange(i + 1, 7).setValue("");
        addAudit(norm(payload.trace_id), "PENDING_TIMEOUT_RECOVER", norm(row[1]), norm(row[2]), "pending", "switched");
        noteLinkedChatProgress(norm(row[1]), "ARC再投入: pending timeout から " + switched.to + " へ切替");
        touched++;
        continue;
      }

      sheets.jobs.getRange(i + 1, 5).setValue(JSON.stringify(payload));
      markDeadJob(norm(row[1]), norm(payload.trace_id), norm(row[2]), "PENDING_TIMEOUT", "pending_for_sec>=" + thresholdSec, "pending_timeout");
      completeLinkedChat(norm(row[1]), "[PENDING_TIMEOUT] ARC実行が開始されませんでした", "error");
      addAudit(norm(payload.trace_id), "PENDING_TIMEOUT_DEAD", norm(row[1]), norm(row[2]), "dead", "sec=" + thresholdSec);
      touched++;
    }
    return touched;
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
      recoverStalePendingJobs();
      requeueExpiredLeases();
      routePendingChatCommands();

      const rows = sheets.jobs.getDataRange().getValues();
      // 新しいジョブを優先。古い詰まりジョブが先頭を占有し続けるのを防ぐ。
      for (let i = rows.length - 1; i >= 1; i--) {
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
        if (workerId) {
          putArcShortMemory(
            workerId,
            norm(payload.session_id) || norm(payload.trace_id) || norm(row[1]),
            "last_instruction",
            JSON.stringify({
              job_id: norm(row[1]),
              mode: rowMode,
              target: norm(payload.target),
              prompt: norm(payload.prompt).slice(0, 500)
            }),
            1800,
            norm(payload.trace_id)
          );
        }
        return Object.assign({ mode: rowMode, job_id: norm(row[1]) }, payload);
      }
      return null;
    } finally {
      lock.releaseLock();
    }
  };

  const findTraceByMissionId = (missionId) => {
    const found = findJobRowById(resolveMissionJobId(missionId));
    if (!found) return "";
    return norm(found.payload.trace_id);
  };

  const completeLinkedChat = (missionId, output, type) => {
    const mid = resolveMissionJobId(missionId);
    if (!mid) return false;
    const rows = sheets.main.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (norm(rows[i][5]) !== mid) continue;
      sheets.main.getRange(i + 1, 4).setValue(type === "error" ? "ARC_ERROR" : "ARC_DONE");
      sheets.main.getRange(i + 1, 5).setValue(output);
      return true;
    }
    return false;
  };

  const appendOrphanChatResult = (missionId, output, type, target) => {
    const status = type === "error" ? "ARC_ERROR" : "ARC_DONE";
    const user = type === "error" ? "ARC(ORPHAN_ERR)" : "ARC(ORPHAN)";
    sheets.main.appendRow([
      new Date(),
      user,
      "[" + (norm(target) || "unknown") + "] " + norm(missionId),
      status,
      norm(output),
      norm(missionId)
    ]);
  };

  const noteLinkedChatProgress = (missionId, note) => {
    const mid = resolveMissionJobId(missionId);
    if (!mid) return;
    const rows = sheets.main.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (norm(rows[i][5]) !== mid) continue;
      const st = lower(rows[i][3]);
      if (st === "arc_done" || st === "arc_error") return;
      sheets.main.getRange(i + 1, 4).setValue("QUEUED_ARC");
      sheets.main.getRange(i + 1, 5).setValue(norm(note));
      return;
    }
  };

  const nextFailoverTarget = (currentTarget) => {
    const t = lower(currentTarget);
    if (t === "chatgpt") return "gemini";
    if (t === "gemini") return "chatgpt";
    if (t === "copilot") return "chatgpt";
    return "gemini";
  };

  const maybeSwitchJobTargetForRecovery = (jobRowIndex, row, payload, reasonTag) => {
    if (!targetFailoverEnabled) return { switched: false, reason: "disabled" };
    const modeName = lower(row[3]);
    if (modeName !== "request_arc") return { switched: false, reason: "mode_not_supported" };
    if (lower(payload.pin_target) === "true") return { switched: false, reason: "target_pinned" };
    const from = lower(payload.target || "");
    if (!from || from === "all") return { switched: false, reason: "invalid_target" };
    if (from === "copilot") return { switched: false, reason: "copilot_no_failover" };
    const to = nextFailoverTarget(from);
    if (from === to) return { switched: false, reason: "same_target" };
    payload.target = to;
    payload.target_failover_count = (parseInt(norm(payload.target_failover_count) || "0", 10) || 0) + 1;
    payload.target_failover_reason = norm(reasonTag);
    payload.target_failover_at = nowIso();
    sheets.jobs.getRange(jobRowIndex, 5).setValue(JSON.stringify(payload));
    addAudit(norm(payload.trace_id), "TARGET_FAILOVER", norm(row[1]), norm(row[2]), "pending", from + "->" + to + " / " + norm(reasonTag));
    noteLinkedChatProgress(norm(row[1]), "ARC自動切替: " + from + " -> " + to + " (" + norm(reasonTag) + ")");
    return { switched: true, from: from, to: to };
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

  ensureRecommendedDefaults();
  maybeRunDailyCleanup();
  evaluateRuntimeAlerts();

  if (mode === "arc_setup") {
    const setupSheets = (data.blueprint && data.blueprint.sheets) || {};
    Object.keys(setupSheets).forEach((name) => ensureSheet(name, setupSheets[name]));
    // ARC起動時の自動セットアップで認証キーを同期する。
    // ここがズレると heartbeat/lease/result がすべて unauthorized になり、PENDING_TIMEOUT化する。
    const incomingAuth =
      norm((data.blueprint && data.blueprint.auth_key) || data.auth_key || "");
    if (incomingAuth) {
      props.setProperty("ARC_AUTH_KEY", incomingAuth);
    }
    return jsonOut({
      status: "ok",
      setup: "success",
      auth_synced: !!incomingAuth
    });
  }

  if (mode === "handshake") {
    return jsonOut({
      status: "ok",
      role: "gateway",
      version: "arc-gateway-20.0",
      control: "gateway_primary",
      lease_timeout_sec: leaseTimeoutSec,
      pending_timeout_sec: pendingTimeoutSec,
      max_retry: maxRetry,
      retry_backoff_sec: retryBackoffSec,
      repair_executor: repairExecutor,
      default_route: defaultRoute,
      target_failover_enabled: targetFailoverEnabled,
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
    const lock = LockService.getScriptLock();
    const locked = lock.tryLock(5000);
    if (!locked) return jsonOut({ status: "busy", routed: 0, error: "route_lock_timeout" });
    try {
      const routed = routePendingChatCommands();
      return jsonOut({ status: "ok", routed: routed.length, details: routed });
    } finally {
      lock.releaseLock();
    }
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
      pending_timeout_sec: pendingTimeoutSec,
      max_retry: maxRetry,
      retry_backoff_sec: retryBackoffSec,
      repair_executor: repairExecutor,
      default_route: defaultRoute,
      default_executor: defaultExecutor,
      default_target: defaultTarget,
      target_failover_enabled: targetFailoverEnabled,
      require_signature: requireSignature,
      autonomy_paused: autonomyPaused,
      jobs: counts,
      nodes: Math.max(0, sheets.nodes.getLastRow() - 1),
      dead_jobs: Math.max(0, sheets.dead.getLastRow() - 1),
      audit_rows: Math.max(0, sheets.audit.getLastRow() - 1),
      mothership_nodes: Math.max(0, sheets.mothershipNodes.getLastRow() - 1)
    });
  }

  if (mode === "admin_set_timeouts") {
    const current = {
      ARC_LEASE_TIMEOUT_SEC: String(leaseTimeoutSec),
      ARC_PENDING_TIMEOUT_SEC: String(pendingTimeoutSec),
      ARC_LEASE_EXPIRE_MAX: String(leaseExpireMax),
      ARC_RETRY_BACKOFF_SEC: String(retryBackoffSec)
    };

    const profileName = lower(data.profile || "");
    const profileMap = {
      safe: { lease: 180, pending: 420, lease_expire_max: 2, retry_backoff: 30 },
      balanced: { lease: 120, pending: 300, lease_expire_max: 2, retry_backoff: 20 },
      fast: { lease: 90, pending: 240, lease_expire_max: 1, retry_backoff: 15 }
    };
    const fromProfile = profileMap[profileName] || {};
    const leaseIn = parseInt(norm(data.lease_timeout_sec || fromProfile.lease), 10);
    const pendingIn = parseInt(norm(data.pending_timeout_sec || fromProfile.pending), 10);
    const leaseExpireIn = parseInt(norm(data.lease_expire_max || fromProfile.lease_expire_max), 10);
    const retryBackoffIn = parseInt(norm(data.retry_backoff_sec || fromProfile.retry_backoff), 10);

    const leaseNew = Number.isFinite(leaseIn) && leaseIn >= 60 && leaseIn <= 600 ? leaseIn : leaseTimeoutSec;
    const pendingNew = Number.isFinite(pendingIn) && pendingIn >= 180 && pendingIn <= 1800 ? pendingIn : pendingTimeoutSec;
    const leaseExpireNew = Number.isFinite(leaseExpireIn) && leaseExpireIn >= 1 && leaseExpireIn <= 5 ? leaseExpireIn : leaseExpireMax;
    const retryBackoffNew = Number.isFinite(retryBackoffIn) && retryBackoffIn >= 5 && retryBackoffIn <= 120 ? retryBackoffIn : retryBackoffSec;
    const dryRun = lower(norm(data.dry_run || "false")) === "true";

    const next = {
      ARC_LEASE_TIMEOUT_SEC: String(leaseNew),
      ARC_PENDING_TIMEOUT_SEC: String(pendingNew),
      ARC_LEASE_EXPIRE_MAX: String(leaseExpireNew),
      ARC_RETRY_BACKOFF_SEC: String(retryBackoffNew)
    };

    if (!dryRun) {
      props.setProperty("ARC_LEASE_TIMEOUT_SEC", next.ARC_LEASE_TIMEOUT_SEC);
      props.setProperty("ARC_PENDING_TIMEOUT_SEC", next.ARC_PENDING_TIMEOUT_SEC);
      props.setProperty("ARC_LEASE_EXPIRE_MAX", next.ARC_LEASE_EXPIRE_MAX);
      props.setProperty("ARC_RETRY_BACKOFF_SEC", next.ARC_RETRY_BACKOFF_SEC);
      addAudit(norm(data.trace_id), "ADMIN_SET_TIMEOUTS", "", norm(data.worker_id), "ok", JSON.stringify(next));
    }

    return jsonOut({
      status: "ok",
      dry_run: dryRun,
      profile: profileName || "",
      before: current,
      after: next
    });
  }

  if (mode === "admin_debug_snapshot") {
    const snapshot = fetchDebugSnapshot();
    const truncate = (v, maxLen) => {
      const s = norm(v);
      if (!s) return "";
      if (s.length <= maxLen) return s;
      return s.slice(0, maxLen) + "...(truncated)";
    };
    const compactRows = (rows, maxRows, maxCellLen) => {
      const src = Array.isArray(rows) ? rows.slice(-maxRows) : [];
      return src.map((row) => {
        if (!Array.isArray(row)) return row;
        return row.map((cell) => {
          if (cell === null || cell === undefined) return "";
          if (typeof cell === "string") return truncate(cell, maxCellLen);
          return cell;
        });
      });
    };
    return jsonOut({
      status: "ok",
      ai_packet: snapshot.ai_packet || {},
      jobs_recent: compactRows(snapshot.jobs && snapshot.jobs.recent, 10, 320),
      audit_recent: compactRows(snapshot.audit && snapshot.audit.recent, 20, 240),
      errors_recent: compactRows(snapshot.errors && snapshot.errors.recent, 8, 240),
      results_recent: compactRows(snapshot.results && snapshot.results.recent, 8, 320),
      main_chat_recent: compactRows(snapshot.main_chat && snapshot.main_chat.recent, 8, 320)
    });
  }

  if (mode === "admin_job_probe") {
    const jobId = norm(data.job_id || data.mission_id || data.qid);
    if (!jobId) return jsonOut({ status: "error", error: "job_id_required" });

    let job = null;
    const jobRows = sheets.jobs.getDataRange().getValues();
    for (let i = jobRows.length - 1; i >= 1; i--) {
      const row = jobRows[i];
      if (norm(row[1]) !== jobId) continue;
      const payload = parseJsonSafe(norm(row[4]));
      job = {
        row_index: i + 1,
        job_id: norm(row[1]),
        worker_id: norm(row[2]),
        mode: norm(row[3]) || "request_arc",
        status_value: norm(row[5]),
        leased_at: norm(row[6]),
        trace_id: norm(payload.trace_id),
        target: norm(payload.target),
        executor: norm(payload.executor),
        retry_count: Number(parseInt(norm(payload.retry_count) || "0", 10) || 0),
        pending_recover_count: Number(parseInt(norm(payload.pending_recover_count) || "0", 10) || 0),
        lease_expire_count: Number(parseInt(norm(payload.lease_expire_count) || "0", 10) || 0),
        target_failover_count: Number(parseInt(norm(payload.target_failover_count) || "0", 10) || 0),
        last_eval_summary: norm(payload.last_eval_summary),
        last_eval_at: norm(payload.last_eval_at)
      };
      break;
    }

    let mainChat = null;
    const mainRows = sheets.main.getDataRange().getValues();
    for (let i = mainRows.length - 1; i >= 1; i--) {
      const row = mainRows[i];
      if (norm(row[5]) !== jobId) continue;
      mainChat = {
        row_index: i + 1,
        ts: norm(row[0]),
        user: norm(row[1]),
        content: norm(row[2]).slice(0, 500),
        status: norm(row[3]),
        response: norm(row[4]).slice(0, 800),
        mission_id: norm(row[5])
      };
      break;
    }

    let nodeInfo = null;
    const nodeRows = sheets.nodes.getDataRange().getValues();
    const workerHint = job ? norm(job.worker_id) : "";
    if (workerHint) {
      for (let i = nodeRows.length - 1; i >= 1; i--) {
        const row = nodeRows[i];
        if (norm(row[6]) !== workerHint) continue;
        nodeInfo = {
          ts: norm(row[0]),
          ip: norm(row[1]),
          port: norm(row[2]),
          status: norm(row[3]),
          current_target: norm(row[4]),
          version: norm(row[5]),
          worker_id: norm(row[6]),
          executor: norm(row[7]),
          current_host: norm(row[8]),
          current_url: norm(row[9]),
          current_title: norm(row[10]),
          hud_tail: norm(row[11])
        };
        break;
      }
    }
    if (!nodeInfo) {
      for (let i = nodeRows.length - 1; i >= 1; i--) {
        const row = nodeRows[i];
        nodeInfo = {
          ts: norm(row[0]),
          ip: norm(row[1]),
          port: norm(row[2]),
          status: norm(row[3]),
          current_target: norm(row[4]),
          version: norm(row[5]),
          worker_id: norm(row[6]),
          executor: norm(row[7]),
          current_host: norm(row[8]),
          current_url: norm(row[9]),
          current_title: norm(row[10]),
          hud_tail: norm(row[11])
        };
        break;
      }
    }

    return jsonOut({
      status: "ok",
      found: !!job,
      job: job,
      main_chat: mainChat,
      node: nodeInfo
    });
  }

  if (mode === "admin_chat_probe") {
    const query = norm(data.query || data.tag || data.text);
    if (!query) return jsonOut({ status: "error", error: "query_required" });
    const rows = sheets.main.getDataRange().getValues();
    let hit = null;
    const q = lower(query);
    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      const content = norm(row[2]);
      const response = norm(row[4]);
      if (lower(content).indexOf(q) < 0 && lower(response).indexOf(q) < 0) continue;
      hit = {
        row_index: i + 1,
        ts: norm(row[0]),
        user: norm(row[1]),
        content: content.slice(0, 500),
        status: norm(row[3]),
        response: response.slice(0, 800),
        mission_id: norm(row[5])
      };
      break;
    }
    return jsonOut({
      status: "ok",
      found: !!hit,
      row: hit
    });
  }

  if (mode === "admin_mission_timing") {
    const missionId = norm(data.mission_id || data.job_id || data.qid);
    if (!missionId) return jsonOut({ status: "error", error: "mission_id_required" });

    const parseTs = (v) => {
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : NaN;
    };

    let mainRow = null;
    const mains = sheets.main.getDataRange().getValues();
    for (let i = mains.length - 1; i >= 1; i--) {
      if (norm(mains[i][5]) !== missionId) continue;
      mainRow = mains[i];
      break;
    }

    let resultRow = null;
    const results = sheets.results.getDataRange().getValues();
    for (let i = results.length - 1; i >= 1; i--) {
      if (norm(results[i][1]) !== missionId) continue;
      resultRow = results[i];
      break;
    }

    let errorRow = null;
    const errors = sheets.errors.getDataRange().getValues();
    for (let i = errors.length - 1; i >= 1; i--) {
      if (norm(errors[i][1]) !== missionId) continue;
      errorRow = errors[i];
      break;
    }

    const foundJob = findJobRowById(missionId);
    const createdAtMs = parseTs(mainRow ? mainRow[0] : "");
    const resultAtMs = parseTs(resultRow ? resultRow[0] : "");
    const errorAtMs = parseTs(errorRow ? errorRow[0] : "");

    const doneLatencySec = Number.isFinite(createdAtMs) && Number.isFinite(resultAtMs)
      ? Math.max(0, Math.floor((resultAtMs - createdAtMs) / 1000))
      : null;
    const errorLatencySec = Number.isFinite(createdAtMs) && Number.isFinite(errorAtMs)
      ? Math.max(0, Math.floor((errorAtMs - createdAtMs) / 1000))
      : null;

    return jsonOut({
      status: "ok",
      mission_id: missionId,
      main: mainRow ? {
        ts: norm(mainRow[0]),
        user: norm(mainRow[1]),
        content: norm(mainRow[2]).slice(0, 500),
        status: norm(mainRow[3]),
        response: norm(mainRow[4]).slice(0, 800)
      } : null,
      job: foundJob ? {
        status_value: norm(foundJob.row[5]),
        worker_id: norm(foundJob.row[2]),
        mode: norm(foundJob.row[3]),
        leased_at: norm(foundJob.row[6]),
        payload: foundJob.payload
      } : null,
      result: resultRow ? {
        ts: norm(resultRow[0]),
        mission_id: norm(resultRow[1]),
        target: norm(resultRow[2]),
        prompt: norm(resultRow[3]).slice(0, 400),
        result: norm(resultRow[4]).slice(0, 400)
      } : null,
      error: errorRow ? {
        ts: norm(errorRow[0]),
        qid: norm(errorRow[1]),
        type: norm(errorRow[2]),
        data: norm(errorRow[3]).slice(0, 400)
      } : null,
      timing: {
        done_latency_sec: doneLatencySec,
        error_latency_sec: errorLatencySec
      }
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

  if (mode === "admin_recover_queues") {
    const scope = lower(data.scope || "both");
    const leasedMinSecRaw = parseInt(norm(data.leased_min_sec || ""), 10);
    const pendingMinSecRaw = parseInt(norm(data.pending_min_sec || ""), 10);
    const leasedMinSec = Number.isFinite(leasedMinSecRaw) && leasedMinSecRaw >= 30 ? leasedMinSecRaw : leaseTimeoutSec;
    const pendingMinSec = Number.isFinite(pendingMinSecRaw) && pendingMinSecRaw >= 60 ? pendingMinSecRaw : pendingTimeoutSec;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return jsonOut({ status: "busy", error: "lease_lock_timeout" });
    try {
      let leasedRecovered = 0;
      let pendingRecovered = 0;
      if (scope === "leased" || scope === "both") {
        leasedRecovered = requeueExpiredLeases(leasedMinSec * 1000);
      }
      if (scope === "pending" || scope === "both") {
        pendingRecovered = recoverStalePendingJobs(pendingMinSec * 1000);
      }
      const routed = routePendingChatCommands();
      return jsonOut({
        status: "ok",
        scope: scope,
        leased_recovered: leasedRecovered,
        pending_recovered: pendingRecovered,
        routed: routed.length
      });
    } finally {
      lock.releaseLock();
    }
  }

  if (mode === "gateway_memory_put" || mode === "memory_put") {
    const mem = setGatewayLongMemory(data.key, data.value, data.source || data.user || "gateway", data.trace_id, data.tags);
    if (!mem.ok) return jsonOut({ status: "error", error: mem.error });
    addAudit(norm(data.trace_id), "GATEWAY_MEMORY_PUT", "", norm(data.worker_id), "ok", mem.key);
    return jsonOut({ status: "ok", key: mem.key });
  }

  if (mode === "gateway_memory_get" || mode === "memory_get") {
    const rows = getGatewayLongMemory(data.key, data.limit);
    return jsonOut({ status: "ok", key: norm(data.key), rows: rows, count: rows.length });
  }

  if (mode === "arc_memory_put" || mode === "arc_short_memory_put") {
    cleanupArcShortMemory(500);
    const mem = putArcShortMemory(data.worker_id, data.session_id, data.key, data.value, data.ttl_sec, data.trace_id);
    if (!mem.ok) return jsonOut({ status: "error", error: mem.error });
    addAudit(norm(data.trace_id), "ARC_SHORT_MEMORY_PUT", "", norm(data.worker_id), "ok", norm(data.key));
    return jsonOut(Object.assign({ status: "ok" }, mem));
  }

  if (mode === "arc_memory_get" || mode === "arc_short_memory_get") {
    cleanupArcShortMemory(500);
    const rows = getArcShortMemory(data.worker_id, data.session_id, data.key, data.limit);
    return jsonOut({ status: "ok", rows: rows, count: rows.length });
  }

  if (mode === "arc_result" || mode === "report_result") {
    const missionIdRaw = norm(data.qid || data.mission_id);
    const missionId = resolveMissionJobId(missionIdRaw);
    const result = norm(data.text);
    const evalSummary = norm(data.eval_summary);
    const traceId = norm(data.trace_id) || findTraceByMissionId(missionId || missionIdRaw);
    sheets.results.appendRow([new Date(), missionId, data.target || "", data.prompt || "", result, data.image || ""]);
    const found = findJobRowById(missionId);
    if (found && evalSummary) {
      const payload = found.payload || {};
      payload.last_eval_summary = evalSummary.slice(0, 1200);
      payload.last_eval_at = nowIso();
      sheets.jobs.getRange(found.rowIndex, 5).setValue(JSON.stringify(payload));
    }
    completeArcJob(missionId, "done");
    const linked = completeLinkedChat(missionId, result, "result");
    if (!linked) appendOrphanChatResult(missionId, result, "result", data.target || "");
    const bakuReport = parseBakuStructuredReport(result);
    if (bakuReport) {
      addAudit(traceId, "BAKU_REPORT_PARSED", missionId, norm(data.worker_id), "ok", norm(bakuReport.domain) + " / " + norm(bakuReport.mode));
      maybeEnqueueBakuFollowup(missionId, traceId, bakuReport);
    }
    if (norm(data.worker_id)) {
      putArcShortMemory(
        norm(data.worker_id),
        norm(data.session_id) || traceId || missionId,
        "last_result",
        result.slice(0, MAX_MEMORY_VALUE),
        1800,
        traceId
      );
    }
    addAudit(traceId, "ARC_RESULT", missionId, norm(data.worker_id), "done", norm(data.target));
    return jsonOut({ status: "ok", trace_id: traceId });
  }

  if (mode === "arc_error" || mode === "report_error") {
    const missionIdRaw = norm(data.qid || data.mission_id);
    const missionId = resolveMissionJobId(missionIdRaw);
    const err = norm(data.error_type);
    const errData = norm(data.data);
    const traceId = norm(data.trace_id) || findTraceByMissionId(missionId || missionIdRaw);
    const workerId = norm(data.worker_id);

    sheets.errors.appendRow([new Date(), missionId, err, errData]);
    const linked = completeLinkedChat(missionId, "[" + err + "] " + errData, "error");
    if (!linked) appendOrphanChatResult(missionId, "[" + err + "] " + errData, "error", data.target || "");

    const retry = tryScheduleRetry(missionId, traceId, err, errData, workerId);
    if (workerId) {
      putArcShortMemory(
        workerId,
        norm(data.session_id) || traceId || missionId,
        "last_error",
        ("[" + err + "] " + errData).slice(0, MAX_MEMORY_VALUE),
        1800,
        traceId
      );
    }
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
      const rowWorker = norm(all[i][6]);
      if (workerId && rowWorker && rowWorker === workerId) {
        foundRow = i + 1;
        break;
      }
      if (norm(all[i][1]) === ip && norm(all[i][2]) === port) {
        foundRow = i + 1;
        break;
      }
    }
    const currentTarget = norm(data.current_target || data.target || "");
    const currentHost = norm(data.current_host).slice(0, 200);
    const currentUrl = norm(data.current_url).slice(0, 800);
    const currentTitle = norm(data.current_title).slice(0, 200);
    const hudTail = (function(v) {
      try {
        if (Array.isArray(v)) return v.map((x) => norm(x)).join(" > ").slice(0, 1200);
        const s = norm(v);
        if (!s) return "";
        if (s.charAt(0) === "[" && s.charAt(s.length - 1) === "]") {
          const arr = JSON.parse(s);
          if (Array.isArray(arr)) return arr.map((x) => norm(x)).join(" > ").slice(0, 1200);
        }
        return s.slice(0, 1200);
      } catch (_) {
        return norm(v).slice(0, 1200);
      }
    })(data.hud_tail);
    const row = [
      new Date(),
      ip,
      port,
      data.status || "",
      currentTarget,
      data.version || "",
      workerId,
      consumer,
      currentHost,
      currentUrl,
      currentTitle,
      hudTail
    ];
    if (foundRow > 0) sheets.nodes.getRange(foundRow, 1, 1, row.length).setValues([row]);
    else sheets.nodes.appendRow(row);

    const workerStatus = lower(norm(data.status || ""));
    if (workerStatus === "running") touchLeaseFromHeartbeat(workerId, data);
    const canLease =
      workerStatus === "" ||
      workerStatus === "online" ||
      workerStatus === "idle" ||
      workerStatus === "heartbeat" ||
      workerStatus === "success" ||
      workerStatus === "error";
    const instruction = canLease ? claimNextInstruction(workerId, consumer) : null;
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
