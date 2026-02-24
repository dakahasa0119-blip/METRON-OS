/**
 * METRON Gateway v12 – Gateway UI + MainChat + PatchSlots + Timeline
 * 役割：
 * - 文明の人格ログ（MainChat）
 * - PatchSlots / Forge / Timeline（母艦復活後のために保持）
 * - ARC 連携ロジックは gateway_questions.gs 側に集約
 * - JS テンプレートは削除（ARC は自前で操作するため）
 */

/* ==================================================
   母艦 ID 解決（v10 のまま）
================================================== */

const DEFAULT_OS_ID = "1lK9XN7DJ1G_RM0-GzsQ2v4Hti49er2rvAkR_eV8lr0M";

function getTargetId() {
  const cached = CacheService.getUserCache().get("ACTIVE_MOTHERSHIP_ID");
  return cached || DEFAULT_OS_ID;
}

/* ==================================================
   Gateway UI エントリポイント
================================================== */

function doGetGatewayUi(e) {

  // 母艦切り替え（UI）
  if (e && e.parameter && e.parameter.ship_id) {
    CacheService.getUserCache().put("ACTIVE_MOTHERSHIP_ID", e.parameter.ship_id, 21600);
  }

  // Gateway UI
  return HtmlService.createHtmlOutputFromFile("gateway")
    .setTitle("METRON Gateway v12")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/**
 * 入口統合: doGet は code.js で一元管理する。
 * - mode=pending: ARC 旧互換（AI_Questions）
 * - default: Gateway UI
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.mode === "pending") {
    const result = handlePendingRequest();
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return doGetGatewayUi(e);
}

/* ==================================================
   MainChat（人格ログ）
================================================== */

function ensureMainChatSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let main = ss.getSheetByName("MAIN_CHAT");
  const legacy = ss.getSheetByName("MainChat");

  if (!main && legacy) {
    legacy.setName("MAIN_CHAT");
    main = legacy;
  }
  if (!main) {
    main = ss.insertSheet("MAIN_CHAT");
  }

  const header = ["Timestamp", "User", "Content", "Status", "Response", "MissionID"];
  if (main.getLastRow() === 0) {
    main.appendRow(header);
  } else {
    main.getRange(1, 1, 1, header.length).setValues([header]);
  }

  const currentCols = main.getMaxColumns();
  if (currentCols < header.length) {
    main.insertColumnsAfter(currentCols, header.length - currentCols);
  }
  return main;
}

function fetchMainChat() {
  try {
    const sheet = ensureMainChatSheet_();

    const last = sheet.getLastRow();
    if (last < 2) return [];

    const count = Math.min(50, last - 1);
    const startRow = Math.max(2, last - count + 1);
    const width = Math.max(3, sheet.getLastColumn());
    const rows = sheet.getRange(startRow, 1, count, width).getValues();

    // UIは [timestamp, source, message] を期待するため正規化
    // MAIN_CHAT(6列)では1行から user/content と ARC/response を両方表示する。
    const normalized = [];
    rows.forEach((r) => {
      if (width >= 6) {
        const ts = r[0];
        const user = String(r[1] || "SYSTEM");
        const content = String(r[2] || "");
        const response = String(r[4] || "");

        if (content) normalized.push([ts, user, content]);
        if (response) normalized.push([ts, "ARC", response]);
        return;
      }
      normalized.push([r[0], r[1] || "", r[2] || ""]);
    });

    return JSON.parse(JSON.stringify(normalized));

  } catch (e) {
    console.error("fetchMainChat error:", e);
    return [];
  }
}

function sendToMainChat(text) {
  try {
    const sheet = ensureMainChatSheet_();

    const now = new Date();
    // 誤連打のみ軽く抑止（直近1行が同一本文かつ1.5秒以内）
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const prev = sheet.getRange(lastRow, 1, 1, 3).getValues()[0];
      const prevTs = new Date(prev[0]).getTime();
      const prevUser = String(prev[1] || "");
      const prevText = String(prev[2] || "");
      const deltaMs = Date.now() - prevTs;
      if (Number.isFinite(prevTs) && deltaMs >= 0 && deltaMs <= 1500 && prevUser === "USER (GW)" && prevText === text) {
        console.warn("Gateway: sendToMainChat skipped (duplicate click)");
        return true;
      }
    }
    sheet.appendRow([now, "USER (GW)", text, "NEW", "", ""]);

    SpreadsheetApp.flush();
    return true;

  } catch (e) {
    console.error("sendToMainChat error:", e);
    return false;
  }
}

