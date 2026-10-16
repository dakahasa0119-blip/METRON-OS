# METRON — AI Continuity, Recovery and External-Interface Experiments

日本語 / English

**METRON is an experimental architecture and a collection of historical prototypes**, exploring continuity of AI workflows, persistent memory, external AI interaction, repair, and eventually decentralized AI communities. It is **not** a verified, fully autonomous or fully distributed AI civilization.

The historical Android, Apps Script and Gateway sources remain available in this repository.

**Historical source publication is partial, not a complete all-version release.** See the [per-body coverage audit](docs/SOURCE_RELEASE_COVERAGE_2026-10-14.md). The previously omitted six Gateway cloud modules are preserved in [their separate 2026-09-28 archive](archive/gas/METRON_GATEWAY/cloud-only-2026-09-28/README.md); A-side MotherShip source and consistent cloud revisions still need independent verification. A small, dependency-free, **reusable toolkit** is maintained separately under [`reusable/`](reusable/README.md).

## Why this exists / 目的

METRON investigates how independent AI-enabled systems can preserve goals, context and work when providers, sessions, interfaces or machines change. The broader concept includes independent villages, communication and knowledge exchange between them, shared computing, and salvage of damaged systems.

- **MotherShip (METRON OS):** user-specific context, evolving application and workflow control.
- **Gateway:** dispatch, leases, status tracking, persistent and short-lived memory.
- **ARC / PROXY-HAND:** external AI interface through Android WebView; adaptive DOM inspection.
- **BAKU:** extraction and reuse of code fragments; recovery candidates, canary and quarantine.

These components evolved separately. **Their full end-to-end integration is not verified.** In particular, the observed MotherShip-A/B `Dispatcher` is a same-spreadsheet, tab-based prototype; it does not itself prove direct cross-spreadsheet or P2P messaging. Separate spreadsheet artifacts exist and their complete direct-communication path requires further verification.

## Use registered projects from the Mini work screen

The existing `/experience` work screen can select an owner-configured registered
project, reproduce its public failure, explicitly request one Codex candidate,
show progress and failures, review the actual diff, run independent checks and
apply only to the registered disposable checkout. It reuses the existing work
and reviewed Rumor publication/adoption path. Reading or restarting never calls
a model; each worker attempt requires fresh confirmation.

Start with `METRON_PROJECT_REGISTRY` pointing at the owner's local registration
JSON and optionally `METRON_CODEX_EXECUTABLE` pointing at the installed official
CLI. Open the private owner URL printed by `node mini/start.mjs`. Its operation
key stays in page memory. The owner still selects the source, pinned base,
allowlist and independent sealed tests. An optional host-authored
`METRON_PROJECT_SETUP_MANIFEST` lets the screen create the three local worktrees
after explicit review; arbitrary filesystem registration is not exposed over
HTTP. See the [local setup and user flow](docs/METRON_MINI_PROJECT_USER_FLOW_2026-10-15.md),
also served at `/project-guide-source`.

Prepared targets are selected by name. The main screen shows editable files,
check boundaries and the disposable apply scope before an explicit scope
acknowledgment; internal IDs and JSON stay in expandable audit details.
The readable `/project-guide` separates everyday use from the owner's initial
setup instructions at `/project-guide-source`.

The earlier [UI and official Codex verification](docs/METRON_MINI_UI_REAL_CODEX_2026-10-15.md)
completed two approved, reused synthetic cases through candidate generation,
independent checks, disposable application and persisted readback. Windows
regression passed 364/364. It used isolated Chromium and the installed official
Codex CLI; the earlier injected-worker UI trial and CLI revision trials remain
separate evidence. Normally signed-in ChatGPT ARC, another real coding provider,
and METRON's complete self-repair, replication and autonomous evolution remain
unverified.

