import test from "node:test";
import assert from "node:assert/strict";
import { adviseGatewayRoute } from "../gateway-jobs/mediation-advice.mjs";

test("repair and execution suggestions do not grant authority", () => {
  const repair = adviseGatewayRoute("この機能を修復したい");
  assert.equal(repair.intent, "repair");
  assert.equal(repair.recommended.lane, "BAKU");
  assert.equal(repair.recommended.requiresConfirmation, true);
  assert.equal(repair.executionAuthorized, false);
  const exec = adviseGatewayRoute("Please deploy the patch");
  assert.equal(exec.recommended.lane, "ARC");
  assert.equal(exec.recommended.requiresConfirmation, true);
  assert.equal(exec.executionAuthorized, false);
});

test("strategy, review and unclassified chat stay in analysis", () => {
  for (const input of ["進め方を比較したい", "コードを監査して", "こんにちは"]) {
    const result = adviseGatewayRoute(input);
    assert.equal(result.recommended.lane, "GATEWAY");
    assert.equal(result.recommended.mode, "analysis_only");
    assert.equal(result.recommended.requiresConfirmation, false);
  }
});

test("unsafe ambiguity is advisory not a silent execution trigger", () => {
  const ambiguous = adviseGatewayRoute("修復するか確認したい");
  assert.equal(ambiguous.recommended.lane, "BAKU"); // historical precedence
  assert.equal(ambiguous.executionAuthorized, false);
  assert.equal(ambiguous.recommended.requiresConfirmation, true);
  assert.deepEqual(ambiguous.alternatives[0], { lane: "GATEWAY", mode: "analysis_only" });
  assert.equal(adviseGatewayRoute("     ").status, "error");
  assert.throws(() => adviseGatewayRoute({ request: "deploy" }), TypeError);
});

test("mediator returns no source text, credentials or worker payloads", () => {
  const request = "実行 project-token-should-not-be-echoed";
  const out = adviseGatewayRoute(request);
  assert.equal(JSON.stringify(out).includes("project-token"), false);
  assert.equal(out.executionAuthorized, false);
});
