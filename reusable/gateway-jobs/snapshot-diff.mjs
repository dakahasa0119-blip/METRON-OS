/**
 * Independent, offline FILE-LEVEL repair snapshot comparator.
 *
 * These are caller-supplied in-memory inventories, not filesystem reads.
 * Actual application of a patch must occur in a separately authorized host.
 * Never treat "ready_for_review" as approval or as proof that the host supplied
 * a complete or authentic before/after snapshot.
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { preflightRepairRequest } from "./repair-preflight.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const FAILURE = { canApply: false, approved: false, requiresIndependentVerification: true };
const MAX_FILES = 128, MAX_BYTES = 8 * 1024 * 1024, MAX_FILE_BYTES = 1024 * 1024;

function blocked(reason) { return { status: "blocked", reason, ...FAILURE }; }
function pathKey(raw) {
  if (typeof raw !== "string" || raw !== raw.trim()) return null;
  const value = raw.normalize("NFC").replaceAll("\\", "/");
  if (!value || value.startsWith("/") || value.startsWith("~") || value.includes("//") ||
      /[\x00-\x1f\x7f<>:"|?*]/u.test(value)) return null;
  const segments = value.split("/");
  if (segments.some(s => !s || s === "." || s === ".." ||
      s.trim() !== s || s.endsWith(".") ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(s) ||
      s.toLowerCase() === ".git")) return null;
  return value.toLowerCase();
}
function ownDataEntries(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new Error("invalid_snapshot");
  }
  const props = Object.getOwnPropertyDescriptors(input);
  const out = Object.entries(props);
  if (out.length > MAX_FILES) throw new Error("too_many_files");
  for (const [, descriptor] of out) {
    if (!Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") {
      throw new Error("invalid_snapshot_entry");
    }
  }
  return out.map(([name, descriptor]) => [name, descriptor.value]);
}
function normalizedSnapshot(files) {
  const found = new Map();
  let total = 0;
  for (const [name, text] of ownDataEntries(files)) {
    const key = pathKey(name);
    if (!key) throw new Error("invalid_snapshot_path");
    if (found.has(key)) throw new Error("duplicate_normalized_path");
    const bytes = Buffer.from(text, "utf8");
    if (bytes.toString("utf8") !== text) throw new Error("invalid_unicode");
    if (bytes.length > MAX_FILE_BYTES) throw new Error("file_too_large");
    total += bytes.length;
    if (total > MAX_BYTES) throw new Error("snapshot_too_large");
    found.set(key, bytes);
  }
  for (const key of found.keys()) {
    const parts = key.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (found.has(parts.slice(0, i).join("/"))) throw new Error("file_directory_collision");
    }
  }
  return found;
}
function canonicalDigest(files) {
  const hash = createHash("sha256");
  hash.update("METRON-SNAPSHOT-V1\0");
  for (const [path, bytes] of [...files].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const pathBytes = Buffer.from(path, "utf8");
    const head = Buffer.alloc(12);
    head.writeUInt32BE(pathBytes.length, 0);
    head.writeBigUInt64BE(BigInt(bytes.length), 4);
    hash.update(head);
    hash.update(pathBytes);
    hash.update(bytes);
  }
  return hash.digest("hex");
}
/** Compute an inventory fingerprint to pin externally before reviewing a patch. */
export function snapshotDigest(files) {
  return canonicalDigest(normalizedSnapshot(files));
}
/**
 * Compare complete supplied before/after text-file snapshots against declared
 * exact file scope. An expected prior digest must be pinned by the caller.
 * A file absent from one side counts as an addition/deletion.
 */
export function reviewRepairSnapshots({ scope, beforeFiles, afterFiles, expectedBaseDigest } = {}) {
  if (typeof expectedBaseDigest !== "string" || !/^[0-9a-f]{64}$/.test(expectedBaseDigest)) {
    return blocked("trusted_base_digest_required");
  }
  let before, after;
  try {
    before = normalizedSnapshot(beforeFiles);
    after = normalizedSnapshot(afterFiles);
  } catch (error) {
    return blocked(error?.message || "invalid_snapshot");
  }
  const baseDigest = canonicalDigest(before);
  if (baseDigest !== expectedBaseDigest) return blocked("base_digest_mismatch");

  const intake = preflightRepairRequest(scope);
  if (intake.status === "blocked") return blocked("repair_preflight_" + intake.reason);
  if (intake.status !== "ready_for_review" && intake.status !== "review_required") {
    return blocked("unrecognized_preflight");
  }

  const declared = new Set();
  for (const raw of scope.proposedPaths) {
    const path = pathKey(raw);
    if (!path || declared.has(path)) return blocked("invalid_or_duplicate_declared_path");
    declared.add(path);
  }
  const all = new Set([...before.keys(), ...after.keys()]);
  const changes = [];
  for (const path of [...all].sort()) {
    const prior = before.get(path), next = after.get(path);
    if (prior !== undefined && next !== undefined && prior.equals(next)) continue;
    changes.push({ path, kind: prior === undefined ? "added" :
      next === undefined ? "deleted" : "modified",
      beforeSha256: prior === undefined ? null : digest(prior),
      afterSha256: next === undefined ? null : digest(next) });
  }
  if (!changes.length) return blocked("no_actual_changes");
  if (changes.some(x => !declared.has(x.path))) return blocked("undeclared_file_changed");
  if (changes.length !== declared.size) return blocked("declared_file_unchanged_or_missing");
  return {
    status: "review_required",
    reason: intake.status === "review_required"
      ? "critical_topic_manual_review" : "file_scope_matched",
    baseDigest, candidateDigest: canonicalDigest(after), changes,
    // A caller-provided set of files may be incomplete or fabricated.
    evidenceLevel: "supplied_snapshot_bytes_only",
    ...FAILURE
  };
}
