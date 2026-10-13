/**
 * Local multi-process coordinator for the Node.js Gateway reference.
 *
 * An atomic mkdir lock serializes reads and updates by cooperating processes
 * sharing a *local* filesystem. No stale-lock auto-removal: a crashed owner
 * leaves an observable lock and the system fails closed until an operator
 * independently verifies that the owner is gone.
 *
 * Not for NFS/distributed hosts or hostile multi-user filesystem access.
 * Remote side effects still require independent idempotency guarantees.
 */
import { mkdir, rmdir } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PersistentGateway } from "./persistent-gateway.mjs";

export class LockedGateway {
  constructor(file, {
    now = () => Date.now(), queueOptions = {}, memoryOptions = {},
    maxWaitMs = 4000, retryMs = 15
  } = {}) {
    if (typeof file !== "string" || !file) throw new Error("checkpoint file required");
    if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0 ||
        !Number.isFinite(retryMs) || retryMs < 1) throw new Error("invalid lock timing");
    this.file = resolve(file);
    this.lockPath = this.file + ".write-lock";
    this.now = now;
    this.queueOptions = queueOptions;
    this.memoryOptions = memoryOptions;
    this.maxWaitMs = maxWaitMs;
    this.retryMs = retryMs;
  }

  async #locked(action) {
    mkdirSync(dirname(this.file), { recursive: true });
    const started = Date.now();
    let acquired = false;
    for (;;) {
      try {
        await mkdir(this.lockPath);
        acquired = true;
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (Date.now() - started >= this.maxWaitMs) {
          const failure = new Error("LOCK_TIMEOUT: checkpoint held by another process or abandoned lock");
          failure.code = "LOCK_TIMEOUT";
          throw failure;
        }
        await delay(Math.min(this.retryMs, Math.max(1, this.maxWaitMs - (Date.now() - started))));
      }
    }

    try {
      const gateway = new PersistentGateway(this.file, {
        now: this.now, queueOptions: this.queueOptions, memoryOptions: this.memoryOptions
      });
      const output = action(gateway);
      // Never await external activity while holding this local filesystem lock.
      if (output && typeof output.then === "function") {
        throw new Error("async operation inside Gateway file lock is forbidden");
      }
      return output;
    } finally {
      if (acquired) await rmdir(this.lockPath);
    }
  }

  enqueue(id, payload = {}) { return this.#locked(gw => gw.enqueue(id, payload)); }
  claim(worker) { return this.#locked(gw => gw.claim(worker)); }
  complete(id, lease, result) { return this.#locked(gw => gw.complete(id, lease, result)); }
  fail(id, lease, error) { return this.#locked(gw => gw.fail(id, lease, error)); }
  recoverExpired() { return this.#locked(gw => gw.recoverExpired()); }
  getJob(id) { return this.#locked(gw => gw.getJob(id)); }
  putMemory(worker, session, key, value, ttlMs) {
    return this.#locked(gw => gw.putMemory(worker, session, key, value, ttlMs));
  }
  getMemory(worker, session, key) { return this.#locked(gw => gw.getMemory(worker, session, key)); }
  snapshot() { return this.#locked(gw => ({ jobs: gw.queue.snapshot(), memory: gw.memory.snapshot() })); }
}