/**
 * Gateway UI からの送信後に、即時ルーティングを走らせる。
 * doPost(route_chat) を同プロジェクト内で直接呼び、UI操作の体感遅延を減らす。
 */
function routeChatNow() {
  return callGatewayMode_("route_chat", {});
}

function callGatewayMode_(mode, payload) {
  try {
    const auth = PropertiesService.getScriptProperties().getProperty("ARC_AUTH_KEY") || "";
    const req = {
      postData: {
        contents: JSON.stringify(
          Object.assign({}, payload || {}, {
            mode: mode,
            auth_key: auth
          })
        )
      }
    };
    const res = doPost(req);
    const txt = res && res.getContent ? res.getContent() : "";
    return txt ? JSON.parse(txt) : { status: "ok" };
  } catch (e) {
    console.error("callGatewayMode_ error:", mode, e);
    return { status: "error", error: String(e) };
  }
}

/**
 * UI送信の統合入口
 */
function submitGatewayChat(text) {
  const ok = sendToMainChat(text);
  if (!ok) return { status: "error", error: "send_failed" };
  const routed = routeChatNow();
  return { status: "ok", routed: routed };
}

/**
 * UI から複数メッセージをまとめて投入し、ルーティングを一度だけ実行する。
 * AllAI 送信時の route_chat 競合を避けるための入口。
 */
function submitGatewayChatBatch(texts) {
  const list = Array.isArray(texts) ? texts : [];
  let accepted = 0;
  for (let i = 0; i < list.length; i++) {
    const text = String(list[i] || "").trim();
    if (!text) continue;
    if (sendToMainChat(text)) accepted++;
  }
  if (accepted === 0) return { status: "error", error: "send_failed" };
  const routed = routeChatNow();
  return { status: "ok", accepted: accepted, routed: routed };
}

/* ==================================================
   Gateway UI 参照関数（gateway.html 用）
================================================== */

function fetchLogs() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet =
      ss.getSheetByName("ARC_AUDIT") ||
      ss.getSheetByName("SystemLog") ||
      ss.getSheetByName("MAIN_CHAT");
    if (!sheet || sheet.getLastRow() < 2) return [];
    const n = Math.min(100, sheet.getLastRow() - 1);
    const start = sheet.getLastRow() - n + 1;
    const w = Math.max(3, sheet.getLastColumn());
    return sheet.getRange(start, 1, n, w).getValues();
  } catch (e) {
    console.error("fetchLogs error:", e);
    return [];
  }
}

