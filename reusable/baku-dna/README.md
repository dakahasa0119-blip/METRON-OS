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
