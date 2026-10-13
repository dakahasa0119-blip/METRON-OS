# Repair evidence acceptance boundary — 2026-10-14

The historical METRON/BAKU/Gateway suite sometimes treated a submitted script update or successful HTTP response as proof of applied, working repair. The portable reference separates five classes of evidence:

1. **Pinned source baseline:** independently captured before-tree digest.
2. **Proposed change scope:** exact before/after file inventory difference and protected path preflight.
3. **Post-change readback:** a later independent filesystem read with the identical candidate inventory digest.
4. **Functional checks:** separately recorded compile, unit, regression and smoke test results, each bound to the same candidate digest.
5. **Rollback and authorization:** retained baseline reference and an explicit trusted human/host decision.

## Implemented in the reusable reference

The new \`assessRepairEvidence\` accepts file review, readback, a rollback digest and check receipts. It refuses mismatched or missing data, empty/failed results and repeated check kinds. The normal output is **review_required**, not **approved**. \`canApply\` and \`canDeploy\` are always false.

Seven new synthetic tests bring the local Windows+Chromium Node suite to **77/77 passing**. They deliberately exercise apparently positive but untrustworthy combinations, such as fake approval flags and stale test results. No live legacy GAS, Drive or external AI account was used.

## Mandatory security caveat

The check receipts are **ordinary JSON objects supplied by the caller**, not signed attestations from a genuinely independent runner. Even completely consistent objects may be made up by an untrusted process. This helper does not actually compile, execute tests, inspect permissions, obtain user consent or validate independent origin. It does not create a rollback backup, nor guarantee that the actual deployment matches the reviewed candidate. The trusted host must run the checks independently, authenticate their provenance, pin revision+hash, prove that rollback exists, and separately authorize an action.

This component exists to make **missing or inconsistent evidence explicit**, not to turn AI-generated success claims into automatic permission.

## Next genuine performance milestone

Use a frozen, labelled, held-out set of real repair incidents to test the candidate generator against failures and non-fixable cases. Report per-distinct-incident results: safely repaired, correctly rejected, unsafe patch, inconclusive; correlate source readback with independent functional testing and measure recurrence after restart. Historic BAKU's queue-level logs alone cannot establish that benchmark.