function fetchDebugSnapshot() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const getSheet = (name) => ss.getSheetByName(name);
    const toRows = (sheet, limit) => {
      if (!sheet || sheet.getLastRow() < 2) return [];
      const n = Math.min(limit, sheet.getLastRow() - 1);
      const start = sheet.getLastRow() - n + 1;
      const w = Math.max(1, sheet.getLastColumn());
      return sheet.getRange(start, 1, n, w).getValues();
    };
    const countByStatus = (rows, idx) => {
      const out = {};
      rows.forEach((r) => {
        const k = String((r[idx] || "")).toLowerCase() || "empty";
        out[k] = (out[k] || 0) + 1;
      });
      return out;
    };

    const jobs = toRows(getSheet("ARC_JOBS"), 200);
    const audit = toRows(getSheet("ARC_AUDIT"), 80);
    const errors = toRows(getSheet("ARC_ERRORS"), 40);
    const results = toRows(getSheet("ARC_RESULTS"), 40);
    const main = toRows(getSheet("MAIN_CHAT"), 60);
    const nodes = toRows(getSheet("ARC_NODES"), 40);
    const jobByStatus = countByStatus(jobs, 5);

    const nowMs = Date.now();
    const findAgeSec = (ts) => {
      const t = new Date(ts).getTime();
      if (!Number.isFinite(t)) return null;
      return Math.max(0, Math.floor((nowMs - t) / 1000));
    };
    const compactText = (v, max) => {
      const s = String(v == null ? "" : v);
      if (s.length <= max) return s;
      return s.slice(0, max) + "...(len=" + s.length + ")";
    };
    const parseRepeatCount = (raw) => {
      const txt = String(raw == null ? "" : raw).trim();
      if (!txt) return 1;
      try {
        const obj = JSON.parse(txt);
        const n = parseInt(String(obj && obj.repeat_count != null ? obj.repeat_count : ""), 10);
        return Number.isFinite(n) && n >= 1 ? n : 1;
      } catch (_) {
        return 1;
      }
    };
    const detectKeywords = (rows, colIdx, needles) => {
      const hit = [];
      rows.forEach((r) => {
        const txt = String((r[colIdx] || "")).toLowerCase();
        for (let i = 0; i < needles.length; i++) {
          if (txt.indexOf(needles[i]) >= 0) {
            hit.push({
              ts: r[0],
              value: compactText(r[colIdx], 240)
            });
            break;
          }
        }
      });
      return hit;
    };
    const pendingJobs = jobs.filter((r) => String(r[5] || "").toLowerCase() === "pending");
    const leasedJobs = jobs.filter((r) => String(r[5] || "").toLowerCase() === "leased");
    const stalePending = pendingJobs.filter((r) => {
      const age = findAgeSec(r[0]);
      return age != null && age >= 120;
    });
    const staleLeased = leasedJobs.filter((r) => {
      const leaseTs = r[6] || r[0];
      const age = findAgeSec(leaseTs);
      return age != null && age >= 180;
    });
    const authHints = []
      .concat(detectKeywords(audit, 6, ["unauthorized", "bad_signature", "worker_not_allowed"]))
      .concat(detectKeywords(errors, 3, ["unauthorized", "bad_signature", "worker_not_allowed"]));
    const postFailHints = detectKeywords(errors, 2, ["result_post_fail", "pending_timeout", "lease_expire"]);
    const lockTimeoutHints = detectKeywords(audit, 6, ["route_lock_timeout", "lease_lock_timeout"]);
    const latestNode = nodes.length ? nodes[nodes.length - 1] : null;
    const latestHudTail = latestNode ? compactText(latestNode[11] || "", 320) : "";
    const parsePayload = (v) => {
      const s = String(v == null ? "" : v);
      if (!s) return {};
      try { return JSON.parse(s); } catch (_) { return {}; }
    };
    const latestEvalFromJobs = (() => {
      for (let i = jobs.length - 1; i >= 0; i--) {
        const payload = parsePayload(jobs[i][4]);
        const summary = String(payload.last_eval_summary || "");
        if (!summary) continue;
        return {
          summary: compactText(summary, 400),
          at: String(payload.last_eval_at || jobs[i][0] || "")
        };
      }
      return { summary: "", at: "" };
    })();
    const terminalMain = main.filter((r) => {
      const st = String(r[3] || "").toLowerCase();
      return st === "arc_done" || st === "arc_error";
    });
    const doneMain = terminalMain.filter((r) => String(r[3] || "").toLowerCase() === "arc_done").length;
    const errorMain = terminalMain.length - doneMain;
    const doneRate = terminalMain.length > 0 ? Number((doneMain / terminalMain.length).toFixed(3)) : null;
    const timeoutErrCount = errors.filter((r) => {
      const t = String(r[2] || "").toUpperCase();
      const d = String(r[3] || "").toUpperCase();
      return t.indexOf("LEASE_EXPIRE_MAX") >= 0 || t.indexOf("PENDING_TIMEOUT") >= 0 || d.indexOf("LEASE_EXPIRE_MAX") >= 0 || d.indexOf("PENDING_TIMEOUT") >= 0;
    }).length;
    const timeoutRate = terminalMain.length > 0 ? Number((timeoutErrCount / terminalMain.length).toFixed(3)) : null;
    let compactSavedAudit = 0;
    for (let i = 0; i < audit.length; i++) {
      const rep = parseRepeatCount(audit[i][6]);
      if (rep > 1) compactSavedAudit += (rep - 1);
    }
    let compactSavedErrors = 0;
    for (let i = 0; i < errors.length; i++) {
      const rep = parseRepeatCount(errors[i][3]);
      if (rep > 1) compactSavedErrors += (rep - 1);
    }

    const hypothesis = (() => {
      if (authHints.length > 0) return "auth_mismatch_or_signature";
      if (postFailHints.length > 0) return "arc_result_delivery_unstable";
      if (staleLeased.length > 0 || stalePending.length > 0) return "job_lifecycle_stuck";
      return "no_critical_anomaly_detected";
    })();
    const nextActions = (() => {
      if (hypothesis === "auth_mismatch_or_signature") {
        return [
          "署名シークレットと許可Worker IDを照合し、認証失敗ログを再確認",
          "ARC側のresult postのURL/ヘッダを点検し再送テスト",
          "ARC_AUDIT/ARC_ERRORSのunauthorized系イベント発生時刻を突合"
        ];
      }
      if (hypothesis === "arc_result_delivery_unstable") {
        return [
          "ARC_RESULT投稿経路のタイムアウト設定と再試行条件を確認",
          "pending_timeout/lease_expireの発生job_idを抽出して個別追跡",
          "GatewayとARCの時刻ズレ(lease判定)を確認"
        ];
      }
      if (hypothesis === "job_lifecycle_stuck") {
        return [
          "stale pending/leased jobのtrace_idとlease時刻を確認",
          "ルートロック競合(route_lock_timeout)の頻度を確認",
          "詰まりjobの再投入前にARCワーカー稼働状態を点検"
        ];
      }
      return [
        "直近5分のmetrics推移を継続監視",
        "新規異常(anomalies)が増えた時点で再診断",
        "必要時のみ詳細ログ(生データ)を個別抽出"
      ];
    })();

    const aiPacket = {
      version: "gw-debug-ai-v2",
      generated_at: new Date(),
      metrics: {
        jobs_total: jobs.length,
        jobs_pending: pendingJobs.length,
        jobs_leased: leasedJobs.length,
        jobs_done: Number(jobByStatus.done || 0),
        jobs_error: Number(jobByStatus.error || 0),
        jobs_dead: Number(jobByStatus.dead || 0),
        nodes_total: nodes.length,
        errors_total: errors.length,
        results_total: results.length,
        main_chat_total: main.length,
        terminal_main_total: terminalMain.length,
        done_count_recent: doneMain,
        error_count_recent: errorMain,
        done_rate_recent: doneRate,
        timeout_error_count_recent: timeoutErrCount,
        timeout_rate_recent: timeoutRate,
        compact_saved_audit_recent: compactSavedAudit,
        compact_saved_errors_recent: compactSavedErrors,
        compact_saved_rows_recent: compactSavedAudit + compactSavedErrors
      },
      anomalies: {
        stale_pending_count: stalePending.length,
        stale_leased_count: staleLeased.length,
        auth_issue_count: authHints.length,
        result_post_fail_count: postFailHints.length,
        lock_timeout_count: lockTimeoutHints.length
      },
      candidates: {
        stale_pending_job_ids: stalePending.slice(-10).map((r) => String(r[1] || "")),
        stale_leased_job_ids: staleLeased.slice(-10).map((r) => String(r[1] || "")),
        latest_node_hud_tail: latestHudTail,
        latest_eval_summary: latestEvalFromJobs.summary,
        latest_eval_at: latestEvalFromJobs.at,
        recent_auth_issue: authHints.slice(-5),
        recent_post_fail: postFailHints.slice(-5),
        recent_lock_timeout: lockTimeoutHints.slice(-5)
      },
      hypothesis: hypothesis,
      next_actions: nextActions
    };

    const snapshot = {
      now: new Date(),
      jobs: {
        total: jobs.length,
        by_status: jobByStatus,
        recent: jobs.slice(-20)
      },
      audit: {
        total: audit.length,
        recent: audit.slice(-30)
      },
      errors: {
        total: errors.length,
        recent: errors.slice(-20)
      },
      results: {
        total: results.length,
        recent: results.slice(-20)
      },
      main_chat: {
        total: main.length,
        recent: main.slice(-20)
      },
      nodes: {
        total: nodes.length,
        recent: nodes.slice(-12)
      },
      ai_packet: aiPacket
    };

    return JSON.parse(JSON.stringify(snapshot));
  } catch (e) {
    console.error("fetchDebugSnapshot error:", e);
    return {
      error: String(e),
      jobs: { total: 0, by_status: {}, recent: [] },
      audit: { total: 0, recent: [] },
      errors: { total: 0, recent: [] },
      results: { total: 0, recent: [] },
      main_chat: { total: 0, recent: [] },
      nodes: { total: 0, recent: [] },
      ai_packet: {
        version: "gw-debug-ai-v1",
        hypothesis: "snapshot_error"
      }
    };
  }
}

