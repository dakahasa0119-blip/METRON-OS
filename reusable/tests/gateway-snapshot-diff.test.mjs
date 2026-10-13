import test from "node:test";
import assert from "node:assert/strict";
import { snapshotDigest, reviewRepairSnapshots } from "../gateway-jobs/snapshot-diff.mjs";

const scope = proposedPaths => ({
  symptom: "UI click fails", expectedFix: "Repair UI click callback",
  preserveContracts: ["keep state contract"], prohibitedChanges: ["no API calls"],
  protectedPaths: ["src/security/**", "src/config.js"], proposedPaths
});
const before = () => ({
  "src/ui.js": "export const a=1;\n",
  "src/security/access.js": "export const canAccess=false;\n"
});
const run = (b, a, proposedPaths = ["src/ui.js"], pin = snapshotDigest(b), extra = {}) =>
  reviewRepairSnapshots({ scope: scope(proposedPaths), beforeFiles: b,
    afterFiles: a, expectedBaseDigest: pin, ...extra });

test("exact change scope, hashes and content-free evidence agree", () => {
  const b = before(), a = { ...b, "src/ui.js": "export const a=2;\n" };
  const result = run(b, a);
  assert.equal(result.status, "review_required");
  assert.equal(result.reason, "file_scope_matched");
  assert.deepEqual(result.changes.map(x => [x.path,x.kind]), [["src/ui.js","modified"]]);
  assert.equal(result.baseDigest, snapshotDigest(b));
  assert.equal(result.candidateDigest, snapshotDigest(a));
  assert.equal(result.canApply, false);
  assert.equal(result.approved, false);
  assert.ok(!JSON.stringify(result).includes("export const"));
});

test("unexpected changed file fails closed even when declared file also changed", () => {
  const b = before(), a = { ...b, "src/ui.js": "changed", "src/extra.js": "surprise" };
  assert.equal(run(b,a).reason, "undeclared_file_changed");
  const t = { ...b, "src/ui.js": "changed", "src/security/access.js": "true" };
  assert.equal(run(b,t).reason, "undeclared_file_changed");
});

test("protected path declarations cannot be smuggled into approved scope", () => {
  const b=before(), a={ ...b, "src/security/access.js": "true" };
  assert.equal(run(b,a,["src/security/access.js"]).reason,
    "repair_preflight_protected_scope_overlap");
});

test("both additions and deletions are visible and need exact declarations", () => {
  const b=before(), a={ "src/ui.js": b["src/ui.js"], "src/new.js": "new" };
  const result=run(b,a,["src/security/access.js","src/new.js"]);
  assert.equal(result.status, "blocked"); // protected path deletion is prohibited
  const safeBefore={"src/ui.js":"before"};
  const safeAfter={"src/new.js":"new"};
  const ok=run(safeBefore,safeAfter,["src/ui.js","src/new.js"]);
  assert.equal(ok.status, "review_required");
  assert.deepEqual(ok.changes.map(x=>x.kind),["added","deleted"].sort());
});

test("stale pinned snapshot and no-op replacement cannot pass", () => {
  const b=before(), a={...b,"src/ui.js":"other"};
  assert.equal(run(b,a,["src/ui.js"],"0".repeat(64)).reason,"base_digest_mismatch");
  assert.equal(run(b,b).reason,"no_actual_changes");
  assert.equal(run(b,a,["src/ui.js","src/unused.js"]).reason,
    "declared_file_unchanged_or_missing");
  assert.equal(run(b,a,["src/ui.js"],undefined,{expectedBaseDigest:""}).reason,
    "trusted_base_digest_required");
});

test("case aliases, path tricks and collisions are rejected", () => {
  const b=before();
  for (const bad of ["../a.js","/tmp/a.js","C:\\temp\\a.js","x//a.js",
    "foo/./bar.js","CON.js","ok/.git/config","bad?.js","bad."]) {
    assert.throws(()=>snapshotDigest({[bad]:"a"}), /invalid_snapshot_path/);
  }
  const dup={"SRC/Ui.js":"a","src/ui.js":"b"};
  assert.throws(()=>snapshotDigest(dup), /duplicate_normalized_path/);
  assert.throws(()=>snapshotDigest({"x":"a","x/y.js":"b"}), /file_directory_collision/);
  assert.equal(run(b,{"src/ui.js":"a","SRC/UI.JS":"b"}).reason,
    "duplicate_normalized_path");
});

test("malformed unicode, oversized files and executable getters fail closed", () => {
  const evil=Object.defineProperty({}, "src/ui.js", {enumerable:true,
    get(){ throw Error("should never execute getter"); }});
  assert.equal(run(before(),evil).reason,"invalid_snapshot_entry");
  assert.throws(()=>snapshotDigest({"a.js":String.fromCharCode(0xd800)}),/invalid_unicode/);
  const huge={"a.js":"a".repeat(1048577)};
  assert.throws(()=>snapshotDigest(huge),/file_too_large/);
  assert.equal(run(before(),huge).reason,"file_too_large");
});

test("security keywords still require explicit manual review", () => {
  const b=before(),a={...b,"src/ui.js":"changed"};
  const result=run(b,a,undefined,undefined,{
    scope:{...scope(["src/ui.js"]),expectedFix:"Fix authorization token logic"}
  });
  assert.equal(result.reason,"critical_topic_manual_review");
  assert.equal(result.canApply,false);
});
