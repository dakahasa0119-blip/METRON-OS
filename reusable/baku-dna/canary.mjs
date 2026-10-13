/**
 * BAKU reusable canary gate — explicit safety evidence before and after apply.
 *
 * This reference evaluates caller-provided assertions. It neither executes
 * code nor authenticates approvers, and must not be mistaken for a sandbox,
 * static security audit or automatic autonomous repair.
 */
import { inspectCard } from "./code-cards.mjs";

function present(value) { return typeof value === "string" && value.trim().length > 0; }

export function evaluateCanary(candidate, evidence = {}, { phase = "preflight" } = {}) {
  if (!candidate || typeof candidate.code !== "string" || !present(candidate.name)) {
    throw new Error("candidate name and code are required");
  }
  if (phase !== "preflight" && phase !== "postflight") throw new Error("invalid canary phase");
  const flags = inspectCard(candidate).flags;
  const checks = [];
  const check = (name, ok, severity) => {
    checks.push({ name, ok: ok === true, severity });
  };

  check("source_provenance", present(evidence.sourceRef), "review");
  check("human_approval", present(evidence.approvedBy), "review");
  check("syntax_validated", evidence.syntaxValid === true, "block");
  check("behavior_tests", evidence.behaviorTestsPass === true, "block");
  check("rollback_available", evidence.rollbackReady === true, "block");
  check("risk_review", flags.length === 0 || evidence.riskReviewed === true, "review");
  if (phase === "postflight") {
    check("readback_match", evidence.readBackMatch === true, "block");
    check("post_apply_smoke", evidence.postApplySmokePass === true, "block");
    check("audit_trace", present(evidence.auditTraceId), "review");
  }

  const failed = checks.filter(c => !c.ok);
  const status = failed.some(c => c.severity === "block")
    ? "blocked"
    : failed.length > 0 ? "needs_review" : "pass";

  return {
    candidate: candidate.name,
    phase,
    status,
    flags,
    failed_checks: failed.map(c => c.name),
    checks,
    automaticDeployment: false,
    evidenceAuthenticity: "not_independently_verified"
  };
}

/**
 * Confusion-matrix report on manually labelled dispositions.
 * This reports agreement with labels, NOT success on unseen real repairs.
 */
export function evaluateLabelledCorpus(samples) {
  if (!Array.isArray(samples) || !samples.length) {
    throw new Error("a non-empty labelled corpus is required");
  }
  const classes = ["pass", "needs_review", "blocked"];
  const matrix = Object.fromEntries(classes.map(v =>
    [v, Object.fromEntries(classes.map(p => [p, 0]))]));
  let matches = 0;
  for (const sample of samples) {
    if (!classes.includes(sample.expected)) throw new Error("invalid expected disposition");
    const prediction = evaluateCanary(sample.candidate, sample.evidence || {},
      { phase: sample.phase || "preflight" }).status;
    matrix[sample.expected][prediction]++;
    if (sample.expected === prediction) matches++;
  }
  const byClass = {};
  for (const label of classes) {
    const truePositive = matrix[label][label];
    const actual = classes.reduce((n, predicted) => n + matrix[label][predicted], 0);
    const predicted = classes.reduce((n, expected) => n + matrix[expected][label], 0);
    byClass[label] = {
      support: actual,
      precision: predicted > 0 ? truePositive / predicted : null,
      recall: actual > 0 ? truePositive / actual : null
    };
  }
  return {
    samples: samples.length,
    correct: matches,
    accuracy: matches / samples.length,
    matrix,
    byClass,
    meaning: "agreement_with_provided_labels_only"
  };
}