function recoverStaleLeasedJobsFromUi(minAgeSec) {
  const thresholdSec = Math.max(30, Number(minAgeSec || 180));
  const res = callGatewayMode_("admin_recover_queues", {
    scope: "leased",
    leased_min_sec: thresholdSec
  });
  return {
    status: String(res.status || "ok"),
    threshold_sec: thresholdSec,
    recovered: Number(res.leased_recovered || 0),
    routed: { routed: Number(res.routed || 0) },
    raw: res
  };
}

function recoverStalePendingJobsFromUi(minAgeSec) {
  const thresholdSec = Math.max(60, Number(minAgeSec || 120));
  const res = callGatewayMode_("admin_recover_queues", {
    scope: "pending",
    pending_min_sec: thresholdSec
  });
  return {
    status: String(res.status || "ok"),
    threshold_sec: thresholdSec,
    recovered: Number(res.pending_recovered || 0),
    switched_target: 0,
    raw: res
  };
}

/**
 * Logsタブ向け: 滞留ジョブ救済をまとめて実行する。
 */
function recoverGatewayQueuesFromUi(options) {
  const opt = options && typeof options === "object" ? options : {};
  const leasedMinSec = Math.max(30, Number(opt.leased_min_sec || 180));
  const pendingMinSec = Math.max(60, Number(opt.pending_min_sec || 120));
  const scope = String(opt.scope || "both").toLowerCase();
  const res = callGatewayMode_("admin_recover_queues", {
    scope: scope,
    leased_min_sec: leasedMinSec,
    pending_min_sec: pendingMinSec
  });
  const leasedRecovered = Number(res.leased_recovered || 0);
  const pendingRecovered = Number(res.pending_recovered || 0);
  const recoveredTotal = leasedRecovered + pendingRecovered;
  return {
    status: String(res.status || "ok"),
    recovered_total: recoveredTotal,
    leased: { recovered: leasedRecovered },
    pending: { recovered: pendingRecovered, switched_target: 0 },
    routed: Number(res.routed || 0),
    raw: res
  };
}

