/**
 * Gateway/BAKU repair-intake preflight reference.
 * Pure, conservative decision support; never an authorization or patch runner.
 * Paths are declarations, NOT independently inspected actual code diffs.
 */
const required = [
  "symptom", "expectedFix", "preserveContracts",
  "prohibitedChanges", "protectedPaths", "proposedPaths"
];
const nonempty = text => typeof text === "string" && text.trim().length > 0;
const validList = value => Array.isArray(value) && value.length > 0
  && value.length <= 64 && value.every(x => nonempty(x) && x.length <= 1024);

function normalizePath(input, allowDirectoryPattern = false) {
  if (!nonempty(input) || input.includes("\0")) return null;
  const v = input.replace(/\\/g, "/").trim();
  if (!v || v.startsWith("/") || v.startsWith("~") || /^[a-zA-Z]:/.test(v) ||
      v.includes("//") || v.includes("?")) return null;
  let s = v.toLowerCase();
  let prefix = false;
  if (allowDirectoryPattern && s.endsWith("/**")) {
    prefix = true;
    s = s.slice(0, -3);
  } else if (allowDirectoryPattern && s.endsWith("/")) {
    prefix = true;
    s = s.slice(0, -1);
  }
  if (!s || s.includes("*")) return null;
  const segments = s.split("/");
  if (segments.some(x => !x || x === "." || x === "..")) return null;
  return { path: segments.join("/"), prefix };
}

const isProtected = (proposed, protectedEntry) =>
  proposed === protectedEntry.path ||
  (protectedEntry.prefix && proposed.startsWith(protectedEntry.path + "/"));

const critical = /\b(?:auth|authorization|secret|private[\s_-]+key|jwt|hmac|signature|nonce|encryption|decrypt|token|credential|sha256)\b/i;

/**
 * Output never allows execution. Missing constraints, bad paths, and protected
 * overlap are hard blocks; auth/crypto mentions trigger manual review.
 */
export function preflightRepairRequest(input) {
  const safe = { canApply: false, approved: false, requiresIndependentVerification: true };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { status: "blocked", reason: "invalid_request", ...safe };
  }
  const missing = required.filter(k =>
    (k === "symptom" || k === "expectedFix")
      ? !nonempty(input[k])
      : !validList(input[k])
  );
  if (missing.length) {
    return { status: "blocked", reason: "missing_or_invalid_constraints", missing, ...safe };
  }

  const protectedPaths = input.protectedPaths.map(x => normalizePath(x, true));
  const proposedPaths = input.proposedPaths.map(x => normalizePath(x, false));
  if (protectedPaths.some(x => !x) || proposedPaths.some(x => !x)) {
    return { status: "blocked", reason: "invalid_path_scope", ...safe };
  }
  const overlaps = proposedPaths.filter(p => protectedPaths.some(x => isProtected(p.path, x)));
  if (overlaps.length) {
    return { status: "blocked", reason: "protected_scope_overlap",
      overlapCount: overlaps.length, ...safe };
  }

  // Heuristic flag only, not code analysis or a runtime privilege boundary.
  const combined = [input.symptom, input.expectedFix,
    ...input.prohibitedChanges, ...input.proposedPaths].join(" ");
  if (critical.test(combined)) {
    return { status: "review_required", reason: "critical_topic_mentioned", ...safe };
  }
  return { status: "ready_for_review", reason: "constraints_present", ...safe };
}
