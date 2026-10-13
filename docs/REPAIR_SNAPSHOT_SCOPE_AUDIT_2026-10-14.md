# Repair candidate snapshot scope verifier — 2026-10-14

## Motivation

BAKU/Gateway historical code can submit or stage source updates after local validation. Prior portable \`preflightRepairRequest\` checks only user-declared paths and constraints, not the files that really changed. This follow-up adds an **offline file-snapshot comparator** so candidate source text cannot silently add, delete or modify files absent from the stated scope **within the provided inventory**.

## What is implemented

- \`snapshotDigest(beforeFiles)\` creates a deterministic, sorted, length-framed SHA-256 digest of full supplied text-file contents and normalized relative paths.
- \`reviewRepairSnapshots\` requires a caller-provided independently **pinned before digest**. Mismatched bases fail closed.
- The checker computes the full before/after changed path set and requires an exact match to user-declared proposed paths, including additions and deletions.
- The existing \`preflightRepairRequest\` denies protected path overlaps; this verifier also blocks invalid paths, case-only duplicate aliases, file/directory collisions, empty diffs, missing changes, malformed UTF-8 source strings and oversized inventories.
- A successful comparison yields \`status=review_required\` and individual file hashes plus a candidate inventory digest. \`canApply=false\` and \`approved=false\` **always**; no source content or user prompt text is reproduced in the report.

## Evidence and limits

The Windows Chromium and Node tests passed **61 / 61** on the isolated portable reference suite (8 new snapshot tests). The tests use synthetic inventories, not old confidential Drive records.

**Important trust boundary:** a malicious agent could supply two internally consistent but incomplete inventories and then hide a changed file. The verifier **does not enumerate or read the true filesystem**, check Git untracked state, resolve symlinks, execute a compiler, run UI tests or check deployment behavior. A separate trusted runner must collect a complete baseline and candidate inventory, bind the pinned digest to a specific revision, independently read the applied files, and authorize any writes. A hash without an authenticated reference to its source is not proof of provenance.

## Next integration step

A read-only, trusted host adapter should first enumerate an authorized worktree, capture all relevant files and exact commit/version identifiers, run the verifier, then independently validate compilation, functional behavior and post-write readback. No automatic patch install or live GAS rollout is part of this stage.
