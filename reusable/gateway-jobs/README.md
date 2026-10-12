# Gateway jobs & memory

In-memory state machine for deduplication, worker leasing, retry/backoff, dead-letter status and expiring per-session memory.

```js
import { JobQueue } from 'metron-reference-gateway-jobs';
const q = new JobQueue();
q.enqueue('task-1', { task: 'example' });
const lease = q.claim('worker-1');
q.complete('task-1', lease.lease, 'done');
```

**Single process only.** State disappears on restart, there is no distributed lock or authentication, and external operations require their own idempotency keys. Stale lease fencing protects only this instance's state. Never claim globally exactly-once execution from this toolkit.

## Crash recovery (Node.js, single writer)

The original example above keeps all state in RAM. The optional checkpoint adapter adds JSON snapshots and process-restart recovery. It is available only in Node.js:

~~~js
import { PersistentGateway } from "metron-reference-gateway-jobs/persistent";
const gateway = new PersistentGateway("./private-state/gateway.json");
gateway.enqueue("task-1", { task: "example" });
const leased = gateway.claim("worker-1");
if (leased) {
  gateway.complete(leased.id, leased.lease, { result: "ok" });
}
~~~

Low-level storage helpers are available at `metron-reference-gateway-jobs/checkpoint`. `JobQueue.snapshot()` and `JobQueue.restore()` retain job statuses and lease versions; `ExpiringMemory.snapshot()` and `.restore()` preserve absolute expiry timestamps. Expired leases are recovered on load. An old worker response cannot complete a newly leased or already expired job.

**Mandatory limits:**

- Run **exactly one writer process per checkpoint file**. The adapter uses no lock or consensus mechanism. Two processes can overwrite each other's changes.
- An atomic rename prevents partially written JSON during ordinary interruptions, but guarantees vary by filesystem, operating system, disk and power failure. There is no synchronous replication, transaction log, or crash consistency for remote side effects.
- Checkpoint each queue transition before initiating an external non-idempotent action. Even with checkpoints, side effects can run twice after timeout; apply a separate idempotency key at the external system.
- The JSON file can contain sensitive job prompts/results. Place it in a private directory, restrict its permissions, and never commit it to Git.
- Corrupt checkpoints produce an error rather than silently resetting the queue. Recovery only concerns the reusable Node.js reference, not the historical GAS Gateway deployment.