function fetchEvolution() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet =
      ss.getSheetByName("Evolution_Timeline") ||
      ss.getSheetByName("ARC_LEARNING") ||
      ss.getSheetByName("PatchSlots");
    if (!sheet || sheet.getLastRow() < 2) return [];
    const n = Math.min(100, sheet.getLastRow() - 1);
    const start = sheet.getLastRow() - n + 1;
    const w = Math.max(3, sheet.getLastColumn());
    return sheet.getRange(start, 1, n, w).getValues();
  } catch (e) {
    console.error("fetchEvolution error:", e);
    return [];
  }
}

function fetchEvolutionList() {
  return fetchEvolution();
}

function fetchStaging() {
  try {
    return getStagedProposals();
  } catch (e) {
    console.error("fetchStaging error:", e);
    return [];
  }
}

/* ==================================================
   PatchSlots（母艦復活後のために保持）
================================================== */

function evaluateProposalsWithAI() {
  const METRON_OS_ID = getTargetId();
  const ss = SpreadsheetApp.openById(METRON_OS_ID);
  let sheet = ss.getSheetByName("PatchSlots");

  if (!sheet) {
    sheet = ss.insertSheet("PatchSlots");
    sheet.appendRow(["Timestamp","Filename","SlotName","Priority","Code","Status","Note"]);
    return [];
  }

  const last = sheet.getLastRow();
  if (last < 2) return [];

  const data = sheet.getRange(2, 1, last - 1, 7).getValues();

  return toJsonSafe(data.map((row, index) => ({
    id: index + 1,
    timestamp: Utilities.formatDate(new Date(row[0]), "JST", "yyyy-MM-dd HH:mm"),
    filename: row[1],
    slotName: row[2],
    preview: (row[4] || "").toString().slice(0, 80),
    status: row[5],
    note: row[6] || ""
  })));
}

/* ==================================================
   Forge_Staging（母艦復活後のために保持）
================================================== */

