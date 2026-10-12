/**
 * Gateway queue & expiring memory — portable state machine reference.
 * No network transport or persistence is included. Caller must persist snapshots
 * and serialize concurrent mutations if using this in production.
 */

export class JobQueue {
  constructor({ now = () => Date.now(), leaseMs = 300_000, maxRetries = 2, backoffMs = 30_000 } = {}) {
    this.now = now;
    this.leaseMs = leaseMs;
    this.maxRetries = maxRetries;
    this.backoffMs = backoffMs;
    this.jobs = new Map();
  }
  enqueue(id, payload = {}) {
    if (typeof id !== "string" || !id.trim()) throw new Error("job id required");
    if (this.jobs.has(id)) return { ...this.jobs.get(id), deduped: true };
    const record = { id, payload: structuredClone(payload), state: "pending", attempts: 0,
      worker: null, leaseVersion: 0, expiresAt: null, nextReadyAt: this.now(), result: null, error: null };
    this.jobs.set(id, record);
    return { ...record, deduped: false };
  }
  claim(worker) {
    if (typeof worker !== "string" || !worker) throw new Error("worker required");
    this.recoverExpired();
    for (const job of this.jobs.values()) {
      if (job.state !== "pending" || this.now() < job.nextReadyAt) continue;
      job.state = "leased";
      job.worker = worker;
      job.leaseVersion++;
      job.expiresAt = this.now() + this.leaseMs;
      return { id: job.id, payload: structuredClone(job.payload), lease: { worker, version: job.leaseVersion } };
    }
    return null;
  }
  isLeaseValid(job, lease) {
    return job && job.state === "leased" && lease?.worker === job.worker && lease?.version === job.leaseVersion;
  }
  complete(id, lease, result) {
    const job = this.jobs.get(id);
    if (!this.isLeaseValid(job, lease)) return false;
    job.state = "done";
    job.result = structuredClone(result);
    job.expiresAt = null;
    return true;
  }
  fail(id, lease, error) {
    const job = this.jobs.get(id);
    if (!this.isLeaseValid(job, lease)) return false;
    job.attempts++;
    job.error = String(error);
    job.worker = null;
    job.expiresAt = null;
    if (job.attempts > this.maxRetries) {
      job.state = "dead";
    } else {
      job.state = "pending";
      job.nextReadyAt = this.now() + this.backoffMs * (2 ** (job.attempts - 1));
    }
    return true;
  }
  recoverExpired() {
    let recovered = 0;
    for (const job of this.jobs.values()) {
      if (job.state !== "leased" || this.now() < job.expiresAt) continue;
      const lease = { worker: job.worker, version: job.leaseVersion };
      if (this.fail(job.id, lease, "lease_expired")) recovered++;
    }
    return recovered;
  }
  get(id) {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }
}

/** Ephemeral per-worker/session notes with TTL, analogous to ARC_SHORT_MEMORY. */
export class ExpiringMemory {
  constructor({ now = () => Date.now(), defaultTtlMs = 1_800_000 } = {}) {
    this.now = now;
    this.defaultTtlMs = defaultTtlMs;
    this.items = new Map();
  }
  key(worker, session, name) { return JSON.stringify([worker, session, name]); }
  put(worker, session, name, value, ttlMs = this.defaultTtlMs) {
    if (!worker || !name || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("invalid memory entry");
    this.items.set(this.key(worker, session, name), { value: structuredClone(value), expiresAt: this.now() + ttlMs });
  }
  get(worker, session, name) {
    const key = this.key(worker, session, name), item = this.items.get(key);
    if (!item) return null;
    if (this.now() >= item.expiresAt) { this.items.delete(key); return null; }
    return structuredClone(item.value);
  }
}
