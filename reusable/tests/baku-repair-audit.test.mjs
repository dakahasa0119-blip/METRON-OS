import test from "node:test";
import assert from "node:assert/strict";
import { auditRepairOutcomes } from "../baku-dna/repair-audit.mjs";

const metric = (id, RepairState, Result = "partial", before = "N", after = "N") =>
  ({ QueueId: id, RepairState, Result, CompileBeforeOk: before, CompileAfterOk: after });
const evidence = (id, RepairState, Result, before, after, changed, verdict) =>
  ({ QueueId: id, RepairState, Result, CompileBeforeOk: before, CompileAfterOk: after,
    CodeChanged: changed, ReviewVerdict: verdict });

test("repeat attempts do not inflate independent repair counts", () => {
  const m = [
    metric("r1", "unresolved"), metric("r1", "unresolved"),
    metric("r1", "repaired", "ok", "N", "Y"),
    metric("r2", "clean", "ok", "Y", "Y"),
    metric("r3", "unresolved_exhausted", "error"),
    metric("r3", "unresolved_exhausted", "error"),
    metric("r4", "unresolved")
  ];
  const e = [
    evidence("r1", "unresolved", "partial", "N", "N", "N", "no_progress"),
    evidence("r1", "repaired", "ok", "N", "Y", "Y", "effective_fix"),
    evidence("r2", "clean", "ok", "Y", "Y", "N", "noop_clean"),
    evidence("r3", "unresolved_exhausted", "error", "N", "N", "N", "no_progress"),
    evidence("r4", "unresolved", "partial", "N", "N", "N", "no_progress")
  ];
  const result = auditRepairOutcomes(m, e);
  assert.equal(result.metricRecords, 7);
  assert.equal(result.distinctQueues, 4);
  assert.deepEqual(result.finalStates, {
    clean: 1, repaired: 1, unresolved: 1, unresolved_exhausted: 1
  });
  assert.equal(result.candidateLocalFixes, 1);
  assert.equal(result.cleanNoChange, 1);
  assert.equal(result.unsupportedPositiveStates, 0);
  assert.equal(result.deployedRepairSuccesses, null);
});

test("optimistic status alone is never evidence of working repair", () => {
  const cases = [
    evidence("broken", "repaired", "ok", "N", "Y", "N", "effective_fix"), // unchanged code
    evidence("other", "repaired", "ok", "N", "Y", "Y", "no_progress"), // reviewer refused
    evidence("clean", "clean", "ok", "N", "Y", "N", "noop_clean") // compile originally failed
  ];
  const m = [
    metric("broken", "repaired", "ok", "N", "Y"),
    metric("other", "repaired", "ok", "N", "Y"),
    metric("clean", "clean", "ok", "Y", "Y"),
    metric("missing", "repaired", "ok", "N", "Y")
  ];
  const result = auditRepairOutcomes(m, cases);
  assert.equal(result.distinctQueues, 4);
  assert.equal(result.candidateLocalFixes, 0);
  assert.equal(result.cleanNoChange, 0);
  assert.equal(result.unsupportedPositiveStates, 4);
  assert.equal(result.missingEvidenceRows, 1);
});

test("missing queue identity fails closed", () => {
  assert.throws(() => auditRepairOutcomes([{ Result: "ok" }], []), /QueueId/);
  assert.throws(() => auditRepairOutcomes([], [{}]), /QueueId/);
  assert.throws(() => auditRepairOutcomes(null, []), /metricRows/);
});
