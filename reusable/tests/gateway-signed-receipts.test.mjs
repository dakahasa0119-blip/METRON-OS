import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  signCheckReceipt, verifyCheckBundle, assessSignedRepairEvidence
} from "../gateway-jobs/signed-receipts.mjs";

const base = "a".repeat(64), candidate = "b".repeat(64), suite = "c".repeat(64);
const now = 1_800_000_000_000;
const nonce = () => randomBytes(24).toString("base64url");
const make = () => {
  const {publicKey,privateKey} = generateKeyPairSync("ed25519");
  const challenge=nonce();
  const claims = ["compile","unit","regression","smoke"].map(kind=>({
    version:1,keyId:"runner-key-1",runnerId:"isolated-test-runner",
    audience:"metron-review",nonce:challenge,
    candidateDigest:candidate,suiteDigest:suite,kind,status:"passed",
    exitCode:0,passed:2,failed:0,issuedAtMs:now-500,expiresAtMs:now+60000
  }));
  const keys=new Map([["runner-key-1",{publicKey,runnerId:"isolated-test-runner"}]]);
  const used=new Set();
  const trust=()=>({
    publicKeys:keys,consumedNonces:used,expectedNonce:challenge,
    expectedAudience:"metron-review",expectedCandidateDigest:candidate,
    expectedSuiteDigest:suite,expectedRunnerId:"isolated-test-runner",nowMs:now
  });
  const receipts=()=>claims.map(c=>signCheckReceipt(c,privateKey));
  const review={status:"review_required",reason:"file_scope_matched",
    baseDigest:base,candidateDigest:candidate,canApply:false,approved:false,
    changes:[{path:"src/fix.js",kind:"modified"}]};
  const readback={status:"matched",digest:candidate,canApply:false,approved:false};
  return {publicKey,privateKey,claims,receipts,keys,used,trust,review,readback,challenge};
};
test("four Ed25519 receipts bind candidate, audience, suite, nonce and runner",()=>{
  const f=make();
  const signed=f.receipts();
  const r=verifyCheckBundle(signed,f.trust());
  assert.equal(r.status,"verified");
  assert.equal(r.checks.length,4);
  assert.equal(r.evidenceLevel,"ed25519_receipt_signature_verified");
  assert.equal(r.approved,false);
  assert.equal(r.canApply,false);
  assert.equal(r.canDeploy,false);
  assert.equal(JSON.stringify(r).includes("BEGIN PRIVATE KEY"),false);
});
test("single-use challenge refuses replay",()=>{
  const f=make(),signed=f.receipts();
  assert.equal(verifyCheckBundle(signed,f.trust()).status,"verified");
  assert.equal(verifyCheckBundle(signed,f.trust()).reason,"replayed_challenge");
});
test("tampering signed claims and signature are rejected",()=>{
  const f=make();
  const changed=f.receipts();changed[0].claims.passed=999;
  assert.equal(verifyCheckBundle(changed,f.trust()).reason,"invalid_signature");
  const sig=f.receipts();sig[2].signature="A".repeat(86);
  assert.equal(verifyCheckBundle(sig,f.trust()).reason,"invalid_signature");
});
test("expired, future, wrong audience, runner or candidate fail closed",()=>{
  const f=make();
  const signed=f.receipts();
  assert.equal(verifyCheckBundle(signed,{...f.trust(),nowMs:now+61000}).reason,"receipt_expired_or_not_yet_valid");
  assert.equal(verifyCheckBundle(signed,{...f.trust(),nowMs:now-10000}).reason,"receipt_expired_or_not_yet_valid");
  assert.equal(verifyCheckBundle(signed,{...f.trust(),expectedAudience:"other"}).reason,"receipt_scope_mismatch");
  assert.equal(verifyCheckBundle(signed,{...f.trust(),expectedCandidateDigest:"1".repeat(64)}).reason,"receipt_scope_mismatch");
  assert.equal(verifyCheckBundle(signed,{...f.trust(),expectedRunnerId:"other-runner"}).reason,"receipt_scope_mismatch");
  assert.equal(verifyCheckBundle(signed,{...f.trust(),expectedSuiteDigest:"2".repeat(64)}).reason,"receipt_scope_mismatch");
});
test("key substitution and duplicate check kind do not authenticate",()=>{
  const f=make(), signed=f.receipts();
  const impostor=generateKeyPairSync("ed25519").publicKey;
  const other=new Map([["runner-key-1",{publicKey:impostor,runnerId:"isolated-test-runner"}]]);
  assert.equal(verifyCheckBundle(signed,{...f.trust(),publicKeys:other}).reason,"invalid_signature");
  const duplicate=[signed[0],signed[0],signed[2],signed[3]];
  assert.equal(verifyCheckBundle(duplicate,f.trust()).reason,"duplicate_check_kind");
  assert.equal(f.used.size,0);
});
test("signed but failed checks are never marked passing",()=>{
  const f=make();
  const bad=f.claims.map((c,i)=>i===0?{...c,status:"failed",exitCode:1,passed:0,failed:1}:c);
  const signed=bad.map(c=>signCheckReceipt(c,f.privateKey));
  assert.equal(verifyCheckBundle(signed,f.trust()).reason,"reported_check_failure");
  assert.equal(f.used.size,0);
});
test("compound evidence still only requests review, not deployment",()=>{
  const f=make();
  const output=assessSignedRepairEvidence({
    review:f.review,readback:f.readback,rollbackDigest:base,
    receipts:f.receipts(),trust:f.trust()
  });
  assert.equal(output.status,"review_required");
  assert.equal(output.approved,false);
  assert.equal(output.canDeploy,false);
  assert.equal(output.evidenceLevel,"ed25519_signature_verified_not_runner_attested");
});
test("separate Node process can sign exact data; parent verifies with pinned public key",()=>{
  const f=make();
  const pem=f.privateKey.export({type:"pkcs8",format:"pem"});
  const moduleUri=new URL("../gateway-jobs/signed-receipts.mjs",import.meta.url).href;
  const script=[
    'import {readFileSync} from "node:fs";',
    'import {signCheckReceipt} from '+JSON.stringify(moduleUri)+';',
    'const data=JSON.parse(readFileSync(0,"utf8"));',
    'const packets=data.claims.map(c=>signCheckReceipt(c,data.testOnlyPrivatePem));',
    'process.stdout.write(JSON.stringify(packets));'
  ].join("\n");
  // TEST FIXTURE ONLY: private key flows to a local child over stdin.
  // A production runner must own/protect its key separately.
  const child=spawnSync(process.execPath,["--input-type=module","-e",script],{
    input:JSON.stringify({claims:f.claims,testOnlyPrivatePem:pem}),
    encoding:"utf8",timeout:12000
  });
  assert.equal(child.status,0,child.stderr);
  const signed=JSON.parse(child.stdout);
  assert.equal(verifyCheckBundle(signed,f.trust()).status,"verified");
});
test("unsigned receipt, invalid claim schema and absent replay store are rejected",()=>{
  const f=make();
  const signed=f.receipts();
  signed[0].claims.extra="injection";
  assert.equal(verifyCheckBundle(signed,f.trust()).reason,"invalid_signed_receipt");
  assert.throws(()=>signCheckReceipt({...f.claims[0],extra:true},f.privateKey),/invalid_receipt_claims/);
  assert.equal(verifyCheckBundle(f.receipts(),{...f.trust(),consumedNonces:null}).reason,"invalid_verifier_configuration");
});
