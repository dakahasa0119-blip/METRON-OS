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

## Cross-check declared paths against actual supplied file snapshots

The `snapshot-diff` subpath compares **in-memory complete text-file inventories**
before and after a candidate change. It pins the before inventory to a trusted
SHA-256 inventory digest, checks exact changed-file names against
`proposedPaths`, and computes per-file and candidate-inventory digests:

```js
import {
  snapshotDigest, reviewRepairSnapshots
} from "metron-reference-gateway-jobs/snapshot-diff";

const beforeFiles = { "src/widget.js": "export const n=1;\n" };
const afterFiles = { "src/widget.js": "export const n=2;\n" };
// Capture/pin this expected digest from a *separately trusted* baseline reader.
const expectedBaseDigest = snapshotDigest(beforeFiles);
const review = reviewRepairSnapshots({
  scope: {
    symptom: "counter does not update", expectedFix: "Correct counter value",
    preserveContracts: ["preserve export name"],
    prohibitedChanges: ["no external I/O"],
    protectedPaths: ["src/auth/**"],
    proposedPaths: ["src/widget.js"]
  },
  beforeFiles, afterFiles, expectedBaseDigest
});
console.log(review.status, review.changes);
// "review_required"; review.canApply is ALWAYS false
```

This is a **byte-level file comparison**, not a Git patch parser, full JS AST,
semantic test, deployment or source-of-truth proof. Supplying an incomplete,
malicious or inconsistent pair of snapshots can conceal changes elsewhere.
The host must independently obtain a complete inventory and pin the baseline
digest outside the candidate writer's control. Symlink/hardlink/realpath,
filesystem case sensitivity, executable permissions, binary files, generated
outputs, submodules and dependency behavior are outside this adapter.
Text-file snapshots are capped at 128 files and 1 MiB/file (8 MiB total).
The checker rejects file/directory collisions, case-only aliases, traversal,
empty diffs, unlisted changes and overbroad declared scope. No source contents
appear in the review result; it is never executable authority.

## Read-only trusted worktree inventories and later readback

`worktree-reader` scans a **trusted isolated checkout** from an explicit root,
skipping root `.git` metadata while rejecting symlinks, non-text files,
invalid UTF-8, nested git metadata and oversized source trees. This permits
the **verifier's own process** to enumerate code rather than trusting an
agent-supplied list of changed filenames.

```js
import { readTextWorktree } from "metron-reference-gateway-jobs/worktree-reader";
import { snapshotDigest } from "metron-reference-gateway-jobs/snapshot-diff";
import {
  reviewRepairWorktrees, verifyWorktreeReadback
} from "metron-reference-gateway-jobs/worktree-review";

// baselineRoot and candidateRoot must be two independently authorized,
// isolated, stable directories under the verifier's control.
const expectedBaseDigest = snapshotDigest(readTextWorktree(baselineRoot).files);
// In a real host, pin the digest *before* receiving candidate material.
const review = reviewRepairWorktrees({
  baselineRoot, candidateRoot, expectedBaseDigest, scope
});
if (review.status === "review_required") {
  const readback = verifyWorktreeReadback({
    root: candidateRoot, expectedCandidateDigest: review.candidateDigest
  });
  console.log(readback.status); // matched, still not approval to deploy
}
```

This is a **read-only reference adapter**, not a sandbox, application
installer, lock, signature checker, transaction or release authority.
A malicious/changed directory, hardlinks, race conditions, directory
permissions, ignored root `.git` metadata, repository submodules, non-text
assets and external dependencies can invalidate apparent completeness.
Use immutable disposable clones/containers and a trusted actor to pin the
baseline **outside** the patch writer's control. Comparing two snapshots and
readback digests cannot establish test passing, behavioral correctness,
authorization, secure code or live deployment.

## Repair evidence consistency gate (not a deployment approval)

`assessRepairEvidence` groups file-scope review, independently re-read
candidate digest, compilation/unit/regression/smoke results and rollback
reference into **one digest-bound evidence packet**:

```js
import { assessRepairEvidence } from "metron-reference-gateway-jobs/repair-evidence";
const assessed = assessRepairEvidence({
  review, readback,
  rollbackDigest: review.baseDigest,
  checks: [
    {kind:"compile",status:"passed",candidateDigest:review.candidateDigest,exitCode:0,passed:1,failed:0,runnerLabel:"trusted-ci"},
    {kind:"unit",status:"passed",candidateDigest:review.candidateDigest,exitCode:0,passed:4,failed:0,runnerLabel:"trusted-ci"},
    {kind:"regression",status:"passed",candidateDigest:review.candidateDigest,exitCode:0,passed:4,failed:0,runnerLabel:"trusted-ci"},
    {kind:"smoke",status:"passed",candidateDigest:review.candidateDigest,exitCode:0,passed:1,failed:0,runnerLabel:"trusted-ci"}
  ]
});
console.log(assessed.status); // review_required; NEVER approved
```

The gate rejects missing, duplicate, failed or digest-mismatched evidence;
`canApply=false`, `canDeploy=false` and `approved=false` **always**.
**Critical caveat:** These test receipts are ordinary caller-supplied objects.
The module does **not** validate digital signatures, actually launch tests,
attest runner isolation, determine correctness, prove rollback availability or
grant permission. A malicious patch process could fabricate receipts. Only
a separate trusted host that ran the checks and independently approved the
operation could make such an operational determination.

## Signed check receipts (Ed25519 — signature verification only)

The `signed-receipts` subpath adds a strictly typed versioned receipt format
binding an Ed25519 signature to the runner identity, pinned public-key ID,
target audience, **single-use verifier-generated nonce**, source candidate SHA,
test-suite SHA, individual test category, result counts and a five-minute
maximum validity interval. All four expected categories are required.

```js
import {
  signCheckReceipt, verifyCheckBundle, assessSignedRepairEvidence
} from "metron-reference-gateway-jobs/signed-receipts";
```

A **trusted verifier** must pin each permitted public key and its runner ID
independently of the patch submitter, create the nonce before execution,
provide an immutable test-suite digest, and keep a durable single-use challenge
ledger. Private signing keys must never be committed or passed through build
artifacts. The example tests use ephemeral Ed25519 test keys and a local child
process; no production identity or attested CI provider is implied.

`verifyCheckBundle` verifies all signatures and scopes, then consumes a nonce
in a caller-owned Set only after all four succeed. The caller is responsible
for **persisting the replay ledger durably under a single-writer lock before
accepting the verified bundle**; the Set itself does not survive restart.
`assessSignedRepairEvidence` combines those verified receipts with the
existing source/readback/rollback checks and still returns
`approved:false,canApply:false,canDeploy:false`.

**Security caveat:** A valid signature proves that whoever controlled the
pinned key signed these exact claims. It does **not** prove that code compiled,
that a truly independent trusted runner executed tests, that logs were not
fabricated by a compromised signing host, that a sandbox was isolated, that
replay state was durably recorded, or that deployment is authorized. This
package has no trust-root lifecycle, identity provisioning, revocation,
persistent nonce ledger, trusted CI connector or deployment actions.
