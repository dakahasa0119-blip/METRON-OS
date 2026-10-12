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
    return !!(job && job.state === "leased" && Number.isFinite(job.expiresAt) && this.now() < job.expiresAt && lease?.worker === job.worker && lease?.version === job.leaseVersion);
  }
  complete(id, lease, result) {
    const job = this.jobs.get(id);
    if (!this.isLeaseValid(job, lease)) return false;
    job.state = "done";
    job.result = structuredClone(result);
    job.expiresAt = null;
    return true;
  }
  #recordFailure(job, error) {
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
  }
  fail(id, lease, error) {
    const job = this.jobs.get(id);
    if (!this.isLeaseValid(job, lease)) return false;
    this.#recordFailure(job, error);
    return true;
  }
  recoverExpired() {
    let recovered = 0;
    for (const job of this.jobs.values()) {
      if (job.state !== "leased" || this.now() < job.expiresAt) continue;
      // Recovery is an internal transition, not a stale external worker ACK.
      this.#recordFailure(job, "lease_expired");
      recovered++;
    }
    return recovered;
  }
  get(id) {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }
  /** Portable JSON snapshot; persist after every transition for crash recovery. */
  snapshot() {
    return {
      schemaVersion: 1,
      config: { leaseMs: this.leaseMs, maxRetries: this.maxRetries, backoffMs: this.backoffMs },
      jobs: Array.from(this.jobs.values()).map(record => structuredClone(record))
    };
  }
  /** Caller must ensure this is the sole writer to the backing store. */
  static restore(snapshot, { now = () => Date.now() } = {}) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.jobs)) {
      throw new Error("unsupported or corrupt job snapshot");
    }
    const conf = snapshot.config;
    if (!conf || !Number.isFinite(conf.leaseMs) || conf.leaseMs <= 0 ||
        !Number.isInteger(conf.maxRetries) || conf.maxRetries < 0 ||
        !Number.isFinite(conf.backoffMs) || conf.backoffMs < 0) {
      throw new Error("invalid job snapshot configuration");
    }
    const queue = new JobQueue({ ...conf, now });
    const validStates = new Set(["pending", "leased", "done", "dead"]);
    for (const raw of snapshot.jobs) {
      if (!raw || typeof raw.id !== "string" || !raw.id.trim() || queue.jobs.has(raw.id) ||
          !validStates.has(raw.state) || !Number.isInteger(raw.attempts) || raw.attempts < 0 ||
          !Number.isSafeInteger(raw.leaseVersion) || raw.leaseVersion < 0 ||
          !Number.isFinite(raw.nextReadyAt) ||
          (raw.state === "leased" && (typeof raw.worker !== "string" || !raw.worker ||
            !Number.isFinite(raw.expiresAt))) ) {
        throw new Error("invalid or duplicate job snapshot record");
      }
      queue.jobs.set(raw.id, structuredClone(raw));
    }
    queue.recoverExpired();
    return queue;
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
  snapshot() {
    return { schemaVersion: 1, defaultTtlMs: this.defaultTtlMs,
      items: Array.from(this.items, ([key, entry]) => [key, structuredClone(entry)]) };
  }
  static restore(snapshot, { now = () => Date.now() } = {}) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.items) ||
        !Number.isFinite(snapshot.defaultTtlMs) || snapshot.defaultTtlMs <= 0) {
      throw new Error("unsupported or corrupt memory snapshot");
    }
    const mem = new ExpiringMemory({ now, defaultTtlMs: snapshot.defaultTtlMs });
    for (const pair of snapshot.items) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" ||
          mem.items.has(pair[0]) || !pair[1] || !Number.isFinite(pair[1].expiresAt)) {
        throw new Error("invalid or duplicate memory snapshot record");
      }
      if (pair[1].expiresAt > now()) mem.items.set(pair[0], structuredClone(pair[1]));
    }
    return mem;
  }
}
