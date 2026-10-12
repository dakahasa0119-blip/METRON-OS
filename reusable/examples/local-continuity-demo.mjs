/**
 * METRON reference continuity demo (LOCAL FIXTURE ONLY).
 *
 * Uses all four newly extracted packages together without network traffic,
 * real AI calls, user data, Android, GAS, or third-party automation.
 * This is NOT proof of the legacy METRON system's complete integration.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { SelectorMemory } from "../arc-dom/selector-kit.mjs";
import { extractCards, inspectCard } from "../baku-dna/code-cards.mjs";
import { PersistentGateway } from "../gateway-jobs/persistent-gateway.mjs";
import { recommendEngine, newPatch, transitionPatch } from "../mothership/workflow.mjs";

export function runLocalContinuityDemo() {
  const dir = mkdtempSync(join(tmpdir(), "metron-demo-"));
  try {
    let now = 1000;
    const clock = () => now;
    const checkpoint = join(dir, "gateway.json");
    let gateway = new PersistentGateway(checkpoint, {
      now: clock, queueOptions: { leaseMs: 200, backoffMs: 40 }
    });
    const instruction = "小さな関数のコードを修正して";
    const decision = recommendEngine(instruction);
    assert.equal(decision.engine, "deepseek");
    gateway.enqueue("demo-mission", { instruction, decision });
    const leased = gateway.claim("arc-demo-worker");
    assert.equal(leased?.id, "demo-mission");

    // ARC's browser selector-learning concept, using a known synthetic selector.
    const selectors = new SelectorMemory({ confirmations: 2, now: clock });
    assert.equal(selectors.observe("local.fixture", "input", "#prompt").committed, false);
    assert.equal(selectors.observe("local.fixture", "input", "#prompt").committed, true);
    selectors.setManual("local.fixture", "send", "#send", { lock: true });

    // BAKU component extraction and a deliberately small, trusted local fixture.
    const source = "function normalizeDemo(value) { return String(value).trim(); }";
    const cards = extractCards(source, { sourceName: "fixture.js" });
    assert.deepEqual(cards.map(c => c.name), ["normalizeDemo"]);
    assert.deepEqual(inspectCard(cards[0]).flags, []);

    // MotherShip patch lifecycle: submission is not verification.
    let patch = transitionPatch(newPatch("patch-1", source), "stage");
    patch = transitionPatch(patch, "submit");

    // Only the hard-coded local test fixture is evaluated here. vm is NOT a
    // secure sandbox and must never execute untrusted agent-generated code.
    const candidatePath = join(dir, "candidate.js");
    writeFileSync(candidatePath, source, "utf8");
    const readBackMatch = readFileSync(candidatePath, "utf8") === source;
    const isolated = vm.createContext({});
    new vm.Script(source).runInContext(isolated, { timeout: 1000 });
    const smokeTestPass = isolated.normalizeDemo("  ok  ") === "ok";
    patch = transitionPatch(patch, "verify", { readBackMatch, smokeTestPass });
    assert.equal(patch.state, "verified");

    gateway.putMemory("arc-demo-worker", "session-1", "selected_input",
      selectors.get("local.fixture", "input"), 10000);
    assert.equal(gateway.complete(leased.id, leased.lease, {
      selectedInput: selectors.get("local.fixture", "input"),
      patchState: patch.state
    }), true);

    // Simulate restart by constructing a fresh instance from the JSON file.
    now += 1;
    gateway = new PersistentGateway(checkpoint, { now: clock });
    assert.equal(gateway.getJob("demo-mission").state, "done");
    assert.equal(gateway.getMemory("arc-demo-worker", "session-1", "selected_input"), "#prompt");
    return {
      outcome: "LOCAL_SIMULATION_PASS",
      paths: ["ARC", "BAKU", "Gateway", "MotherShip"],
      selectedInput: selectors.get("local.fixture", "input"),
      jobState: gateway.getJob("demo-mission").state,
      patchState: patch.state,
      limits: "No external AI, GAS, Android or distributed/multi-writer integration was exercised"
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1].replace(/\\/g, "/")).href) {
  console.log(JSON.stringify(runLocalContinuityDemo(), null, 2));
}
