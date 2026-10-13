# Independent file inventory and readback reference — 2026-10-14

The prior portable Gateway \`snapshot-diff\` module compared *supplied* text-file inventories, so an unreliable producer could hide undeclared file changes by omitting them from both snapshots. This follow-up adds a **read-only Node.js filesystem inventory reader** and wrapper that the *verification process* can run against two **isolated, authorized worktree roots**.

## Demonstrated narrow behavior

- Reader recursively enumerates UTF-8 source files, including nested directories, and excludes root \`.git\` metadata. It refuses symlinks, nested \`.git\`, unsupported special entries, binary/NUL-containing files, malformed text and trees exceeding defined file/byte budgets.
- \`reviewRepairWorktrees\` independently reads baseline and candidate directories, checks the pinned baseline hash and exact declared changed-file set, and always returns \`canApply=false\`.
- \`verifyWorktreeReadback\` re-collects the candidate tree from the filesystem after the comparison and matches its inventory digest. A later silent mutation or an undeclared addition produces a blocked result.
- Nine isolated filesystem tests plus the existing cross-platform suite bring the local Windows + Chrome test count to **70/70**.

## Limits that must remain visible

This implementation is **not a secure sandbox**. Stat/open/read can race concurrent modifications; hardlinks, mount points, process privileges, excluded \`.git\` metadata and file modes are not represented in text inventories; and the reader intentionally fails on binary dependencies and repositories exceeding its bounds. All cloned test directories are disposable. The trusted parent application must authorize the absolute roots, independently pin the baseline revision and decide what constitutes a complete codebase.

A readback hash shows that the later measured text snapshot matches the earlier candidate hash. It does **not** prove that a program compiled, passed realistic tests, had no vulnerabilities, met user intent, or was deployed and loaded. Neither historical METRON GAS nor ARC Android processes were changed or exercised.

## Next acceptance gate

Separate source readback from the actual acceptance decision: collect independently produced compiler/test evidence bound to the same candidate digest, preserve a rollback reference, and require a trusted user's authorization for any write or deployment. The portable modules will remain incapable of applying changes.
