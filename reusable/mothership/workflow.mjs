/**
 * MotherShip reference: small-vs-structural task routing and evidence-based patch states.
 * In the historical implementation, submitting an ARC patch could be labeled applied.
 * This extraction intentionally makes submission and verification different states.
 */

export function classifyWork(prompt) {
  const text = String(prompt || "");
  const code = /\b(?:function|class|const|import|export)\b|\.gs\b|\.kt\b|\bjavascript\b|コード|実装/i.test(text);
  const multiFile = /複数ファイル|モジュール|依存関係|multi.?file|architecture|アーキテクチャ|全体|構成/i.test(text);
  const evolution = /進化|自己修復|復旧|rollback|repair|restore|patch|改修/i.test(text);
  return { code, multiFile, evolution, length: text.length };
}

export function recommendEngine(prompt, { localRepair = "deepseek", structural = "gemini" } = {}) {
  const traits = classifyWork(prompt);
  return {
    engine: traits.multiFile || traits.evolution || traits.length > 4000 ? structural : localRepair,
    traits,
    reason: traits.multiFile ? "multi_file" :
      traits.evolution ? "repair_or_evolution" :
      traits.length > 4000 ? "long_request" : "small_task"
  };
}

export function newPatch(id, code) {
  if (!id || !code) throw new Error("patch id and code required");
  return { id, code, state: "proposed", evidence: null };
}

/** No claim of 'applied' until code readback AND behavior check both pass. */
export function transitionPatch(patch, event, evidence = null) {
  const allowed = {
    proposed: { stage: "staged", reject: "rejected" },
    staged: { submit: "submitted", reject: "rejected" },
    submitted: { verify: "verified", fail: "failed" },
    verified: { rollback: "rolled_back" }
  };
  const next = allowed[patch.state]?.[event];
  if (!next) throw new Error(`invalid transition: ${patch.state} -> ${event}`);
  if (event === "verify" && !(evidence?.readBackMatch === true && evidence?.smokeTestPass === true)) {
    throw new Error("verification requires independent readback and smoke test evidence");
  }
  return { ...patch, state: next, evidence: evidence ? structuredClone(evidence) : patch.evidence };
}
