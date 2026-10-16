# Registered-project UI with the official Codex CLI — 2026-10-15

Two approved synthetic repair cases completed the real UI → official Codex
candidate → independent review → public and sealed checks → disposable apply →
post-apply checks → persisted readback path. Windows regression passed **364/364**
with zero failures, cancellations, skips or todos (1,153,742 ms; actual exit 0).
This is evidence for this registered-project path, not completion of METRON.

## Frozen source and changes

The tested product/test source is `8bc683ba32bfe24e9ba5178f0d90a01e3bc9fab4`.
All 103 frozen Mini/assets/test files were checked byte-for-byte after regression
and the two cases. Later commits for this report change documentation only.
The manifest hashes the actual tested Windows working bytes. Some working files
use CRLF while Git stores LF; raw checkout hashes and raw Git blob hashes are
distinct evidence. The project's existing checkout contract accepts an exact
Git blob or a NUL-free UTF-8 file whose CRLF-to-LF conversion matches that blob.
No checkout files or Git settings were rewritten to make verification pass.

- `717f447d642a49729355cfef09e149df1df253e4`: select prepared targets by human
  name; show allowed edits, check boundaries, disposable apply destination and
  exact send scope; require fresh scope acknowledgment; provide a readable guide.
- `f07c36a0f2534e7178520480cd5f93cbb008007b`: reconnect an owner startup link in
  the same document, including before UI factory initialization. Strip the key
  fragment immediately; keep the key in page memory. Busy work does not change
  authority or queue a deferred reconnect. Strict CSP remains unchanged.
- `8bc683ba32bfe24e9ba5178f0d90a01e3bc9fab4`: give the bounded ARC drain test a
  fixed logical clock. Its count, durable pending, replay and single-delivery
  assertions remain intact; production behavior and separate expiry tests are
  unchanged.

Owner provisioning of the registry, Git worktrees, allowed paths and sealed
tests remains manual. Everyday users can review prepared target/scope cards
without entering a filesystem path, internal ID or JSON. This does not claim a
self-service project registration or village creation interface.

## Actual case results

| Case | Reproduced baseline | Public after repair | Host sealed | Post-apply |
| --- | --- | --- | --- | --- |
| `prefix-gateway-v2` | 5 pass / 3 fail | 8/8 | 4/4 | 2/2 |
| `delivery-envelope-v2` | 5 pass / 4 fail | 9/9 | 5/5 | 2/2 |

All post-repair checks had zero skipped, cancelled or todo tests. Each case made
one explicitly confirmed official CLI model-process launch, with observed
process close and exit 0, one completed turn, and a complete durable adapter
receipt. There was no automatic retry or candidate-generating injected worker.
These are observed local process/events, not cryptographic model authentication
or a count of provider-internal RPCs.

Both cases reuse previously approved v2 synthetic shapes and public baseline
bytes. No correct repair patch was supplied. They are **not newly selected
unseen tasks**, and success is not evidence of general repair capability.

| Case | Applied candidate | SHA-256 of reviewed diff |
| --- | --- | --- |
| Prefix | `7ce1ab63df46ecee7b7b08aafb6659e565acc3d5` | `748774c370852df13bd9437f6fe4ae1686eeb30d1650792e4bd66e676eedf106` |
| Delivery | `cc16e5f28de034e980948235000bb7c007fe7779` | `fda06aaab1a55da1a0d7134233789f07a8af3388ee1825d2163ee60abcedaf51` |

The independent reviewer read the actual diff and public requirements/source
before sealed validation. Prefix changes two allowed source files to preserve
explicit HEAD precedence, use GET fallback when no HEAD route matches, and keep
HEAD misses bodyless. Delivery changes one allowed source file to fold ASCII
space/tab continuations into the immediately preceding occurrence and reject
orphans while preserving occurrence order and body framing. No test, dependency
or configuration file in either repair target was modified.

## UI, persistence and restart evidence

An owned isolated Chromium profile used actual DOM controls and served product
JS/CSS. The harness injected an HTML driver and translated a test loopback
origin; it did not inject an operator header or a candidate worker. This is not
the user's normally signed-in browser and is not ChatGPT ARC.

