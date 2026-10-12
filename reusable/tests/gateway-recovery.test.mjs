import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { JobQueue, ExpiringMemory } from "../gateway-jobs/job-state.mjs";
import { writeAtomicJson, readCheckpoint } from "../gateway-jobs/checkpoint.mjs";

test("expired lease cannot complete before housekeeping", () => {
  let time = 100;
  const q = new JobQueue({ now: () => time, leaseMs: 10 });
  q.enqueue("one", { value: 1 });
  const lease = q.claim("arc");
  time += 11;
  assert.equal(q.complete("one", lease.lease, "too late"), false);
  assert.equal(q.get("one").state, "leased"); // not a false success
  assert.equal(q.recoverExpired(), 1);
  assert.equal(q.get("one").state, "pending");
});

test("snapshot validation rejects corrupt IDs/states/duplicate job records", () => {
  assert.throws(() => JobQueue.restore({ schemaVersion: 99, jobs: [] }), /snapshot/);
  const q = new JobQueue({ now: () => 100 });
  q.enqueue("one", { value: 1 });
  const good = q.snapshot();
  const dup = structuredClone(good);
  dup.jobs.push(structuredClone(dup.jobs[0]));
  assert.throws(() => JobQueue.restore(dup, { now: () => 100 }), /duplicate/);
  const bad = structuredClone(good);
  bad.jobs[0].state = "unknown";
  assert.throws(() => JobQueue.restore(bad), /invalid/);
});

test("checkpoints survive a fresh Node process and reject stale worker responses", () => {
  const dir = mkdtempSync(join(tmpdir(), "metron-gateway-recovery-"));
  try {
    const file = join(dir, "state.json");
    let now = 1000;
    const q = new JobQueue({ now: () => now, leaseMs: 100, backoffMs: 50, maxRetries: 2 });
    const memory = new ExpiringMemory({ now: () => now });
    q.enqueue("J1", { prompt: "recover me" });
    q.enqueue("J2", { prompt: "remain pending" });
    const old = q.claim("ARC-before-crash");
    memory.put("worker-a", "session-1", "last", { marker: "saved" }, 200);
    now = 1101;
    writeAtomicJson(file, { jobs: q.snapshot(), memory: memory.snapshot() });
    assert.equal(readCheckpoint(file).jobs.jobs.length, 2);

    // A different Node process loads persisted JSON, recovers the expired
    // lease, and prevents the old worker from acknowledging stale work.
    const entry = new URL("../gateway-jobs/job-state.mjs", import.meta.url).href;
    const store = new URL("../gateway-jobs/checkpoint.mjs", import.meta.url).href;
    const code = [
      'import { JobQueue, ExpiringMemory } from ' + JSON.stringify(entry) + ';',
      'import { readCheckpoint, writeAtomicJson } from ' + JSON.stringify(store) + ';',
      'const file = process.argv[1];',
      'const snap = readCheckpoint(file);',
      'let at = 1101;',
      'const q = JobQueue.restore(snap.jobs, { now: () => at });',
      'if(q.get("J1").state !== "pending") throw Error("expired job was not recovered");',
      'if(q.get("J2").state !== "pending") throw Error("other job was lost");',
      'if(q.complete("J1",{worker:"ARC-before-crash",version:1},"late")) throw Error("stale lease accepted");',
      'const m=ExpiringMemory.restore(snap.memory, { now: () => at });',
      'if(m.get("worker-a","session-1","last")?.marker !== "saved") throw Error("memory lost");',
      'at=1151;',
      'const task=q.claim("ARC-after-crash");',
      'if(task?.id !== "J1" || task.lease.version !== 2) throw Error("new lease invalid");',
      'if(!q.complete("J1",task.lease,{ result:"ok" })) throw Error("completion failed");',
      'writeAtomicJson(file, {jobs:q.snapshot(),memory:m.snapshot()});',
      'console.log("RESTART_PASS");'
    ].join("\n");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, file],
      { encoding: "utf8", timeout: 12000 });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /RESTART_PASS/);
    const state = readCheckpoint(file);
    const restored = JobQueue.restore(state.jobs, { now: () => 1152 });
    assert.equal(restored.get("J1").state, "done");
    assert.equal(restored.get("J1").result.result, "ok");
    assert.equal(restored.get("J2").state, "pending");
    assert.deepEqual(readdirSync(dir), ["state.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory restore honors absolute TTL; corrupt checkpoint fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "metron-memory-"));
  try {
    let now = 10;
    const mem = new ExpiringMemory({ now: () => now });
    mem.put("arc", "s1", "x", "short", 10);
    mem.put("arc", "s2", "x", "long", 100);
    now = 50;
    const loaded = ExpiringMemory.restore(mem.snapshot(), { now: () => now });
    assert.equal(loaded.get("arc", "s1", "x"), null);
    assert.equal(loaded.get("arc", "s2", "x"), "long");
    assert.equal(readCheckpoint(join(dir, "absent.json")), null);
    const path = join(dir, "invalid.json");
    writeFileSync(path, "{ not JSON", "utf8");
    assert.throws(() => readCheckpoint(path), SyntaxError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
