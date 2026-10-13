/**
 * Gateway mediation reference: advisory classification only.
 * Adapted from the archived Gateway's analysis/repair/execute routing idea.
 * No hooks, transport, worker dispatch, credentials or execution grants.
 * Words are heuristics; this is not an intent-security classifier.
 */
const normalize = value => String(value ?? "").normalize("NFKC").trim().toLowerCase();
const includesAny = (text, words) => words.some(w => text.includes(w));

const rules = [
  ["repair", ["修復", "復旧", "salvage", "repair", "壊れ", "エラー対応"]],
  ["execute", ["実行", "動かし", "run", "execute", "deploy", "反映", "同期"]],
  ["review", ["レビュー", "確認", "監査", "audit", "check", "検証"]],
  ["strategy", ["どうする", "方針", "相談", "参謀", "戦略", "比較", "案"]]
];

/** Intentionally yields only an advice object, never an execution command. */
export function adviseGatewayRoute(input) {
  if (typeof input !== "string") throw new TypeError("input must be text");
  const normalized = normalize(input);
  if (!normalized) {
    return { status: "error", reason: "input_required", executionAuthorized: false };
  }
  const intent = rules.find(([, terms]) => includesAny(normalized, terms))?.[0] ?? "chat";
  const target =
    intent === "repair" ? { lane: "BAKU", mode: "repair_candidate" } :
    intent === "execute" ? { lane: "ARC", mode: "execution_candidate" } :
    { lane: "GATEWAY", mode: "analysis_only" };

  // Unlike the historic default, unspecified chat stays analysis-only.
  // Explicit user authorization has to be supplied out-of-band to the real
  // executor; this library has no API that can produce such an authorization.
  const requiresConfirmation = target.lane !== "GATEWAY";
  return {
    status: "ok",
    intent,
    recommended: {
      lane: target.lane, mode: target.mode,
      requiresConfirmation,
      reason: intent === "chat" ? "safe_default" : intent + "_keyword"
    },
    alternatives: [
      { lane: "GATEWAY", mode: "analysis_only" },
      ...(target.lane === "GATEWAY" ? [] : [target])
    ],
    executionAuthorized: false,
    caution: "heuristic_only_no_side_effects"
  };
}
