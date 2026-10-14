# Reusable toolkit validation — 2026-10-13

## Reproducible commands

```sh
node --test reusable/tests/*.test.mjs
npm pack --dry-run ./reusable/arc-dom
npm pack --dry-run ./reusable/baku-dna
npm pack --dry-run ./reusable/gateway-jobs
npm pack --dry-run ./reusable/mothership
```

Verified locally on Windows with Node.js v24.18.0, npm CLI and installed Google Chrome (new headless mode), using a **separate temporary checkout** rather than changing production sources:

| Evidence | Result | Meaning |
| --- | --- | --- |
| Node tests | **17 passed, 0 failed, 0 skipped** (prior validation round) | Current isolated reference methods behave as the included tests require |
| Chromium DOM picker integration | **Passed** | A real browser selected an element in an open Shadow Root and returned its selector; click interception, Escape and manual lock behaved as expected |
| Historical BAKU extraction fixtures | **Passed** | Extractor recovered ten preselected named fragments from two published legacy BAKU JavaScript files |
| Synthetic BAKU review labels | **Passed** | Eight manually labelled simple examples matched expected pattern flags |
| npm package dry-run | **4 / 4 succeeded** | Packages include entrypoint, `package.json`, `README.md`, `LICENSE` |
| Actual npm tarball installation | **4 / 4 succeeded** | Four `.tgz` packages installed in a separate temporary consumer folder and imported by their package names |
| Android device/E2E | **Not tested** | `adb devices` showed no connected devices; old ARC application's picker routing has not been proven end-to-end |
| Historic BAKU autonomous repair precision | **Not measured** | Script/source examples and synthetic pattern matching do not establish repair success on unseen failures |

## Limitations of the metrics

The ten historical BAKU names were selected from readable, known functions in `modules/gas/BAKU/BAKU_SessionSalvager.js` and `modules/gas/BAKU/DNA_ANALYST.js`. Recovering those names is **coverage on selected expected fragments**. It is not unbiased recall or precision across the full BAKU codebase, nor evidence that the fragments can be run independently.

The eight review examples are synthetic and simple. Regex-based flagging can miss obfuscated/dynamic behavior and can flag innocuous comments or string literals. The extractor is not a parser or a security audit.

The browser test uses a local, synthetic page in a **real desktop Chromium** instance, without authentication, third-party service access or CAPTCHA interaction. It does **not** prove compatibility with current ChatGPT/Gemini/Claude UIs or the old Android WebView app.

The existing Gateway state machine is single-process and in-memory. Its state transitions do not provide distributed exactly-once execution, crash-safe persistence or cryptographic authorization.

## Installation

Each `reusable/<package>/` directory is independently npm-packable and contains the same scoped MIT permission for its files. No npm registry publishing is claimed. Original first-party historical METRON bodies now have separate Apache-2.0 coverage; see the root LICENSING.md. Third-party content retains its upstream license.

## Follow-up experiments, not yet accomplished

1. Connect an authorized Android test device or isolated emulator and measure the original WebView + picker path with screenshots, regression cases and explicit selector-role mapping.
2. Build a labelled set of historical BAKU failures and expected safe outcomes. Evaluate false positives, false negatives, quarantine behavior and rollback **without touching production GAS**.
3. Persist Gateway state in a durable store, then test lease expiry, worker crashes, idempotency and restart recovery across two processes.

## 2026-10-13: robustness regression round

- **23 / 23 tests passed, with 0 failed and 0 skipped** on the GitHub Actions Linux runner, including the real Chromium picker test and all four independent package installation checks. See the pull request and its exact workflow run for reproducibility.
- ARC `findDeep` now evaluates all matches instead of allowing a hidden first match to conceal visible alternatives; Shadow DOM traversal remains supported. The picker now recognizes the relevant ancestor for its `input`, `send`, or `response` role, so a click on a nested icon can choose the containing button. Captured pointer-down and click events are suppressed during picking.
- BAKU's lightweight extractor masks strings and comments before finding named fragments and matching braces. The simple review-pattern detector also ignores comments and quoted literal text. Regression tests cover phantom declarations, quoted braces, real code calls, truncated fragments and existing historical-source expectations.
- **Limits:** This is still a best-effort scanner, not a complete JS parser. Regex literals, complex template interpolation, unusual syntax and dynamic behavior can defeat parsing or review flags. There is no measured precision for autonomous code repair. No Android device-level test was run in this round. A registry package publication is not claimed.

## 2026-10-13: restart-recovery and local continuity reference

Gateway's **new Node.js reference implementation** gained versioned `JobQueue` and `ExpiringMemory` snapshots, an atomic JSON checkpoint adapter and a `PersistentGateway` wrapper that persists each state transition. Test coverage includes an actual **fresh Node.js process** loading the state after an expired worker lease, refusing stale results, re-leasing the recovered job, and preserving unexpired memory. Corrupt checkpoint content fails closed instead of resetting job state.

This is deliberately a **single-writer** implementation. There is no distributed lock, durable database transaction, remote-worker exactly-once execution, automatic external side-effect deduplication, or hardened encryption. Crash/power-loss guarantees depend on the underlying filesystem; JSON checkpoints must not contain secrets unless the storage environment is secured.

