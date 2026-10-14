function createGatewayBakuIntakeModule(ctx) {
  const c = ctx || {};
  const API_CONTRACT_VERSION = c.norm(c.apiContractVersion || "1.0");
  const INTAKE_POLICY_VERSION = "2026-03-10.r1";
  const CRITICAL_PROTECTED_PATHS = [
    "auth/*",
    "crypto/*",
    "key-rotation/*",
    "gateway_verify/*"
  ];

  const resolveBakuWebappUrl = () => {
    const cur = c.norm(c.props.getProperty("BAKU_WEBAPP_URL_CURRENT") || "");
    const fallback = c.norm(c.props.getProperty("BAKU_WEBAPP_URL") || "");
    if (cur) return cur;
    if (fallback) return fallback;
    return "";
  };

  const callBakuWebapp = (payload) => {
    const bakuUrl = resolveBakuWebappUrl();
    const auth = c.norm(c.props.getProperty("ARC_AUTH_KEY") || "");
    if (!bakuUrl) return { status: "error", error: "baku_webapp_url_missing" };
    if (!auth) return { status: "error", error: "arc_auth_key_missing" };
    const body = Object.assign({}, payload || {}, { auth_key: auth });
    try {
      const resp = UrlFetchApp.fetch(bakuUrl, {
        method: "post",
        contentType: "application/json",
        muteHttpExceptions: true,
        payload: JSON.stringify(body)
      });
      const code = Number(resp.getResponseCode() || 0);
      const text = String(resp.getContentText() || "");
      let json = {};
      try { json = JSON.parse(text); } catch (_) { json = { status: "error", error: "baku_response_not_json", raw: text.slice(0, 300) }; }
      if (code < 200 || code >= 300) return { status: "error", error: "baku_http_" + code, response: json };
      return json;
    } catch (e) {
      return { status: "error", error: "baku_fetch_failed", detail: String(e && e.message || e || "") };
    }
  };

  const extractRepairConstraintHintsFromMemory = (requestObj) => {
    const req = requestObj && typeof requestObj === "object" ? requestObj : {};
    const title = c.norm(req.title || "");
    const summary = c.norm(req.summary || "");
    const moduleName = c.norm(req.module || "");
    const text = [title, summary, moduleName].filter((x) => !!x).join(" ");
    if (!text) return { status: "ok", hints: {}, refs: [] };
    const query = "constraint preserve prohibited contract gateway baku repair " + text;
    const rows = c.searchGatewayLongMemory(query, { limit: 6, scan: 900 });
    const hints = {
      preserve_contracts: [],
      prohibited_changes: [],
      expected_fix: "",
      symptom: ""
    };
    const refs = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const v = c.lower(c.norm(r.value || ""));
      refs.push({ key: c.norm(r.key || ""), source: c.norm(r.source || ""), timestamp: r.timestamp || "" });
      if (!hints.expected_fix && (v.indexOf("expected_fix") >= 0 || v.indexOf("期待") >= 0 || v.indexOf("goal") >= 0)) {
        hints.expected_fix = c.norm(r.value || "").slice(0, 180);
      }
      if (!hints.symptom && (v.indexOf("symptom") >= 0 || v.indexOf("症状") >= 0 || v.indexOf("error") >= 0)) {
        hints.symptom = c.norm(r.value || "").slice(0, 180);
      }
      if (v.indexOf("contract") >= 0 || v.indexOf("mode") >= 0 || v.indexOf("google.script.run") >= 0 || v.indexOf("dopost") >= 0) {
        hints.preserve_contracts.push(c.norm(r.key || "").slice(0, 120));
      }
      if (v.indexOf("禁止") >= 0 || v.indexOf("prohibit") >= 0 || v.indexOf("do_not_change") >= 0) {
        hints.prohibited_changes.push(c.norm(r.key || "").slice(0, 120));
      }
    }
    hints.preserve_contracts = c.dedupList(hints.preserve_contracts, 8);
    hints.prohibited_changes = c.dedupList(hints.prohibited_changes, 8);
    return { status: "ok", hints: hints, refs: refs };
  };

  const mergeRepairConstraints = (inputConstraints, hintConstraints) => {
    const inC = inputConstraints && typeof inputConstraints === "object" ? inputConstraints : {};
    const hi = hintConstraints && typeof hintConstraints === "object" ? hintConstraints : {};
    const preferInputList = (a, b, maxN) => {
      const inputList = c.dedupList(Array.isArray(a) ? a : [], maxN || 12);
      if (inputList.length > 0) return inputList;
      return c.dedupList(Array.isArray(b) ? b : [], maxN || 12);
    };
    return {
      symptom: c.norm(inC.symptom || hi.symptom || ""),
      expected_fix: c.norm(inC.expected_fix || hi.expected_fix || ""),
      preserve_contracts: preferInputList(inC.preserve_contracts, hi.preserve_contracts, 10),
      prohibited_changes: preferInputList(inC.prohibited_changes, hi.prohibited_changes, 10),
      protected_paths: c.dedupList(
        (Array.isArray(inC.protected_paths) ? inC.protected_paths : []).concat(CRITICAL_PROTECTED_PATHS),
        12
      )
    };
  };

  const validateRepairIntakeConstraints = (constraints) => {
    const obj = constraints && typeof constraints === "object" ? constraints : {};
    const missing = [];
    if (!c.norm(obj.symptom)) missing.push("symptom");
    if (!c.norm(obj.expected_fix)) missing.push("expected_fix");
    if (!Array.isArray(obj.preserve_contracts) || obj.preserve_contracts.length <= 0) missing.push("preserve_contracts");
    if (!Array.isArray(obj.prohibited_changes) || obj.prohibited_changes.length <= 0) missing.push("prohibited_changes");
    if (!Array.isArray(obj.protected_paths) || obj.protected_paths.length <= 0) missing.push("protected_paths");
    return { ok: missing.length === 0, missing: missing };
  };

  const summarizeConstraints = (constraints) => {
    const obj = constraints && typeof constraints === "object" ? constraints : {};
    return [
      "symptom=" + c.norm(obj.symptom).slice(0, 80),
      "expected_fix=" + c.norm(obj.expected_fix).slice(0, 80),
      "preserve=" + (Array.isArray(obj.preserve_contracts) ? obj.preserve_contracts.length : 0),
      "prohibit=" + (Array.isArray(obj.prohibited_changes) ? obj.prohibited_changes.length : 0),
      "protected=" + (Array.isArray(obj.protected_paths) ? obj.protected_paths.length : 0)
    ].join(" | ");
  };

  const buildRepairPacket = (requestObj, constraints, incomingPacket, extra) => {
    const req = requestObj && typeof requestObj === "object" ? requestObj : {};
    const guard = constraints && typeof constraints === "object" ? constraints : {};
    const inPkt = incomingPacket && typeof incomingPacket === "object" ? incomingPacket : {};
    const ex = extra && typeof extra === "object" ? extra : {};
    return {
      request_id: c.norm(req.request_id || inPkt.request_id || ""),
      module: c.norm(req.module || inPkt.module || ""),
      severity: c.norm(req.severity || inPkt.severity || "high"),
      source: c.norm(req.source || inPkt.source || "gateway_external"),
      created_by: c.norm(req.created_by || inPkt.created_by || "gateway_intake"),
      entity_model: "card_to_build",
      api_contract_version: API_CONTRACT_VERSION,
      intake_policy_version: INTAKE_POLICY_VERSION,
      constraint_summary: summarizeConstraints(guard),
      protected_paths: c.dedupList(Array.isArray(guard.protected_paths) ? guard.protected_paths : [], 12),
      preserve_contracts: c.dedupList(Array.isArray(guard.preserve_contracts) ? guard.preserve_contracts : [], 10),
      prohibited_changes: c.dedupList(Array.isArray(guard.prohibited_changes) ? guard.prohibited_changes : [], 10),
      code_surface: {
        has_server_code: !!c.norm(req.server_code || ""),
        has_ui_code: !!c.norm(req.ui_code || "")
      },
      build_context: {
        build_id: c.norm(ex.build_id || inPkt.build_context && inPkt.build_context.build_id || ""),
        deck_id: c.norm(ex.deck_id || inPkt.build_context && inPkt.build_context.deck_id || ""),
        card_ids: c.dedupList(Array.isArray(ex.card_ids) ? ex.card_ids : (inPkt.build_context && Array.isArray(inPkt.build_context.card_ids) ? inPkt.build_context.card_ids : []), 24)
      }
    };
  };

  const detectCriticalScopeSignals = (req, constraints) => {
    const r = req && typeof req === "object" ? req : {};
    const cObj = constraints && typeof constraints === "object" ? constraints : {};
    const text = [
      c.norm(r.server_code || ""),
      c.norm(r.ui_code || ""),
      c.norm(r.summary || ""),
      c.norm(r.title || "")
    ].join("\n").toLowerCase();
    const rules = []
      .concat(Array.isArray(cObj.prohibited_changes) ? cObj.prohibited_changes : [])
      .map((x) => c.norm(x).toLowerCase())
      .join(" ");
    const protectedPaths = Array.isArray(cObj.protected_paths) ? cObj.protected_paths : [];
    const protectedPrefixes = protectedPaths
      .map((x) => c.norm(x).toLowerCase().replace(/\*/g, ""))
      .filter((x) => x.length > 0);
    const criticalPatterns = [
      "arc_auth_key",
      "auth_key",
      "x-api-key",
      "authorization",
      "bearer ",
      "hmac",
      "sha256",
      "jwt",
      "nonce",
      "signature",
      "encrypt",
      "decrypt",
      "crypto",
      "secret",
      "private key",
      "key rotation"
    ];
    const hits = [];
    for (let i = 0; i < criticalPatterns.length; i++) {
      const p = criticalPatterns[i];
      if (text.indexOf(p) >= 0 || rules.indexOf(p) >= 0) hits.push(p);
    }
    for (let i = 0; i < protectedPrefixes.length; i++) {
      const p = protectedPrefixes[i];
      if (p && text.indexOf(p) >= 0) hits.push("protected_path:" + p);
    }
    const uniqueHits = c.dedupList(hits, 20);
    const blocked = uniqueHits.length > 0;
    return {
      blocked: blocked,
      hits: uniqueHits,
      reason: blocked ? "critical_scope_auth_crypto_detected" : ""
    };
  };

  const appendBakuRepairIntakeLog = (entry) => {
    const e = entry && typeof entry === "object" ? entry : {};
    const sh = c.sheets.bakuRepairIntakeLog;
    const row = [
      new Date(),
      c.norm(e.request_id),
      c.norm(e.status),
      c.norm(e.error),
      c.norm(e.analyze_status),
      c.norm(e.apply_status),
      c.norm(e.apply_reason),
      Array.isArray(e.blocked_checks) ? e.blocked_checks.join(",") : c.norm(e.blocked_checks),
      c.norm(e.return_id),
      c.norm(e.manifest_key),
      Array.isArray(e.constraint_missing) ? e.constraint_missing.join(",") : c.norm(e.constraint_missing),
      c.norm(e.constraint_symptom),
      c.norm(e.constraint_expected_fix),
      c.parseIntSafe(e.memory_ref_count, 0),
      c.norm(e.intake_summary).slice(0, 500)
    ];
    sh.appendRow(row);
  };

  const buildIntakeStatusPersistPayload = (payloadObj, maxLen) => {
    const p = payloadObj && typeof payloadObj === "object" ? payloadObj : {};
    const req = p.request && typeof p.request === "object" ? p.request : {};
    const constraints = p.constraints && typeof p.constraints === "object" ? p.constraints : {};
    const repairPacket = p.repair_packet && typeof p.repair_packet === "object" ? p.repair_packet : {};
    const analyze = p.analyze && typeof p.analyze === "object" ? p.analyze : {};
    const apply = p.apply && typeof p.apply === "object" ? p.apply : {};
    const codeReturn = apply.gateway_code_return && typeof apply.gateway_code_return === "object" ? apply.gateway_code_return : {};
    const compact = {
      status: c.norm(p.status),
      error: c.norm(p.error),
      dry_run: p.dry_run === true,
      request_id: c.norm(p.request_id || req.request_id),
      updated_at: c.norm(p.updated_at || ""),
      trace_id: c.norm(p.trace_id || ""),
      request: {
        request_id: c.norm(req.request_id || ""),
        title: c.norm(req.title || "").slice(0, 180),
        summary: c.norm(req.summary || "").slice(0, 280),
        module: c.norm(req.module || ""),
        severity: c.norm(req.severity || ""),
        source: c.norm(req.source || ""),
        created_by: c.norm(req.created_by || "")
      },
      constraints: {
        symptom: c.norm(constraints.symptom || "").slice(0, 180),
        expected_fix: c.norm(constraints.expected_fix || "").slice(0, 180),
        preserve_contracts: c.dedupList(Array.isArray(constraints.preserve_contracts) ? constraints.preserve_contracts : [], 8),
        prohibited_changes: c.dedupList(Array.isArray(constraints.prohibited_changes) ? constraints.prohibited_changes : [], 8)
      },
      repair_packet: {
        api_contract_version: c.norm(repairPacket.api_contract_version || ""),
        entity_model: c.norm(repairPacket.entity_model || ""),
        request_id: c.norm(repairPacket.request_id || ""),
        module: c.norm(repairPacket.module || ""),
        build_context: {
          build_id: c.norm(repairPacket.build_context && repairPacket.build_context.build_id || ""),
          deck_id: c.norm(repairPacket.build_context && repairPacket.build_context.deck_id || ""),
          card_ids: c.dedupList(repairPacket.build_context && Array.isArray(repairPacket.build_context.card_ids) ? repairPacket.build_context.card_ids : [], 12)
        }
      },
      missing: Array.isArray(p.missing) ? p.missing.slice(0, 8) : [],
      memory_ref_count: Array.isArray(p.memory_refs) ? p.memory_refs.length : c.parseIntSafe(p.memory_ref_count, 0),
      analyze: {
        status: c.norm(analyze.status || ""),
        error: c.norm(analyze.error || ""),
        compile_after_ok: !!analyze.compile_after_ok,
        repaired: !!analyze.repaired,
        failure_reason: c.norm(analyze.failure_reason || "").slice(0, 180),
        quality_score: c.parseIntSafe(analyze.quality_score, 0)
      },
      apply: {
        status: c.norm(apply.status || ""),
        error: c.norm(apply.error || ""),
        reason: c.norm(apply.reason || "").slice(0, 180),
        blocked_checks: Array.isArray(apply.blocked_checks) ? apply.blocked_checks.slice(0, 10) : [],
        candidate_id: c.norm(apply.candidate_id || ""),
        gateway_code_return: {
          status: c.norm(codeReturn.status || ""),
          return_id: c.norm(codeReturn.return_id || ""),
          manifest_key: c.norm(codeReturn.manifest_key || "")
        }
      },
      summary: p.summary && typeof p.summary === "object" ? p.summary : {}
    };
    let text = JSON.stringify(compact);
    if (text.length <= maxLen) return compact;
    compact.constraints.symptom = compact.constraints.symptom.slice(0, 90);
    compact.constraints.expected_fix = compact.constraints.expected_fix.slice(0, 90);
    compact.constraints.preserve_contracts = compact.constraints.preserve_contracts.slice(0, 4);
    compact.constraints.prohibited_changes = compact.constraints.prohibited_changes.slice(0, 4);
    compact.repair_packet.build_context.card_ids = compact.repair_packet.build_context.card_ids.slice(0, 4);
    compact.request.summary = compact.request.summary.slice(0, 120);
    compact.apply.blocked_checks = compact.apply.blocked_checks.slice(0, 4);
    compact.summary = {};
    text = JSON.stringify(compact);
    if (text.length <= maxLen) return compact;
    return {
      status: compact.status || "ok",
      error: compact.error || "",
      request_id: compact.request_id,
      updated_at: compact.updated_at,
      trace_id: compact.trace_id,
      apply: { status: compact.apply.status, error: compact.apply.error, reason: compact.apply.reason },
      analyze: { status: compact.analyze.status, error: compact.analyze.error },
      truncated: true
    };
  };

  const persistBakuRepairIntakeStatus = (requestId, payloadObj) => {
    const reqId = c.norm(requestId);
    if (!reqId) return { ok: false, error: "request_id_required" };
    const payload = buildIntakeStatusPersistPayload(payloadObj, c.MAX_MEMORY_VALUE);
    const key = "baku:intake_result:" + reqId;
    const value = JSON.stringify(payload);
    return c.setGatewayLongMemory(
      key,
      value,
      "gateway_baku_intake",
      c.norm(payload.trace_id || ""),
      "namespace:baku_intake_result,type:status,request_id:" + reqId
    );
  };

  const getBakuRepairIntakeStatus = (requestId) => {
    const reqId = c.norm(requestId);
    if (!reqId) return withContractMeta({ status: "error", error: "request_id_required" });
    const key = "baku:intake_result:" + reqId;
    const rows = c.getGatewayLongMemory(key, 1);
    if (!rows || !rows[0]) return withContractMeta({ status: "not_found", request_id: reqId });
    let payload = {};
    try { payload = JSON.parse(c.norm(rows[0].value || "{}")); } catch (_) { payload = { raw: c.norm(rows[0].value || "") }; }
    return withContractMeta({ status: "ok", request_id: reqId, key: key, item: payload, timestamp: rows[0].timestamp });
  };

  const withContractMeta = (payloadObj) => {
    const p = payloadObj && typeof payloadObj === "object" ? payloadObj : {};
    if (!p.api_contract_version) p.api_contract_version = API_CONTRACT_VERSION;
    if (!p.policy_version) p.policy_version = INTAKE_POLICY_VERSION;
    return p;
  };

  const buildContractResponse = () => {
    return withContractMeta({
      status: "ok",
      mode: "baku_repair_intake",
      contract_version: INTAKE_POLICY_VERSION,
      required: [
        "constraints.symptom",
        "constraints.expected_fix",
        "constraints.preserve_contracts[]",
        "constraints.prohibited_changes[]",
        "constraints.protected_paths[]"
      ],
      optional: [
        "request_id",
        "title",
        "summary",
        "module",
        "severity",
        "source",
        "created_by",
        "repair_packet.request_id",
        "repair_packet.module",
        "repair_packet.entity_model",
        "repair_packet.build_context.build_id",
        "repair_packet.build_context.deck_id",
        "repair_packet.build_context.card_ids[]",
        "server_code",
        "ui_code",
        "dry_run"
      ],
      status_endpoint: {
        mode: "baku_repair_intake_status",
        key: "request_id"
      },
      returns: {
        submit: ["request", "constraints", "memory_refs", "analyze", "apply"],
        status: ["item.analyze.status", "item.apply.status", "item.apply.reason", "item.apply.gateway_code_return.return_id", "item.apply.gateway_code_return.manifest_key"]
      },
      failure_behavior: {
        missing_constraints: "repair_intake_constraints_missing",
        protected_paths_required: CRITICAL_PROTECTED_PATHS,
        blocked_result: "apply.status=error|partial with blocked_checks/reason",
        code_return: "apply.gateway_code_return"
      },
      example: {
        mode: "baku_repair_intake",
        request_id: "ext_req_20260310_001",
        summary: "Gateway doPost malformed payload handling",
        module: "GATEWAY",
        severity: "high",
        source: "gateway_external",
        repair_packet: {
          request_id: "ext_req_20260310_001",
          module: "GATEWAY",
          entity_model: "card_to_build"
        },
        constraints: {
          symptom: "exception when postData is empty",
          expected_fix: "safe parse + explicit mode guard",
          preserve_contracts: ["doPost response schema", "existing mode names"],
          prohibited_changes: ["no auth bypass", "no endpoint URL changes"],
          protected_paths: CRITICAL_PROTECTED_PATHS
        },
        server_code: "function doPost(e){/* code */}"
      }
    });
  };

  const handleIntake = (data) => {
    const d = data && typeof data === "object" ? data : {};
    const req = {
      request_id: c.norm(d.request_id) || ("baku_req_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12)),
      title: c.norm(d.title || ""),
      summary: c.norm(d.summary || d.prompt || ""),
      module: c.norm(d.module || "GATEWAY"),
      severity: c.norm(d.severity || "high"),
      source: c.norm(d.source || "gateway_external"),
      created_by: c.norm(d.created_by || "gateway_intake"),
      server_code: c.norm(d.server_code || ""),
      ui_code: c.norm(d.ui_code || ""),
      constraints: (d.constraints && typeof d.constraints === "object") ? d.constraints : {}
    };
    const dryRun = c.lower(c.norm(d.dry_run || "false")) === "true";
    const hintsPack = extractRepairConstraintHintsFromMemory(req);
    const mergedConstraints = mergeRepairConstraints(req.constraints, hintsPack.hints || {});
    const repairPacket = buildRepairPacket(req, mergedConstraints, d.repair_packet, {
      build_id: d.build_id,
      deck_id: d.deck_id,
      card_ids: Array.isArray(d.card_ids) ? d.card_ids : []
    });
    const checklist = validateRepairIntakeConstraints(mergedConstraints);
    const criticalScope = detectCriticalScopeSignals(req, mergedConstraints);
    const memoryRefs = Array.isArray(hintsPack.refs) ? hintsPack.refs : [];
    const memoryRefCount = memoryRefs.length;

    if (criticalScope.blocked) {
      c.addAudit(c.norm(d.trace_id), "BAKU_REPAIR_INTAKE_BLOCKED", req.request_id, c.norm(d.worker_id), "ng", "critical_scope=" + criticalScope.hits.join(","));
      const blockedPayloadCritical = {
        status: "error",
        error: "repair_intake_critical_scope_forbidden",
        request_id: req.request_id,
        request: req,
        repair_packet: repairPacket,
        constraints: mergedConstraints,
        critical_scope_hits: criticalScope.hits,
        memory_refs: memoryRefs,
        updated_at: c.nowIso(),
        trace_id: c.norm(d.trace_id)
      };
      persistBakuRepairIntakeStatus(req.request_id, blockedPayloadCritical);
      appendBakuRepairIntakeLog({
        request_id: req.request_id,
        status: "blocked",
        error: "repair_intake_critical_scope_forbidden",
        constraint_symptom: mergedConstraints.symptom,
        constraint_expected_fix: mergedConstraints.expected_fix,
        memory_ref_count: memoryRefCount,
        intake_summary: summarizeConstraints(mergedConstraints) + " | critical=" + criticalScope.hits.join("|")
      });
      return withContractMeta({
        status: "error",
        error: "repair_intake_critical_scope_forbidden",
        request: req,
        repair_packet: repairPacket,
        constraints: mergedConstraints,
        critical_scope_hits: criticalScope.hits,
        memory_refs: memoryRefs
      });
    }

    if (!checklist.ok) {
      c.addAudit(c.norm(d.trace_id), "BAKU_REPAIR_INTAKE_BLOCKED", req.request_id, c.norm(d.worker_id), "ng", "missing=" + checklist.missing.join(","));
      const blockedPayload = {
        status: "error",
        error: "repair_intake_constraints_missing",
        request_id: req.request_id,
        request: req,
        repair_packet: repairPacket,
        constraints: mergedConstraints,
        missing: checklist.missing,
        memory_refs: memoryRefs,
        updated_at: c.nowIso(),
        trace_id: c.norm(d.trace_id)
      };
      persistBakuRepairIntakeStatus(req.request_id, blockedPayload);
      appendBakuRepairIntakeLog({
        request_id: req.request_id,
        status: "blocked",
        error: "repair_intake_constraints_missing",
        constraint_missing: checklist.missing,
        constraint_symptom: mergedConstraints.symptom,
        constraint_expected_fix: mergedConstraints.expected_fix,
        memory_ref_count: memoryRefCount,
        intake_summary: summarizeConstraints(mergedConstraints)
      });
      return withContractMeta({
        status: "error",
        error: "repair_intake_constraints_missing",
        request: req,
        repair_packet: repairPacket,
        constraints: mergedConstraints,
        missing: checklist.missing,
        memory_refs: memoryRefs
      });
    }

    const analyze = callBakuWebapp({
      mode: "smoke_repair_analyze",
      server_code: req.server_code,
      ui_code: req.ui_code
    });
    if (dryRun) {
      const dryPayload = {
        status: "ok",
        dry_run: true,
        request_id: req.request_id,
        request: req,
        repair_packet: repairPacket,
        constraints: mergedConstraints,
        memory_refs: memoryRefs,
        analyze: analyze,
        updated_at: c.nowIso(),
        trace_id: c.norm(d.trace_id)
      };
      persistBakuRepairIntakeStatus(req.request_id, dryPayload);
      appendBakuRepairIntakeLog({
        request_id: req.request_id,
        status: "dry_run",
        analyze_status: c.norm(analyze && analyze.status),
        constraint_symptom: mergedConstraints.symptom,
        constraint_expected_fix: mergedConstraints.expected_fix,
        memory_ref_count: memoryRefCount,
        intake_summary: summarizeConstraints(mergedConstraints)
      });
      return withContractMeta({
        status: "ok",
        dry_run: true,
        request: req,
        repair_packet: repairPacket,
        constraints: mergedConstraints,
        memory_refs: memoryRefs,
        analyze: analyze
      });
    }

    const apply = callBakuWebapp({
      mode: "smoke_repair_apply",
      title: req.title || ("gateway_intake_" + req.request_id),
      summary: req.summary,
      module: req.module,
      severity: req.severity,
      source: req.source,
      created_by: req.created_by,
      note: "gateway_intake:" + req.request_id + " symptom=" + mergedConstraints.symptom.slice(0, 80),
      payload: {
        analysis: analyze,
        repair_packet: repairPacket,
        intake_constraints: mergedConstraints,
        intake_guard: {
          critical_scope_forbidden: true,
          protected_paths: mergedConstraints.protected_paths,
          auto_apply_on_critical_scope: false,
          critical_scope_hits: []
        }
      }
    });
    c.addAudit(c.norm(d.trace_id), "BAKU_REPAIR_INTAKE_SUBMIT", req.request_id, c.norm(d.worker_id), String(apply && apply.status || "unknown"), c.norm(req.module));

    const applyStatus = c.norm(apply && apply.status || "");
    const applyReason = c.norm(apply && (apply.reason || apply.error || "") || "");
    const blockedChecks = Array.isArray(apply && apply.blocked_checks) ? apply.blocked_checks : [];
    const codeReturn = apply && apply.gateway_code_return && typeof apply.gateway_code_return === "object" ? apply.gateway_code_return : {};
    const statusPayload = {
      status: "ok",
      request_id: req.request_id,
      request: req,
      repair_packet: repairPacket,
      constraints: mergedConstraints,
      memory_refs: memoryRefs,
      analyze: analyze,
      apply: apply,
      summary: {
        analyze_status: c.norm(analyze && analyze.status),
        apply_status: applyStatus,
        apply_reason: applyReason,
        blocked_checks: blockedChecks,
        return_id: c.norm(codeReturn.return_id || ""),
        manifest_key: c.norm(codeReturn.manifest_key || "")
      },
      updated_at: c.nowIso(),
      trace_id: c.norm(d.trace_id)
    };
    persistBakuRepairIntakeStatus(req.request_id, statusPayload);
    appendBakuRepairIntakeLog({
      request_id: req.request_id,
      status: applyStatus || "unknown",
      analyze_status: c.norm(analyze && analyze.status),
      apply_status: applyStatus,
      apply_reason: applyReason,
      blocked_checks: blockedChecks,
      return_id: c.norm(codeReturn.return_id || ""),
      manifest_key: c.norm(codeReturn.manifest_key || ""),
      constraint_symptom: mergedConstraints.symptom,
      constraint_expected_fix: mergedConstraints.expected_fix,
      memory_ref_count: memoryRefCount,
      intake_summary: summarizeConstraints(mergedConstraints)
    });
    return withContractMeta({
      status: "ok",
      request: req,
      repair_packet: repairPacket,
      constraints: mergedConstraints,
      memory_refs: memoryRefs,
      analyze: analyze,
      apply: apply
    });
  };

  return {
    buildContractResponse: buildContractResponse,
    handleIntake: handleIntake,
    handleStatus: getBakuRepairIntakeStatus
  };
}
