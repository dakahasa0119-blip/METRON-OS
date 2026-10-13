/**
 * Read-only orchestration of real worktree inventory, file-level scope
 * comparison, and later independently re-collected post-write readback.
 * No patch execution, writes, external services or approval mechanism.
 */
import { realpathSync } from "node:fs";
import { readTextWorktree } from "./worktree-reader.mjs";
import { reviewRepairSnapshots, snapshotDigest } from "./snapshot-diff.mjs";

const baseSafe = { approved: false, canApply: false };
const blocked = reason => ({ status: "blocked", reason, ...baseSafe });
const sha = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

/**
 * Caller controls two isolated, immutable, authorized checkout paths and
 * independently pins expectedBaseDigest BEFORE receiving candidate changes.
 */
export function reviewRepairWorktrees({
  baselineRoot, candidateRoot, expectedBaseDigest, scope
} = {}) {
  if (!sha(expectedBaseDigest)) return blocked("trusted_base_digest_required");
  if (typeof baselineRoot !== "string" || typeof candidateRoot !== "string")
    return blocked("roots_required");
  try {
    if (realpathSync(baselineRoot) === realpathSync(candidateRoot))
      return blocked("roots_must_differ");
    const before = readTextWorktree(baselineRoot);
    const after = readTextWorktree(candidateRoot);
    const reviewed = reviewRepairSnapshots({
      scope, beforeFiles: before.files, afterFiles: after.files, expectedBaseDigest
    });
    return {
      ...reviewed,
      inventorySource: "read_only_filesystem_inventory",
      baseFiles: before.fileCount,
      candidateFiles: after.fileCount
    };
  } catch {
    // Do not propagate filenames or raw system errors into the public report.
    return blocked("inventory_failed");
  }
}

/**
 * Check that a post-write, independently re-collected text inventory matches
 * a candidate digest from an earlier review. Not a functional test or deploy
 * approval. The host must ensure trusted root and no later mutation.
 */
export function verifyWorktreeReadback({ root, expectedCandidateDigest } = {}) {
  if (!sha(expectedCandidateDigest)) return blocked("candidate_digest_required");
  if (typeof root !== "string") return blocked("root_required");
  try {
    const inventory = readTextWorktree(root);
    const observedDigest = snapshotDigest(inventory.files);
    return observedDigest === expectedCandidateDigest
      ? { status: "matched", digest: observedDigest, files: inventory.fileCount, ...baseSafe }
      : blocked("readback_digest_mismatch");
  } catch {
    return blocked("readback_inventory_failed");
  }
}
