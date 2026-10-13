import test from "node:test";
import assert from "node:assert/strict";
import { preflightRepairRequest } from "../gateway-jobs/repair-preflight.mjs";

const sample = () => ({
  symptom: "UI button is unresponsive", expectedFix: "Restore click handler",
  preserveContracts: ["keep UI state shape"],
  prohibitedChanges: ["no external API calls"],
  protectedPaths: ["src/security/**", "src/core/main.js"],
  proposedPaths: ["src/views/Button.js"]
});

test("complete ordinary scope is reviewable but never authorized to apply", () => {
  const v = preflightRepairRequest(sample());
  assert.equal(v.status, "ready_for_review");
  assert.equal(v.approved, false);
  assert.equal(v.canApply, false);
  assert.equal(v.requiresIndependentVerification, true);
});

test("all five historic constraint fields plus a proposed path are mandatory", () => {
  const { expectedFix, ...x } = sample();
  const v = preflightRepairRequest(x);
  assert.equal(v.status, "blocked");
  assert.deepEqual(v.missing, ["expectedFix"]);
  assert.equal(preflightRepairRequest({}).reason, "missing_or_invalid_constraints");
  assert.equal(preflightRepairRequest(null).reason, "invalid_request");
});

test("protected exact paths and directory subtrees block proposed changes", () => {
  const exact = preflightRepairRequest({ ...sample(), proposedPaths: ["SRC/CORE/MAIN.JS"] });
  assert.equal(exact.reason, "protected_scope_overlap");
  const subtree = preflightRepairRequest({ ...sample(), proposedPaths: ["src/security/roles/check.js"] });
  assert.equal(subtree.reason, "protected_scope_overlap");
  const adjacent = preflightRepairRequest({ ...sample(), proposedPaths: ["src/security-ui/button.js"] });
  assert.equal(adjacent.status, "ready_for_review");
});

test("path traversal, absolute paths and unsupported globs fail closed", () => {
  for (const p of ["../src/views/Button.js", "/tmp/evil.js", "C:\\temp\\file.js", "src//ok.js", "src/./ok.js"]) {
    const v = preflightRepairRequest({ ...sample(), proposedPaths: [p] });
    assert.equal(v.reason, "invalid_path_scope", p);
  }
  const v = preflightRepairRequest({ ...sample(), protectedPaths: ["**/auth/**"] });
  assert.equal(v.reason, "invalid_path_scope");
});

test("critical-scope keywords require review rather than assuming safety", () => {
  const p = { ...sample(), expectedFix: "Repair authorization token handling" };
  const v = preflightRepairRequest(p);
  assert.equal(v.status, "review_required");
  assert.equal(v.canApply, false);
});

test("source descriptions are not returned and claims of approval are ignored", () => {
  const p = { ...sample(), symptom: "incident-secret-123", approved: true, canApply: true };
  const output = preflightRepairRequest(p);
  assert.equal(output.status, "ready_for_review");
  assert.equal(output.approved, false);
  assert.equal(output.canApply, false);
  assert.equal(JSON.stringify(output).includes("incident-secret-123"), false);
});
