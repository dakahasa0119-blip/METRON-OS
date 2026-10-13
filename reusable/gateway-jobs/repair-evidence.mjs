/**
 * Strict evidence-consistency gate for repair candidates.
 *
 * Never authorizes a patch. Test receipts are caller-supplied data, not
 * cryptographically verified proof that a trusted independent runner ran.
 * The host must check origins, signatures, isolated runner outputs and consent.
 */
const REQUIRE = ["compile", "unit", "regression", "smoke"];
const sha = x => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
const safe = { canApply: false, canDeploy: false, approved: false };
const blocked = reason => ({ status: "blocked", reason, ...safe });
const plain = o => !!o && typeof o === "object" && !Array.isArray(o);

export function assessRepairEvidence({ review, readback, checks, rollbackDigest } = {}) {
  if (!plain(review) || review.status !== "review_required" ||
      review.canApply !== false || review.approved !== false ||
      !sha(review.baseDigest) || !sha(review.candidateDigest) ||
      !Array.isArray(review.changes) || review.changes.length === 0) {
    return blocked("valid_scope_review_required");
  }
  if (!plain(readback) || readback.status !== "matched" ||
      readback.canApply !== false || readback.approved !== false ||
      readback.digest !== review.candidateDigest) {
    return blocked("candidate_readback_not_verified");
  }
  if (!sha(rollbackDigest) || rollbackDigest !== review.baseDigest) {
    return blocked("rollback_reference_mismatch");
  }
  if (!Array.isArray(checks) || checks.length !== REQUIRE.length) {
    return blocked("required_checks_missing");
  }

  const seen = new Set();
  for (const receipt of checks) {
    if (!plain(receipt) || typeof receipt.kind !== "string" ||
        !REQUIRE.includes(receipt.kind) || seen.has(receipt.kind)) {
      return blocked("unknown_or_repeated_check");
    }
    seen.add(receipt.kind);
    if (receipt.candidateDigest !== review.candidateDigest) {
      return blocked("check_candidate_mismatch");
    }
    if (receipt.status !== "passed" || receipt.exitCode !== 0 ||
        !Number.isSafeInteger(receipt.passed) || receipt.passed < 1 ||
        !Number.isSafeInteger(receipt.failed) || receipt.failed !== 0) {
      return blocked("check_not_proven_passed");
    }
    // A literal runner identity is metadata only; not authentication.
    if (typeof receipt.runnerLabel !== "string" || !receipt.runnerLabel.trim()) {
      return blocked("runner_metadata_missing");
    }
  }
  if (seen.size !== REQUIRE.length) return blocked("required_checks_missing");
  return {
    status: "review_required",
    reason: review.reason === "critical_topic_manual_review"
      ? "critical_topic_manual_review"
      : "evidence_consistent_not_authorized",
    candidateDigest: review.candidateDigest,
    rollbackDigest: review.baseDigest,
    checksRecorded: REQUIRE.length,
    evidenceLevel: "unsigned_caller_supplied_receipts",
    requiresHumanDecision: true,
    ...safe
  };
}