The local implementation also adds explicit creation of a separate
single-village A/B + Gateway runtime, with selected text/provenance inheritance
and a transient owned child process. Actual isolated-browser delivery and clean
restart through three separate parent Node processes are verified. Windows
regression passed 402/402 after the process-exit accounting fix. An additional
unchanged Delivery-v2 trial used the actual preparation UI and one official
Codex process, passed independent public/sealed and post-apply checks, and
freshly read back the clean disposable apply root with zero POSTs. Its first
candidate passed, so a natural failed-candidate retry remains unobserved.
Subsequent local changes connect owned new villages to the existing work,
registered-project repair and Rumor flows. Selected inheritance remains reference
data; each external attempt and recipient adoption requires a fresh explicit
decision. See the [dynamic village workflow and its validation scope](docs/METRON_MINI_DYNAMIC_VILLAGE_FLOW_2026-10-15.md)
and the
[same-PC village and project preparation guide](docs/METRON_MINI_LOCAL_VILLAGE_SETUP_2026-10-15.md)
for the exact scope, test results and remaining steps.

Verified registered-project candidates also have an explicit local PoUC action:
redo the fixed checks, compare their inputs and outcomes, and save a deduplicated
receipt bound to the work and verification. It makes no additional model call.
See the [PoUC work flow and limits](docs/METRON_MINI_POUC_WORK_FLOW_2026-10-15.md).

## BAKU now has an optional real LLM-driven multi-file repair worker

METRON Mini includes a guarded **agentic BAKU workflow**:
a real local Ollama model or authenticated OpenAI API can inspect multiple
source files and actual failing test output, suggest file changes, receive
real feedback from separate Node test execution and iterate. A hidden
acceptance suite is used only after public tests pass. All changes remain
inside a disposable first-party project; incident attempts are checkpointed
for explicit restart.

**This path cannot run autonomously on the observed PC without installing/
authenticating a real coding model.** Tests inject a labelled fixture
responder solely to verify the real test/execution and retry control plane.
This is not evidence that an actual LLM has already fixed a new bug on that
PC. Read the [BAKU Mini agent runner guide](docs/BAKU_AGENTIC_MINI_RUNNER_2026-10-14.md).

## BAKU is an actual coding-agent repair loop — NOT a mutation toy

**BAKU's intended behavior is the same real investigate → edit → test →
failure feedback → revise → independently verify → safe-apply work performed
by a coding assistant with authorized GitHub/PC/IDE tools.** The old BAKU DNA
vault and self-rebuild were parts of that architecture. The bounded
pure-function mutation and known-backup restoration demos are only
supporting subroutines, not the agentic repair brain.

See the [canonical BAKU agentic repair contract](docs/BAKU_AGENTIC_REPAIR_CONTRACT_2026-10-14.md).
The complete autonomous agent loop is not yet running inside METRON Mini;
recent real METRON PR repairs were made by ChatGPT acting with connected tools.

## Recover previously unseen behavior, not just known backups

Mini now supports **actual bounded unknown-bug repair search**. The operator
provides failing behavior examples, *not* a fixed source file. An expression
mutation engine searches candidate edits on its own and only returns a patch
after separate holdout vectors pass. No arbitrary source is executed and
no real project is modified.

Open `http://127.0.0.1:8766/experience` → chapter 09, or consult the
[exact supported grammar, proof, refused cases and limitations](docs/UNKNOWN_BEHAVIORAL_REPAIR_2026-10-14.md).
This does **not** establish general autonomous repair for unknown faults in
arbitrary production software.

## Interchangeable AI: local LLM is optional

METRON now includes a tested capability-aware provider selector and
failover primitive. A configured, authorized external AI can replace a
missing local model for an advisory final decision; repair roles are
limited to providers with real coding-agent adapters. All providers can
be unavailable without inventing output or applying unverified changes.
[AI substitution contract](docs/AI_FAILOVER_OPTIONAL_LOCAL_2026-10-14.md).

## AI consensus, local LLM, useful computation and recovery

The Mini `/experience` page now has actual provider API adapters for a
three-provider OpenAI/Gemini/Claude consultation, a separate Ollama localhost
final-judgment request, a PoUC bounded useful computation verifier, and a
BAKU automatic known-good source recovery cycle in a disposable sandbox.
**Provider calls are disabled without user consent/configuration; an absent
LLM never produces a fabricated answer.** No production patch is applied.
See [execution evidence and limits](docs/AI_POUC_RECOVERY_EXECUTION_2026-10-14.md).

