# BAKU DNA cards

A lightweight **best-effort** extractor for named JavaScript functions, classes, common object-method and arrow-function blocks. Use `inspectCard` for simple review flags and `composeCards` to order explicitly declared dependencies.

```js
import { extractCards, inspectCard } from 'metron-reference-baku-dna';
const cards = extractCards('function hello() { return 1; }', { sourceName: 'demo' });
console.log(cards.map(c => ({ name: c.name, review: inspectCard(c).reviewRequired })));
```

**Not a full JavaScript parser**, not a vulnerability scanner, and not an automatic patch installer. `composeCards` concatenates fragments for inspection; property methods require their original enclosing object. Tested on selected historical BAKU source names and synthetic review labels, **not** on real-world repair outcomes.

## Assess archived repair outcomes (read-only)

`auditRepairOutcomes(metrics, evidence)` is exported from
`metron-reference-baku-dna/repair-audit`. Supply two arrays of parsed rows
with the original `QueueId`, `RepairState`, `Result`,
`CompileBeforeOk` and `CompileAfterOk` column labels, plus
`CodeChanged` and `ReviewVerdict` in evidence rows. Preserve original
sheet append order; each queue's final row is its current recorded state.

```js
import { auditRepairOutcomes } from 'metron-reference-baku-dna/repair-audit';
const counts = auditRepairOutcomes(metricRows, evidenceRows);
console.log(counts.distinctQueues, counts.finalStates);
```

This does **not** execute repairs, connect to Drive, process source excerpts, or
validate deployment. `candidateLocalFixes` means consistent recorded
compile-before/after, code-changed and local review markers; it is explicitly
**not an autonomous-repair accuracy metric**. Independent runtime verification
requires separate instrumentation and unbiased held-out cases. When a positive
state lacks corroborating evidence it is counted under
`unsupportedPositiveStates`, not as a fix.

## Held-out incident evaluation — no code execution

The `heldout-benchmark` subpath provides two functions:

```js
import {
  fingerprintIncidentLabels,evaluateHeldoutIncidents
} from "metron-reference-baku-dna/heldout-benchmark";
const frozen = fingerprintIncidentLabels(incidentRecords);
// Pin 'frozen' with a trusted evaluator BEFORE scoring any candidate.
const report = evaluateHeldoutIncidents(incidentRecords,{
  expectedLabelDigest:frozen
});
```

Records represent **one distinct incident each** rather than every retry.
Each has a stable incident and code-family identity, a development/holdout
split, independent truth label (repairable/must_reject), and a candidate
decision. Proposals require six independent-result fields: scope, syntax,
readback, unit, regression and rollback, each `pass`, `fail` or `unknown`.
Families present in development may **not** appear in holdout. A frozen SHA-256
fingerprint covers incident IDs, families, splits, truth and oracle version,
but not candidate outcomes, so multiple candidate strategies can be compared.

Only holdout incidents contribute to rates. Outputs distinguish locally
verified repair proposals, correctly rejected non-fixable incidents, missed
fixes, unsafe proposals, failed candidates and inconclusive evidence.
Reported Wilson intervals measure small-sample uncertainty, not real-world
operating performance. `actualProductionRepairSuccesses` is always `null`.

**Limits:** The evaluator does not validate annotation authorship, run
tests, execute proposals, inspect changed files, check deployed behavior or
prove that a supposedly frozen label set was held outside the candidate
author's control. The historical 487 queue IDs and five cards are not an
unbiased held-out corpus. Never claim a repair success rate from demo tests.
