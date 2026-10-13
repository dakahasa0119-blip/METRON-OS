import test from "node:test";
import assert from "node:assert/strict";
import { assessRepairEvidence } from "../gateway-jobs/repair-evidence.mjs";
const base="a".repeat(64), candidate="b".repeat(64);
const fixture=()=>({
  review:{status:"review_required",reason:"file_scope_matched",
    canApply:false,approved:false,baseDigest:base,candidateDigest:candidate,
    changes:[{path:"src/ui.js",kind:"modified"}]},
  readback:{status:"matched",digest:candidate,canApply:false,approved:false},
  rollbackDigest:base,
  checks:["compile","unit","regression","smoke"].map(kind=>({
    kind, candidateDigest:candidate,status:"passed",exitCode:0,
    passed:1,failed:0,runnerLabel:"isolated-fixture"
  }))
});
test("correlated review, readback and four receipts still require human decision",()=>{
  const x=assessRepairEvidence(fixture());
  assert.equal(x.status,"review_required");
  assert.equal(x.reason,"evidence_consistent_not_authorized");
  assert.equal(x.checksRecorded,4);
  assert.equal(x.canApply,false);assert.equal(x.canDeploy,false);
  assert.equal(x.approved,false);
  assert.equal(x.evidenceLevel,"unsigned_caller_supplied_receipts");
});
test("readback from different candidate is rejected",()=>{
  const x=fixture();x.readback.digest="0".repeat(64);
  assert.equal(assessRepairEvidence(x).reason,"candidate_readback_not_verified");
});
test("rollback reference cannot be missing or refer to different baseline",()=>{
  const x=fixture();x.rollbackDigest="0".repeat(64);
  assert.equal(assessRepairEvidence(x).reason,"rollback_reference_mismatch");
  delete x.rollbackDigest;
  assert.equal(assessRepairEvidence(x).status,"blocked");
});
test("missing, duplicate, or unrecognized test categories fail closed",()=>{
  const x=fixture();x.checks.pop();
  assert.equal(assessRepairEvidence(x).reason,"required_checks_missing");
  const d=fixture();d.checks[3].kind="unit";
  assert.equal(assessRepairEvidence(d).reason,"unknown_or_repeated_check");
  const z=fixture();z.checks[3].kind="marketing";
  assert.equal(assessRepairEvidence(z).reason,"unknown_or_repeated_check");
});
test("wrong digest, failed tests and empty result counters are rejected",()=>{
  const x=fixture();x.checks[0].candidateDigest="0".repeat(64);
  assert.equal(assessRepairEvidence(x).reason,"check_candidate_mismatch");
  const y=fixture();y.checks[1].failed=1;
  assert.equal(assessRepairEvidence(y).reason,"check_not_proven_passed");
  const z=fixture();z.checks[2].passed=0;
  assert.equal(assessRepairEvidence(z).reason,"check_not_proven_passed");
});
test("hostile approval flags cannot create deploy authorization",()=>{
  const x=fixture();x.approved=true;x.canApply=true;x.checks[0].approved=true;
  const result=assessRepairEvidence(x);
  assert.equal(result.approved,false);
  assert.equal(result.canDeploy,false);
  assert.equal(JSON.stringify(result).includes("isolated-fixture"),false);
});
test("security-sensitive review remains flagged even with passing checks",()=>{
  const x=fixture();x.review.reason="critical_topic_manual_review";
  const r=assessRepairEvidence(x);
  assert.equal(r.reason,"critical_topic_manual_review");
  assert.equal(r.approved,false);
});