## Experience the original METRON civilization concept / 構想を体験する

**METRON is not merely a task-resume utility.** Its long-term concept is
independent user villages, **each housing its own MotherShip A and B**, exchanging
actual Rumor JSON files through a Village Square, retaining provenance,
configuring noise filters and surviving loss of individual interfaces.

A new **guided, interactive experience** is part of the runnable Mini OS.
Start `node mini/start.mjs` and open
**http://127.0.0.1:8766/experience**. Inside each village, MotherShip A/B
exchange local tasks via their own Gateway. Across villages, a **real versioned
Rumor JSON file** is published into a local shared Village Square folder,
then independently read by the next village's own Gateway. The user controls
the receiving filter strength and personally decides whether to adopt or
quarantine the Rumor; no AI-generated "derived idea" is fabricated.
Local file exchange is real, but multi-machine P2P and external AI reasoning
remain unimplemented.

Read the [original concept and precise evidence boundaries](docs/METRON_CIVILIZATION_EXPERIENCE_2026-10-14.md).

## Try the running METRON Mini OS / 実際に起動する

Verified work can now prepare a reviewed repair-evidence Rumor, explicitly
publish its exact bytes to the local Village Square, and preserve the other
village's adoption/provenance in a later work. Restart does not publish;
uncertain publication requires an explicit same-payload continuation. This
does not establish signed-in ARC E2E or a general autonomous coding agent.
See the [repair-knowledge path and trust limits](docs/METRON_MINI_REPAIR_KNOWLEDGE_2026-10-15.md).

Village work continuity now connects a delivered Gateway reply, the original
goal and explicitly selected adopted knowledge to the **same persisted BAKU
incident**. Chapter 10 of `/experience` creates or reopens that work, passes
its context into the repair prompt and saves candidates, failures, actual
provider/model records and per-run consent. Restarting does not call a model;
an explicit provider change can retain the same candidate and history.
Verified results prepare a local human-review sharing draft without publishing
it. The repair target remains the bundled two-file fixture. Validation uses
labelled injected reasoners and local Chromium, not live AI or signed-in ARC
E2E. See the [work continuity contract](docs/METRON_MINI_WORK_CONTINUITY_2026-10-15.md).

A browser-based **local working reference** now connects two separately
persisted MotherShip mailboxes, Gateway queued message delivery and ACK,
BAKU source-fragment inspection, and ARC DOM selector exploration. It
runs without AI-service credentials, a Google Apps Script deployment, npm
installation, or an Android device:

```sh
node mini/start.mjs
```

Open **http://127.0.0.1:8766/** from the same PC. See the
[Japanese quick start, architecture and boundaries](mini/README.md).
This is an operational local prototype, **not** a reconstruction or proof of
the historical cloud system's complete end-to-end autonomous integration.
Local messages persist in git-ignored JSON; code excerpts are only inspected,
not run or saved. The server binds loopback only.

## Start with the reusable code

| Area | Standalone reference module | Demonstrated behavior |
| --- | --- | --- |
| ARC | [Selector kit](reusable/arc-dom/selector-kit.mjs) | Shadow DOM lookup, semantic selectors, confirmation/debounce and interactive picker |
| BAKU | [DNA cards](reusable/baku-dna/code-cards.mjs) | Extract function/class fragments, flag review patterns, dependency-order composition |
| Gateway | [Jobs and memory](reusable/gateway-jobs/job-state.mjs) | Deduplicated jobs, leases, stale-result fencing, retry/dead-letter, expiring session memory |
| MotherShip | [Workflow](reusable/mothership/workflow.mjs) | Work classification and independent evidence required before claiming patch verification |

Run `node --test reusable/tests/*.test.mjs` (Node.js 20+). These are **small reference implementations extracted/reworked from the ideas**, not drop-in replacements for the original Android/GAS runtimes. Their synthetic unit tests do not prove production safety.

## Reusable packages and new validation

The four reusable components can now be packed **individually** using npm pack from their respective folders. This does **not** imply they are published on the npm registry. Each package includes its own package metadata, README and MIT license.

