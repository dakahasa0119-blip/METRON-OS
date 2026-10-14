function createGatewayRoutingQueueModule(ctx) {
  const c = ctx || {};

  const enqueueArcJob = (job) => {
    const jobId = c.norm(job.jobId) || ("JOB_" + Utilities.getUuid().slice(0, 8));
    const traceId = c.toTraceId(job.traceId);
    const retryCountRaw = parseInt(c.norm(job.retryCount) || "0", 10);
    const retryCount = Number.isFinite(retryCountRaw) && retryCountRaw >= 0 ? retryCountRaw : 0;
    const resolvedTarget = c.resolveOperationalTarget(job.target, { allowAll: true, fallback: c.defaultTarget });
    const resolvedSlot = c.resolveSlotForTarget(resolvedTarget, job.slotId || job.slot_id);
    const payload = {
      qid: c.norm(job.qid) || jobId,
      target: resolvedTarget,
      slot_id: resolvedSlot,
      pin_target: c.lower(c.norm(job.pinTarget || "false")) === "true" ? "true" : "false",
      prompt: c.norm(job.prompt).slice(0, c.MAX_PROMPT),
      script: c.norm(job.script),
      executor: c.norm(job.executor) || "AUTO",
      requested_by: c.norm(job.user) || "gateway",
      trace_id: traceId,
      retry_count: retryCount,
      max_retry: c.maxRetry,
      ts: c.nowIso()
    };
    const isLongRunningPrompt = (prompt) => {
      const p = c.lower(c.norm(prompt));
      if (!p) return false;
      return (
        p.indexOf("```") >= 0 ||
        p.indexOf("repair") >= 0 ||
        p.indexOf("fix") >= 0 ||
        p.indexOf("salvage") >= 0 ||
        p.indexOf("patch") >= 0 ||
        p.indexOf("broken") >= 0 ||
        p.indexOf("syntax") >= 0 ||
        p.indexOf("drive.google.com") >= 0 ||
        p.indexOf("スプレッドシート") >= 0 ||
        p.indexOf("修復") >= 0 ||
        p.indexOf("修正") >= 0 ||
        p.indexOf("壊れ") >= 0
      );
    };
    if (payload.target === "all") {
      payload.lease_timeout_sec = Math.max(c.leaseTimeoutSec, 420);
      payload.pending_timeout_sec = Math.max(c.pendingTimeoutSec, 900);
    }
    if ((c.norm(job.mode) || "request_arc") === "request_arc" && payload.target !== "all") {
      payload.lease_timeout_sec = Math.max(Number(payload.lease_timeout_sec || 0), Math.max(c.leaseTimeoutSec, 210));
      payload.pending_timeout_sec = Math.max(Number(payload.pending_timeout_sec || 0), Math.max(c.pendingTimeoutSec, 600));
    }
    if (isLongRunningPrompt(payload.prompt)) {
      payload.lease_timeout_sec = Math.max(Number(payload.lease_timeout_sec || 0), 300);
      payload.pending_timeout_sec = Math.max(Number(payload.pending_timeout_sec || 0), 900);
    }
    if (c.norm(job.targetStrategy)) payload.target_strategy = c.norm(job.targetStrategy).slice(0, 64);
    if (c.norm(job.targetReason)) payload.target_reason = c.norm(job.targetReason).slice(0, 180);
    if (job.targetSuccessRate !== null && job.targetSuccessRate !== undefined) payload.target_success_rate = job.targetSuccessRate;
    if (job.targetAvgLatencySec !== null && job.targetAvgLatencySec !== undefined) payload.target_avg_latency_sec = job.targetAvgLatencySec;
    if (c.norm(job.mode) === "arc_set_runtime_mode") {
      payload.runtime_mode = c.normalizeRuntimeMode(job.runtimeMode || job.runtime_mode);
    }
    if (c.norm(job.mode) === "arc_set_ui_mode") {
      payload.ui_mode = c.normalizeUiMode(job.uiMode || job.ui_mode);
    }
    const existingRows = c.sheets.jobs.getDataRange().getValues();
    for (let i = existingRows.length - 1; i >= 1; i--) {
      const r = existingRows[i];
      if (c.norm(r[1]) !== jobId) continue;
      const existingPayload = c.parseJsonSafe(c.norm(r[4]));
      const existingTrace = c.norm(existingPayload.trace_id) || traceId;
      c.addAudit(existingTrace, "JOB_ENQUEUE_DEDUP", jobId, c.norm(r[2]), c.lower(r[5]) || "unknown", c.norm(job.mode) || "request_arc");
      return {
        jobId: jobId,
        traceId: existingTrace,
        payload: existingPayload && Object.keys(existingPayload).length ? existingPayload : payload,
        deduped: true,
        existing_status: c.lower(r[5]) || ""
      };
    }
    c.sheets.jobs.appendRow([new Date(), jobId, c.norm(job.workerId), c.norm(job.mode) || "request_arc", JSON.stringify(payload), "pending", ""]);
    c.addAudit(traceId, "JOB_ENQUEUED", jobId, c.norm(job.workerId), "pending", payload.executor + " / " + payload.target + " / slot=" + (payload.slot_id || "-") + " / retry=" + retryCount);
    return { jobId: jobId, traceId: traceId, payload: payload };
  };

  const routePendingChatCommands = (enableBackfillRaw, missionFilterIdRaw) => {
    const enableBackfill = enableBackfillRaw === true || enableBackfillRaw === "true";
    const missionFilterId = c.norm(missionFilterIdRaw);
    const lastRow = c.sheets.main.getLastRow();
    if (lastRow <= 1) return [];
    const cursorRaw = parseInt(c.norm(c.props.getProperty("ARC_MAIN_ROUTE_CURSOR") || "1"), 10);
    const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 1 ? cursorRaw : 1;
    const startPrimary = Math.max(2, Math.min(lastRow, cursor + 1));
    const primaryRows = startPrimary <= lastRow
      ? c.sheets.main.getRange(startPrimary, 1, lastRow - startPrimary + 1, 6).getValues()
      : [];
    const routed = [];
    for (let i = 0; i < primaryRows.length; i++) {
      const rowIndex = startPrimary + i;
      const res = c.routeOneChatRow(rowIndex, primaryRows[i], missionFilterId);
      if (res) routed.push(res);
    }
    c.props.setProperty("ARC_MAIN_ROUTE_CURSOR", String(lastRow));

    if (!enableBackfill) return routed;
    const nowMs = Date.now();
    const lastBackfillRaw = parseInt(c.norm(c.props.getProperty("ARC_ROUTE_LAST_BACKFILL_TS") || "0"), 10);
    const lastBackfillMs = Number.isFinite(lastBackfillRaw) && lastBackfillRaw >= 0 ? lastBackfillRaw : 0;
    if (nowMs - lastBackfillMs < c.routeBackfillSec * 1000) return routed;

    const startTail = Math.max(2, lastRow - c.routeCursorLookbackRows + 1);
    const tailRows = c.sheets.main.getRange(startTail, 1, lastRow - startTail + 1, 6).getValues();
    for (let i = 0; i < tailRows.length; i++) {
      const row = tailRows[i];
      const st = c.lower(row[3]);
      if (st && st !== "new" && st !== "pending") continue;
      const rowIndex = startTail + i;
      const res = c.routeOneChatRow(rowIndex, row, missionFilterId);
      if (res) routed.push(res);
    }
    c.props.setProperty("ARC_ROUTE_LAST_BACKFILL_TS", String(nowMs));
    return routed;
  };

  return {
    enqueueArcJob: enqueueArcJob,
    routePendingChatCommands: routePendingChatCommands
  };
}