The UI created each work item from a harmless saved synthetic message, reviewed
its target/send scope, explicitly dispatched the worker, and stopped at the
independent review boundary. Validation and apply each ran in a fresh
Node/server/browser invocation. Across two cases this was six separate stage
invocations, with all six actual exits observed as 0. Five harness PIDs were
captured; the Prefix validation PID was missed before its owned lock vanished.
That telemetry limitation did not trigger a repeated repair or model call.

On every restart, startup/GET receipt counts and hashes were unchanged before
the next explicit action. After apply, a separate read-only load recovered both
verified sessions and exact applied HEADs. The persisted ledger and CLI receipt
hashes were unchanged by that load; it started no server, browser or model.
This proves these Mini process restart/readback steps, not a PC or Codex app
restart, cross-device deployment or production continuity.

The final read-only onboarding observation passed 17 checks, covering empty and
catalog-configured screens, human target/scope cards, owner-link reconnect,
fragment removal, collapsed audit data, guide layout and strict CSP. It made
GETs only and zero mutations/model launches. Earlier injected-worker UI tests
and earlier real-CLI revision/sharing trials remain separate evidence. This
phase did not repeat real-AI Rumor publication/adoption.

## Scope and retained anomalies

The actual prompt scope was the approved synthetic goal/message/code/symptom/
evidence/public failure, with zero selected knowledge. Host-sealed test contents
were absent. Recorded commands show no private conversation, credential,
sealed-test, other-case or earlier correct-patch reads, installation or
publication. Both CLI runs also explicitly read normal coordinate-subagent
operating skill/reference documents outside the project. Therefore this report
does not claim all reads were project-local; normal CLI configuration was kept.
The `local_thread_store_compression` startup feature warning is retained and
was not a permission denial. Expected failing public tests are distinguished
from tool/permission failures.

An earlier regression was intentionally interrupted for the owner-link fix.
It also recorded the bounded ARC test receiving 97 of 100 messages. That failure
is retained. Three retained natural-clock reproductions later passed 100/100,
and the fixed-clock focused file passed 5/5. The original 97 cause is
**unconfirmed**; the test change does not establish a production fix or prove
that time caused it. The final frozen full run passed 364/364.

Earlier browser-observer startup/readiness failures and interim captures are
retained alongside the final observation. An auxiliary stage-PID helper was
once invoked with a nonnumeric placeholder and exited before any operation;
the real Delivery validation PID was then captured without rerunning the stage.

The first aggregate verifier exited 1 and its failed proof is retained. It
incorrectly required raw checkout/Git blob equality instead of reproducing the
existing CRLF-aware project contract, and treated the focused Node specs
reporter log as TAP. The full regression log is actual TAP; the focused log is
specs output despite its historical `.tap` filename. A separate corrected
verifier preserves both byte/hash forms, uses explicit reporter parsers and
links the first failed aggregate. Product/test bytes and stage execution
receipts remain unchanged; aggregate implementation errors do not justify
rerunning models or rewriting earlier evidence.

The second aggregate verified the 103-file freeze, full regression and retained
history, but still incorrectly required the worker and apply checkout's **raw**
source proofs to be equal. These are separate Windows checkouts of the same
candidate and can have different CRLF bytes. Read-only recomputation confirmed
each checkout's raw proof matches its own durable receipt, every file matches
the same Git object under the existing strict CRLF rule, and both Git trees are
identical. V2's failed output is retained rather than promoted to success. No
third aggregate verifier was created. The operational case results above rest
on the individual stage/exit/check/readback records and this explicit
cross-check; a completely passing aggregate report remains unavailable.

The earlier local-fetch MSYS `NtCreateDirectoryObject` access-denied incident
remains separately documented. Read-only investigation did not establish
source-file ACL denial, an intentional restriction, or a general runtime bug.
Alternative methods are not inherently wrong; a proven restriction bypass is
not claimed. The auxiliary publication copy was not used or accessed in this
phase. There was no push, PR creation, merge, app restart or scheduling-project
change.

## Original goals and remaining connections

The original goals include **self-repair, self-replication and autonomous
evolution**. Memory persistence is one prerequisite, not their complete meaning.
See the [completion criteria](METRON_MINI_COMPLETION_CRITERIA_2026-10-14.md) and
[agentic repair contract](BAKU_AGENTIC_REPAIR_CONTRACT_2026-10-14.md).

