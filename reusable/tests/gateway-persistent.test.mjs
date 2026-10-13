import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentGateway } from "../gateway-jobs/persistent-gateway.mjs";

test("persistent Gateway preserves queue, reclaims expired work, and rejects stale ACK", () => {
  const dir = mkdtempSync(join(tmpdir(), "metron-persistent-"));
  try {
    const file = join(dir, "queue.json");
    let clock = 100;
    const opts = { now: () => clock, queueOptions: { leaseMs: 20, backoffMs: 5 } };
    let gateway = new PersistentGateway(file, opts);
    assert.ok(existsSync(file));
    gateway.enqueue("job-1", { task: "run" });
    gateway.putMemory("arc", "one", "checkpoint", "remember", 100);
    const first = gateway.claim("worker-before-crash");
    assert.equal(first.id, "job-1");
    clock = 121;
    gateway = new PersistentGateway(file, opts); // simulate process restart
    assert.equal(gateway.getJob("job-1").state, "pending");
    assert.equal(gateway.complete(first.id, first.lease, "stale"), false);
    assert.equal(gateway.getMemory("arc", "one", "checkpoint"), "remember");
    clock = 126;
    const second = gateway.claim("worker-after-restart");
    assert.equal(second.lease.version, 2);
    assert.equal(gateway.complete(second.id, second.lease, { result: "ok" }), true);
    const after = new PersistentGateway(file, opts);
    assert.equal(after.getJob("job-1").state, "done");
    assert.equal(after.getJob("job-1").result.result, "ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persistent Gateway does not discard invalid on-disk state", () => {
  const dir = mkdtempSync(join(tmpdir(), "metron-invalid-"));
  try {
    const file = join(dir, "queue.json");
    const gateway = new PersistentGateway(file);
    gateway.enqueue("id", { task: "work" });
    assert.equal(gateway.enqueue("id", { task: "work" }).deduped, true);
    assert.equal(gateway.getJob("id").state, "pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persisted worker heartbeat survives restart without replaying the job", () => {
  const dir = mkdtempSync(join(tmpdir(), "metron-heartbeat-"));
  try {
    const file = join(dir, "gateway.json");
    let now = 100;
    const opts = { now: () => now, queueOptions: { leaseMs: 20, backoffMs: 0 } };
    let gateway = new PersistentGateway(file, opts);
    gateway.enqueue("long-task", { kind: "fixture" });
    const lease = gateway.claim("ARC");
    now = 115;
    assert.equal(gateway.renewLease("long-task", lease.lease), true);
    assert.equal(gateway.getJob("long-task").expiresAt, 135);
    now = 125;
    gateway = new PersistentGateway(file, opts); // simulated single-writer restart
    assert.equal(gateway.getJob("long-task").state, "leased");
    assert.equal(gateway.getJob("long-task").expiresAt, 135);
    assert.equal(gateway.complete("long-task", lease.lease, { success: true }), true);
    const done = new PersistentGateway(file, opts);
    assert.equal(done.getJob("long-task").state, "done");
    assert.equal(done.renewLease("long-task", lease.lease), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
