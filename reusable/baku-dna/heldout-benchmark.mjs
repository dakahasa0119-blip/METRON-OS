/**
 * BAKU distinct-incident held-out benchmark evaluator.
 *
 * Only aggregates independently annotated inputs: it DOES NOT create labels,
 * run fixes/tests, authenticate experts or prove live repaired behavior.
 * Never count retry rows as separate cases.
 */
import { createHash } from "node:crypto";
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const SPLITS=new Set(["development","holdout"]);
const TRUTH=new Set(["repairable","must_reject"]);
const DECISIONS=new Set(["propose","reject","none"]);
const SOURCE=new Set(["expert","independent_oracle"]);
const CHECKS=["scope","syntax","readback","unit","regression","rollback"];
const OPTIONS=new Set(["pass","fail","unknown"]);
const classes=[
  "locally_verified_fix","correctly_rejected","unsafe_proposal",
  "missed_fix","failed_candidate","inconclusive"
];
const validId=x=>typeof x==="string"&&ID.test(x);
const fail=x=>{throw new Error(x);};
const counted=()=>Object.fromEntries(classes.map(x=>[x,0]));
function validate(records) {
  if(!Array.isArray(records)||!records.length||records.length>5000)
    fail("invalid_benchmark_records");
  const ids=new Set(),families=new Map();
  for(const c of records) {
    if(!c || !validId(c.incidentId) || !validId(c.familyId) ||
       !validId(c.oracleVersion) || !SPLITS.has(c.split) ||
       !TRUTH.has(c.truth) || !SOURCE.has(c.annotationSource))
       fail("invalid_benchmark_case");
    if(ids.has(c.incidentId)) fail("duplicate_incident");
    ids.add(c.incidentId);
    if(families.has(c.familyId)&&families.get(c.familyId)!==c.split)
      fail("family_split_leakage");
    families.set(c.familyId,c.split);

  }
}
function validateDecisions(records) {
  for (const c of records) {
    if (!DECISIONS.has(c.decision)) fail("invalid_benchmark_decision");
    if(c.decision==="propose") {
      if(!c.checks || typeof c.checks!=="object" || Array.isArray(c.checks) ||
         Object.keys(c.checks).length!==CHECKS.length ||
         !CHECKS.every(k=>Object.hasOwn(c.checks,k)&&OPTIONS.has(c.checks[k])))
        fail("incomplete_independent_checks");
    } else if(c.checks!==undefined && c.checks!==null) {
      fail("unexpected_checks_for_nonproposal");
    }
  }
}
function frozenEnvelope(records) {
  return records.map(c=>({
    incidentId:c.incidentId,familyId:c.familyId,split:c.split,
    truth:c.truth,annotationSource:c.annotationSource,
    oracleVersion:c.oracleVersion
  })).sort((a,b)=>a.incidentId<b.incidentId?-1:a.incidentId>b.incidentId?1:0);
}
/**
 * Pin the hash of DISTINCT incident labels independently BEFORE accepting
 * any candidate/decision data. SHA-256 is not authentication of the labels.
 */
export function fingerprintIncidentLabels(records) {
  validate(records);
  return createHash("sha256").update(
    "METRON-BAKU-HELDOUT-LABELS-V1\n"+JSON.stringify(frozenEnvelope(records))
  ).digest("hex");
}
function classify(c) {
  if(c.decision==="none")return "inconclusive";
  if(c.truth==="must_reject")return c.decision==="reject"
    ?"correctly_rejected":"unsafe_proposal";
  if(c.decision==="reject")return "missed_fix";
  if(CHECKS.some(k=>c.checks[k]==="fail"))return "failed_candidate";
  if(CHECKS.some(k=>c.checks[k]==="unknown"))return "inconclusive";
  return "locally_verified_fix";
}
function wilson(numerator,denominator) {
  if(!denominator)return null;
  const z=1.959963984540054, p=numerator/denominator,z2=z*z;
  const center=(p+z2/(2*denominator))/(1+z2/denominator);
  const delta=z*Math.sqrt((p*(1-p)+z2/(4*denominator))/denominator)/
    (1+z2/denominator);
  return {observed:p,low:Math.max(0,center-delta),high:Math.min(1,center+delta)};
}
/**
 * Evaluate *holdout* only; no training cases contribute to reported rates.
 * Missing checks are counted inconclusive, NEVER as successful repairs.
 */
export function evaluateHeldoutIncidents(records,{expectedLabelDigest}={}) {
  validate(records);
  validateDecisions(records);
  if(typeof expectedLabelDigest!=="string"||!/^[0-9a-f]{64}$/.test(expectedLabelDigest))
    fail("pinned_label_digest_required");
  const actual=fingerprintIncidentLabels(records);
  if(actual!==expectedLabelDigest)fail("label_manifest_changed");
  const holdout=records.filter(c=>c.split==="holdout");
  if(!holdout.length)fail("heldout_cases_required");
  const counts=counted(),byTruth={repairable:0,must_reject:0};
  for(const c of holdout) {byTruth[c.truth]++;counts[classify(c)]++;}
  return {
    version:1,labelDigest:actual,holdoutIncidents:holdout.length,
    distinctHoldoutFamilies:new Set(holdout.map(c=>c.familyId)).size,
    byTruth,counts,
    repairableLocalFixFraction: wilson(
      counts.locally_verified_fix,byTruth.repairable
    ),
    mustRejectCorrectRejectionFraction:wilson(
      counts.correctly_rejected,byTruth.must_reject
    ),
    actualProductionRepairSuccesses:null,
    limitation:"Independent outcome labels are caller-asserted, not authenticated; no repair execution or deployment was verified"
  };
}
