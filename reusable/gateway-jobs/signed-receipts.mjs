/**
 * Ed25519 signed test receipt reference for the local METRON toolkit.
 *
 * A trusted independent verifier MUST pin public keys, audience, candidate,
 * suite and single-use challenge before the signer runs. A signature validates
 * origin and exact receipt fields, NOT whether tests actually ran or whether
 * signing host was secure. Never gives deployment/apply authorization.
 */
import { sign as signBytes, verify as verifyBytes, createPublicKey, createPrivateKey } from "node:crypto";
import { Buffer } from "node:buffer";
import { assessRepairEvidence } from "./repair-evidence.mjs";

const KINDS = ["compile", "unit", "regression", "smoke"];
const DIGEST = /^[0-9a-f]{64}$/;
const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{22,86}$/;
const MAX_AGE_MS = 300_000, SKEW_MS = 5_000;
const SAFE = Object.freeze({ canApply: false, canDeploy: false, approved: false });
const blocked = reason => ({ status: "blocked", reason, ...SAFE });
const keys = ["version","keyId","runnerId","audience","nonce","candidateDigest",
  "suiteDigest","kind","status","exitCode","passed","failed","issuedAtMs","expiresAtMs"];
const plain = x => !!x && typeof x === "object" && !Array.isArray(x);
const validLabel = x => typeof x === "string" && LABEL.test(x);
const validDigest = x => typeof x === "string" && DIGEST.test(x);
const validNonce = x => typeof x === "string" && CHALLENGE.test(x);

function validateClaims(c) {
  if (!plain(c) || Object.keys(c).length !== keys.length ||
      !keys.every(k => Object.hasOwn(c,k)) || c.version !== 1 ||
      !validLabel(c.keyId) || !validLabel(c.runnerId) || !validLabel(c.audience) ||
      !validNonce(c.nonce) || !validDigest(c.candidateDigest) ||
      !validDigest(c.suiteDigest) || !KINDS.includes(c.kind) ||
      !["passed","failed"].includes(c.status) ||
      !Number.isSafeInteger(c.exitCode) || c.exitCode < 0 ||
      !Number.isSafeInteger(c.passed) || c.passed < 0 ||
      !Number.isSafeInteger(c.failed) || c.failed < 0 ||
      !Number.isSafeInteger(c.issuedAtMs) ||
      !Number.isSafeInteger(c.expiresAtMs) ||
      c.expiresAtMs <= c.issuedAtMs ||
      c.expiresAtMs - c.issuedAtMs > MAX_AGE_MS)
    return false;
  return c.status !== "passed" ||
    (c.exitCode === 0 && c.failed === 0 && c.passed > 0);
}
const encoded = claims => Buffer.from(
  "METRON-SIGNED-CHECK-V1\n" + JSON.stringify(keys.map(key=>claims[key])),
  "utf8"
);
/** Signing is only for a host that ACTUALLY performed the declared checks. */
export function signCheckReceipt(claims, privateKey) {
  if (!validateClaims(claims)) throw new TypeError("invalid_receipt_claims");
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("ed25519_private_key_required");
  const signature = signBytes(null,encoded(claims),key).toString("base64url");
  return { claims: { ...claims }, signature };
}
/**
 * Verify a complete 4-check bundle. publicKeys must be externally pinned
 * Map(keyId => {publicKey, runnerId}). consumedNonces is caller-persisted state.
 */
export function verifyCheckBundle(receipts,{
  publicKeys, consumedNonces, expectedNonce, expectedAudience,
  expectedCandidateDigest, expectedSuiteDigest, expectedRunnerId,
  nowMs = Date.now()
}={}) {
  if (!Array.isArray(receipts) || receipts.length !== KINDS.length)
    return blocked("required_receipts_missing");
  if (!(publicKeys instanceof Map) || !(consumedNonces instanceof Set) ||
      !validNonce(expectedNonce) || !validLabel(expectedAudience) ||
      !validLabel(expectedRunnerId) || !validDigest(expectedCandidateDigest) ||
      !validDigest(expectedSuiteDigest) || !Number.isSafeInteger(nowMs))
    return blocked("invalid_verifier_configuration");
  const challengeKey = expectedAudience + ":" + expectedRunnerId + ":" + expectedNonce;
  if (consumedNonces.has(challengeKey)) return blocked("replayed_challenge");

  const seen = new Set();
  const checks=[];
  for (const packet of receipts) {
    if (!plain(packet) || !plain(packet.claims) || typeof packet.signature !== "string" ||
        !/^[A-Za-z0-9_-]{86}$/.test(packet.signature) ||
        !validateClaims(packet.claims)) return blocked("invalid_signed_receipt");
    const c = packet.claims;
    if (seen.has(c.kind)) return blocked("duplicate_check_kind");
    seen.add(c.kind);
    if (c.nonce !== expectedNonce || c.audience !== expectedAudience ||
        c.candidateDigest !== expectedCandidateDigest ||
        c.suiteDigest !== expectedSuiteDigest || c.runnerId !== expectedRunnerId)
      return blocked("receipt_scope_mismatch");
    if (nowMs < c.issuedAtMs - SKEW_MS || nowMs >= c.expiresAtMs)
      return blocked("receipt_expired_or_not_yet_valid");
    const trust = publicKeys.get(c.keyId);
    if (!plain(trust) || trust.runnerId !== expectedRunnerId || !trust.publicKey)
      return blocked("untrusted_runner_key");
    let valid = false;
    try {
      const key=createPublicKey(trust.publicKey);
      if (key.asymmetricKeyType === "ed25519") {
        const sig=Buffer.from(packet.signature,"base64url");
        valid = sig.length===64 && sig.toString("base64url")===packet.signature &&
          verifyBytes(null,encoded(c),key,sig);
      }
    } catch { valid=false; }
    if (!valid) return blocked("invalid_signature");
    if (c.status !== "passed" || c.exitCode !== 0 ||
        c.failed !== 0 || c.passed < 1)
      return blocked("reported_check_failure");
    checks.push({
      kind:c.kind,candidateDigest:c.candidateDigest,status:c.status,
      exitCode:c.exitCode,passed:c.passed,failed:c.failed,
      runnerLabel:c.runnerId
    });
  }
  if (seen.size !== KINDS.length) return blocked("required_receipts_missing");
  consumedNonces.add(challengeKey);
  return {
    status:"verified",
    candidateDigest:expectedCandidateDigest,suiteDigest:expectedSuiteDigest,
    runnerId:expectedRunnerId,checks,
    evidenceLevel:"ed25519_receipt_signature_verified",
    ...SAFE
  };
}

/**
 * Compound review: signed packet first, then the existing conservative
 * evidence-consistency gate. Neither can ever authorize code application.
 */
export function assessSignedRepairEvidence({
  review,readback,rollbackDigest,receipts,trust
}={}) {
  const v=verifyCheckBundle(receipts,trust);
  if(v.status!=="verified") return v;
  const assessed=assessRepairEvidence({
    review,readback,rollbackDigest,checks:v.checks
  });
  return {
    ...assessed,
    evidenceLevel: assessed.status === "review_required"
      ? "ed25519_signature_verified_not_runner_attested"
      : "failed_after_signature_verification",
    ...SAFE
  };
}