function createGatewayLeaseQueueModule(ctx) {
  const c = ctx || {};

  const claimNextInstruction = (workerId, consumer, controlOnlyMode) => {
    if (c.autonomyPaused) return null;
    const lock = LockService.getScriptLock();
    const locked = lock.tryLock(5000);
    if (!locked) {
      c.addAudit("", "LEASE_LOCK_TIMEOUT", "", workerId, "busy", consumer);
      return null;
    }

    try {
      const rows = c.sheets.jobs.getDataRange().getValues();
      const controlModes = { arc_set_ui_mode: true, arc_set_runtime_mode: true };
      const tryLease = (controlOnly) => {
        for (let i = rows.length - 1; i >= 1; i--) {
          const row = rows[i];
          const rowWorker = c.norm(row[2]);
          const rowMode = c.norm(row[3]) || "request_arc";
          const payloadRaw = c.norm(row[4]);
          const status = c.lower(row[5]);
          if (status !== "pending") continue;
          if (controlOnly && !controlModes[rowMode]) continue;
          if (!controlOnly && controlModes[rowMode]) continue;

          if (rowWorker && (!workerId || rowWorker !== workerId)) continue;

          const payload = c.parseJsonSafe(payloadRaw);
          const linkedTerminal = c.getLinkedChatTerminalStatus(c.norm(row[1]));
          if (linkedTerminal) {
            const nextStatus = linkedTerminal === "arc_done" ? "done" : "error";
            c.sheets.jobs.getRange(i + 1, 6).setValue(nextStatus);
            c.sheets.jobs.getRange(i + 1, 7).setValue(new Date());
            c.addAudit(c.norm(payload.trace_id), "JOB_LEASE_SKIP_TERMINAL", c.norm(row[1]), workerId, nextStatus, "linked_main=" + linkedTerminal);
            continue;
          }
          const wanted = c.upper(payload.executor || "AUTO");
          const mine = c.upper(consumer || "ARC");
          if (wanted !== "AUTO" && wanted !== mine) continue;

          const nextRetryAtMs = new Date(c.norm(payload.next_retry_at)).getTime();
          if (Number.isFinite(nextRetryAtMs) && Date.now() < nextRetryAtMs) continue;

          c.sheets.jobs.getRange(i + 1, 6).setValue("leased");
          c.sheets.jobs.getRange(i + 1, 7).setValue(new Date());
          if (!rowWorker && workerId) c.sheets.jobs.getRange(i + 1, 3).setValue(workerId);

          c.addAudit(c.norm(payload.trace_id), "JOB_LEASED", c.norm(row[1]), workerId, "leased", mine);
          if (workerId) {
            c.putArcShortMemory(
              workerId,
              c.norm(payload.session_id) || c.norm(payload.trace_id) || c.norm(row[1]),
              "last_instruction",
              JSON.stringify({
                job_id: c.norm(row[1]),
                mode: rowMode,
                target: c.norm(payload.target),
                prompt: c.norm(payload.prompt).slice(0, 500)
              }),
              1800,
              c.norm(payload.trace_id)
            );
          }
          c.markLinkedChatStarted(c.norm(row[1]), workerId, c.norm(payload.target));
          c.addAudit(c.norm(payload.trace_id), "JOB_STARTED_ACK", c.norm(row[1]), workerId, "leased", mine);
          return Object.assign({ mode: rowMode, job_id: c.norm(row[1]) }, payload);
        }
        return null;
      };

      if (controlOnlyMode) {
        const controlOnly = tryLease(true);
        if (controlOnly) return controlOnly;
        return null;
      }

      const controlFirst = tryLease(true);
      if (controlFirst) return controlFirst;
      const normal = tryLease(false);
      if (normal) return normal;

      return null;
    } finally {
      lock.releaseLock();
    }
  };

  const safeClaimNextInstruction = (workerId, consumer, traceId, options) => {
    try {
      const opt = options && typeof options === "object" ? options : {};
      return claimNextInstruction(workerId, consumer, !!opt.control_only);
    } catch (err) {
      const detail = (() => {
        try {
          if (err && err.stack) return String(err.stack).slice(0, 1200);
          return String(err || "claim_exception").slice(0, 1200);
        } catch (_) {
          return "claim_exception";
        }
      })();
      c.addAudit(c.norm(traceId), "JOB_LEASE_EXCEPTION", "", c.norm(workerId), "error", detail);
      return null;
    }
  };

  const runArcQueueMaintenance = (traceId, workerId, consumer, force) => {
    try {
      const now = Date.now();
      const maintCache = CacheService.getScriptCache();
      const cacheKey = "arc_queue_maint_last_ms";
      const lastRaw = parseInt(c.norm(maintCache.get(cacheKey)) || "0", 10);
      const shouldRun = !!force || !Number.isFinite(lastRaw) || lastRaw <= 0 || (now - lastRaw >= c.queueMaintIntervalMs);
      if (!shouldRun) return { skipped: true, reason: "throttled" };
      maintCache.put(cacheKey, String(now), 60);

      const reconciled = c.reconcileTerminalLinkedJobs(120);
      c.recoverStalePendingJobs();
      c.requeueExpiredLeases();
      c.routePendingChatCommands(false);
      if (reconciled > 0) {
        c.addAudit(c.norm(traceId), "QUEUE_TERMINAL_RECONCILED", "", c.norm(workerId), "ok", "count=" + reconciled);
      }
      return { skipped: false, reconciled: reconciled };
    } catch (err) {
      const detail = (() => {
        try {
          if (err && err.stack) return String(err.stack).slice(0, 1200);
          return String(err || "queue_maintenance_exception").slice(0, 1200);
        } catch (_) {
          return "queue_maintenance_exception";
        }
      })();
      c.addAudit(c.norm(traceId), "QUEUE_MAINT_EXCEPTION", "", c.norm(workerId), "error", c.norm(consumer) + ":" + detail);
      return { skipped: false, error: detail };
    }
  };

  return {
    safeClaimNextInstruction: safeClaimNextInstruction,
    runArcQueueMaintenance: runArcQueueMaintenance
  };
}
