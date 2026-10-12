import test from "node:test";
import assert from "node:assert/strict";
import { classifyWork, recommendEngine, newPatch, transitionPatch } from "../mothership/workflow.mjs";

test("routes small work separately from multi-file evolution", () => {
  assert.equal(recommendEngine("この関数だけ直して").engine, "deepseek");
  assert.equal(recommendEngine("複数ファイルの依存関係を整理して修復").engine, "gemini");
  assert.equal(classifyWork("複数ファイルの構成").multiFile, true);
});

test("submission is not deployment: must verify readback and smoke tests", () => {
  const patch = newPatch("P-1", "function hello() {}");
  const staged = transitionPatch(patch, "stage");
  const submitted = transitionPatch(staged, "submit");
  assert.equal(submitted.state, "submitted");
  assert.throws(() => transitionPatch(submitted, "verify"), /verification requires/);
  const verified = transitionPatch(submitted, "verify", { readBackMatch: true, smokeTestPass: true });
  assert.equal(verified.state, "verified");
  assert.equal(transitionPatch(verified, "rollback").state, "rolled_back");
  assert.throws(() => transitionPatch(patch, "verify"), /invalid transition/);
});
