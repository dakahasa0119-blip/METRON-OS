# METRON Mini: a human-reviewed repair worker handoff

This path hands one saved village work item to an already approved coding worker.
It preserves the existing village/work/run, delivered Gateway source, selected
adopted knowledge and history. It does not start Codex CLI, authenticate a model,
install tools or automatically apply a repair to the original checkout.

## Handoff and independent verification

Explicit export records worker consent, the symptom, reproduction and evidence,
the full base commit, permitted files and operations, and a fixed validation plan.
A request digest binds these values. Worker consent does not authorize a new
external AI call or billing.

The worker returns a committed local candidate and a report of actual operations
and remaining issues. Import stores `candidate_unverified`, with no result or
sharing draft. Report strings are claims, not validation evidence. Unknown
commands, success claims, path overrides and approval overrides are refused.
Reimporting the same report is idempotent. Import never executes a patch or checks
out a report's commit.

A separate trusted local verifier reviews the actual files and commit diff, then
explicitly supplies that diff's SHA-256 and permits the fixed checks. METRON checks
full commit identities, ancestry, allowed regular-file changes, the pinned
reproducer, clean worktrees and actual tracked bytes. It runs the original
reproduction on the baseline, then the target and full regression on the candidate.
Real exit status, test summaries, bounded logs and pre/post input digests are
recorded. Worker JSON cannot replace these steps.

Only these checks produce a verified candidate and a nine-field Rumor draft marked
`human_review_required`. Production changes and approval remain false. The draft
is not published to Village Square or adopted by another village.

## Operator CLI

All ledger mutations use the existing loopback server. The CLI is an HTTP client,
not a second offline ledger writer. Use one server per data root. The server's
trusted local plan configuration fixes roots and commands; request JSON cannot
choose them.

The first supported plan is the ARC consecutive-send regression. Its public base
is `d25d351504b07753cc923e998ae9967034bb8616`. Prepare an approved baseline commit
whose direct parent is that base and whose only change is the fixed regression in
`reusable/tests/mini-arc-extension-behavior.test.mjs`. Prepare a descendant candidate
that keeps that reproducer unchanged and modifies only
`mini/arc-browser/content.js`. Keep both worktrees clean and frozen during review
and validation. The application does not create or switch these worktrees.

```text
node mini/worker-cli.mjs serve --data-root "<isolated-data>" --repository-root "<approved-repository>" --baseline-root "<baseline-worktree>" --candidate-root "<candidate-worktree>" --reproduction-commit <test-only-commit> --artifacts-root "<owned-logs>" --temp-root "<owned-temp>" --port 8766
```

Create a normal work item in that server's village with the existing UI/API. Export
input JSON contains `symptom`, `reproduction` and `evidence` (short references).

```text
node mini/worker-cli.mjs export --url http://127.0.0.1:8766 --village-id village-1 --work-id <existing-work> --input "<input.json>" --output "<request.json>" --confirm

node mini/worker-cli.mjs import --url http://127.0.0.1:8766 --village-id village-1 --work-id <existing-work> --input "<worker-report.json>"

node mini/worker-cli.mjs review --url http://127.0.0.1:8766 --village-id village-1 --work-id <existing-work> --output "<review.json>"

node mini/worker-cli.mjs verify --url http://127.0.0.1:8766 --village-id village-1 --work-id <existing-work> --reviewed-diff <reviewed-diff-sha256> --verifier "<local-verifier-label>" --confirm
```

Output files are created exclusively. Destinations are loopback only; redirects
are refused. Input and response sizes are bounded.

The worker report has exactly these fields: `schemaVersion` (1), `requestId`,
`requestDigest`, `villageId`, `workId`, `runId`, `baseCommit`, `candidateCommit`,
`changedPaths`, `worker`, `summary`, `operations` (strings) and `unresolved`
(strings). Copy identity fields from the exported `request`. Worker/verifier labels
are audit metadata, not authenticated identities; an operator must establish the
actual separation of roles.

## Restart, failure and evidence boundaries

Restart/read does not launch a worker or validator. A saved active verification
becomes interrupted and unfinished. Validation is quarantined because the old
process's termination was not observed. There is no automatic or CLI quarantine
override; an operator must investigate before recovery work.

Wrong village, base or request, a changed reproducer, changes outside the allowed
files, dirty/mismatching bytes, missing evidence and failed tests cannot promote a
candidate. Saved verified results bind the request, report, plan, commits, diff
and test evidence.

Fixed Node checks use a minimal runtime environment without provider keys or Node
preload variables, a 180-second deadline, a 2 MiB output limit and a bounded direct
process termination wait. Forced-stop uncertainty blocks further validation.
Direct-child close does not prove every descendant stopped; successful tests rely
on their existing cleanup. This is a frozen, approved public development checkout
on a trusted local host, not a sandbox for malicious JavaScript, Git configuration
or concurrent hostile writers.

The ARC regression uses a VM DOM/chrome fixture. Protocol tests use explicitly
labelled fixtures and real Node test processes. They do not prove signed-in
ChatGPT browser E2E, external AI reasoning, operating-system reboot continuity or
general autonomous repair of unknown projects. Runtime ledgers, request/report IDs,
raw logs and machine diagnostics are local evidence, separate from this public
guide; review and redact them before sharing.
