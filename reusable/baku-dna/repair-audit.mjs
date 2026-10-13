/**
 * Reproducible, read-only BAKU historical repair-state classifier.
 *
 * Inputs are already-parsed Google Sheets-style rows with named columns.
 * Does not connect to Drive, mutate GAS, execute code or prove deployed repairs.
 * Sheet rows MUST be passed in append order (latest occurrence last).
 */
function requiredRows(value, name) {
  if (!Array.isArray(value)) throw new TypeError(name + " must be an array");
  return value;
}

function queueId(row) {
  const id = String(row?.QueueId ?? "").trim();
  if (!id) throw new Error("repair record missing QueueId");
  return id;
}

const text = value => String(value ?? "").trim().toLowerCase();
const yes = value => text(value) === "y";

export function auditRepairOutcomes(metricRows, evidenceRows) {
  requiredRows(metricRows, "metricRows");
  requiredRows(evidenceRows, "evidenceRows");

  // The last occurrence of a QueueId is its currently recorded state.
  // Repeated attempts are NOT independent faults or successful repairs.
  const finalMetrics = new Map();
  const finalEvidence = new Map();
  for (const row of metricRows) finalMetrics.set(queueId(row), row);
  for (const row of evidenceRows) finalEvidence.set(queueId(row), row);

  const finalStates = new Map();
  let candidateLocalFixes = 0;
  let cleanNoChange = 0;
  let unsupportedPositiveStates = 0;
  let missingEvidenceRows = 0;

  for (const [id, metric] of finalMetrics) {
    const state = text(metric.RepairState) || "(blank)";
    finalStates.set(state, (finalStates.get(state) || 0) + 1);

    const evidence = finalEvidence.get(id);
    if (!evidence) missingEvidenceRows++;

    // This only supports the system's *local compile and change* claim.
    // It is not independently executed or deployed verification.
    const common = !!evidence
      && text(metric.Result) === "ok"
      && text(evidence.Result) === "ok"
      && text(evidence.RepairState) === state;

    if (state === "repaired") {
      const supported = common && !yes(metric.CompileBeforeOk)
        && yes(metric.CompileAfterOk)
        && !yes(evidence.CompileBeforeOk)
        && yes(evidence.CompileAfterOk)
        && yes(evidence.CodeChanged)
        && text(evidence.ReviewVerdict) === "effective_fix";
      if (supported) candidateLocalFixes++;
      else unsupportedPositiveStates++;
    } else if (state === "clean") {
      const supported = common && yes(metric.CompileBeforeOk)
        && yes(metric.CompileAfterOk)
        && yes(evidence.CompileBeforeOk)
        && yes(evidence.CompileAfterOk)
        && !yes(evidence.CodeChanged)
        && text(evidence.ReviewVerdict) === "noop_clean";
      if (supported) cleanNoChange++;
      else unsupportedPositiveStates++;
    }
  }

  return {
    metricRecords: metricRows.length,
    evidenceRecords: evidenceRows.length,
    distinctQueues: finalMetrics.size,
    finalStates: Object.fromEntries([...finalStates].sort(([a], [b]) => a.localeCompare(b))),
    candidateLocalFixes,
    cleanNoChange,
    unsupportedPositiveStates,
    missingEvidenceRows,
    // There is no runtime/deployment proof in these two sources.
    deployedRepairSuccesses: null,
    assessmentScope: "recorded local compile/change evidence only; external runtime unverified"
  };
}
