import test from "node:test";
import assert from "node:assert/strict";
import { JobQueue, ExpiringMemory } from "../gateway-jobs/job-state.mjs";

test("job ids deduplicate and stale leases cannot complete", () => {
  let at = 1000;
  const queue = new JobQueue({ now: () => at, leaseMs: 100, backoffMs: 10 });
  queue.enqueue("job-1", { prompt: "hello" });
  assert.equal(queue.enqueue("job-1").deduped, true);
  const first = queue.claim("device-A");
  assert.equal(first?.id, "job-1");
  at += 101;
  assert.equal(queue.recoverExpired(), 1);
  assert.equal(queue.complete("job-1", first.lease, "late"), false);
  at += 10;
  const second = queue.claim("device-B");
  assert.equal(second?.id, "job-1");
  assert.equal(queue.complete("job-1", second.lease, { answer: "ok" }), true);
  assert.equal(queue.complete("job-1", second.lease, { answer: "repeat" }), false);
  assert.equal(queue.get("job-1").state, "done");
});

test("failed jobs back off then become dead-letter", () => {
  let at = 0;
  const queue = new JobQueue({ now: () => at, maxRetries: 1, backoffMs: 50 });
  queue.enqueue("x");
  const a = queue.claim("worker");
  queue.fail("x", a.lease, "temporary");
  assert.equal(queue.claim("worker"), null);
  at += 50;
  const b = queue.claim("worker");
  queue.fail("x", b.lease, "again");
  assert.equal(queue.get("x").state, "dead");
});

test("short memory expires and isolates sessions", () => {
  let now = 0;
  const mem = new ExpiringMemory({ now: () => now });
  mem.put("arc", "session-a", "last", { result: "saved" }, 5);
  assert.equal(mem.get("arc", "session-b", "last"), null);
  assert.equal(mem.get("arc", "session-a", "last").result, "saved");
  now = 5;
  assert.equal(mem.get("arc", "session-a", "last"), null);
});

test("worker heartbeat prolongs only the current unexpired lease", () => {
  let at = 100;
  const queue = new JobQueue({ now: () => at, leaseMs: 20, backoffMs: 0 });
  queue.enqueue("long-running");
  const active = queue.claim("ARC");
  assert.equal(queue.get("long-running").expiresAt, 120);
  at = 115;
  assert.equal(queue.renewLease("long-running", active.lease), true);
  assert.equal(queue.get("long-running").expiresAt, 135);
  at = 125;
  assert.equal(queue.renewLease("long-running", { worker: "other", version: 1 }), false);
  assert.equal(queue.renewLease("long-running", active.lease), true);
  assert.equal(queue.get("long-running").expiresAt, 145);
  at = 146;
  assert.equal(queue.renewLease("long-running", active.lease), false);
  assert.equal(queue.recoverExpired(), 1);
  const next = queue.claim("ARC-next");
  assert.equal(next.lease.version, 2);
  assert.equal(queue.renewLease("long-running", active.lease), false);
  assert.equal(queue.complete("long-running", next.lease, "ok"), true);
  assert.equal(queue.renewLease("long-running", next.lease), false);
});
