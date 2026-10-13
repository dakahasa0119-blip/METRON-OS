import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PersistentReceiptVerifier } from "../gateway-jobs/persistent-receipts.mjs";
import { signCheckReceipt } from "../gateway-jobs/signed-receipts.mjs";

const NOW=1_800_000_000_000;
const hex=s=>s.repeat(64);
function setup() {
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const nonce=randomBytes(24).toString("base64url");
  const claims=["compile","unit","regression","smoke"].map(kind=>({
    version:1,keyId:"key-1",runnerId:"audit-runner",audience:"audit",
    nonce,candidateDigest:hex("b"),suiteDigest:hex("c"),kind,
    status:"passed",exitCode:0,passed:1,failed:0,
    issuedAtMs:NOW-1000,expiresAtMs:NOW+20000
  }));
  const receipts=claims.map(c=>signCheckReceipt(c,privateKey));
  const trust={
    publicKeys:new Map([["key-1",{runnerId:"audit-runner",publicKey}]]),
    expectedNonce:nonce,expectedAudience:"audit",
    expectedRunnerId:"audit-runner",
    expectedCandidateDigest:hex("b"),expectedSuiteDigest:hex("c"),
    nowMs:NOW
  };
  return {receipts,trust};
}
function tmp(fn) {
  const dir=mkdtempSync(join(tmpdir(),"metron-replay-ledger-"));
  try {return fn(join(dir,"ledger.json"));}
  finally {rmSync(dir,{recursive:true,force:true});}
}

test("verified replay nonce is checkpointed before successful return",()=>tmp(file=>{
  const {receipts,trust}=setup();
  const verifier=new PersistentReceiptVerifier(file);
  const outcome=verifier.verifyOnce(receipts,trust);
  assert.equal(outcome.status,"verified");
  assert.equal(outcome.durableReplayRecorded,true);
  assert.equal(outcome.approved,false);
  assert.equal(verifier.consumedCount,1);
  const parsed=JSON.parse(readFileSync(file,"utf8"));
  assert.equal(parsed.consumed.length,1);
}));

test("same bundle after process-style reconstruction is rejected",()=>tmp(file=>{
  const {receipts,trust}=setup();
  let verifier=new PersistentReceiptVerifier(file);
  assert.equal(verifier.verifyOnce(receipts,trust).status,"verified");
  verifier=new PersistentReceiptVerifier(file);
  assert.equal(verifier.consumedCount,1);
  assert.equal(verifier.verifyOnce(receipts,trust).reason,"replayed_challenge");
}));

test("invalid signature does not consume ledger",()=>tmp(file=>{
  const {receipts,trust}=setup();
  const verifier=new PersistentReceiptVerifier(file);
  const altered=structuredClone(receipts);
  altered[0].claims.passed=98;
  assert.equal(verifier.verifyOnce(altered,trust).reason,"invalid_signature");
  assert.equal(verifier.consumedCount,0);
  assert.equal(verifier.verifyOnce(receipts,trust).status,"verified");
}));

test("invalid JSON and duplicate replay records fail closed during restore",()=>tmp(file=>{
  writeFileSync(file,"not-json");
  assert.throws(()=>new PersistentReceiptVerifier(file),SyntaxError);
  const bad={schemaVersion:1,consumed:["audit:runner:abc","audit:runner:abc"]};
  writeFileSync(file,JSON.stringify(bad));
  assert.throws(()=>new PersistentReceiptVerifier(file),/invalid_replay_ledger_entry/);
}));

test("persistence failure is never reported as verified",()=>tmp(file=>{
  const {receipts,trust}=setup();
  const verifier=new PersistentReceiptVerifier(file);
  verifier.file=join(file,"cannot-create-under-file");
  const result=verifier.verifyOnce(receipts,trust);
  assert.equal(result.reason,"replay_ledger_persist_failed");
  assert.equal(verifier.consumedCount,0);
}));