Round-two verification includes a real desktop Chromium DOM/Shadow DOM picker test, historical BAKU-source extraction fixtures, and independent npm package dry-runs. This does **not** verify the old Android ARC picker or autonomous BAKU repair. See the [validation report](reusable/VALIDATION.md) and [packaging guide](reusable/README.md).

## Gateway restart recovery and local integration example

The reference Gateway now offers **single-writer JSON checkpointing**, state restoration across Node.js processes, and stale-lease fencing. Its reference code can be used from `metron-reference-gateway-jobs/persistent`; no multi-process locking or remote exactly-once semantics are claimed.

A **local synthetic continuity demo** combines all four reusable reference modules without calling an AI API or touching the historical runtime:

A separate [two-MotherShip relay demonstration](reusable/examples/two-mothership-relay.mjs) now exercises message delivery through the reference Gateway across two distinct persisted JSON inbox files, including crash/retry deduplication. This is synthetic, **not** proof of the historic two-spreadsheet route.

```sh
node reusable/examples/local-continuity-demo.mjs
```

The [validation report](reusable/VALIDATION.md) distinguishes this new test from the **not-yet-verified** fully integrated legacy MotherShip–Gateway–BAKU–ARC system.

## Historic development / 開発経緯

- **December 2025:** earlier Yume Engine/Yume System work: AI-driven application generation, staged development, transport scheduling test data, chunked code transfer, and early self-update experiments.
- **January 2026:** MotherShip variants, internal communication/message-type experiments, evolution candidates and approval workflows.
- **February–March 2026:** Gateway, ARC and BAKU integrations developed separately; Gateway/ARC logs show submitted jobs and stored outcomes, BAKU logs record script update requests.
- **Later 2026:** additional experimental refinements and preservation of local source snapshots. Complete autonomous community-level operation has not been established.

This timeline draws on preserved project code and historical logs; it is not a claim that every planned feature ran successfully. See [implementation evidence](docs/IMPLEMENTATION_STATUS.md).

## Original concept documents

The historical Gists were created before this repository's later archival/distribution work. They remain unchanged:

- [METRON: decentralized AI civilization architecture (2026-02-05)](https://gist.github.com/dakahasa0119-blip/a5e6fe11fbbcce76ff8957f6d77a2eb9)
- [BAKU — salvage intelligence (2026-02-06)](https://gist.github.com/dakahasa0119-blip/5480137dde654c83b263b7c04b430c41)
- [METRON: PROXY-HAND (2026-02-06)](https://gist.github.com/dakahasa0119-blip/d7cb8714fc5c576689eff0edc0c3bdf7)

## Scope of permission to reuse / 再利用の条件

**Original first-party METRON OS, Gateway, BAKU and ARC source is available under [Apache License 2.0](LICENSE).** Attribution is recorded in [NOTICE](NOTICE); see the [license map](LICENSING.md) for exact scope and third-party exclusions. The separate `reusable/` reference packages **remain MIT licensed** under [their own license](reusable/LICENSE). Commercial use and derivative works are allowed subject to the applicable license; licenses do not grant access to private services or third-party intellectual property.

For security issues and research limitations, read [SECURITY.md](SECURITY.md). The original scripts may contain stale endpoint URLs or machine paths; do not deploy unchanged, expose personal data or assume provider platform terms allow automated use. We do not provide help circumventing access controls or challenges.

## 日本語まとめ

旧METRONには、母艦・Gateway・BAKU・ARCそれぞれに動作履歴と実装ソースがあります。 BAKUの修復ログは[再試行を重複排除した監査](docs/BAKU_REPAIR_EVIDENCE_AUDIT_2026-10-14.md)を追加しました。ただし全体統合、独立した村間P2P通信、自律的な修復成功の安定性は未実証です。公開版は**当時の実験コード**と**新しく切り出した再利用モジュール**を分離しました。旧本体の第一者著作部分にはApache 2.0、新しい再利用モジュールにはMITを適用しています。原著作者とライセンス表示を維持する条件で商用利用・改変・再配布が可能です。第三者コードは元のライセンスを優先します。

開発を中断した背景にはAPI利用料金の負担があったと開発者は述べていますが、直接の料金記録との照合は未完了です。
