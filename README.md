# METRON — AI Continuity, Recovery and External-Interface Experiments

日本語 / English

**METRON is an experimental architecture and a collection of historical prototypes**, exploring continuity of AI workflows, persistent memory, external AI interaction, repair, and eventually decentralized AI communities. It is **not** a verified, fully autonomous or fully distributed AI civilization.

The historical Android, Apps Script and Gateway sources remain available in this repository. A small, dependency-free, **reusable toolkit** is maintained separately under [`reusable/`](reusable/README.md).

## Why this exists / 目的

METRON investigates how independent AI-enabled systems can preserve goals, context and work when providers, sessions, interfaces or machines change. The broader concept includes independent villages, communication and knowledge exchange between them, shared computing, and salvage of damaged systems.

- **MotherShip (METRON OS):** user-specific context, evolving application and workflow control.
- **Gateway:** dispatch, leases, status tracking, persistent and short-lived memory.
- **ARC / PROXY-HAND:** external AI interface through Android WebView; adaptive DOM inspection.
- **BAKU:** extraction and reuse of code fragments; recovery candidates, canary and quarantine.

These components evolved separately. **Their full end-to-end integration is not verified.** In particular, the observed MotherShip-A/B `Dispatcher` is a same-spreadsheet, tab-based prototype; it does not itself prove direct cross-spreadsheet or P2P messaging. Separate spreadsheet artifacts exist and their complete direct-communication path requires further verification.

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

**Only the new `reusable/` toolkit is offered here under the [MIT license](reusable/LICENSE).** Other historical files in the repository may include third-party content, environment-specific details, and incomplete research experiments. Do **not** assume the MIT license applies to the old Android/GAS tree. Unless separately licensed, normal copyright restrictions apply to that material.

For security issues and research limitations, read [SECURITY.md](SECURITY.md). The original scripts may contain stale endpoint URLs or machine paths; do not deploy unchanged, expose personal data or assume provider platform terms allow automated use. We do not provide help circumventing access controls or challenges.

## 日本語まとめ

旧METRONには、母艦・Gateway・BAKU・ARCそれぞれに動作履歴と実装ソースがあります。 BAKUの修復ログは[再試行を重複排除した監査](docs/BAKU_REPAIR_EVIDENCE_AUDIT_2026-10-14.md)を追加しました。ただし全体統合、独立した村間P2P通信、自律的な修復成功の安定性は未実証です。公開版は**当時の実験コード**と**新しく切り出した再利用モジュール**を分離しました。後者のみMITライセンスで二次利用できます。

開発を中断した背景にはAPI利用料金の負担があったと開発者は述べていますが、直接の料金記録との照合は未完了です。
