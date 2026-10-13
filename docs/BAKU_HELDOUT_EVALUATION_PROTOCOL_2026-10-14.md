# BAKU independent held-out evaluation protocol — 2026-10-14

## Why no historical repair-success rate has been claimed

Original BAKU repair evidence contained 2,908 attempt records but only 487 queue IDs spanning five card IDs. Two queue outcomes were labelled "repaired" internally; this does not prove reliable repair of new faults. Repeated attempts are not independent incidents, and automated API update/compile acknowledgements are not held-out functional proof.

## New reusable scoring code

The \`reusable/baku-dna/heldout-benchmark.mjs\` module now **scores separately labelled distinct incidents**, with fixed development/holdout splits grouped by code family to block data leakage. The label manifest is hashed before receiving candidate predictions. A proposal is counted as a \`locally_verified_fix\` *only* when six caller-reported independent checks (scope, syntax, readback, unit, regression, rollback) all report pass for a repairable held-out case. An unknown check remains \`inconclusive\`; a failed check is a \`failed_candidate\`; an attempted fix for a labelled must-reject case becomes \`unsafe_proposal\`. Correct refusal is measured separately. No category proves installed production repair.

The module reports held-out denominators and Wilson 95% intervals for local-fix and correct-rejection fractions to make small samples visible. **It does not execute repairs or authenticate the evaluation labels.**

## Protocol required to establish real BAKU performance

1. Define an actual incident from a unique failing program, independent symptom and expected functional behavior — **not** one queue retry. Create a distinct non-fixable control set.
2. Label cause and fixability through an evaluator independent of the candidate generator; remove personal/confidential data, and preserve private corpus outside public GitHub.
3. Freeze case IDs, code-family grouping, development/holdout assignment, label version and manifest hash **before** candidate generation. Do not leak oracle tests into candidate prompts.
4. Run each candidate only in a disposable authorized environment. Independently collect changed-file inventory, protection checks, compile outcome, behavioral and regression tests, readback, and rollback validation.
5. Supply signed or otherwise independently authenticated result evidence to the offline scoring adapter. Report all rejected and inconclusive cases, not just successful ones.
6. Publish aggregate denominators, experiment commit and test harness hashes without private source; keep BAKU/GAS production unmodified.

## Current result and explicit limitation

The first **seven tests** of the new evaluator are synthetic accounting and leakage tests. They do not give a repair hit rate for BAKU, so issue #100 remains open until a genuine frozen, sufficiently diverse and independently evaluated historical or realistic failure corpus has been completed. The present effort improves measurement integrity, **not** BAKU's code repair algorithm.
