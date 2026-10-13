import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runLocalContinuityDemo } from "../examples/local-continuity-demo.mjs";

test("four-component continuity reference runs without network calls", () => {
  const outcome = runLocalContinuityDemo();
  assert.equal(outcome.outcome, "LOCAL_SIMULATION_PASS");
  assert.equal(outcome.jobState, "done");
  assert.equal(outcome.patchState, "verified");
  assert.deepEqual(outcome.paths, ["ARC", "BAKU", "Gateway", "MotherShip"]);
  assert.match(outcome.limits, /No external AI/);
});

test("demo works as a standalone command", () => {
  const file = fileURLToPath(new URL("../examples/local-continuity-demo.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [file],
    { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "LOCAL_SIMULATION_PASS");
});
