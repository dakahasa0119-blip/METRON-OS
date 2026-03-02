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
  const canonicalTarget = (v) => {
    const t = lower(v).replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    if (!t) return "";
    if (t === "claude") return "copilot";
    return t;
  };
  const canonicalSlotId = (v) => {
    const s = lower(v).replace(/[^a-z0-9_-]/g, "");
    return s.slice(0, 40);
  };
  const normalizeSlotAliasId = (slotId) => {
    const sid = canonicalSlotId(slotId);
    if (sid === "copilot") return "claude";
    return sid;
  };
  const defaultSlotRegistry = () => ([
    {
      slot_id: "chatgpt",
      display_name: "ChatGPT",
      target: "chatgpt",
      enabled: true,
      priority: 10,
      login: "openai"
    },
    {
      slot_id: "gemini",
      display_name: "Gemini",
      target: "gemini",
      enabled: true,
      priority: 20,
      login: "google"
    },
    {
      slot_id: "claude",
      display_name: "Claude",
      target: "copilot",
      enabled: false,
      priority: 30,
      login: "google_or_email"
    }
  ]);
  const normalizeSlotEntry = (slot, idx) => {
    const s = slot && typeof slot === "object" ? slot : {};
    const target = canonicalTarget(s.target);
    const slotIdSeed = normalizeSlotAliasId(s.slot_id) || (target && target !== "all" ? target : ("slot" + (idx + 1)));
    const enabled = (() => {
      if (typeof s.enabled === "boolean") return s.enabled;
      const ev = lower(norm(s.enabled));
      if (!ev) return true;
      return ev !== "false" && ev !== "0" && ev !== "off";
    })();
    return {
      slot_id: slotIdSeed,
      display_name: norm(s.display_name) || slotIdSeed,
      target: target && target !== "all" ? target : "gemini",
      enabled: enabled,
      priority: clamp(parseInt(norm(s.priority), 10), 1, 999) || ((idx + 1) * 10),
      login: norm(s.login).slice(0, 40),
      url: norm(s.url).slice(0, 400),
      input_selector: norm(s.input_selector).slice(0, 240),
      send_selector: norm(s.send_selector).slice(0, 240),
      response_selector: norm(s.response_selector).slice(0, 240)
    };
  };
  const loadSlotRegistry = () => {
    const raw = norm(props.getProperty("ARC_SLOT_REGISTRY_JSON"));
    const base = (() => {
      if (!raw) return defaultSlotRegistry();
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return defaultSlotRegistry();
        return parsed;
      } catch (_) {
        return defaultSlotRegistry();
      }
    })();
    const out = [];
    const seen = {};
    for (let i = 0; i < base.length; i++) {
      const n = normalizeSlotEntry(base[i], i);
      if (!n.slot_id || seen[n.slot_id]) continue;
      seen[n.slot_id] = true;
      out.push(n);
    }
    if (out.length === 0) {
      const defs = defaultSlotRegistry().map((s, i) => normalizeSlotEntry(s, i));
      props.setProperty("ARC_SLOT_REGISTRY_JSON", JSON.stringify(defs));
      return defs;
    }
    const sorted = out.sort((a, b) => a.priority - b.priority);
    const hasLegacyCopilot = sorted.some((s) => canonicalSlotId(s.slot_id) === "copilot");
    const hasClaude = sorted.some((s) => canonicalSlotId(s.slot_id) === "claude");
    if (hasLegacyCopilot && !hasClaude) {
      const migrated = sorted.map((s) => {
        if (canonicalSlotId(s.slot_id) !== "copilot") return s;
        return Object.assign({}, s, { slot_id: "claude", display_name: norm(s.display_name) || "Claude" });
      });
      saveSlotRegistry(migrated);
      return migrated;
    }
    return sorted;
  };
  const saveSlotRegistry = (slots) => {
    const arr = Array.isArray(slots) ? slots : [];
    props.setProperty("ARC_SLOT_REGISTRY_JSON", JSON.stringify(arr));
  };
  const findSlotById = (slotId, slots) => {
    const sid = normalizeSlotAliasId(slotId);
    if (!sid) return null;
    const arr = Array.isArray(slots) ? slots : loadSlotRegistry();
    for (let i = 0; i < arr.length; i++) {
      if (normalizeSlotAliasId(arr[i].slot_id) === sid) return arr[i];
    }
    return null;
  };
  const preferredSlotForTarget = (target, slots) => {
    const t = canonicalTarget(target);
    if (!t || t === "all") return null;
    const arr = Array.isArray(slots) ? slots : loadSlotRegistry();
    const enabled = arr.filter((s) => s.enabled && canonicalTarget(s.target) === t);
    if (enabled.length > 0) return enabled[0];
    const any = arr.filter((s) => canonicalTarget(s.target) === t);
    return any.length > 0 ? any[0] : null;
  };
  const resolveSlotForTarget = (target, requestedSlotId, slots) => {
    const arr = Array.isArray(slots) ? slots : loadSlotRegistry();
    const t = canonicalTarget(target);
    const sid = canonicalSlotId(requestedSlotId);
    if (sid) {
      const hit = findSlotById(sid, arr);
      if (hit && canonicalTarget(hit.target) === t) return sid;
    }
    const preferred = preferredSlotForTarget(t, arr);
    return preferred ? canonicalSlotId(preferred.slot_id) : "";
  };
  const listSlotTargets = (enabledOnly) => {
    const arr = loadSlotRegistry();
    const out = [];
    const seen = {};
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (enabledOnly && !s.enabled) continue;
      const t = canonicalTarget(s.target || "");
      if (!t || t === "all" || seen[t]) continue;
      seen[t] = true;
      out.push(t);
    }
    return out;
  };
  const resolveOperationalTarget = (target, options) => {
    const opt = options && typeof options === "object" ? options : {};
    const allowAll = opt.allowAll === true;
    const fallback = canonicalTarget(opt.fallback || "");
    const t = canonicalTarget(target || "");
    if (allowAll && t === "all") return "all";
    if (t && t !== "all") {
      const known = listSlotTargets(false);
      if (known.indexOf(t) >= 0) return t;
    }
    if (fallback && fallback !== "all") return fallback;
    const enabledTargets = listSlotTargets(true);
    if (enabledTargets.length > 0) return enabledTargets[0];
    const allTargets = listSlotTargets(false);
    if (allTargets.length > 0) return allTargets[0];
    return "gemini";
  };
  const normalizeRuntimeMode = (v) => {
    const m = lower(v);
    return m === "autonomous" ? "autonomous" : "interactive";
  };
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
    const v = canonicalTarget(norm(props.getProperty("ARC_DEFAULT_TARGET") || "gemini"));
    return v || "gemini";
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
  const compactScanMaxRaw = parseInt(norm(props.getProperty("ARC_COMPACT_SCAN_MAX")) || "300", 10);
  const compactScanMax = Number.isFinite(compactScanMaxRaw) && compactScanMaxRaw >= 50 ? Math.min(compactScanMaxRaw, 3000) : 300;
  const auditCompactWindowSecRaw = parseInt(norm(props.getProperty("ARC_AUDIT_COMPACT_WINDOW_SEC")) || "90", 10);
  const auditCompactWindowSec = Number.isFinite(auditCompactWindowSecRaw) && auditCompactWindowSecRaw >= 10 ? Math.min(auditCompactWindowSecRaw, 3600) : 90;
  const errorCompactWindowSecRaw = parseInt(norm(props.getProperty("ARC_ERROR_COMPACT_WINDOW_SEC")) || "300", 10);
  const errorCompactWindowSec = Number.isFinite(errorCompactWindowSecRaw) && errorCompactWindowSecRaw >= 30 ? Math.min(errorCompactWindowSecRaw, 7200) : 300;
  const routeRecentWindowSecRaw = parseInt(norm(props.getProperty("ARC_ROUTE_RECENT_WINDOW_SEC")) || "45", 10);
  const routeRecentWindowSec = Number.isFinite(routeRecentWindowSecRaw) && routeRecentWindowSecRaw >= 10 ? Math.min(routeRecentWindowSecRaw, 600) : 45;
  const routeCursorLookbackRowsRaw = parseInt(norm(props.getProperty("ARC_ROUTE_CURSOR_LOOKBACK_ROWS")) || "40", 10);
  const routeCursorLookbackRows = Number.isFinite(routeCursorLookbackRowsRaw) && routeCursorLookbackRowsRaw >= 5 ? Math.min(routeCursorLookbackRowsRaw, 500) : 40;
  const routeBackfillSecRaw = parseInt(norm(props.getProperty("ARC_ROUTE_BACKFILL_SEC")) || "60", 10);
  const routeBackfillSec = Number.isFinite(routeBackfillSecRaw) && routeBackfillSecRaw >= 10 ? Math.min(routeBackfillSecRaw, 900) : 60;
  const leaseProgressTouchEnabled = lower(norm(props.getProperty("ARC_LEASE_PROGRESS_TOUCH_ENABLED") || "true")) === "true";
  const adaptiveTargetEnabled = lower(norm(props.getProperty("ARC_ADAPTIVE_TARGET_ENABLED") || "true")) === "true";
  const adaptiveWindowSecRaw = parseInt(norm(props.getProperty("ARC_ADAPTIVE_TARGET_WINDOW_SEC")) || "1800", 10);
  const adaptiveWindowSec = Number.isFinite(adaptiveWindowSecRaw) && adaptiveWindowSecRaw >= 120
    ? Math.min(adaptiveWindowSecRaw, 86400)
    : 1800;
  const adaptiveScanMaxRaw = parseInt(norm(props.getProperty("ARC_ADAPTIVE_TARGET_SCAN_MAX")) || "400", 10);
  const adaptiveScanMax = Number.isFinite(adaptiveScanMaxRaw) && adaptiveScanMaxRaw >= 100
    ? Math.min(adaptiveScanMaxRaw, 2000)
    : 400;
  const consultEnabled = lower(norm(props.getProperty("ARC_CONSULT_ENABLED") || "false")) === "true";
  const targetCooldownSecRaw = parseInt(norm(props.getProperty("ARC_TARGET_COOLDOWN_SEC")) || "180", 10);
  const targetCooldownSec = Number.isFinite(targetCooldownSecRaw) && targetCooldownSecRaw >= 30
    ? Math.min(targetCooldownSecRaw, 3600)
    : 180;
  const targetFailStreakThresholdRaw = parseInt(norm(props.getProperty("ARC_TARGET_FAIL_STREAK_THRESHOLD")) || "2", 10);
  const targetFailStreakThreshold = Number.isFinite(targetFailStreakThresholdRaw) && targetFailStreakThresholdRaw >= 1
    ? Math.min(targetFailStreakThresholdRaw, 10)
    : 2;

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
      , ARC_COMPACT_SCAN_MAX: "300"
      , ARC_AUDIT_COMPACT_WINDOW_SEC: "90"
      , ARC_ERROR_COMPACT_WINDOW_SEC: "300"
      , ARC_ROUTE_RECENT_WINDOW_SEC: "45"
      , ARC_ROUTE_CURSOR_LOOKBACK_ROWS: "40"
      , ARC_ROUTE_BACKFILL_SEC: "60"
      , ARC_LEASE_PROGRESS_TOUCH_ENABLED: "true"
      , ARC_LEASE_EXPIRE_MAX: "2"
    };
    Object.keys(defaults).forEach((k) => {
      if (!norm(props.getProperty(k))) props.setProperty(k, defaults[k]);
    });
    if (!norm(props.getProperty("ARC_SLOT_REGISTRY_JSON"))) {
      props.setProperty("ARC_SLOT_REGISTRY_JSON", JSON.stringify(defaultSlotRegistry()));
    }
  };

  const expectedAuth = props.getProperty("ARC_AUTH_KEY") || "";
  const requiresAuth = [
    "arc_result", "report_result",
    "arc_error", "report_error",
    "arc_learning",
    "arc_heartbeat", "register_worker", "lease_job",
    "arc_consult", "route_chat",
    "mothership_submit", "mothership_heartbeat", "mothership_pull", "mothership_result", "mothership_error",
    "admin_status", "admin_cleanup", "admin_pause", "admin_resume", "admin_recover_queues", "admin_debug_snapshot", "admin_job_probe", "admin_chat_probe", "admin_mission_timing", "admin_set_timeouts", "admin_target_scores", "admin_slot_scores", "admin_slot_list", "admin_slot_upsert", "admin_slot_delete",
    "admin_diag_latest",
    "gateway_memory_put", "gateway_memory_get", "gateway_memory_search", "memory_put", "memory_get", "memory_search",
    "arc_memory_put", "arc_memory_get", "arc_short_memory_put", "arc_short_memory_get",
    "arc_diag_snapshot",
    "arc_runtime_status", "arc_runtime_set", "arc_set_runtime_mode"
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
    arcShortMemory: ensureSheet("ARC_SHORT_MEMORY", ["Timestamp", "WorkerID", "SessionID", "Key", "Value", "TTL_SEC", "ExpiresAt", "TraceID"]),
    diag: ensureSheet("ARC_COPILOT_DIAG", [
      "Timestamp", "WorkerID", "Target", "PageUrl", "PageTitle",
      "Webdriver", "UserAgent", "Platform", "Languages", "HardwareConcurrency",
      "WebglVendor", "WebglRenderer", "CanvasHash", "StorageFlags",
      "Headers", "ChallengeDetected", "ChallengeText", "Note", "TraceID"
    ])
  };

  const addAudit = (traceId, event, jobId, worker, status, detail) => {
    try {
      const trace = norm(traceId);
      const evt = norm(event);
      const job = norm(jobId);
      const workerNorm = norm(worker);
      const statusNorm = norm(status);
      const detailNorm = norm(detail);
      const recent = readRecentRows(sheets.audit, 7, compactScanMax);
      let found = -1;
      const nowTs = Date.now();
      const windowMs = auditCompactWindowSec * 1000;
      for (let i = recent.rows.length - 1; i >= 0; i--) {
        const row = recent.rows[i];
        const rowTs = toMs(row[0]);
        if (Number.isFinite(rowTs) && nowTs - rowTs > windowMs) break;
        if (norm(row[1]) !== trace) continue;
        if (norm(row[2]) !== evt) continue;
        if (norm(row[3]) !== job) continue;
        if (norm(row[4]) !== workerNorm) continue;
        if (norm(row[5]) !== statusNorm) continue;
        const rowDetailObj = parseCompactDetail(row[6], "message");
        const rowDetailMsg = norm(rowDetailObj.message || row[6]);
        if (rowDetailMsg !== detailNorm) continue;
        found = recent.startRow + i;
        break;
      }
      if (found > 0) {
        const existing = sheets.audit.getRange(found, 1, 1, 7).getValues()[0];
        const existingTs = toMs(existing[0]);
        const mergedDetail = mergeCompactDetail(
          existing[6],
          "message",
          detailNorm,
          Number.isFinite(existingTs) ? new Date(existingTs).toISOString() : nowIso(),
          nowIso()
        );
        sheets.audit.getRange(found, 1, 1, 7).setValues([[new Date(), trace, evt, job, workerNorm, statusNorm, mergedDetail]]);
      } else {
        sheets.audit.appendRow([new Date(), trace, evt, job, workerNorm, statusNorm, detailNorm]);
      }
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
  const toMs = (v) => {
    const n = new Date(v).getTime();
    return Number.isFinite(n) ? n : NaN;
  };
  const readRecentRows = (sheet, width, scanMax) => {
    const last = sheet.getLastRow();
    if (last <= 1) return { startRow: 2, rows: [] };
    const start = Math.max(2, last - clamp(parseIntSafe(scanMax, compactScanMax), 50, 3000) + 1);
    const rows = sheet.getRange(start, 1, last - start + 1, width).getValues();
    return { startRow: start, rows: rows };
  };
  const parseCompactDetail = (raw, fallbackField) => {
    const txt = norm(raw);
    if (!txt) return {};
    try {
      const obj = JSON.parse(txt);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch (_) { }
    const out = {};
    out[fallbackField] = txt;
    return out;
  };
  const mergeCompactDetail = (existingRaw, fallbackField, latestText, seedFirstTs, nowIsoRaw) => {
    const nowIsoVal = norm(nowIsoRaw) || nowIso();
    const base = parseCompactDetail(existingRaw, fallbackField);
    const repeatRaw = parseInt(norm(base.repeat_count), 10);
    const repeatCount = Number.isFinite(repeatRaw) && repeatRaw >= 1 ? repeatRaw + 1 : 2;
    const firstTs = norm(base.first_ts) || norm(seedFirstTs) || nowIsoVal;
    const merged = {};
    Object.keys(base).forEach((k) => {
      if (k === "repeat_count" || k === "last_ts") return;
      merged[k] = base[k];
    });
    merged[fallbackField] = norm(latestText) || norm(merged[fallbackField]);
    merged.repeat_count = repeatCount;
    merged.first_ts = firstTs;
    merged.last_ts = nowIsoVal;
    return JSON.stringify(merged).slice(0, MAX_MEMORY_VALUE);
  };
  const parseMissionIdsFromText = (raw) => {
    const txt = norm(raw);
    if (!txt) return [];
    const out = [];
    const seen = {};
    const rxJob = /CHAT_[0-9]+_[0-9]+/g;
    const rxQid = /\b(?:qid|job_id|mission_id)\s*[:=]\s*([A-Za-z0-9_.:-]{6,120})/ig;
    let m;
    while ((m = rxJob.exec(txt)) !== null) {
      const id = norm(m[0]);
      if (!id || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    while ((m = rxQid.exec(txt)) !== null) {
      const id = norm(m[1]);
      if (!id || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  };
  const parseRepeatCount = (raw) => {
    const obj = parseCompactDetail(raw, "message");
    const n = parseInt(norm(obj.repeat_count), 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  };
  const parseHudSeq = (v) => {
    const n = parseInt(norm(v), 10);
    return Number.isFinite(n) && n >= 0 ? n : -1;
  };

  const setGatewayLongMemory = (key, value, source, traceId, tags) => {
    const k = norm(key).slice(0, MAX_MEMORY_KEY);
    if (!k) return { ok: false, error: "key_required" };
    const val = norm(value).slice(0, MAX_MEMORY_VALUE);
    const sourceNorm = norm(source);
    const trace = norm(traceId);
    const tagsNorm = norm(tags);
    const recent = readRecentRows(sheets.gatewayMemory, 6, compactScanMax);
    let found = -1;
    for (let i = recent.rows.length - 1; i >= 0; i--) {
      const row = recent.rows[i];
      if (norm(row[1]) !== k) continue;
      if (sourceNorm && norm(row[3]) !== sourceNorm) continue;
      found = recent.startRow + i;
      break;
    }
    const nextRow = [new Date(), k, val, sourceNorm, trace, tagsNorm];
    if (found > 0) sheets.gatewayMemory.getRange(found, 1, 1, nextRow.length).setValues([nextRow]);
    else sheets.gatewayMemory.appendRow(nextRow);
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

  const tokenizeForMemory = (text) => {
    const src = lower(text)
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9_\-\u3040-\u30ff\u3400-\u9fff]+/g, " ");
    const parts = src.split(/\s+/).map((x) => norm(x)).filter((x) => x.length >= 2);
    const stop = {
      the: 1, and: 1, for: 1, with: 1, from: 1, this: 1, that: 1, your: 1, you: 1, are: 1,
      の: 1, に: 1, は: 1, を: 1, が: 1, と: 1, で: 1, です: 1, ます: 1, する: 1
    };
    const out = [];
    const seen = {};
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (stop[p]) continue;
      if (seen[p]) continue;
      seen[p] = true;
      out.push(p);
      if (out.length >= 12) break;
    }
    return out;
  };

  const searchGatewayLongMemory = (query, opts) => {
    const options = opts && typeof opts === "object" ? opts : {};
    const limit = clamp(parseIntSafe(options.limit, 4), 1, 12);
    const scan = clamp(parseIntSafe(options.scan, 300), 50, 1200);
    const sourceFilter = norm(options.source);
    const tokens = tokenizeForMemory(query);
    const rows = readRecentRows(sheets.gatewayMemory, 6, scan).rows;
    const ranked = [];
    const sourceWeight = (src) => {
      const s = lower(src);
      if (s === "arc_result_auto") return 3.0;
      if (s === "arc_error_auto") return 2.2;
      if (s === "gateway_manual" || s === "gateway") return 1.6;
      if (s.indexOf("diag") >= 0 || s.indexOf("webview") >= 0) return 0.2;
      return 1.0;
    };
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const source = norm(row[3]);
      if (sourceFilter && source !== sourceFilter) continue;
      const key = norm(row[1]);
      const value = norm(row[2]);
      const tags = norm(row[5]);
      const keyL = lower(key);
      const valL = lower(value);
      const tagL = lower(tags);
      let score = 0;
      for (let t = 0; t < tokens.length; t++) {
        const tok = tokens[t];
        if (!tok) continue;
        if (keyL.indexOf(tok) >= 0) score += 2.2;
        if (valL.indexOf(tok) >= 0) score += 1.0;
        if (tagL.indexOf(tok) >= 0) score += 1.2;
      }
      if (tokens.length > 0 && score < 2.0) continue;
      const ts = toMs(row[0]);
      const recency = Number.isFinite(ts) ? Math.max(0, 1 - ((Date.now() - ts) / (1000 * 60 * 60 * 24 * 30))) : 0;
      const weighted = score * sourceWeight(source);
      ranked.push({
        timestamp: row[0],
        key: key,
        value: value,
        source: source,
        trace_id: norm(row[4]),
        tags: tags,
        _score: weighted + recency
      });
    }
    ranked.sort((a, b) => b._score - a._score);
    return ranked.slice(0, limit).map((r) => ({
      timestamp: r.timestamp,
      key: r.key,
      value: r.value,
      source: r.source,
      trace_id: r.trace_id,
      tags: r.tags
    }));
  };

  const compactMemoryItems = (rows, limitChars) => {
    const maxChars = clamp(parseIntSafe(limitChars, 900), 240, 2400);
    let used = 0;
    const lines = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = "[" + norm(r.key) + "] " + norm(r.value).slice(0, 360);
      if (!line.trim()) continue;
      if (used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.join("\n");
  };

  const findMainChatByMissionId = (missionId) => {
    const mid = norm(missionId);
    if (!mid) return null;
    const rows = sheets.main.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (norm(rows[i][5]) !== mid) continue;
      return {
        row_index: i + 1,
        ts: rows[i][0],
        user: norm(rows[i][1]),
        content: norm(rows[i][2]),
        status: norm(rows[i][3]),
        response: norm(rows[i][4]),
        mission_id: norm(rows[i][5])
      };
    }
    return null;
  };

  const buildGatewayMemoryContextForRoute = (user, target, slotId, prompt, missionId) => {
    const u = norm(user);
    const t = canonicalTarget(target);
    const sid = canonicalSlotId(slotId);
    const baseQuery = [u, t, sid, prompt].join(" ").trim();
    const hits = []
      .concat(searchGatewayLongMemory(baseQuery, { limit: 3, scan: 500, source: "arc_result_auto" }))
      .concat(searchGatewayLongMemory(baseQuery, { limit: 2, scan: 500, source: "arc_error_auto" }))
      .concat(searchGatewayLongMemory(baseQuery, { limit: 2, scan: 500, source: "gateway_manual" }));
    const dedup = [];
    const seen = {};
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      const k = norm(h.key) + "|" + norm(h.trace_id);
      if (!k || seen[k]) continue;
      seen[k] = true;
      dedup.push(h);
      if (dedup.length >= 6) break;
    }
    if (!dedup || dedup.length === 0) return { context: "", hit_count: 0, keys: [] };
    const compact = compactMemoryItems(dedup, 900);
    if (!compact) return { context: "", hit_count: 0, keys: [] };
    const memoryHeader = "【Gateway記憶(関連)】\n" + compact + "\n";
    return {
      context: memoryHeader,
      hit_count: dedup.length,
      keys: dedup.map((x) => norm(x.key)).filter((x) => x)
    };
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
    const valueNorm = norm(value).slice(0, MAX_MEMORY_VALUE);
    const trace = norm(traceId);
    const recent = readRecentRows(sheets.arcShortMemory, 8, compactScanMax);
    let found = -1;
    const nowMs = Date.now();
    for (let i = recent.rows.length - 1; i >= 0; i--) {
      const row = recent.rows[i];
      const expiresAtMs = toMs(row[6]);
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) continue;
      if (norm(row[1]) !== worker) continue;
      if (norm(row[2]) !== session) continue;
      if (norm(row[3]) !== k) continue;
      found = recent.startRow + i;
      break;
    }
    const nextRow = [
      new Date(),
      worker,
      session,
      k,
      valueNorm,
      ttlSec,
      expiresAt,
      trace
    ];
    if (found > 0) sheets.arcShortMemory.getRange(found, 1, 1, nextRow.length).setValues([nextRow]);
    else sheets.arcShortMemory.appendRow(nextRow);
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

  const getTargetFailStreak = (target) => {
    const t = canonicalTarget(target);
    if (!t) return 0;
    const cache = CacheService.getScriptCache();
    const n = parseInt(norm(cache.get("target_fail_streak:" + t)), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const getTargetCooldownState = (target) => {
    const t = canonicalTarget(target);
    if (!t) return { active: false, remaining_sec: 0, streak: 0, until_ms: 0 };
    const cache = CacheService.getScriptCache();
    const untilMsRaw = parseInt(norm(cache.get("target_cooldown_until:" + t)), 10);
    const untilMs = Number.isFinite(untilMsRaw) && untilMsRaw > 0 ? untilMsRaw : 0;
    const remainingSec = untilMs > 0 ? Math.max(0, Math.ceil((untilMs - Date.now()) / 1000)) : 0;
    return {
      active: remainingSec > 0,
      remaining_sec: remainingSec,
      streak: getTargetFailStreak(t),
      until_ms: untilMs
    };
  };

  const clearTargetDegradeState = (target) => {
    const t = canonicalTarget(target);
    if (!t) return;
    const cache = CacheService.getScriptCache();
    cache.remove("target_fail_streak:" + t);
    cache.remove("target_cooldown_until:" + t);
  };

  const shouldCooldownForError = (errType, errData) => {
    const u = upper(errType + " " + errData);
    return (
      u.indexOf("STALL") >= 0 ||
      u.indexOf("TIMEOUT") >= 0 ||
      u.indexOf("LOGIN_REQUIRED") >= 0 ||
      u.indexOf("BOT_BLOCKED") >= 0 ||
      u.indexOf("TARGET_STALL") >= 0 ||
      u.indexOf("SCREEN_BLOCKED") >= 0 ||
      u.indexOf("NO_PROGRESS") >= 0 ||
      u.indexOf("NETWORK") >= 0 ||
      u.indexOf("RATE_LIMIT") >= 0
    );
  };

  const markTargetFailure = (target, errType, errData, traceId) => {
    const t = canonicalTarget(target);
    if (!t) return { cooled: false, streak: 0, reason: "invalid_target" };
    if (!shouldCooldownForError(errType, errData)) return { cooled: false, streak: getTargetFailStreak(t), reason: "non_cooldown_error" };
    const cache = CacheService.getScriptCache();
    const prev = getTargetFailStreak(t);
    const streak = prev + 1;
    cache.put("target_fail_streak:" + t, String(streak), Math.max(targetCooldownSec * 3, 300));
    if (streak < targetFailStreakThreshold) return { cooled: false, streak: streak, reason: "threshold_not_reached" };
    const untilMs = Date.now() + targetCooldownSec * 1000;
    cache.put("target_cooldown_until:" + t, String(untilMs), targetCooldownSec);
    addAudit(norm(traceId), "TARGET_COOLDOWN_ON", "", "", "warn", t + " / streak=" + streak + " / sec=" + targetCooldownSec);
    return { cooled: true, streak: streak, cooldown_sec: targetCooldownSec, until_ms: untilMs };
  };

  const markTargetSuccess = (target, traceId) => {
    const t = canonicalTarget(target);
    if (!t) return;
    const state = getTargetCooldownState(t);
    if (state.streak <= 0 && !state.active) return;
    clearTargetDegradeState(t);
    addAudit(norm(traceId), "TARGET_COOLDOWN_OFF", "", "", "ok", t + " / recovered");
  };

  const buildAdaptiveTargetScores = (windowSecRaw) => {
    const windowSec = clamp(parseIntSafe(windowSecRaw, adaptiveWindowSec), 120, 86400);
    const nowMs = Date.now();
    const fromMs = nowMs - windowSec * 1000;
    const targets = (() => {
      const slots = loadSlotRegistry();
      const seen = {};
      const out = [];
      for (let i = 0; i < slots.length; i++) {
        const t = canonicalTarget(slots[i].target || "");
        if (!t || seen[t]) continue;
        seen[t] = true;
        out.push(t);
      }
      if (!seen[defaultTarget]) {
        seen[defaultTarget] = true;
        out.push(defaultTarget);
      }
      if (out.length === 0) return ["gemini"];
      return out;
    })();
    const stats = {};
    targets.forEach((t) => {
      stats[t] = {
        target: t,
        success: 0,
        error: 0,
        latency_sum_sec: 0,
        latency_count: 0,
        avg_latency_sec: null,
        terminated: 0,
        success_rate: null,
        cooldown_active: false,
        cooldown_remaining_sec: 0,
        fail_streak: 0
      };
    });

    const jobMap = {};
    const jobs = readRecentRows(sheets.jobs, 7, adaptiveScanMax).rows;
    for (let i = jobs.length - 1; i >= 0; i--) {
      const row = jobs[i];
      const jobId = norm(row[1]);
      if (!jobId || jobMap[jobId]) continue;
      const createdMs = toMs(row[0]);
      if (!Number.isFinite(createdMs) || createdMs < fromMs) continue;
      const payload = parseJsonSafe(norm(row[4]));
      const target = canonicalTarget(payload.target || "");
      if (!target || !stats[target]) continue;
      jobMap[jobId] = { target: target, createdMs: createdMs };
    }

    const results = readRecentRows(sheets.results, 6, adaptiveScanMax).rows;
    for (let i = results.length - 1; i >= 0; i--) {
      const row = results[i];
      const tsMs = toMs(row[0]);
      if (!Number.isFinite(tsMs) || tsMs < fromMs) continue;
      const missionId = norm(row[1]);
      const job = jobMap[missionId];
      const target = job ? job.target : canonicalTarget(row[2]);
      if (!target || !stats[target]) continue;
      const st = stats[target];
      st.success++;
      if (job && Number.isFinite(job.createdMs)) {
        const latencySec = Math.max(0, Math.floor((tsMs - job.createdMs) / 1000));
        st.latency_sum_sec += latencySec;
        st.latency_count++;
      }
    }

    const errors = readRecentRows(sheets.errors, 4, adaptiveScanMax).rows;
    for (let i = errors.length - 1; i >= 0; i--) {
      const row = errors[i];
      const tsMs = toMs(row[0]);
      if (!Number.isFinite(tsMs) || tsMs < fromMs) continue;
      const missionId = norm(row[1]);
      const job = jobMap[missionId];
      if (!job || !stats[job.target]) continue;
      stats[job.target].error++;
    }

    targets.forEach((t) => {
      const st = stats[t];
      st.terminated = st.success + st.error;
      st.success_rate = st.terminated > 0 ? Number((st.success / st.terminated).toFixed(3)) : null;
      st.avg_latency_sec = st.latency_count > 0 ? Number((st.latency_sum_sec / st.latency_count).toFixed(2)) : null;
      const cool = getTargetCooldownState(t);
      st.cooldown_active = cool.active;
      st.cooldown_remaining_sec = cool.remaining_sec;
      st.fail_streak = cool.streak;
    });

    return stats;
  };

  const pickAdaptiveTarget = (opts) => {
    const options = opts && typeof opts === "object" ? opts : {};
    const preferred = canonicalTarget(options.preferred || "") || defaultTarget;
    const exclude = canonicalTarget(options.exclude || "");
    const forceAdaptive = options.forceAdaptive === true;
    const scores = buildAdaptiveTargetScores(options.windowSec);
    const baseCandidates = Object.keys(scores).filter((t) => t !== exclude);
    if (baseCandidates.length === 0) {
      return { target: preferred, reason: "no_candidate", scores: scores };
    }
    const readyCandidates = baseCandidates.filter((t) => !(scores[t] && scores[t].cooldown_active));
    const candidates = readyCandidates.length > 0 ? readyCandidates : baseCandidates;

    let best = null;
    for (let i = 0; i < candidates.length; i++) {
      const t = candidates[i];
      const st = scores[t];
      if (!st) continue;
      if (!best) {
        best = { target: t, st: st };
        continue;
      }
      const b = best.st;
      const sr = st.success_rate === null ? -1 : st.success_rate;
      const bSr = b.success_rate === null ? -1 : b.success_rate;
      if (sr > bSr) {
        best = { target: t, st: st };
        continue;
      }
      if (sr < bSr) continue;
      const lat = st.avg_latency_sec === null ? 999999 : st.avg_latency_sec;
      const bLat = b.avg_latency_sec === null ? 999999 : b.avg_latency_sec;
      if (lat < bLat) {
        best = { target: t, st: st };
        continue;
      }
      if (lat > bLat) continue;
      if (st.success > b.success) best = { target: t, st: st };
    }

    if (!best) return { target: preferred, reason: "no_stats", scores: scores };
    const hasTerminated = best.st.terminated > 0;
    if (!hasTerminated && !forceAdaptive) {
      return { target: preferred, reason: "insufficient_stats", scores: scores };
    }
    return {
      target: best.target,
      reason: "adaptive_best",
      scores: scores,
      success_rate: best.st.success_rate,
      avg_latency_sec: best.st.avg_latency_sec
    };
  };

  const buildAdaptiveSlotScores = (windowSecRaw) => {
    const windowSec = clamp(parseIntSafe(windowSecRaw, adaptiveWindowSec), 120, 86400);
    const nowMs = Date.now();
    const fromMs = nowMs - windowSec * 1000;
    const slots = loadSlotRegistry();
    const stats = {};
    slots.forEach((s) => {
      const sid = canonicalSlotId(s.slot_id);
      if (!sid) return;
      stats[sid] = {
        slot_id: sid,
        display_name: norm(s.display_name) || sid,
        target: canonicalTarget(s.target) || "",
        enabled: !!s.enabled,
        priority: Number(s.priority || 0),
        success: 0,
        error: 0,
        latency_sum_sec: 0,
        latency_count: 0,
        avg_latency_sec: null,
        terminated: 0,
        success_rate: null
      };
    });

    const fallbackSlotForTarget = (target) => {
      const slot = preferredSlotForTarget(target, slots);
      return slot ? canonicalSlotId(slot.slot_id) : "";
    };

    const jobMap = {};
    const jobs = readRecentRows(sheets.jobs, 7, adaptiveScanMax).rows;
    for (let i = jobs.length - 1; i >= 0; i--) {
      const row = jobs[i];
      const jobId = norm(row[1]);
      if (!jobId || jobMap[jobId]) continue;
      const createdMs = toMs(row[0]);
      if (!Number.isFinite(createdMs) || createdMs < fromMs) continue;
      const payload = parseJsonSafe(norm(row[4]));
      const target = canonicalTarget(payload.target || "");
      const sid = canonicalSlotId(payload.slot_id || "") || fallbackSlotForTarget(target);
      if (!sid || !stats[sid]) continue;
      jobMap[jobId] = { slot_id: sid, createdMs: createdMs };
    }

    const results = readRecentRows(sheets.results, 6, adaptiveScanMax).rows;
    for (let i = results.length - 1; i >= 0; i--) {
      const row = results[i];
      const tsMs = toMs(row[0]);
      if (!Number.isFinite(tsMs) || tsMs < fromMs) continue;
      const missionId = norm(row[1]);
      const job = jobMap[missionId];
      const sid = job ? job.slot_id : fallbackSlotForTarget(row[2]);
      if (!sid || !stats[sid]) continue;
      const st = stats[sid];
      st.success++;
      if (job && Number.isFinite(job.createdMs)) {
        const latencySec = Math.max(0, Math.floor((tsMs - job.createdMs) / 1000));
        st.latency_sum_sec += latencySec;
        st.latency_count++;
      }
    }

    const errors = readRecentRows(sheets.errors, 4, adaptiveScanMax).rows;
    for (let i = errors.length - 1; i >= 0; i--) {
      const row = errors[i];
      const tsMs = toMs(row[0]);
      if (!Number.isFinite(tsMs) || tsMs < fromMs) continue;
      const missionId = norm(row[1]);
      const job = jobMap[missionId];
      if (!job || !stats[job.slot_id]) continue;
      stats[job.slot_id].error++;
    }

    Object.keys(stats).forEach((sid) => {
      const st = stats[sid];
      st.terminated = st.success + st.error;
      st.success_rate = st.terminated > 0 ? Number((st.success / st.terminated).toFixed(3)) : null;
      st.avg_latency_sec = st.latency_count > 0 ? Number((st.latency_sum_sec / st.latency_count).toFixed(2)) : null;
    });
    return stats;
  };

  const pickAdaptiveSlot = (opts) => {
    const options = opts && typeof opts === "object" ? opts : {};
    const slots = loadSlotRegistry();
    const preferred = canonicalSlotId(options.preferred || "");
    const exclude = canonicalSlotId(options.exclude || "");
    const forceAdaptive = options.forceAdaptive === true;
    const scores = buildAdaptiveSlotScores(options.windowSec);
    const candidates = Object.keys(scores).filter((sid) => {
      const st = scores[sid];
      if (!st || !st.enabled) return false;
      if (sid === exclude) return false;
      return true;
    });
    if (candidates.length === 0) {
      const fallback = preferred || (slots.find((s) => s.enabled) ? canonicalSlotId(slots.find((s) => s.enabled).slot_id) : "");
      return { slot_id: fallback, reason: "no_enabled_slot", scores: scores };
    }
    const ranked = candidates.sort((a, b) => {
      const A = scores[a];
      const B = scores[b];
      const aSr = A.success_rate === null ? -1 : A.success_rate;
      const bSr = B.success_rate === null ? -1 : B.success_rate;
      if (aSr !== bSr) return bSr - aSr;
      const aLat = A.avg_latency_sec === null ? 999999 : A.avg_latency_sec;
      const bLat = B.avg_latency_sec === null ? 999999 : B.avg_latency_sec;
      if (aLat !== bLat) return aLat - bLat;
      if (A.success !== B.success) return B.success - A.success;
      return (A.priority || 999) - (B.priority || 999);
    });
    const best = scores[ranked[0]];
    if (!best) return { slot_id: preferred || ranked[0], reason: "no_stats", scores: scores };
    if (best.terminated <= 0 && !forceAdaptive && preferred && scores[preferred] && scores[preferred].enabled) {
      return { slot_id: preferred, reason: "insufficient_stats", scores: scores };
    }
    return {
      slot_id: best.slot_id,
      reason: "adaptive_best",
      success_rate: best.success_rate,
      avg_latency_sec: best.avg_latency_sec,
      scores: scores
    };
  };

  const parseCommandTags = (text) => {
    const raw = norm(text);
    const l = raw.toLowerCase();
    const has = (t) => l.indexOf(t) >= 0;
    const slots = loadSlotRegistry();

    let route = defaultRoute;
    if (has("#arc") || has("@arc") || has("[arc]") || has("#proxy") || has("#baku") || has("@baku")) route = "ARC";
    if (has("#mother") || has("@mother") || has("#metron") || has("#osb")) route = "MOTHERSHIP";

    let executor = defaultExecutor;
    if (has("#baku") || has("@baku")) executor = "BAKU";
    else if (has("#arc") || has("@arc") || has("[arc]") || has("#proxy")) executor = "ARC";

    let target = defaultTarget;
    let requestedTarget = defaultTarget;
    let slotId = "";
    let adaptiveDecision = null;
    let targetPinned = false;
    let useMemory = true;
    const slotTag =
      (raw.match(/(?:^|\s)[#@]slot:([a-zA-Z0-9_-]{1,40})(?:\s|$)/i) || [])[1] ||
      (raw.match(/\[slot:([a-zA-Z0-9_-]{1,40})\]/i) || [])[1] ||
      "";
    const explicitTargetTag =
      (raw.match(/(?:^|\s)[#@]target:([a-zA-Z0-9_-]{1,40})(?:\s|$)/i) || [])[1] ||
      (raw.match(/\[target:([a-zA-Z0-9_-]{1,40})\]/i) || [])[1] ||
      "";
    if (slotTag) {
      const foundSlot = findSlotById(slotTag, slots);
      if (foundSlot) {
        slotId = canonicalSlotId(foundSlot.slot_id);
        target = canonicalTarget(foundSlot.target) || target;
        targetPinned = true;
      }
    }
    if (explicitTargetTag) {
      const explicitTarget = canonicalTarget(explicitTargetTag);
      if (explicitTarget) {
        target = explicitTarget;
        targetPinned = true;
      }
    } else if (has("#chatgpt") || has("@chatgpt") || has("[chatgpt]")) target = "chatgpt";
    else if (has("#copilot") || has("@copilot") || has("[copilot]")) target = "copilot";
    else if (has("#claude") || has("@claude") || has("[claude]")) target = "copilot";
    else if (has("#all") || has("@all")) target = "ALL";
    else if (has("#gemini") || has("@gemini") || has("[gemini]")) target = "gemini";
    if (
      has("#chatgpt") || has("@chatgpt") || has("[chatgpt]") ||
      has("#gemini") || has("@gemini") || has("[gemini]") ||
      has("#copilot") || has("@copilot") || has("[copilot]") ||
      has("#claude") || has("@claude") || has("[claude]")
    ) targetPinned = true;
    if (has("#pin_target") || has("@pin_target") || has("#locktarget") || has("#target_fixed")) targetPinned = true;
    if (has("#allow_failover") || has("@allow_failover")) targetPinned = false;
    if (has("#no_memory") || has("@no_memory") || has("#memory_off")) useMemory = false;
    if (has("#memory_on") || has("@memory_on")) useMemory = true;
    if (lower(target) !== "all") {
      target = resolveOperationalTarget(target, { fallback: defaultTarget });
    }
    requestedTarget = target;
    if (slotId) {
      const hitSlot = findSlotById(slotId, slots);
      if (!hitSlot || canonicalTarget(hitSlot.target) !== canonicalTarget(target)) {
        slotId = "";
      }
    }
    if (!slotId && lower(target) !== "all") {
      slotId = resolveSlotForTarget(target, "", slots);
    }

    let opMode = "request_arc";
    if (has("#refresh")) opMode = "arc_refresh";
    else if (has("#screenshot") || has("#shot")) opMode = "arc_screenshot";
    let runtimeMode = "";
    if (has("#runtime_auto") || has("#autonomous") || has("#mode_auto")) {
      opMode = "arc_set_runtime_mode";
      runtimeMode = "autonomous";
    } else if (has("#runtime_interactive") || has("#mode_interactive")) {
      opMode = "arc_set_runtime_mode";
      runtimeMode = "interactive";
    }

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
      .replace(/\[target:[a-zA-Z0-9_-]{1,40}\]/gi, " ")
      .replace(/\[slot:[a-zA-Z0-9_-]{1,40}\]/gi, " ")
      .replace(/\[arc\]/gi, " ")
      .replace(/\[(chatgpt|gemini|copilot|claude)\]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleanPrompt) cleanPrompt = raw;
    if (cleanPrompt.length > MAX_PROMPT) cleanPrompt = cleanPrompt.slice(0, MAX_PROMPT);

    if (adaptiveTargetEnabled && !targetPinned && route === "ARC" && opMode === "request_arc" && lower(target) !== "all") {
      const picked = pickAdaptiveTarget({ preferred: target });
      adaptiveDecision = picked;
      target = picked.target || target;
      const adaptiveSlot = preferredSlotForTarget(target, slots);
      if (adaptiveSlot) slotId = canonicalSlotId(adaptiveSlot.slot_id);
    }

    return {
      route: route,
      target: target,
      slotId: slotId,
      opMode: opMode,
      script: script,
      prompt: cleanPrompt,
      executor: executor,
      pinTarget: targetPinned,
      runtimeMode: runtimeMode,
      requestedTarget: requestedTarget,
      adaptiveDecision: adaptiveDecision,
      useMemory: useMemory
    };
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
    const resolvedTarget = resolveOperationalTarget(job.target, { allowAll: true, fallback: defaultTarget });
    const resolvedSlot = resolveSlotForTarget(resolvedTarget, job.slotId || job.slot_id);
    const payload = {
      qid: norm(job.qid) || jobId,
      target: resolvedTarget,
      slot_id: resolvedSlot,
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
    if (payload.target === "all") {
      payload.lease_timeout_sec = Math.max(leaseTimeoutSec, 420);
      payload.pending_timeout_sec = Math.max(pendingTimeoutSec, 900);
    }
    if (norm(job.targetStrategy)) payload.target_strategy = norm(job.targetStrategy).slice(0, 64);
    if (norm(job.targetReason)) payload.target_reason = norm(job.targetReason).slice(0, 180);
    if (job.targetSuccessRate !== null && job.targetSuccessRate !== undefined) payload.target_success_rate = job.targetSuccessRate;
    if (job.targetAvgLatencySec !== null && job.targetAvgLatencySec !== undefined) payload.target_avg_latency_sec = job.targetAvgLatencySec;
    if (norm(job.mode) === "arc_set_runtime_mode") {
      payload.runtime_mode = normalizeRuntimeMode(job.runtimeMode || job.runtime_mode);
    }
    sheets.jobs.appendRow([new Date(), jobId, norm(job.workerId), norm(job.mode) || "request_arc", JSON.stringify(payload), "pending", ""]);
    addAudit(traceId, "JOB_ENQUEUED", jobId, norm(job.workerId), "pending", payload.executor + " / " + payload.target + " / slot=" + (payload.slot_id || "-") + " / retry=" + retryCount);
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
    for (let i = rows.length - 1; i >= 0; i--) {
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
      const memPack = cmd.useMemory
        ? buildGatewayMemoryContextForRoute(user, cmd.target, cmd.slotId, cmd.prompt, resolvedId)
        : { context: "", hit_count: 0, keys: [] };
      const promptWithMemory = memPack.context
        ? (memPack.context + "\n【依頼】\n" + cmd.prompt)
        : cmd.prompt;
      const jobRes = enqueueArcJob({
        // qid と jobId は同一にして、結果報告の突合失敗を防ぐ
        jobId: resolvedId,
        qid: resolvedId,
        target: cmd.target,
        slotId: cmd.slotId,
        targetStrategy: cmd.adaptiveDecision ? "adaptive" : "requested",
        targetReason: cmd.adaptiveDecision ? norm(cmd.adaptiveDecision.reason) : "requested",
        targetSuccessRate: cmd.adaptiveDecision ? cmd.adaptiveDecision.success_rate : null,
        targetAvgLatencySec: cmd.adaptiveDecision ? cmd.adaptiveDecision.avg_latency_sec : null,
        prompt: promptWithMemory,
        script: cmd.script,
        runtimeMode: cmd.runtimeMode,
        mode: effectiveMode,
        executor: cmd.executor,
        pinTarget: cmd.pinTarget ? "true" : "false",
        user: user,
        workerId: "",
        traceId: traceId,
        retryCount: 0
      });
      if (
        cmd.adaptiveDecision &&
        canonicalTarget(cmd.requestedTarget) &&
        canonicalTarget(cmd.requestedTarget) !== canonicalTarget(cmd.target)
      ) {
        addAudit(
          jobRes.traceId,
          "TARGET_ADAPTIVE_SELECTED",
          jobRes.jobId,
          "",
          "pending",
          canonicalTarget(cmd.requestedTarget) + "->" + canonicalTarget(cmd.target) +
          " / reason=" + norm(cmd.adaptiveDecision.reason) +
          " / sr=" + norm(cmd.adaptiveDecision.success_rate) +
          " / lat=" + norm(cmd.adaptiveDecision.avg_latency_sec)
        );
      }
      if (memPack.hit_count > 0) {
        addAudit(
          jobRes.traceId,
          "ROUTE_MEMORY_ATTACHED",
          jobRes.jobId,
          "",
          "ok",
          "hits=" + memPack.hit_count + " / keys=" + memPack.keys.join(",").slice(0, 320)
        );
      }
      sheets.main.getRange(rowIndex, 4).setValue("QUEUED_ARC");
      const slotNote = cmd.slotId ? (" / " + cmd.slotId) : "";
      sheets.main.getRange(rowIndex, 5).setValue("ARC queued: " + effectiveMode + " / " + cmd.target + slotNote + " / " + cmd.executor + " / " + jobRes.traceId);
      sheets.main.getRange(rowIndex, 6).setValue(jobRes.jobId);
      return { routed: "ARC", jobId: jobRes.jobId, mode: effectiveMode, traceId: jobRes.traceId, slotId: jobRes.payload.slot_id || "" };
    }

    const msgId = missionId || ("MS_" + rowIndex + "_" + Date.now());
    sheets.mothership.appendRow([new Date(), msgId, user, content, "pending"]);
    sheets.main.getRange(rowIndex, 4).setValue("ROUTED_MOTHERSHIP");
    sheets.main.getRange(rowIndex, 5).setValue("Forwarded to MOTHERSHIP / " + traceId);
    sheets.main.getRange(rowIndex, 6).setValue(msgId);
    addAudit(traceId, "MOTHERSHIP_ROUTED", msgId, "", "pending", user);
    return { routed: "MOTHERSHIP", jobId: msgId, mode: "mothership_queue", traceId: traceId };
  };

  const routePendingChatCommands = (enableBackfillRaw) => {
    const enableBackfill = enableBackfillRaw === true || enableBackfillRaw === "true";
    const lastRow = sheets.main.getLastRow();
    if (lastRow <= 1) return [];
    const cursorRaw = parseInt(norm(props.getProperty("ARC_MAIN_ROUTE_CURSOR") || "1"), 10);
    const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 1 ? cursorRaw : 1;
    const startPrimary = Math.max(2, Math.min(lastRow, cursor + 1));
    const primaryRows = startPrimary <= lastRow
      ? sheets.main.getRange(startPrimary, 1, lastRow - startPrimary + 1, 6).getValues()
      : [];
    const routed = [];
    for (let i = 0; i < primaryRows.length; i++) {
      const rowIndex = startPrimary + i;
      const res = routeOneChatRow(rowIndex, primaryRows[i]);
      if (res) routed.push(res);
    }
    props.setProperty("ARC_MAIN_ROUTE_CURSOR", String(lastRow));

    if (!enableBackfill) return routed;
    const nowMs = Date.now();
    const lastBackfillRaw = parseInt(norm(props.getProperty("ARC_ROUTE_LAST_BACKFILL_TS") || "0"), 10);
    const lastBackfillMs = Number.isFinite(lastBackfillRaw) && lastBackfillRaw >= 0 ? lastBackfillRaw : 0;
    if (nowMs - lastBackfillMs < routeBackfillSec * 1000) return routed;

    const startTail = Math.max(2, lastRow - routeCursorLookbackRows + 1);
    const tailRows = sheets.main.getRange(startTail, 1, lastRow - startTail + 1, 6).getValues();
    for (let i = 0; i < tailRows.length; i++) {
      const row = tailRows[i];
      const st = lower(row[3]);
      if (st && st !== "new" && st !== "pending") continue;
      const rowIndex = startTail + i;
      const res = routeOneChatRow(rowIndex, row);
      if (res) routed.push(res);
    }
    props.setProperty("ARC_ROUTE_LAST_BACKFILL_TS", String(nowMs));
    return routed;
  };
  const collectRecentRoutedDetails = (windowSecRaw, limitRaw) => {
    const windowSec = clamp(parseIntSafe(windowSecRaw, routeRecentWindowSec), 10, 600);
    const limit = clamp(parseIntSafe(limitRaw, 3), 1, 10);
    const lastRow = sheets.main.getLastRow();
    if (lastRow <= 1) return [];
    const scanRows = clamp(routeCursorLookbackRows * 2, 20, 1200);
    const startRow = Math.max(2, lastRow - scanRows + 1);
    const rows = sheets.main.getRange(startRow, 1, lastRow - startRow + 1, 6).getValues();
    const nowMs = Date.now();
    const out = [];
    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      const ts = toMs(row[0]);
      if (Number.isFinite(ts) && nowMs - ts > windowSec * 1000) break;
      const st = lower(row[3]);
      if (st !== "queued_arc" && st !== "routed_mothership") continue;
      const missionId = norm(row[5]);
      if (!missionId) continue;
      const response = norm(row[4]);
      const routed = st === "queued_arc" ? "ARC" : "MOTHERSHIP";
      let modeName = st === "queued_arc" ? "request_arc" : "mothership_queue";
      if (st === "queued_arc" && response.indexOf("ARC queued:") === 0) {
        const parts = response.split(" / ");
        if (parts.length >= 2) modeName = norm(parts[1]) || modeName;
      }
      out.push({
        routed: routed,
        jobId: missionId,
        mode: modeName,
        traceId: st === "queued_arc" && response.lastIndexOf(" / ") > 0
          ? norm(response.substring(response.lastIndexOf(" / ") + 3))
          : ""
      });
      if (out.length >= limit) break;
    }
    return out;
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
      const payload = parseJsonSafe(norm(row[4]));
      const rowLeaseSecRaw = parseInt(norm(payload.lease_timeout_sec || ""), 10);
      const rowLeaseMs = Number.isFinite(rowLeaseSecRaw) && rowLeaseSecRaw >= 30
        ? rowLeaseSecRaw * 1000
        : thresholdMs;
      const leasedAt = new Date(row[6]).getTime();
      if (!Number.isFinite(leasedAt) || now - leasedAt < rowLeaseMs) continue;

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
    const hudCandidates = parseMissionIdsFromText(hb.hud_tail);
    hudCandidates.forEach((id) => {
      if (candidates.indexOf(id) < 0) candidates.push(id);
    });
    const rows = sheets.jobs.getDataRange().getValues();
    if (candidates.length > 0) {
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
    }
    // フォールバック: 実行中シグナルがある heartbeat は同一workerの最新 leased を延命
    const hbStatus = lower(norm(hb.status || ""));
    const progressSignal = hb.progress_signal === true || hb.progress_signal === "true";
    const canFallbackTouch =
      hbStatus === "running" ||
      hbStatus === "working" ||
      hbStatus === "processing" ||
      hbStatus === "waiting" ||
      hbStatus === "busy" ||
      progressSignal;
    if (canFallbackTouch && workerId) {
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
      const payload = parseJsonSafe(norm(row[4]));
      const rowPendingSecRaw = parseInt(norm(payload.pending_timeout_sec || ""), 10);
      const rowPendingMs = Number.isFinite(rowPendingSecRaw) && rowPendingSecRaw >= 60
        ? rowPendingSecRaw * 1000
        : thresholdMs;
      if (!Number.isFinite(createdAtMs) || now - createdAtMs < rowPendingMs) continue;
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

  const safeClaimNextInstruction = (workerId, consumer, traceId) => {
    try {
      return claimNextInstruction(workerId, consumer);
    } catch (err) {
      const detail = (() => {
        try {
          if (err && err.stack) return String(err.stack).slice(0, 1200);
          return String(err || "claim_exception").slice(0, 1200);
        } catch (_) {
          return "claim_exception";
        }
      })();
      addAudit(norm(traceId), "JOB_LEASE_EXCEPTION", "", norm(workerId), "error", detail);
      return null;
    }
  };

  const runArcQueueMaintenance = (traceId, workerId, consumer) => {
    try {
      recoverStalePendingJobs();
      requeueExpiredLeases();
      routePendingChatCommands(false);
    } catch (err) {
      const detail = (() => {
        try {
          if (err && err.stack) return String(err.stack).slice(0, 1200);
          return String(err || "queue_maintenance_exception").slice(0, 1200);
        } catch (_) {
          return "queue_maintenance_exception";
        }
      })();
      addAudit(norm(traceId), "QUEUE_MAINT_EXCEPTION", "", norm(workerId), "error", norm(consumer) + ":" + detail);
    }
  };

  const hasLeasedJobForWorker = (workerId) => {
    const wid = norm(workerId);
    if (!wid) return false;
    const rows = sheets.jobs.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      if (lower(row[5]) !== "leased") continue;
      if (norm(row[2]) !== wid) continue;
      return true;
    }
    return false;
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
    const t = canonicalTarget(currentTarget);
    const fallbackTargets = (() => {
      const seen = {};
      const out = [];
      const slots = loadSlotRegistry();
      slots.forEach((s) => {
        const target = canonicalTarget(s.target || "");
        if (!target || target === "all" || !s.enabled || seen[target]) return;
        seen[target] = true;
        out.push(target);
      });
      slots.forEach((s) => {
        const target = canonicalTarget(s.target || "");
        if (!target || target === "all" || seen[target]) return;
        seen[target] = true;
        out.push(target);
      });
      if (!seen[defaultTarget]) out.push(defaultTarget);
      return out.filter((x, i, arr) => x && arr.indexOf(x) === i);
    })();
    if (adaptiveTargetEnabled) {
      const picked = pickAdaptiveTarget({ preferred: defaultTarget, exclude: t, forceAdaptive: true });
      const target = canonicalTarget(picked.target || "");
      if (target && target !== t) return target;
    }
    if (!t) return fallbackTargets[0] || defaultTarget || "gemini";
    const idx = fallbackTargets.indexOf(t);
    if (idx >= 0 && fallbackTargets.length > 1) {
      return fallbackTargets[(idx + 1) % fallbackTargets.length];
    }
    const alt = fallbackTargets.find((x) => x !== t);
    return alt || fallbackTargets[0] || defaultTarget || "gemini";
  };

  const maybeSwitchJobTargetForRecovery = (jobRowIndex, row, payload, reasonTag) => {
    if (!targetFailoverEnabled) return { switched: false, reason: "disabled" };
    const modeName = lower(row[3]);
    if (modeName !== "request_arc") return { switched: false, reason: "mode_not_supported" };
    if (lower(payload.pin_target) === "true") return { switched: false, reason: "target_pinned" };
    const from = canonicalTarget(payload.target || "");
    if (!from || from === "all") return { switched: false, reason: "invalid_target" };
    const to = nextFailoverTarget(from);
    if (from === to) return { switched: false, reason: "same_target" };
    payload.target = to;
    payload.slot_id = resolveSlotForTarget(to, payload.slot_id);
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
    const target = resolveOperationalTarget(norm(follow.target) || defaultTarget, { fallback: defaultTarget });
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
  const buildGatewayOpsMetrics = () => {
    const recentJobs = readRecentRows(sheets.jobs, 7, 400).rows;
    const recentMain = readRecentRows(sheets.main, 6, 300).rows;
    const recentErrors = readRecentRows(sheets.errors, 4, 200).rows;
    const recentAudit = readRecentRows(sheets.audit, 7, 300).rows;

    const doneOrErrRows = recentMain.filter((r) => {
      const st = lower(r[3]);
      return st === "arc_done" || st === "arc_error";
    });
    let doneCount = 0;
    let errorCount = 0;
    for (let i = 0; i < doneOrErrRows.length; i++) {
      const st = lower(doneOrErrRows[i][3]);
      if (st === "arc_done") doneCount++;
      else if (st === "arc_error") errorCount++;
    }
    const totalTerminated = doneCount + errorCount;
    const doneRate = totalTerminated > 0 ? Number((doneCount / totalTerminated).toFixed(3)) : null;

    let timeoutErr = 0;
    for (let i = 0; i < recentErrors.length; i++) {
      const typeTxt = upper(recentErrors[i][2]);
      const dataTxt = upper(recentErrors[i][3]);
      if (
        typeTxt.indexOf("LEASE_EXPIRE_MAX") >= 0 ||
        typeTxt.indexOf("PENDING_TIMEOUT") >= 0 ||
        dataTxt.indexOf("LEASE_EXPIRE_MAX") >= 0 ||
        dataTxt.indexOf("PENDING_TIMEOUT") >= 0
      ) {
        timeoutErr++;
      }
    }
    const timeoutRate = totalTerminated > 0 ? Number((timeoutErr / totalTerminated).toFixed(3)) : null;

    let compactAuditExtra = 0;
    let compactErrorExtra = 0;
    for (let i = 0; i < recentAudit.length; i++) {
      const rep = parseRepeatCount(recentAudit[i][6]);
      if (rep > 1) compactAuditExtra += (rep - 1);
    }
    for (let i = 0; i < recentErrors.length; i++) {
      const rep = parseRepeatCount(recentErrors[i][3]);
      if (rep > 1) compactErrorExtra += (rep - 1);
    }

    let staleLeasedCount = 0;
    const nowMs = Date.now();
    for (let i = 0; i < recentJobs.length; i++) {
      const row = recentJobs[i];
      if (lower(row[5]) !== "leased") continue;
      const leaseTs = toMs(row[6] || row[0]);
      if (!Number.isFinite(leaseTs)) continue;
      if (nowMs - leaseTs >= leaseTimeoutMs) staleLeasedCount++;
    }

    return {
      sample_main_terminal: totalTerminated,
      done_rate_recent: doneRate,
      timeout_error_count_recent: timeoutErr,
      timeout_rate_recent: timeoutRate,
      compact_saved_rows_recent: compactAuditExtra + compactErrorExtra,
      compact_saved_audit_recent: compactAuditExtra,
      compact_saved_error_recent: compactErrorExtra,
      stale_leased_recent: staleLeasedCount
    };
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
      version: "arc-gateway-20.4",
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

  const deployAppScript = (targetScriptId, resultText, traceId) => {
    try {
      const token = ScriptApp.getOAuthToken();
      if (!token) {
        addAudit(traceId, "DEPLOY_ERROR", targetScriptId, "", "error", "No OAuth Token available.");
        return false;
      }
      const files = [];
      const fileRegex = /---\s*FILE:\s*([a-zA-Z0-9_\-\.]+)\s*---\s*```[a-z]*\n([\s\S]*?)\n```/g;
      let match;
      while ((match = fileRegex.exec(resultText)) !== null) {
        const fileName = match[1].trim();
        const fileContent = match[2];
        const nameParts = fileName.split('.');
        if (nameParts.length < 2) continue;
        const typeStr = nameParts[nameParts.length - 1].toLowerCase();
        let fileType = "SERVER_JS";
        if (typeStr === 'html') fileType = "HTML";
        else if (typeStr === 'json') fileType = "JSON";
        files.push({
          name: nameParts.slice(0, -1).join('.'),
          type: fileType,
          source: fileContent
        });
      }
      if (files.length === 0) {
        addAudit(traceId, "DEPLOY_SKIP", targetScriptId, "", "warn", "No valid files found for deployment.");
        return false;
      }
      const contentUrl = "https://script.googleapis.com/v1/projects/" + targetScriptId + "/content";
      const fetchContentRes = UrlFetchApp.fetch(contentUrl, {
        method: "get",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true
      });
      let existingFiles = [];
      if (fetchContentRes.getResponseCode() === 200) {
        const contentData = JSON.parse(fetchContentRes.getContentText());
        existingFiles = contentData.files || [];
      }
      const hasManifest = files.some((f) => f.name === 'appsscript');
      if (!hasManifest) {
        const existingManifest = existingFiles.find((f) => f.name === 'appsscript');
        if (existingManifest) {
          files.push(existingManifest);
        }
      }
      const putPayload = { files: files };
      const putRes = UrlFetchApp.fetch(contentUrl, {
        method: "put",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + token },
        payload: JSON.stringify(putPayload),
        muteHttpExceptions: true
      });
      if (putRes.getResponseCode() >= 300) {
        addAudit(traceId, "DEPLOY_ERROR", targetScriptId, "", "error", "Failed to PUT code: " + putRes.getContentText());
        return false;
      }
      const versionsUrl = "https://script.googleapis.com/v1/projects/" + targetScriptId + "/versions";
      const verRes = UrlFetchApp.fetch(versionsUrl, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + token },
        payload: JSON.stringify({ description: "Auto-deployed by METRON at " + new Date().toISOString() }),
        muteHttpExceptions: true
      });
      if (verRes.getResponseCode() >= 300) {
        addAudit(traceId, "DEPLOY_ERROR", targetScriptId, "", "error", "Failed to create Version: " + verRes.getContentText());
        return false;
      }
      const versionData = JSON.parse(verRes.getContentText());
      const versionNumber = versionData.versionNumber;
      const deploymentsUrl = "https://script.googleapis.com/v1/projects/" + targetScriptId + "/deployments";
      const depsRes = UrlFetchApp.fetch(deploymentsUrl, {
        method: "get",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true
      });
      let currentDeploymentId = null;
      let deploymentsList = [];
      if (depsRes.getResponseCode() === 200) {
        const dData = JSON.parse(depsRes.getContentText());
        deploymentsList = dData.deployments || [];
        const existingWebDep = deploymentsList.find((d) => d.deploymentConfig && d.deploymentConfig.versionNumber);
        if (existingWebDep) {
          currentDeploymentId = existingWebDep.deploymentId;
        }
      }
      if (currentDeploymentId) {
        const updateUrl = "https://script.googleapis.com/v1/projects/" + targetScriptId + "/deployments/" + currentDeploymentId;
        const updatePayload = {
          deploymentConfig: {
            versionNumber: versionNumber,
            description: "Auto-deployed by METRON at " + new Date().toISOString()
          }
        };
        const updateRes = UrlFetchApp.fetch(updateUrl, {
          method: "put",
          contentType: "application/json",
          headers: { Authorization: "Bearer " + token },
          payload: JSON.stringify(updatePayload),
          muteHttpExceptions: true
        });
        if (updateRes.getResponseCode() >= 300) {
          addAudit(traceId, "DEPLOY_ERROR", targetScriptId, "", "error", "Failed to update deployment: " + updateRes.getContentText());
        } else {
          addAudit(traceId, "DEPLOY_SUCCESS", targetScriptId, "", "ok", "v" + versionNumber + " -> deps:" + currentDeploymentId);
        }
      } else {
        const createPayload = {
          versionNumber: versionNumber,
          description: "Initial Auto-deploy by METRON"
        };
        const createRes = UrlFetchApp.fetch(deploymentsUrl, {
          method: "post",
          contentType: "application/json",
          headers: { Authorization: "Bearer " + token },
          payload: JSON.stringify(createPayload),
          muteHttpExceptions: true
        });
        if (createRes.getResponseCode() >= 300) {
          addAudit(traceId, "DEPLOY_ERROR", targetScriptId, "", "error", "Failed to create deployment: " + createRes.getContentText());
        } else {
          const newData = JSON.parse(createRes.getContentText());
          addAudit(traceId, "DEPLOY_SUCCESS", targetScriptId, "", "ok", "v" + versionNumber + " -> NEW deps:" + newData.deploymentId);
        }
      }
      const verListRes = UrlFetchApp.fetch(versionsUrl, {
        method: "get",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true
      });
      if (verListRes.getResponseCode() === 200) {
        const vData = JSON.parse(verListRes.getContentText());
        const allVersions = vData.versions || [];
        if (allVersions.length > 150) {
          allVersions.sort((a, b) => a.versionNumber - b.versionNumber);
          const toDelete = allVersions.slice(0, 20);
          let deletedCount = 0;
          for (let i = 0; i < toDelete.length; i++) {
            const v = toDelete[i];
            const delUrl = "https://script.googleapis.com/v1/projects/" + targetScriptId + "/versions/" + v.versionNumber;
            const delRes = UrlFetchApp.fetch(delUrl, {
              method: "delete",
              headers: { Authorization: "Bearer " + token },
              muteHttpExceptions: true
            });
            if (delRes.getResponseCode() < 300) deletedCount++;
          }
          addAudit(traceId, "DEPLOY_CLEANUP", targetScriptId, "", "ok", "Deleted " + deletedCount + " old versions.");
        }
      }
      return true;
    } catch (e) {
      addAudit(traceId, "DEPLOY_EXCEPTION", targetScriptId, "", "error", e.toString());
      return false;
    }
  };

  const triggerNextAction = (missionId, traceId) => {
    // ARC_DONE または MOTHERSHIP_DONE になった直後に連鎖判定を行う
    const mainRows = sheets.main.getDataRange().getValues();
    let targetRow = null;
    let targetRowIndex = -1;
    for (let i = mainRows.length - 1; i >= 1; i--) {
      if (norm(mainRows[i][5]) === missionId) {
        targetRow = mainRows[i];
        targetRowIndex = i + 1;
        break;
      }
    }
    if (!targetRow) return false;

    const status = upper(norm(targetRow[3]));
    const responseText = norm(targetRow[4]);

    // ARCが完了し、次がMOTHERSHIP連携の場合（例：特定の応答接頭辞やモードなどから判定）
    // 現状はシンプルな「MOTHERSHIPに自律評価を依頼する」サンプル実装
    if (status === "ARC_DONE" || status === "ARC_ERROR") {
      // TODO: 本来はプロンプトのメタデータやBAKUからの指示（followup）に依存させる
      // 今回はイベント駆動検証のため、"[@metron]" が含まれていればMOTHERSHIPへ渡す
      if (norm(targetRow[2]).indexOf("[@metron]") >= 0) {
        const msgId = "MS_" + targetRowIndex + "_" + Date.now();
        const contentContext = `Action: ${status}\nMission: ${missionId}\nResult: ${responseText.slice(0, 1000)}`;
        sheets.mothership.appendRow([new Date(), msgId, "gateway_chained", contentContext, "pending"]);
        sheets.main.getRange(targetRowIndex, 4).setValue("ROUTED_MOTHERSHIP");
        sheets.main.getRange(targetRowIndex, 5).setValue("Chained to MOTHERSHIP / " + msgId);
        addAudit(traceId, "CHAIN_TO_MOTHERSHIP", msgId, "", "pending", missionId);
        return true;
      }
    }

    // MOTHERSHIPが完了し、次がARC実行の場合
    if (status === "DONE" && targetRow[1] === "MOTHERSHIP") {
      // MOTHERSHIPの応答が "[@arc]" などのコマンドを含んでいれば即時ルート
      if (responseText.indexOf("[@arc]") >= 0 || responseText.indexOf("#arc") >= 0) {
        // MOTHERSHIPの応答を新たなユーザー入力とみなしてルート
        const chainedRow = [new Date(), "MOTHERSHIP", responseText, "NEW", "", missionId];
        const res = routeOneChatRow(targetRowIndex, chainedRow);
        if (res) {
          addAudit(traceId, "CHAIN_TO_ARC", res.jobId, "", "pending", missionId);
          return true;
        }
      }
    }
    return false;
  };

  if (mode === "route_chat") {
    if (autonomyPaused) return jsonOut({ status: "paused", routed: 0 });
    const lock = LockService.getScriptLock();
    const locked = lock.tryLock(5000);
    if (!locked) return jsonOut({ status: "busy", routed: 0, error: "route_lock_timeout" });
    try {
      const strictFresh = lower(norm(data.strict_fresh || "false")) === "true";
      const routed = routePendingChatCommands(true);
      if (routed.length > 0) {
        return jsonOut({ status: "ok", routed: routed.length, details: routed, source: "fresh" });
      }
      if (strictFresh) {
        addAudit(norm(data.trace_id), "ROUTE_CHAT_STRICT_EMPTY", "", "", "ok", "strict_fresh_no_new");
        return jsonOut({ status: "ok", routed: 0, details: [], source: "empty_strict" });
      }
      const recent = collectRecentRoutedDetails(data.recent_window_sec, 3);
      if (recent.length > 0) {
        addAudit(norm(data.trace_id), "ROUTE_CHAT_RECENT_HIT", "", "", "ok", "count=" + recent.length);
        return jsonOut({ status: "ok", routed: 0, details: recent, source: "recent" });
      }
      addAudit(norm(data.trace_id), "ROUTE_CHAT_EMPTY", "", "", "ok", "no_new_or_recent");
      return jsonOut({ status: "ok", routed: 0, details: [], source: "empty" });
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
    if (output) {
      sheets.main.appendRow([new Date(), "MOTHERSHIP", output, "DONE", "", messageId]);
      triggerNextAction(messageId, norm(data.trace_id));
    }
    return jsonOut({ status: ok ? "ok" : "not_found" });
  }

  if (mode === "mothership_error") {
    const messageId = norm(data.message_id);
    const output = norm(data.error || data.data || "mothership_error");
    if (!messageId) return jsonOut({ status: "error", error: "message_id_required" });
    const ok = completeMothershipMessage(messageId, true, norm(data.worker_id));
    sheets.main.appendRow([new Date(), "MOTHERSHIP", "[ERR] " + output, "ERROR", "", messageId]);
    triggerNextAction(messageId, norm(data.trace_id));
    return jsonOut({ status: ok ? "ok" : "not_found" });
  }

  if (mode === "admin_status") {
    const slots = loadSlotRegistry();
    const enabledSlots = slots.filter((s) => s.enabled);
    const adaptivePick = pickAdaptiveTarget({ preferred: defaultTarget, forceAdaptive: true });
    const adaptiveSlotPick = pickAdaptiveSlot({ forceAdaptive: true });
    const targetCooldowns = (() => {
      const keys = {};
      slots.forEach((s) => {
        const t = canonicalTarget(s.target || "");
        if (t) keys[t] = true;
      });
      keys[defaultTarget] = true;
      const out = {};
      Object.keys(keys).sort().forEach((t) => {
        out[t] = getTargetCooldownState(t);
      });
      return out;
    })();
    const rows = sheets.jobs.getDataRange().getValues();
    const counts = { pending: 0, leased: 0, done: 0, error: 0, dead: 0, other: 0 };
    for (let i = 1; i < rows.length; i++) {
      const s = lower(rows[i][5]);
      if (counts.hasOwnProperty(s)) counts[s]++;
      else counts.other++;
    }
    const configWarnings = [];
    const allTargets = listSlotTargets(false);
    const enabledTargets = listSlotTargets(true);
    if (allTargets.length === 0) configWarnings.push("slot_target_empty");
    if (enabledTargets.length === 0) configWarnings.push("slot_target_enabled_empty");
    if (allTargets.length > 0 && allTargets.indexOf(defaultTarget) < 0) {
      configWarnings.push("default_target_not_in_slot_registry:" + defaultTarget);
    }
    return jsonOut({
      status: "ok",
      gateway_version: "arc-gateway-20.4",
      lease_timeout_sec: leaseTimeoutSec,
      pending_timeout_sec: pendingTimeoutSec,
      max_retry: maxRetry,
      retry_backoff_sec: retryBackoffSec,
      repair_executor: repairExecutor,
      default_route: defaultRoute,
      default_executor: defaultExecutor,
      default_target: defaultTarget,
      slot_count: slots.length,
      slot_enabled_count: enabledSlots.length,
      slots: slots,
      adaptive_slot_recommended: adaptiveSlotPick.slot_id || "",
      adaptive_target_enabled: adaptiveTargetEnabled,
      adaptive_target_window_sec: adaptiveWindowSec,
      adaptive_target_recommended: adaptivePick.target || defaultTarget,
      target_cooldown_sec: targetCooldownSec,
      target_fail_streak_threshold: targetFailStreakThreshold,
      target_cooldowns: targetCooldowns,
      target_failover_enabled: targetFailoverEnabled,
      require_signature: requireSignature,
      autonomy_paused: autonomyPaused,
      jobs: counts,
      nodes: Math.max(0, sheets.nodes.getLastRow() - 1),
      dead_jobs: Math.max(0, sheets.dead.getLastRow() - 1),
      audit_rows: Math.max(0, sheets.audit.getLastRow() - 1),
      mothership_nodes: Math.max(0, sheets.mothershipNodes.getLastRow() - 1),
      metrics: buildGatewayOpsMetrics(),
      config_warnings: configWarnings
    });
  }

  if (mode === "admin_target_scores") {
    const preferred = canonicalTarget(data.preferred || "") || defaultTarget;
    const exclude = canonicalTarget(data.exclude || "");
    const forceAdaptive = lower(norm(data.force_adaptive || "false")) === "true";
    const windowSec = parseIntSafe(data.window_sec, adaptiveWindowSec);
    const scores = buildAdaptiveTargetScores(windowSec);
    const picked = pickAdaptiveTarget({
      preferred: preferred,
      exclude: exclude,
      forceAdaptive: forceAdaptive,
      windowSec: windowSec
    });
    return jsonOut({
      status: "ok",
      preferred: preferred,
      exclude: exclude,
      adaptive_target_enabled: adaptiveTargetEnabled,
      target_cooldown_sec: targetCooldownSec,
      target_fail_streak_threshold: targetFailStreakThreshold,
      window_sec: clamp(parseIntSafe(windowSec, adaptiveWindowSec), 120, 86400),
      picked: picked.target || preferred,
      reason: norm(picked.reason),
      success_rate: picked.success_rate,
      avg_latency_sec: picked.avg_latency_sec,
      scores: scores
    });
  }

  if (mode === "admin_slot_scores") {
    const preferred = normalizeSlotAliasId(data.preferred || "");
    const exclude = normalizeSlotAliasId(data.exclude || "");
    const forceAdaptive = lower(norm(data.force_adaptive || "false")) === "true";
    const windowSec = parseIntSafe(data.window_sec, adaptiveWindowSec);
    const scores = buildAdaptiveSlotScores(windowSec);
    const picked = pickAdaptiveSlot({
      preferred: preferred,
      exclude: exclude,
      forceAdaptive: forceAdaptive,
      windowSec: windowSec
    });
    return jsonOut({
      status: "ok",
      preferred: preferred,
      exclude: exclude,
      window_sec: clamp(parseIntSafe(windowSec, adaptiveWindowSec), 120, 86400),
      picked: picked.slot_id || preferred || "",
      reason: norm(picked.reason),
      success_rate: picked.success_rate,
      avg_latency_sec: picked.avg_latency_sec,
      scores: scores
    });
  }

  if (mode === "admin_slot_list") {
    const slots = loadSlotRegistry();
    return jsonOut({
      status: "ok",
      count: slots.length,
      slots: slots
    });
  }

  if (mode === "admin_slot_upsert") {
    const slots = loadSlotRegistry();
    const inId = normalizeSlotAliasId(data.slot_id || data.id);
    if (!inId) return jsonOut({ status: "error", error: "slot_id_required" });
    const target = canonicalTarget(data.target || "");
    if (!target || target === "all") return jsonOut({ status: "error", error: "target_required" });
    const existingIdx = slots.findIndex((s) => normalizeSlotAliasId(s.slot_id) === inId);
    const base = existingIdx >= 0 ? slots[existingIdx] : {};
    const merged = normalizeSlotEntry({
      slot_id: inId,
      display_name: norm(data.display_name || base.display_name || inId),
      target: target,
      enabled: data.hasOwnProperty("enabled") ? data.enabled : (base.enabled !== undefined ? base.enabled : true),
      priority: data.hasOwnProperty("priority") ? data.priority : (base.priority || 100),
      login: norm(data.login || base.login || ""),
      url: norm(data.url || base.url || ""),
      input_selector: norm(data.input_selector || base.input_selector || ""),
      send_selector: norm(data.send_selector || base.send_selector || ""),
      response_selector: norm(data.response_selector || base.response_selector || "")
    }, existingIdx >= 0 ? existingIdx : slots.length);
    if (existingIdx >= 0) slots[existingIdx] = merged;
    else slots.push(merged);
    slots.sort((a, b) => a.priority - b.priority);
    saveSlotRegistry(slots);
    addAudit(norm(data.trace_id), "SLOT_UPSERT", "", "", "ok", merged.slot_id + "->" + merged.target + " enabled=" + merged.enabled);
    return jsonOut({ status: "ok", slot: merged, count: slots.length });
  }

  if (mode === "admin_slot_delete") {
    const slots = loadSlotRegistry();
    const inId = normalizeSlotAliasId(data.slot_id || data.id);
    if (!inId) return jsonOut({ status: "error", error: "slot_id_required" });
    const hardDelete = lower(norm(data.hard_delete || "false")) === "true";
    const idx = slots.findIndex((s) => normalizeSlotAliasId(s.slot_id) === inId);
    if (idx < 0) return jsonOut({ status: "not_found", slot_id: inId });
    let deleted = null;
    if (hardDelete) {
      deleted = slots.splice(idx, 1)[0];
    } else {
      slots[idx].enabled = false;
      deleted = slots[idx];
    }
    saveSlotRegistry(slots);
    addAudit(norm(data.trace_id), "SLOT_DELETE", "", "", "ok", inId + " hard=" + hardDelete);
    return jsonOut({ status: "ok", slot: deleted, count: slots.length, hard_delete: hardDelete });
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

  if (mode === "admin_diag_latest") {
    const limitRaw = parseInt(norm(data.limit || "20"), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, 100) : 20;
    const workerFilter = norm(data.worker_id);
    const targetFilter = lower(data.target);
    const rows = sheets.diag.getDataRange().getValues();
    const out = [];
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      const workerId = norm(r[1]);
      const target = lower(r[2]);
      if (workerFilter && workerFilter !== workerId) continue;
      if (targetFilter && targetFilter !== target) continue;
      out.push({
        ts: norm(r[0]),
        worker_id: workerId,
        target: norm(r[2]),
        page_url: norm(r[3]),
        page_title: norm(r[4]),
        webdriver: norm(r[5]),
        user_agent: norm(r[6]),
        webgl_vendor: norm(r[10]),
        webgl_renderer: norm(r[11]),
        canvas_hash: norm(r[12]),
        storage_flags: norm(r[13]),
        headers: norm(r[14]),
        challenge_detected: norm(r[15]),
        challenge_text: norm(r[16]),
        note: norm(r[17]),
        trace_id: norm(r[18])
      });
      if (out.length >= limit) break;
    }
    return jsonOut({ status: "ok", rows: out, count: out.length });
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
        slot_id: norm(payload.slot_id),
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
      const routed = routePendingChatCommands(false);
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

  if (mode === "gateway_memory_search" || mode === "memory_search") {
    const query = norm(data.query || data.q || data.text);
    if (!query) return jsonOut({ status: "error", error: "query_required" });
    const rows = searchGatewayLongMemory(query, {
      limit: data.limit,
      scan: data.scan,
      source: data.source
    });
    return jsonOut({ status: "ok", query: query, rows: rows, count: rows.length });
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

  if (mode === "arc_runtime_status") {
    const runtimeMode = normalizeRuntimeMode(props.getProperty("ARC_RUNTIME_MODE") || "interactive");
    const updatedAt = norm(props.getProperty("ARC_RUNTIME_MODE_UPDATED_AT") || "");
    return jsonOut({ status: "ok", runtime_mode: runtimeMode, updated_at: updatedAt });
  }

  if (mode === "arc_runtime_set" || mode === "arc_set_runtime_mode") {
    const requested = normalizeRuntimeMode(data.runtime_mode);
    const traceId = toTraceId(data.trace_id);
    const requestWorkerId = norm(data.worker_id);
    const jobId = norm(data.job_id) || ("RUNTIME_" + Utilities.getUuid().slice(0, 8));
    const enq = enqueueArcJob({
      jobId: jobId,
      qid: jobId,
      target: resolveOperationalTarget(defaultTarget, { fallback: "gemini" }),
      prompt: "runtime_mode_set",
      script: "",
      runtimeMode: requested,
      mode: "arc_set_runtime_mode",
      executor: "ARC",
      user: norm(data.user) || "gateway_runtime",
      workerId: "",
      traceId: traceId,
      retryCount: 0
    });
    props.setProperty("ARC_RUNTIME_MODE", requested);
    props.setProperty("ARC_RUNTIME_MODE_UPDATED_AT", nowIso());
    addAudit(traceId, "ARC_RUNTIME_SET_QUEUED", enq.jobId, requestWorkerId, "pending", requested);
    return jsonOut({
      status: "ok",
      runtime_mode: requested,
      job_id: enq.jobId,
      trace_id: enq.traceId
    });
  }

  if (mode === "arc_diag_snapshot") {
    const workerId = norm(data.worker_id);
    const target = resolveOperationalTarget(data.target || defaultTarget, { fallback: defaultTarget });
    const nav = data.navigator && typeof data.navigator === "object" ? data.navigator : {};
    const webgl = data.webgl && typeof data.webgl === "object" ? data.webgl : {};
    const headers = data.headers && typeof data.headers === "object" ? data.headers : {};
    const challenge = data.challenge && typeof data.challenge === "object" ? data.challenge : {};
    const traceId = toTraceId(data.trace_id);

    const langs = Array.isArray(nav.languages) ? nav.languages.join(",") : norm(nav.languages);
    const storageFlags = JSON.stringify({
      local_storage: !!data.local_storage,
      session_storage: !!data.session_storage,
      indexed_db: !!data.indexed_db,
      service_worker: !!data.service_worker,
      cookie_enabled: !!data.cookie_enabled
    });

    sheets.diag.appendRow([
      new Date(),
      workerId,
      target,
      norm(data.page_url),
      norm(data.page_title),
      String(nav.webdriver),
      norm(nav.userAgent),
      norm(nav.platform),
      langs,
      norm(nav.hardwareConcurrency),
      norm(webgl.vendor),
      norm(webgl.renderer),
      norm(data.canvas_hash),
      storageFlags,
      JSON.stringify(headers),
      String(!!challenge.detected),
      norm(challenge.text).slice(0, 500),
      norm(data.note).slice(0, 1000),
      traceId
    ]);

    addAudit(traceId, "ARC_DIAG_SNAPSHOT", "", workerId, "ok", target + " / challenge=" + String(!!challenge.detected));
    return jsonOut({ status: "ok", trace_id: traceId });
  }

  if (mode === "arc_result" || mode === "report_result") {
    const missionIdRaw = norm(data.qid || data.mission_id);
    const missionId = resolveMissionJobId(missionIdRaw);
    const result = norm(data.text);
    const evalSummary = norm(data.eval_summary);
    const traceId = norm(data.trace_id) || findTraceByMissionId(missionId || missionIdRaw);
    sheets.results.appendRow([new Date(), missionId, data.target || "", data.prompt || "", result, data.image || ""]);
    const found = findJobRowById(missionId);
    const resultTarget = canonicalTarget(data.target || (found && found.payload ? found.payload.target : "")) || "";
    const resultSlot = canonicalSlotId((found && found.payload ? found.payload.slot_id : "") || data.slot_id || "");
    const mainRef = findMainChatByMissionId(missionId || missionIdRaw);
    const reqUser = mainRef ? norm(mainRef.user) : "";
    const reqContent = mainRef ? norm(mainRef.content) : norm(data.prompt);
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
    if (resultTarget) {
      markTargetSuccess(resultTarget, traceId);
    }
    if (reqUser && result) {
      const keyBase = "user:" + reqUser + ":" + (resultSlot || resultTarget || "general");
      const memValue = ("request=" + reqContent + "\nresult=" + result)
        .replace(/\s+/g, " ")
        .slice(0, MAX_MEMORY_VALUE);
      setGatewayLongMemory(
        keyBase + ":last_success",
        memValue,
        "arc_result_auto",
        traceId,
        [resultTarget, resultSlot, "success", reqUser].filter((x) => x).join(",")
      );
      const qTokens = tokenizeForMemory(reqContent);
      if (qTokens.length > 0) {
        const topicKey = "topic:" + qTokens[0] + ":" + (resultTarget || "general");
        setGatewayLongMemory(
          topicKey,
          ("user=" + reqUser + " / " + memValue).slice(0, MAX_MEMORY_VALUE),
          "arc_result_auto",
          traceId,
          [resultTarget, resultSlot, "topic"].filter((x) => x).join(",")
        );
      }
    }

    // Check if we need to auto-deploy the result to a GAS project
    // AppForge or MotherShip sets prompt that contains "スプレッドシート [ {scriptId} ] にバインドされた Apps Script プロジェクト"
    const isAppDeployTarget = result.indexOf("--- FILE:") >= 0 && (data.mode === "request_app_deployment" || (found && found.payload && found.payload.mode === "request_app_deployment") || (reqContent && reqContent.indexOf("Apps Script プロジェクト") >= 0));
    if (isAppDeployTarget) {
      // 抽出対象のScriptIdを推測する。通常 Prompt に "スプレッドシート [ ID ]" が入っているか、
      // ターゲットとして指定されているかなど。（ARC側のプロンプト抽出要件に基づく）
      const scriptIdMatch = (reqContent || data.prompt || "").match(/\[\s*([a-zA-Z0-9_-]{30,})\s*\]/);
      const targetAppId = scriptIdMatch ? scriptIdMatch[1] : (data.target || "");
      if (targetAppId && targetAppId.length > 30) {
        addAudit(traceId, "DEPLOY_START", targetAppId, "", "info", "Starting GAS auto-deployment");
        const deploySuccess = deployAppScript(targetAppId, result, traceId);
        if (deploySuccess && mainRef) {
          sheets.main.getRange(mainRef.row_index, 5).setValue(norm(mainRef.response) + "\n\n[Gateway Auto-Deploy] SUCCESS to " + targetAppId);
        }
      }
    }

    addAudit(traceId, "ARC_RESULT", missionId, norm(data.worker_id), "done", norm(data.target));
    triggerNextAction(missionId, traceId);
    return jsonOut({ status: "ok", trace_id: traceId });
  }

  if (mode === "arc_error" || mode === "report_error") {
    const missionIdRaw = norm(data.qid || data.mission_id);
    const missionId = resolveMissionJobId(missionIdRaw);
    const err = norm(data.error_type);
    const errData = norm(data.data);
    const traceId = norm(data.trace_id) || findTraceByMissionId(missionId || missionIdRaw);
    const workerId = norm(data.worker_id);
    const foundJobForTarget = findJobRowById(missionId);
    const errorTarget = canonicalTarget(data.target || (foundJobForTarget && foundJobForTarget.payload ? foundJobForTarget.payload.target : "")) || "";
    const errorSlot = canonicalSlotId((foundJobForTarget && foundJobForTarget.payload ? foundJobForTarget.payload.slot_id : "") || data.slot_id || "");
    const mainRef = findMainChatByMissionId(missionId || missionIdRaw);
    const reqUser = mainRef ? norm(mainRef.user) : "";
    const reqContent = mainRef ? norm(mainRef.content) : "";

    const recentErr = readRecentRows(sheets.errors, 4, compactScanMax);
    let foundErr = -1;
    const nowErrMs = Date.now();
    const errWindowMs = errorCompactWindowSec * 1000;
    for (let i = recentErr.rows.length - 1; i >= 0; i--) {
      const row = recentErr.rows[i];
      const rowTs = toMs(row[0]);
      if (Number.isFinite(rowTs) && nowErrMs - rowTs > errWindowMs) break;
      if (norm(row[1]) !== missionId) continue;
      if (norm(row[2]) !== err) continue;
      const rowObj = parseCompactDetail(row[3], "message");
      const rowMsg = norm(rowObj.message || row[3]);
      if (rowMsg !== errData) continue;
      foundErr = recentErr.startRow + i;
      break;
    }
    if (foundErr > 0) {
      const existingErr = sheets.errors.getRange(foundErr, 1, 1, 4).getValues()[0];
      const existingErrTs = toMs(existingErr[0]);
      const mergedErrData = mergeCompactDetail(
        existingErr[3],
        "message",
        errData,
        Number.isFinite(existingErrTs) ? new Date(existingErrTs).toISOString() : nowIso(),
        nowIso()
      );
      sheets.errors.getRange(foundErr, 1, 1, 4).setValues([[new Date(), missionId, err, mergedErrData]]);
    } else {
      sheets.errors.appendRow([new Date(), missionId, err, errData]);
    }
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
      if (errorTarget) markTargetFailure(errorTarget, err, errData, traceId);
      if (reqUser) {
        setGatewayLongMemory(
          "user:" + reqUser + ":" + (errorSlot || errorTarget || "general") + ":last_error",
          ("request=" + reqContent + "\nerror=[" + err + "] " + errData).replace(/\s+/g, " ").slice(0, MAX_MEMORY_VALUE),
          "arc_error_auto",
          traceId,
          [errorTarget, errorSlot, "error", "retry"].filter((x) => x).join(",")
        );
      }
      addAudit(traceId, "ARC_ERROR_RETRY", missionId, workerId, "pending", "retry=" + retry.retry_count + ",executor=" + retry.executor);
      return jsonOut({ status: "retry_scheduled", trace_id: traceId, retry: retry });
    }

    completeArcJob(missionId, "error");
    if (errorTarget) markTargetFailure(errorTarget, err, errData, traceId);
    if (reqUser) {
      setGatewayLongMemory(
        "user:" + reqUser + ":" + (errorSlot || errorTarget || "general") + ":last_error",
        ("request=" + reqContent + "\nerror=[" + err + "] " + errData).replace(/\s+/g, " ").slice(0, MAX_MEMORY_VALUE),
        "arc_error_auto",
        traceId,
        [errorTarget, errorSlot, "error"].filter((x) => x).join(",")
      );
    }
    addAudit(traceId, "ARC_ERROR", missionId, workerId, "error", err + " / " + retry.reason);
    triggerNextAction(missionId, traceId);
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
    let prevNode = null;
    for (let i = 1; i < all.length; i++) {
      const rowWorker = norm(all[i][6]);
      if (workerId && rowWorker && rowWorker === workerId) {
        foundRow = i + 1;
        prevNode = all[i];
        break;
      }
      if (norm(all[i][1]) === ip && norm(all[i][2]) === port) {
        foundRow = i + 1;
        prevNode = all[i];
        break;
      }
    }
    const currentTarget = norm(data.current_target || data.target || "");
    const currentHost = norm(data.current_host).slice(0, 200);
    const currentUrl = norm(data.current_url).slice(0, 800);
    const currentTitle = norm(data.current_title).slice(0, 200);
    const hudSeq = parseHudSeq(data.hud_seq);
    const hbCache = CacheService.getScriptCache();
    const hudSeqKey = workerId ? ("hud_seq:" + workerId) : "";
    const prevHudSeq = hudSeqKey ? parseHudSeq(hbCache.get(hudSeqKey)) : -1;
    const hudSeqProgress = hudSeq >= 0 && (prevHudSeq < 0 || hudSeq > prevHudSeq);
    const hudTail = (function (v) {
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
    if (hudSeqKey && hudSeq >= 0) hbCache.put(hudSeqKey, String(hudSeq), 60 * 10);

    const workerStatus = lower(norm(data.status || ""));
    const prevUrl = prevNode ? norm(prevNode[9]) : "";
    const prevTitle = prevNode ? norm(prevNode[10]) : "";
    const prevHud = prevNode ? norm(prevNode[11]) : "";
    const hasHudMissionHint = parseMissionIdsFromText(hudTail).length > 0;
    const hasMissionFieldHint =
      !!norm(data.mission_id) || !!norm(data.mission) || !!norm(data.qid) || !!norm(data.arc_qid);
    const progressSignal =
      hudSeqProgress ||
      (hudTail && hudTail !== prevHud) ||
      (currentUrl && currentUrl !== prevUrl) ||
      (currentTitle && currentTitle !== prevTitle);
    const shouldLeaseTouch =
      leaseProgressTouchEnabled &&
      (
        workerStatus === "running" ||
        workerStatus === "working" ||
        workerStatus === "processing" ||
        workerStatus === "waiting" ||
        workerStatus === "busy" ||
        workerStatus === "heartbeat" ||
        hudSeqProgress
      ) &&
      (hasMissionFieldHint || hasHudMissionHint || progressSignal);
    if (shouldLeaseTouch) {
      touchLeaseFromHeartbeat(workerId, Object.assign({}, data, { progress_signal: progressSignal ? "true" : "false" }));
    }
    runArcQueueMaintenance(norm(data.trace_id), workerId, consumer);
    const runningLike =
      workerStatus === "running" ||
      workerStatus === "working" ||
      workerStatus === "processing" ||
      workerStatus === "waiting" ||
      workerStatus === "busy";
    const activeLeaseForWorker = runningLike ? hasLeasedJobForWorker(workerId) : false;
    const canLease =
      workerStatus === "" ||
      workerStatus === "online" ||
      workerStatus === "idle" ||
      workerStatus === "heartbeat" ||
      workerStatus === "success" ||
      workerStatus === "error" ||
      (runningLike && !activeLeaseForWorker);
    const instruction = canLease ? safeClaimNextInstruction(workerId, consumer, norm(data.trace_id)) : null;
    addAudit(norm(data.trace_id), "ARC_HEARTBEAT", "", workerId, "ok", consumer);
    return jsonOut(instruction ? { status: "ok", instruction: instruction } : { status: "ok" });
  }

  if (mode === "lease_job") {
    const workerId = norm(data.worker_id);
    const consumer = upper(data.executor || "ARC");
    runArcQueueMaintenance(norm(data.trace_id), workerId, consumer);
    const instruction = safeClaimNextInstruction(workerId, consumer, norm(data.trace_id));
    return jsonOut(instruction ? { status: "ok", instruction: instruction } : { status: "empty" });
  }

  if (mode === "arc_consult") {
    if (!consultEnabled) {
      return jsonOut({ advice: "", skipped: "disabled" });
    }
    return jsonOut({ advice: "", skipped: "empty_policy" });
  }

  return jsonOut({ status: "ok" });
}
