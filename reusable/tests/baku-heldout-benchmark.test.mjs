import test from "node:test";
import assert from "node:assert/strict";
import {
  fingerprintIncidentLabels,evaluateHeldoutIncidents
} from "../baku-dna/heldout-benchmark.mjs";

const pass={scope:"pass",syntax:"pass",readback:"pass",
  unit:"pass",regression:"pass",rollback:"pass"};
const c=(incidentId,familyId,split,truth,decision,checks)=>({
  incidentId,familyId,split,truth,decision,
  annotationSource:"independent_oracle",oracleVersion:"v1",
  ...(checks?{checks}: {})
});
const rows=()=>[
  c("dev01","family-dev","development","repairable","propose",pass),
  c("h01","family-1","holdout","repairable","propose",pass),
  c("h02","family-2","holdout","must_reject","reject"),
  c("h03","family-3","holdout","repairable","reject"),
  c("h04","family-4","holdout","must_reject","propose",pass),
  c("h05","family-5","holdout","repairable","propose",{...pass,regression:"fail"}),
  c("h06","family-6","holdout","repairable","propose",{...pass,readback:"unknown"})
];
test("distinct heldout incidents count each safety disposition once",()=>{
  const fixture=rows();
  const report=evaluateHeldoutIncidents(fixture,{
    expectedLabelDigest:fingerprintIncidentLabels(fixture)
  });
  assert.equal(report.holdoutIncidents,6);
  assert.equal(report.distinctHoldoutFamilies,6);
  assert.equal(report.counts.locally_verified_fix,1);
  assert.equal(report.counts.correctly_rejected,1);
  assert.equal(report.counts.missed_fix,1);
  assert.equal(report.counts.unsafe_proposal,1);
  assert.equal(report.counts.failed_candidate,1);
  assert.equal(report.counts.inconclusive,1);
  assert.equal(report.repairableLocalFixFraction.observed,0.25);
  assert.equal(report.actualProductionRepairSuccesses,null);
});
test("development performance never pollutes heldout fraction",()=>{
  const fixture=rows();
  fixture[0].checks={...pass,syntax:"fail"};
  const report=evaluateHeldoutIncidents(fixture,{
    expectedLabelDigest:fingerprintIncidentLabels(fixture)
  });
  assert.equal(report.holdoutIncidents,6);
  assert.equal(report.repairableLocalFixFraction.observed,0.25);
});
test("frozen labels cannot silently move incidents across splits",()=>{
  const fixture=rows(),frozen=fingerprintIncidentLabels(fixture);
  fixture[1].split="development";
  assert.throws(()=>evaluateHeldoutIncidents(fixture,{expectedLabelDigest:frozen}),
    /label_manifest_changed/);
});
test("retry rows or family leakage are not independent incidents",()=>{
  const fixture=rows();
  fixture.push({...fixture[1]});
  assert.throws(()=>fingerprintIncidentLabels(fixture),/duplicate_incident/);
  const other=rows();other[0].familyId="family-1";
  assert.throws(()=>fingerprintIncidentLabels(other),/family_split_leakage/);
});
test("missing independent evidence does not count a repair as success",()=>{
  const fixture=rows();
  fixture[1].checks={...pass,unit:"unknown"};
  const r=evaluateHeldoutIncidents(fixture,{
    expectedLabelDigest:fingerprintIncidentLabels(fixture)
  });
  assert.equal(r.counts.locally_verified_fix,0);
  assert.equal(r.counts.inconclusive,2);
  fixture[1].checks={...pass}; delete fixture[1].checks.rollback;
  assert.throws(()=>fingerprintIncidentLabels(fixture),/incomplete_independent_checks/);
});
test("same frozen dataset can evaluate competing predictions separately",()=>{
  const a=rows(),b=rows();
  const digest=fingerprintIncidentLabels(a);
  b[1].decision="reject";delete b[1].checks;
  const first=evaluateHeldoutIncidents(a,{expectedLabelDigest:digest});
  const second=evaluateHeldoutIncidents(b,{expectedLabelDigest:digest});
  assert.equal(first.labelDigest,second.labelDigest);
  assert.equal(first.counts.locally_verified_fix,1);
  assert.equal(second.counts.locally_verified_fix,0);
  assert.equal(second.counts.missed_fix,2);
});
test("reject improperly specified or missing pinned benchmark",()=>{
  assert.throws(()=>evaluateHeldoutIncidents(rows()),/pinned_label_digest_required/);
  const a=rows();a[0].annotationSource="self";
  assert.throws(()=>fingerprintIncidentLabels(a),/invalid_benchmark_case/);
  const b=rows();b.forEach(x=>x.split="development");
  assert.throws(()=>evaluateHeldoutIncidents(b,{expectedLabelDigest:fingerprintIncidentLabels(b)}),
    /heldout_cases_required/);
});
