function doPost(e) {
  let data = {};
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (_) {
    data = {};
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

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
  const mode = norm(data.mode);

  const expectedAuth = props.getProperty("ARC_AUTH_KEY") || "";
  const requiresAuth = [
    "arc_result", "report_result",
    "arc_error", "report_error",
    "arc_learning",
    "arc_heartbeat", "register_worker", "lease_job",
    "arc_consult", "route_chat"
  ];
  if (expectedAuth && requiresAuth.indexOf(mode) >= 0) {
    if (norm(data.auth_key) !== expectedAuth) {
      return jsonOut({ status: "error", error: "unauthorized" });
    }
  }

  const sheets = {
    main: ensureSheet("MAIN_CHAT", ["Timestamp", "User", "Content", "Status", "Response", "MissionID"]),
    nodes: ensureSheet("ARC_NODES", ["LastSeen", "IP", "Port", "Status", "Capabilities", "Version"]),
    jobs: ensureSheet("ARC_JOBS", ["Timestamp", "JobID", "Worker", "Mode", "Payload", "Status", "LeasedAt"]),
    results: ensureSheet("ARC_RESULTS", ["Timestamp", "MissionID", "Target", "Prompt", "Result", "ImageURL"]),
    errors: ensureSheet("ARC_ERRORS", ["Timestamp", "QID", "Type", "Data"]),
    learning: ensureSheet("ARC_LEARNING", ["Timestamp", "Target", "Learned"]),
    mothership: ensureSheet("MOTHERSHIP_QUEUE", ["Timestamp", "MessageID", "User", "Content", "Status"])
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

    return { route: route, target: target, opMode: opMode, script: script, prompt: cleanPrompt, executor: executor };
  };

  const enqueueArcJob = (job) => {
    const jobId = norm(job.jobId) || ("JOB_" + Utilities.getUuid().slice(0, 8));
    const payload = {
      qid: norm(job.qid) || jobId,
      target: norm(job.target) || "gemini",
      prompt: norm(job.prompt) || "",
      script: norm(job.script) || "",
      executor: norm(job.executor) || "AUTO",
      requested_by: norm(job.user) || "gateway",
      ts: nowIso()
    };
    sheets.jobs.appendRow([new Date(), jobId, norm(job.workerId), norm(job.mode) || "request_arc", JSON.stringify(payload), "pending", ""]);
    return { jobId: jobId, payload: payload };
  };

  const routeOneChatRow = (rowIndex, rowValues) => {
    const content = norm(rowValues[2]);
    const status = lower(rowValues[3]);
    const user = norm(rowValues[1]) || "operator";
    const missionId = norm(rowValues[5]);
    if (!content) return null;
    if (status && status !== "new" && status !== "pending") return null;

    const cmd = parseCommandTags(content);
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
        workerId: ""
      });
      sheets.main.getRange(rowIndex, 4).setValue("QUEUED_ARC");
      sheets.main.getRange(rowIndex, 5).setValue("ARC queued: " + effectiveMode + " / " + cmd.target + " / " + cmd.executor);
      sheets.main.getRange(rowIndex, 6).setValue(jobRes.jobId);
      return { routed: "ARC", jobId: jobRes.jobId, mode: effectiveMode };
    }

    const msgId = missionId || ("MS_" + rowIndex + "_" + Date.now());
    sheets.mothership.appendRow([new Date(), msgId, user, content, "pending"]);
    sheets.main.getRange(rowIndex, 4).setValue("ROUTED_MOTHERSHIP");
    sheets.main.getRange(rowIndex, 5).setValue("Forwarded to MOTHERSHIP");
    sheets.main.getRange(rowIndex, 6).setValue(msgId);
    return { routed: "MOTHERSHIP", jobId: msgId, mode: "mothership_queue" };
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

  const claimNextInstruction = (workerId, consumer) => {
    routePendingChatCommands();
    const rows = sheets.jobs.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowWorker = norm(row[2]);
      const rowMode = norm(row[3]) || "request_arc";
      const payloadRaw = norm(row[4]);
      const status = lower(row[5]);
      if (status !== "pending") continue;
      if (rowWorker && workerId && rowWorker !== workerId) continue;
      sheets.jobs.getRange(i + 1, 6).setValue("leased");
      sheets.jobs.getRange(i + 1, 7).setValue(new Date());
      let payload = {};
      try {
        payload = payloadRaw ? JSON.parse(payloadRaw) : {};
      } catch (_) {
        payload = { raw: payloadRaw };
      }
      const wanted = upper(payload.executor || "AUTO");
      const mine = upper(consumer || "ARC");
      if (wanted !== "AUTO" && wanted !== mine) continue;
      if (!rowWorker && workerId) sheets.jobs.getRange(i + 1, 3).setValue(workerId);
      return Object.assign({ mode: rowMode, job_id: norm(row[1]) }, payload);
    }
    return null;
  };
  const upper = (v) => norm(v).toUpperCase();

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
    const mid = norm(missionId);
    if (!mid) return;
    const rows = sheets.jobs.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (norm(rows[i][1]) !== mid) continue;
      sheets.jobs.getRange(i + 1, 6).setValue(status);
      if (!norm(rows[i][6])) sheets.jobs.getRange(i + 1, 7).setValue(new Date());
      return;
    }
  };

  if (mode === "arc_setup") {
    const setupSheets = (data.blueprint && data.blueprint.sheets) || {};
    Object.keys(setupSheets).forEach((name) => ensureSheet(name, setupSheets[name]));
    return textOut("Setup Success");
  }

  if (mode === "handshake") {
    return jsonOut({ status: "ok", role: "gateway", version: "arc-gateway-16.0", control: "gateway_primary" });
  }

  if (mode === "submit_chat") {
    const user = norm(data.user) || "operator";
    const content = norm(data.content);
    if (!content) return jsonOut({ status: "error", error: "content_required" });
    sheets.main.appendRow([new Date(), user, content, "NEW", "", ""]);
    return jsonOut({ status: "ok" });
  }

  if (mode === "route_chat") {
    const routed = routePendingChatCommands();
    return jsonOut({ status: "ok", routed: routed.length });
  }

  if (mode === "arc_result" || mode === "report_result") {
    const missionId = norm(data.qid || data.mission_id);
    const result = norm(data.text);
    sheets.results.appendRow([new Date(), missionId, data.target || "", data.prompt || "", result, data.image || ""]);
    completeArcJob(missionId, "done");
    completeLinkedChat(missionId, result, "result");
    return jsonOut({ status: "ok" });
  }

  if (mode === "arc_error" || mode === "report_error") {
    const missionId = norm(data.qid || data.mission_id);
    const err = norm(data.error_type);
    const payload = norm(data.data);
    sheets.errors.appendRow([new Date(), missionId, err, payload]);
    completeArcJob(missionId, "error");
    completeLinkedChat(missionId, "[" + err + "] " + payload, "error");
    return jsonOut({ status: "ok" });
  }

  if (mode === "arc_learning") {
    sheets.learning.appendRow([new Date(), data.target || "", data.learned || ""]);
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
