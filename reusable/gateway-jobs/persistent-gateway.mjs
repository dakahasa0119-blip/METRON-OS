/**
 * Persistent single-writer Gateway reference.
 *
 * Persists each queue/memory transition through an atomic JSON checkpoint.
 * No remote transport, inter-process locking, encryption or distributed
 * exactly-once execution. Run only ONE process per checkpoint file.
 */
import { JobQueue, ExpiringMemory } from "./job-state.mjs";
import { readCheckpoint, writeAtomicJson } from "./checkpoint.mjs";

export class PersistentGateway {
  constructor(file, { now = () => Date.now(), queueOptions = {}, memoryOptions = {} } = {}) {
    if (typeof file !== "string" || !file) throw new Error("checkpoint file required");
    this.file = file;
    this.now = now;
    const saved = readCheckpoint(file);
    if (saved) {
      if (saved.schemaVersion !== 1 || !saved.queue || !saved.memory) {
        throw new Error("invalid persistent Gateway checkpoint");
      }
      this.queue = JobQueue.restore(saved.queue, { now });
      this.memory = ExpiringMemory.restore(saved.memory, { now });
    } else {
      this.queue = new JobQueue({ ...queueOptions, now });
      this.memory = new ExpiringMemory({ ...memoryOptions, now });
    }
    this.#persist(); // record restoration and reclaimed expired leases
  }

  #persist() {
    writeAtomicJson(this.file, {
      schemaVersion: 1,
      queue: this.queue.snapshot(),
      memory: this.memory.snapshot()
    });
  }

  #modify(action) {
    const oldQueue = this.queue.snapshot();
    const oldMemory = this.memory.snapshot();
    try {
      const value = action();
      this.#persist();
      return value;
    } catch (error) {
      this.queue = JobQueue.restore(oldQueue, { now: this.now });
      this.memory = ExpiringMemory.restore(oldMemory, { now: this.now });
      throw error;
    }
  }

  enqueue(id, payload = {}) { return this.#modify(() => this.queue.enqueue(id, payload)); }
  claim(worker) { return this.#modify(() => this.queue.claim(worker)); }
  renewLease(id, lease) { return this.#modify(() => this.queue.renewLease(id, lease)); }
  complete(id, lease, result) { return this.#modify(() => this.queue.complete(id, lease, result)); }
  fail(id, lease, error) { return this.#modify(() => this.queue.fail(id, lease, error)); }
  recoverExpired() { return this.#modify(() => this.queue.recoverExpired()); }
  getJob(id) { return this.queue.get(id); }
  putMemory(worker, session, name, value, ttlMs) {
    return this.#modify(() => this.memory.put(worker, session, name, value, ttlMs));
  }
  getMemory(worker, session, name) { return this.memory.get(worker, session, name); }
}
