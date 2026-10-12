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