function getStagedProposals() {
  const METRON_OS_ID = getTargetId();
  try {
    const ss = SpreadsheetApp.openById(METRON_OS_ID);
    let sheet = ss.getSheetByName("Forge_Staging");

    if (!sheet) {
      sheet = ss.insertSheet("Forge_Staging");
      sheet.appendRow(["記録日時","生成物名称","解説","ソースコード","状態","バックアップURL"]);
      return [];
    }

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];

    const headers = values.shift();

    return toJsonSafe(values.map((row, index) => {
      const obj = {};
      headers.forEach((h, i) => {
        const v = row[i];
        obj[h] = v instanceof Date
          ? Utilities.formatDate(v, "JST", "yyyy-MM-dd HH:mm:ss")
          : v;
      });

      obj.id = index + 1;
      obj.timestamp = obj["記録日時"] || "-";
      obj.filename = obj["生成物名称"] || "No Name";
      obj.description = obj["解説"] || "";
      obj.code = obj["ソースコード"] || "";
      obj.status = obj["状態"] || "";
      obj.backupUrl = obj["バックアップURL"] || "";

      return obj;
    }));

  } catch (err) {
    console.error("getStagedProposals Error:", err);
    return [];
  }
}

/* ==================================================
   承認・昇格（母艦復活後のために保持）
================================================== */

function approveStagedProposal(id) {
  const METRON_OS_ID = getTargetId();
  const LOCK_KEY = "GW_APPROVE_LOCK_" + id;
  const TTL = 5000;

  const props = GW_props();
  const now = Date.now();

  const raw = props.getProperty(LOCK_KEY);
  if (raw) {
    try {
      const info = JSON.parse(raw);
      if (now - info.timestamp < TTL) return "SKIPPED";
    } catch (_) {}
  }
  props.setProperty(LOCK_KEY, JSON.stringify({ timestamp: now }));

  try {
    const list = getStagedProposals();
    const p = list.find(x => x.id === id);
    if (!p) throw new Error("提案が見つかりません");

    const ss = SpreadsheetApp.openById(METRON_OS_ID);
    const forge = ss.getSheetByName("Forge_Staging");
    const patch = ss.getSheetByName("PatchSlots") || (function () {
      const s = ss.insertSheet("PatchSlots");
      s.appendRow(["Timestamp","Filename","SlotName","Priority","Code","Status","Note"]);
      return s;
    })();

    patch.appendRow([
      new Date(),
      p.filename,
      "PATCH_SLOT_GATEWAY_" + Date.now(),
      999,
      p.code,
      "ACTIVE",
      JSON.stringify({
        source: "Gateway_approveStagedProposal",
        description: p.description || "",
        backupUrl: p.backupUrl || ""
      })
    ]);

    forge.getRange(id + 1, 5).setValue("PROMOTED");

    EV33_recordTimeline(
      "APPROVED",
      p.filename,
      "Gateway承認（Staging→PatchSlots）",
      "Forge_Staging",
      `Target: ${METRON_OS_ID}`
    );

    return "APPROVED";

  } catch (e) {
    console.error("approveStagedProposal error:", e);
    throw e;
  } finally {
    props.deleteProperty(LOCK_KEY);
  }
}

/* ==================================================
   Timeline / SystemLog（文明の歴史）
================================================== */

function logToMother_(level, message) {
  const METRON_OS_ID = getTargetId();
  try {
    const ss = SpreadsheetApp.openById(METRON_OS_ID);
    const logSheet = ss.getSheetByName("SystemLog") || (function () {
      const s = ss.insertSheet("SystemLog");
      s.appendRow(["Timestamp","Level","Message"]);
      return s;
    })();

    logSheet.appendRow([new Date(), level, message]);

  } catch (e) {
    console.error("logToMother_ error:", e);
  }
}

function EV33_recordTimeline(stage, module, summary, source, notes) {
  const METRON_OS_ID = getTargetId();
  try {
    const ss = SpreadsheetApp.openById(METRON_OS_ID);
    let sheet = ss.getSheetByName("Evolution_Timeline");

    if (!sheet) {
      sheet = ss.insertSheet("Evolution_Timeline");
      sheet.appendRow(["Timestamp", "Stage", "Module", "Summary", "Source", "Notes"]);
    }

    sheet.appendRow([
      new Date(),
      stage || "",
      module || "",
      summary || "",
      source || "",
      notes || ""
    ]);

  } catch (e) {
    console.error("EV33_recordTimeline error:", e);
  }
}
