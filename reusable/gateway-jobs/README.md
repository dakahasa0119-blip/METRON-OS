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

For work that lasts longer than its lease, the active worker can periodically
extend its lease using `gateway.renewLease(leased.id, leased.lease)`. This
heartbeat succeeds only while the **same lease remains active and unexpired**;
it extends the expiry by the configured `leaseMs` interval from the current
time, without shortening an existing expiry. A failed heartbeat returns
`false`, and the worker must not assume it still owns the job. Clients are
responsible for sending heartbeats well before expiry; no background timer or
remote heartbeat transport is provided.

Low-level storage helpers are available at `metron-reference-gateway-jobs/checkpoint`. `JobQueue.snapshot()` and `JobQueue.restore()` retain job statuses and lease versions; `ExpiringMemory.snapshot()` and `.restore()` preserve absolute expiry timestamps. Expired leases are recovered on load. An old worker response cannot complete a newly leased or already expired job.

**Mandatory limits:**

- Run **exactly one writer process per checkpoint file**. The adapter uses no lock or consensus mechanism. Two processes can overwrite each other's changes.
- An atomic rename prevents partially written JSON during ordinary interruptions, but guarantees vary by filesystem, operating system, disk and power failure. There is no synchronous replication, transaction log, or crash consistency for remote side effects.
- Checkpoint each queue transition before initiating an external non-idempotent action. Even with checkpoints, side effects can run twice after timeout; apply a separate idempotency key at the external system.
- The JSON file can contain sensitive job prompts/results. Place it in a private directory, restrict its permissions, and never commit it to Git.
- Corrupt checkpoints produce an error rather than silently resetting the queue. Recovery only concerns the reusable Node.js reference, not the historical GAS Gateway deployment.

## Checked chunk handoff (separate reference design)

The archived Gateway had an external BAKU-code manifest/inbox process. The
standalone `chunk-envelope` adapter illustrates how to **reject incomplete
code instead of saving a partial source as a usable artifact**. This is a new
schema, not a compatible deployment migration:

```js
import {
  createChunkedArtifact, verifyChunkedArtifact
} from "metron-reference-gateway-jobs/chunk-envelope";

const transfer = createChunkedArtifact("function demo() { return 1; }", {
  returnId: "demo_01", chunkSizeBytes: 16
});
const verified = verifyChunkedArtifact(transfer.manifest, transfer.chunks);
if (verified.status === "ok") console.log(verified.bytes, verified.sha256);
```

Chunks are canonical Base64-encoded UTF-8 bytes stored in a `Map`. The
manifest declares a fixed schema, exact chunk keys and order, total byte count
and SHA-256 digest. **No artifact text is returned on missing, duplicated,
reordered, malformed, truncated or hash-mismatched data.** Defaults cap data
to 1 MiB and 256 chunks. The caller must separately authenticate the manifest,
authorize the source/recipient, protect stored content, prevent replay and
supply durable transport. SHA-256 alone **does not authenticate a sender**:
a party who replaces both manifest and chunks can generate a new valid digest.
The helper does not save to Google Sheets, update Apps Script or execute code.

## Advisory-only Gateway mediation

The archived mediation flow inspired a pure classification helper:

```js
import { adviseGatewayRoute } from "metron-reference-gateway-jobs/mediation-advice";
const advice = adviseGatewayRoute("このコードを修復して");
console.log(advice.recommended.lane); // BAKU; NOT an authorization to execute
```

It recommends lanes but cannot enqueue, authenticate, approve or execute any
task. Repair/execute suggestions declare `requiresConfirmation: true`;
unclassified chat defaults to analysis-only (safer than the archived default
ARC lane). Intent detection is simple keyword matching and **will misclassify
negation and ambiguous requests**. Explicit user consent and independent
authorization/validation are responsibilities of a separate trusted host.

## Repair intake preflight (advisory, fail-closed)

The archived `gateway_baku_intake_module.gs` required a repair symptom,
expected fix, contracts to preserve, prohibited changes and protected paths.
The new standalone `repair-preflight` also requires explicit proposed paths:

```js
import { preflightRepairRequest } from "metron-reference-gateway-jobs/repair-preflight";
const result = preflightRepairRequest({
  symptom: "UI button fails",
  expectedFix: "Restore button callback",
  preserveContracts: ["keep existing UI state"],
  prohibitedChanges: ["no API calls"],
  protectedPaths: ["src/security/**", "src/core.js"],
  proposedPaths: ["src/ui/button.js"]
});
console.log(result.status); // ready_for_review, NOT authorized to apply
```

Missing or malformed fields, unexpected paths and protected exact/directory
overlap return `blocked`; mentions of auth/cryptography require manual review.
Paths are compared as normalized **declared strings**, not resolved against a
filesystem. Symlinks, generated files, case-sensitive environments, aliases,
transitive imports, actual code diffs, semantic contracts and changing runtime
dependencies require independent checks. `preserveContracts` and
`prohibitedChanges` are checked for presence, **not automatically enforced**.
Never interpret `ready_for_review` as a secure approval or a license to deploy.
The returned `canApply` and `approved` are always `false`.
