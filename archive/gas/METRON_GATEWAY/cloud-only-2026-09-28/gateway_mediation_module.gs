function createGatewayMediationModule(ctx) {
  const c = ctx || {};

  const hasAny = (text, patterns) => {
    for (let i = 0; i < patterns.length; i++) {
      if (text.indexOf(patterns[i]) >= 0) return true;
    }
    return false;
  };

  const classifyIntent = (textRaw) => {
    const text = c.lower(c.norm(textRaw));
    if (!text) return "unknown";

    const executeWords = ["実行", "動かし", "run", "execute", "deploy", "反映", "同期"];
    const repairWords = ["修復", "復旧", "salvage", "repair", "壊れ", "エラー対応"];
    const reviewWords = ["レビュー", "確認", "監査", "audit", "check", "検証"];
    const strategyWords = ["どうする", "方針", "相談", "参謀", "戦略", "比較", "案"];

    if (hasAny(text, repairWords)) return "repair";
    if (hasAny(text, executeWords)) return "execute";
    if (hasAny(text, reviewWords)) return "review";
    if (hasAny(text, strategyWords)) return "strategy";
    return "chat";
  };

  const recommendLane = (intent, textRaw) => {
    const text = c.lower(c.norm(textRaw));
    if (intent === "repair") return { lane: "BAKU", mode: "baku_enqueue_arc", reason: "repair_intent" };
    if (intent === "execute") return { lane: "ARC", mode: "request_arc", reason: "execution_intent" };
    if (intent === "review") return { lane: "GATEWAY", mode: "analysis_only", reason: "review_intent" };
    if (intent === "strategy") return { lane: "GATEWAY", mode: "analysis_only", reason: "strategy_intent" };
    if (text.indexOf("route_chat") >= 0 || text.indexOf("lease_job") >= 0) {
      return { lane: "GATEWAY", mode: "analysis_only", reason: "control_plane_topic" };
    }
    return { lane: "ARC", mode: "request_arc", reason: "default_chat_lane" };
  };

  const buildOptions = (intent, route) => {
    const base = [];
    if (intent === "strategy" || intent === "review") {
      base.push({ key: "A", title: "分析のみ", lane: "GATEWAY", risk: "low" });
      base.push({ key: "B", title: "ARCへ委任", lane: "ARC", risk: "medium" });
      base.push({ key: "C", title: "BAKU修復委任", lane: "BAKU", risk: "medium" });
      return base;
    }
    base.push({ key: "A", title: "推奨ルート", lane: route.lane, risk: route.lane === "GATEWAY" ? "low" : "medium" });
    base.push({ key: "B", title: "分析のみ", lane: "GATEWAY", risk: "low" });
    return base;
  };

  const handleAdvise = (data) => {
    const d = data && typeof data === "object" ? data : {};
    const userText = c.norm(d.user_text || d.content || d.prompt || "");
    if (!userText) return { status: "error", error: "user_text_required" };

    const intent = classifyIntent(userText);
    const route = recommendLane(intent, userText);
    const options = buildOptions(intent, route);
    const requiresConfirmation = route.lane !== "GATEWAY";
    const profileApplied = c.lower(c.norm(d.profile_applied || "chat_only")) !== "off";

    const out = {
      status: "ok",
      role: "gateway_mediator",
      intent: intent,
      recommended: {
        lane: route.lane,
        mode: route.mode,
        reason: route.reason,
        requires_confirmation: requiresConfirmation
      },
      options: options,
      mediation: {
        profile_applied: profileApplied,
        chat_only_policy: true
      },
      summary_ja: requiresConfirmation
        ? "実行系ルートを推奨します。実行前に確認ステップを挟んでください。"
        : "分析系ルートを推奨します。Gateway内で整理してから次の操作を決めてください。",
      updated_at: c.nowIso()
    };

    c.addAudit(
      c.norm(d.trace_id),
      "GATEWAY_MEDIATION_ADVISED",
      c.norm(d.mission_id),
      c.norm(d.worker_id),
      "ok",
      ("intent=" + intent + " lane=" + route.lane + " mode=" + route.mode).slice(0, 600)
    );
    return out;
  };

  return {
    handleAdvise: handleAdvise
  };
}
