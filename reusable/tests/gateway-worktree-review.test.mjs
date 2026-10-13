import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTextWorktree } from "../gateway-jobs/worktree-reader.mjs";
import { snapshotDigest } from "../gateway-jobs/snapshot-diff.mjs";
import { reviewRepairWorktrees, verifyWorktreeReadback } from "../gateway-jobs/worktree-review.mjs";

function withRoots(fn) {
  const dir=mkdtempSync(join(tmpdir(),"metron-review-"));
  const base=join(dir,"baseline"),candidate=join(dir,"candidate");
  mkdirSync(base);mkdirSync(candidate);
  try{return fn({base,candidate});}
  finally{rmSync(dir,{recursive:true,force:true});}
}
const scope=()=>({
  symptom:"button click error",
  expectedFix:"change handler implementation",
  preserveContracts:["same exports"],
  prohibitedChanges:["no remote calls"],
  protectedPaths:["src/security/**"],
  proposedPaths:["src/button.js"]
});
const pin=root=>snapshotDigest(readTextWorktree(root).files);
function seed(base,candidate){
  mkdirSync(join(base,"src"));mkdirSync(join(candidate,"src"));
  writeFileSync(join(base,"src","button.js"),"export const enabled=false;");
  writeFileSync(join(candidate,"src","button.js"),"export const enabled=true;");
  mkdirSync(join(base,"src","security"));mkdirSync(join(candidate,"src","security"));
  writeFileSync(join(base,"src","security","core.js"),"doNotTouch");
  writeFileSync(join(candidate,"src","security","core.js"),"doNotTouch");
}
test("isolated on-disk snapshots agree then independent readback agrees",()=>withRoots(({base,candidate})=>{
  seed(base,candidate);
  const reviewed=reviewRepairWorktrees({
    baselineRoot:base,candidateRoot:candidate,expectedBaseDigest:pin(base),scope:scope()
  });
  assert.equal(reviewed.status,"review_required");
  assert.equal(reviewed.inventorySource,"read_only_filesystem_inventory");
  assert.equal(reviewed.canApply,false);
  assert.equal(reviewed.changes.length,1);
  const check=verifyWorktreeReadback({
    root:candidate,expectedCandidateDigest:reviewed.candidateDigest
  });
  assert.equal(check.status,"matched");
  assert.equal(check.canApply,false);
  writeFileSync(join(candidate,"src","button.js"),"silently-changed-later");
  assert.equal(verifyWorktreeReadback({
    root:candidate,expectedCandidateDigest:reviewed.candidateDigest
  }).reason,"readback_digest_mismatch");
}));

test("hidden unlisted file in the candidate blocks full-tree change scope",()=>withRoots(({base,candidate})=>{
  seed(base,candidate);
  writeFileSync(join(candidate,"src","side-effect.js"),"unexpected");
  const reviewed=reviewRepairWorktrees({
    baselineRoot:base,candidateRoot:candidate,expectedBaseDigest:pin(base),scope:scope()
  });
  assert.equal(reviewed.reason,"undeclared_file_changed");
  assert.equal(reviewed.canApply,false);
}));

test("protected modification and false baseline pin cannot be accepted",()=>withRoots(({base,candidate})=>{
  seed(base,candidate);
  const wrong=reviewRepairWorktrees({
    baselineRoot:base,candidateRoot:candidate,
    expectedBaseDigest:"0".repeat(64),scope:scope()
  });
  assert.equal(wrong.reason,"base_digest_mismatch");
  writeFileSync(join(candidate,"src","security","core.js"),"tampered");
  const actual=reviewRepairWorktrees({
    baselineRoot:base,candidateRoot:candidate,expectedBaseDigest:pin(base),scope:scope()
  });
  assert.equal(actual.reason,"undeclared_file_changed");
}));

test("same-root and missing snapshots fail closed",()=>withRoots(({base,candidate})=>{
  seed(base,candidate);
  assert.equal(reviewRepairWorktrees({
    baselineRoot:base,candidateRoot:base,expectedBaseDigest:pin(base),scope:scope()
  }).reason,"roots_must_differ");
  assert.equal(verifyWorktreeReadback({root:candidate,
    expectedCandidateDigest:"not-a-sha"}).reason,"candidate_digest_required");
  assert.equal(verifyWorktreeReadback({root:join(base,"nonexistent"),
    expectedCandidateDigest:"0".repeat(64)}).reason,"readback_inventory_failed");
}));
