# BAKU repair outcome audit — 2026-10-14

**Scope:** read-only aggregation of the original Drive spreadsheet named BAKU, tabs `BAKU_REPAIR_EVIDENCE` and `BAKU_REPAIR_METRICS`. Neither the original sheets nor legacy GAS were modified. Raw rows, code excerpts, user messages, target identifiers and individual QueueIds are deliberately excluded from this public summary.

## Exact examined columns

- Evidence: `Timestamp, CardId, QueueId, Result, RepairState, FailureReason, CompileBeforeOk, CompileAfterOk, CodeChanged` and `ReviewVerdict` (17th column).
- Metrics: `Timestamp, CardId, QueueId, Result, RepairState, FailureReason, CompileBeforeOk, CompileAfterOk, Attempts, DurationMs, QualityScore, Note`.
- The two sheets each contain **2,908 populated data rows** (excluding the header). Do not interpret reserved sheet rows or repeated attempts as distinct incidents.

## Row-level totals

| Source | Field | Classification | Count |
| --- | --- | --- | ---: |
| Evidence | `RepairState` | `unresolved` | 2,904 |
| Evidence | `RepairState` | `repaired` | 2 |
| Evidence | `RepairState` | `clean` | 2 |
| Metrics | `RepairState` | `unresolved` | 2,422 |
| Metrics | `RepairState` | `unresolved_exhausted` | 482 |
| Metrics | `RepairState` | `repaired` | 2 |
| Metrics | `RepairState` | `clean` | 2 |

`unresolved_exhausted` appears as a final metric event for retried queues. A corresponding Evidence row may still say `unresolved`; the sheet schemas record related but different aspects of the attempted work. Simply counting 'unresolved' in one tab does not capture terminal exhaustion in the other.

## Deduplicated metrics by QueueId

There are **487 distinct nonempty QueueIds**, referring to just **5 distinct CardIds** in this dataset. Taking the **last metric row in sheet append order** for each QueueId gives:

| Final recorded state | Distinct queues |
| --- | ---: |
| `unresolved_exhausted` | **482** |
| `repaired` | **2** |
| `clean` | **2** |
| `unresolved` | **1** |
| **Total** | **487** |

The last status is not necessarily the current runtime state; it is the latest *recorded* state in the audited sheet. QueueIds and CardIds are not independently labelled distinct real-world defect cases. The dataset is heavily repetitive and must **not** be used to estimate unbiased repair accuracy or recall.

## How strong are the four positive rows?

The two `repaired` records each have `Result=ok`, `CompileBeforeOk=N`, `CompileAfterOk=Y`, `CodeChanged=Y` and `ReviewVerdict=effective_fix`. Metrics notes state `external_repair_result_applied`. This supports an **internally recorded code change and compile-state improvement**.

The two `clean` records have `Result=ok`, `CompileBeforeOk=Y`, `CompileAfterOk=Y`, `CodeChanged=N` and `ReviewVerdict=noop_clean`. These are successful *no-change checks*, **not repaired faults**.

Neither pair proves durable deployment, application behavior after restart, absence of regression, original-user acceptance, or ability to repair previously unseen faults. No verified repair-success rate should be computed without independent readback/functional tests and deduplicated held-out incident labels.

## Follow-up to the two internally recorded repaired cases (2026-10-14 review)

A narrower read-only forensic pass matched the two rows with
`RepairState=repaired` in `BAKU_REPAIR_EVIDENCE` and
`BAKU_REPAIR_METRICS`, then inspected subsequent metric rows bearing
the same original CardId. Individual CardIds, queue identifiers and source
excerpts are intentionally not republished.

| Evidence field | Repaired record A | Repaired record B |
| --- | ---: | ---: |
| Event date (JST) | 2026-03-13 | 2026-03-13 |
| Reported code length before → after | 325 → 571 | 276 → 422 |
| Compile before → after | N → Y | N → Y |
| Code changed / local verdict | Y / effective_fix | Y / effective_fix |
| Subsequent records against the **same CardId** | 6 | 6 |
| Distinct *other* subsequent QueueIds | 1 | 1 |
| Final status of those subsequent queues | unresolved_exhausted | unresolved_exhausted |

This supports a real, recorded source modification and syntax/compile
improvement within the historical pipeline for two cases. The later same-card
exhaustions are **not proof of regression**: distinct QueueIds may refer to
different symptoms, sources, tasks or evaluation rules, and the available
records do not link the precise changes to a follow-up independent acceptance
test. Conversely, the two positive rows do not prove durable production
repair. An actual performance study must label distinct fault identities,
match a candidate's source hash and trace, and perform after-restart
functional/regression testing independently.

## Reproduction without giving the public project private source data

The [independent repair-audit classifier](../reusable/baku-dna/repair-audit.mjs) can summarize parsed rows using the original column keys while counting a QueueId once. Its associated tests are *synthetic* and include false-positive positive states and missing evidence. The classifier never calls the Drive API or installs code. It deliberately returns `deployedRepairSuccesses: null`; a `candidateLocalFixes` counter is **not a deployed repair-success count**.

## Next investigation

1. Establish a **labelled, deduplicated sample of actual failure symptoms** and known safe fixes. Include never-seen-before cases, non-fixable cases and hold-out controls.
2. Evaluate whether the suggested repair preserves observable behavior after rollback and independent readback, not only whether a syntax check passes or a script update endpoint returns HTTP 200.
3. Run all trials in an isolated disposable GAS clone or local mock; do not apply candidate changes to the active historical spreadsheets or script projects without explicit scope and recovery design.

This report documents observed historical data; it is not a certification of BAKU's effectiveness.