The new [local continuity demo](examples/local-continuity-demo.mjs) runs a synthetic fixture through all four portable reference modules (ARC selector memory, BAKU extraction, MotherShip patch-state workflow, Gateway lease and persisted memory), including restart recovery. It uses only hard-coded fixture code in the local Node.js `vm` smoke test. Node.js `vm` is not a security sandbox, and the demo must never execute untrusted source.

```sh
node reusable/examples/local-continuity-demo.mjs
node --test reusable/tests/*.test.mjs
```

**Scope of proof:** successful portable reference workflows only. No historical Apps Script deployment, live external AI session, Android device, multi-PC federation, or P2P village consensus was exercised. The old METRON suite still has no independently verified complete four-system E2E run.

## 2026-10-14: BAKU evidence classifier and Windows follow-up

- Re-read both BAKU repair evidence and metrics sheets **read-only** and counted **2,908 populated records in each**, **487 unique queue IDs**, and **5 unique card IDs**. Deduplicated last-metric states are 482 exhausted, 2 repaired, 2 clean/no-change and 1 unresolved. See [audit report](../docs/BAKU_REPAIR_EVIDENCE_AUDIT_2026-10-14.md).
- Added a dependency-free `auditRepairOutcomes` module and three additional synthetic tests: repeated attempts do not inflate successes, optimistic status without supporting evidence is rejected, and missing queue identity fails closed.
- Windows real Chromium + all Node tests: **36 passed, 0 failed, 0 skipped** (Node.js v24.18.0).
- `npm.cmd pack --dry-run ./reusable/baku-dna` succeeded, including the newly exported `repair-audit.mjs` file. Windows PowerShell execution policy was **not** relaxed; `npm.cmd` was used instead of the blocked `npm.ps1` shim.
- These outcomes are **not** a BAKU unknown-fault repair benchmark. Neither the classifier nor these tests deploys code or verifies historic GAS/Android behavior.

## 2026-10-14: archived Gateway feature extraction (independent)

- Inspected the six preserved `gateway_*_module.gs` source files from a
  read-only, verified 2026-09-28 local snapshot. The latest cloud source
  was **not** uploaded to GitHub verbatim. See the
  [source-gap inventory](../docs/GATEWAY_CLOUD_SOURCE_GAP_2026-10-14.md).
- Added standalone checked BAKU/Gateway code artifact envelopes and
  advisory-only routing, **not** original GAS migration.
- Windows Node v24.18.0 with local real Chromium:
  **47 tests passed, 0 failed, 0 skipped** (eleven new tests).
- Two additional Unicode tests reject malformed UTF-8 and lone surrogates rather than silently replacing text.
- Gateway package v0.3.0 dry-runs successfully with both new module subpaths included.
- Safety limits: an artifact checksum is *not* a signature or capability
  token, and classification is heuristic. No live Drive or AI provider was
  contacted; no historical METRON integration or autonomous repair claim.

## 2026-10-14: Gateway repair-intake preflight

- Added `preflightRepairRequest` as a **separate, pure reference adapter** based on the constraint-presence and critical-scope ideas in archived `gateway_baku_intake_module.gs`.
- Six synthetic regression cases cover required fields, exact and directory protections, traversal/absolute paths, critical-topic review and ignored fake approval flags.
- Windows 11, Node.js v24.18.0, real Chromium: **53 tests passed, 0 failed, 0 skipped** (six new tests).
- Gateway v0.4.0 package dry-run succeeded with its dedicated `repair-preflight.mjs` subpath included.
- Only declared paths are inspected; there is **no real diff matching, filesystem path resolution, source execution or permission grant**. `ready_for_review` cannot approve a patch or authorize operations.

## 2026-10-14: actual supplied snapshot / declared scope comparison

- New deterministic `snapshotDigest` and `reviewRepairSnapshots` require
  caller-supplied before/after inventories and an independently pinned
  baseline digest. Validate the exact set of changed paths including adds and
  deletes and exclude protected scope.
- Eight synthetic tests cover unexpected changes, protected overlap, empty
  diffs, stale baseline, alias/path attacks, oversized or malformed inventories,
  security-topic review and no source-content output.
- **Windows real-Chromium Node suite: 61/61 pass, 0 fail, 0 skip**.
- The verifier does **not** independently read the on-disk filesystem. If the
  supplying process is malicious or omits files, comparison cannot detect it;
  a trusted host must obtain snapshots and validate readback separately.

## 2026-10-14: isolated real worktree readback reference

- Added a bounded, read-only `readTextWorktree` filesystem reader.
  It skips root Git metadata and rejects symlinks, malformed UTF-8,
  binary inputs, special nodes and files exceeding its byte/file ceilings.
- Added `reviewRepairWorktrees` for independently enumerating isolated
  baseline/candidate text files and matching pinned base + changed scope;
  `verifyWorktreeReadback` independently re-reads a later on-disk inventory.
- **Windows Node.js + real Chromium: 70/70 tests passed, no failures/skips**.
  Nine additional tests use real temporary directories, not production files.