| Axis | Verified or implemented foundation | Important unconnected step |
| --- | --- | --- |
| Self-repair | Real AI source investigation/editing, independent checks and bounded disposable apply in the two cases | An independently chosen actual METRON fault through repair, recovery and regression, including legitimate required build/test work and refusal cases |
| Self-replication | Two persisted local villages, explicit Rumor adoption and downstream work context; repeatable local startup | Owner-authorized creation/import of a fresh village with declared roots, identity, configuration and inheritance, followed by reproducible independent startup |
| Autonomous evolution | Experience/work records and candidate/check/apply/rollback foundations; human gates in the real-AI repair path | A connected experience → proposed change → independent real evaluation → adopt or restore → next experience cycle under explicit policy, with rejected/failed candidates preserved |

The preserved original code makes these intentions concrete: AI repair and
source replacement in [METRON_EVO](../modules/gas/BAKU/METRON_EVO.js#L121),
reuse into new project clones in [the agent handover](../handover_to_ai_agents.md#L48),
deployment/context handover packages in [Satellite_Link](../modules/gas/METRON_OS_B/Satellite_Link.js#L9),
and patrol, candidate selection and installation in
[METRON_AUTO_EVO](../modules/gas/BAKU/METRON_AUTO_EVO.js#L15), with generation
history in [METRON_GENERATIONS](../modules/gas/BAKU/METRON_GENERATIONS.js#L35).
Their source paths are design/implementation evidence; HTTP success, a saved
generation or a deployment document does not prove functional repair or a
new village's complete startup. The audit used preserved local sources, not a
new fetch or an exhaustive reading of every historical archive/remote Gist.

Both current real-AI cases passed independent verification on their first
candidate, and both prompts selected zero knowledge. They do not yet show an
actual public verification failure causing a better next real-AI candidate,
or adopted repair knowledge improving a later real-AI task. Human adoption
gates are compatible with the intended cycle; the missing evidence concerns
the connected causal cycle and continuing evaluation, not simply removing
approval.

These gaps do not authorize new deployment, other-device access, privilege
expansion or another external model call. The next useful work is to connect a
bounded, authorized actual METRON incident to the existing repair/evaluation
loop and define the owner-controlled new-village lifecycle. Normally signed-in
ChatGPT ARC, another real coding provider, repair/PoUC ledger coupling, whole-PC
restart, Linux verification of this source and production operation remain
unverified in this phase.

## Local evidence index

Private execution material remains outside Git under the local phase directory
`metron-evidence/ui-real-codex-20261015/`. Do not publish raw owner capabilities,
private registry/session data or CLI event payloads. The important artifacts are:

- `final-ui-real-proof-v2-summary.json`: retained second partial/failed aggregate;
  it must not be reported as a passing final aggregate.
- `final-ui-real-proof-summary.json` and `finalizer-console.log`: retained first
  failed aggregate, with its original verifier unchanged.
- `cross-checkout-source-proof-analysis.json`: each actual worker/apply raw
  proof versus its own receipt, with common candidate Git trees.
- `full-regression-exit.json` and `full-regression.tap`: actual exit, metrics,
  source manifest and log digest (`d5ec77c71e1d8bfc1b163431d9b95277480bc8e2c1310fbe719c5c506c219fb4`).
- `run-20261015/cases/<case>/candidate|validate|apply/receipt.json`, independent
  reviews, `session-readback.sanitized.json` and readback receipts: exact source,
  candidate/diff/verification/apply and ledger/CLI continuity bindings.
- `stage-execution-exits.json`, `stage-process-observations.json`,
  `prefix-command-audit.json`, `delivery-command-audit.json`,
  `root-telemetry-note.json`.
- `onboarding-observation/observation-index.json`: before, interim and final
  DOM/PNG/network/served-asset records.
- `interrupted-regression.json`, `arc-drain-regression-analysis.json`,
  `arc-drain-fixed-clock-focused.json`, `msys-readonly-analysis.json`.
- `three-axes-self-repair.json`, `three-axes-self-replication.json`,
  `three-axes-autonomous-evolution.json`: source-backed original-design audits;
  their in-progress evidence cutoffs are supplemented by this final case table.

Later registered-project PoUC wiring is documented separately in the
[PoUC work flow](METRON_MINI_POUC_WORK_FLOW_2026-10-15.md). The real Codex cases
above do not establish execution of that later path or its Linux behavior.