- These tests do **not** prove atomic filesystem snapshots, race-free operation,
  correct permissions, safe code execution, successful repair, or actual GAS
  deployment. The host must control the root and prove it represents the
  complete intended source inventory.

## 2026-10-14: digest-bound evidence consistency gate

- Added `assessRepairEvidence`, correlating a reviewed candidate and later
  readback digest, pinned rollback digest and four separately named check
  receipts (compile, unit, regression, smoke).
- Eight synthetic tests reject missing/failed/duplicate/stale receipts and
  fake approval flags. **Windows/Chromium Node suite: 77/77 pass**, no
  failures or skipped cases.
- Receipts here are **self-reported JSON inputs**, not signed independent
  test attestations. The gate NEVER approves or applies a candidate. The
  trusted caller must independently run tests, verify receipt authenticity,
  confirm rollback materials and obtain explicit deployment authorization.

## 2026-10-14: two distinct synthetic MotherShip mailboxes

- New pure `newMailbox`/`receiveMailboxMessage` functions reject conflicting
  message-ID replays and invalid recipients while deduplicating exact replays.
- The offline `two-mothership-relay.mjs` demo stores MotherShip A, MotherShip B
  and Gateway in **three distinct JSON files**. A message from A to B is
  persisted; Gateway then simulates a crash before ACK, recovers the expired
  lease and redelivers the same message. B records it only once. B sends a new
  ACK back to A, and a stale Gateway ACK is rejected.
- **Windows Node.js v24.18.0 + Chromium: 84/84 tests passing, 0 skipped**.
  Seven new tests include a standalone two-file process run.
- These are **not Google spreadsheet files** and prove no historical
  cross-spreadsheet communication, P2P AI cognition, real worker identity,
  atomic external effects or old GAS integration.

## 2026-10-14: Ed25519-signed, nonce-bound check receipt prototype

- New `signed-receipts` module checks four distinct categories against a pinned
  candidate SHA-256, suite SHA-256, audience, runner ID, key ID, short validity
  window and single-use verifier nonce. Signatures are **Ed25519**.
- Nine additional tests cover isolated child-process signatures, tampering,
  wrong keys, binding mismatches, duplicate receipt kinds, expiration,
  replay and invalid optimistic claims.
- **Scope:** cryptographic verification of signed metadata only, NOT
  independently authenticated real CI runners, semantically validated test
  results, durable challenge storage, trusted key issuance or patch approval.

## 2026-10-14: persisted single-writer signed receipt replay state

- Added `PersistentReceiptVerifier` to atomically checkpoint a consumed
  challenge **before** reporting its signed receipts as verified.
- Restart, corrupt checkpoint, signature rejection and write-failure cases
  are exercised by five additional tests using disposable local files.
- Scope remains single-writer local state; no process synchronization,
  cloud-wide replay consensus or trusted real CI result execution is claimed.

## 2026-10-14: BAKU held-out benchmark accounting

- Added an independent incident evaluator with frozen label-set SHA,
  family-level train/holdout exclusion, six-field result evidence and
  separate categories for verified-local-fix, missed repair, correctly rejected,
  unsafe proposal, failed candidate and inconclusive.
- Eight synthetic tests confirm duplicate-incident refusal, family leakage
  detection, unchanged label sets across alternate candidate outcomes,
  development/holdout isolation and conservative treatment of unknown checks.
- **Not** historical BAKU repair precision: only scored test fixtures, not a
  blinded real incident corpus. The required independent labelling and actual
  candidate functional tests remain issue #100.

## 2026-10-14: actual METRON Mini OS loopback runtime

- New [METRON Mini OS](../mini/README.md) Node.js HTTP server, browser UI and
  integrated local MotherShip A/B, Gateway, BAKU and ARC workflows.
- Verified actual HTTP `POST /api/mission`, two independent JSON MotherShip
  files, Gateway ACK and worker queue persistence, static BAKU code-card
  detection without source storage, ARC same-page DOM discovery, reverse
  direction and crash-after-delivery deduplication.
- Eight new tests cover the runtime, restart, idempotency and conflict
  rejection, invalid routes, host/Origin protections, static source limits,
  real desktop Chromium UI initialization and reverse ACK routing.
- This is a **working local reference app** only. It is not a live integration
  with the four historic deployments, real external AI authentication,
  autonomous code repair or an Android device.

## 2026-10-14: guided METRON civilization experience

- New `mini/civilization.mjs` and browser `/experience` guide:
  independent village knowledge, actual Gateway transport/ACK, explicit
  knowledge adoption or quarantine, parent-linked rule-based knowledge
  inheritance, BAKU synthetic salvage and isolated crash/replay demonstration.
- Real persisted Village Square ledger survives Mini process recreation.
  Decisions are checkpointed before in-memory acceptance to fail closed on
  storage errors.
- Tests use actual temporary local storage, HTTP API, deliberate adversarial
  input, and a real Chromium render of the guided page.
- The experience is educational and deterministic; **no claim of autonomous
  AI reasoners, external LLM calls, genuine P2P multi-host villages, live
  unknown-code repair, or historical system restoration**.
