import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {ProjectPoUCLedger} from "../../mini/project-pouc.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
const stable=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==="object"&&!Array.isArray(entry)?
  Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
const digest=value=>sha(stable(value));
const subject=()=>({projectId:"delivery-v2",planDigest:sha("owner fixed plan"),candidateCommit:"a".repeat(40),diffSha256:sha("candidate diff")});
function result(kind,{duration="1.25",tests=3}={}){
  const output=`TAP version 13\n# tests ${tests}\n# pass ${tests}\n# duration_ms ${duration}\n`;
  const inputProof=sha(kind+" immutable source and fixed checks");
  return {passed:true,checks:[{id:kind,exitCode:0,timedOut:false,error:null,terminationConfirmed:true,
    outputSha256:sha(output),logFile:`private-${kind}.tap`,output,
    testSummary:{tests,pass:tests,fail:0,cancelled:0,skipped:0,todo:0}}],
  inputProofBefore:inputProof,inputProofAfter:inputProof,terminationUnconfirmed:false};
}
const run=options=>({public:result("public",options),acceptance:result("acceptance",options)});
const input=()=>({subject:subject(),original:run(),recomputed:run({duration:"2.50"})});
function fixture(fn){
  const root=mkdtempSync(join(tmpdir(),"metron-project-pouc-"));
  try{return fn({root,file:join(root,"project-pouc-ledger.json"),ledger:new ProjectPoUCLedger(root)});}
  finally{rmSync(root,{recursive:true,force:true});}
}
const reference=receipt=>({computationDigest:receipt.computationDigest,proofDigest:receipt.proofDigest});

test("registered fixed-check recomputation survives readback without preserving private output or paths",()=>fixture(({root,file,ledger})=>{
  const data=input(),record=ledger.record(data),receipt=record.receipt;
  assert.equal(record.deduplicated,false);
  assert.equal(receipt.workType,"registered_project_fixed_check_recomputation");
  assert.equal(receipt.productionRepairVerified,false);
  assert.equal(receipt.distributedTrust,false);
  assert.deepEqual(receipt.subject,data.subject);
  assert.equal(receipt.original.acceptance.checks[0].outputSha256,data.original.acceptance.checks[0].outputSha256);
  assert.equal(receipt.recomputed.acceptance.checks[0].outputSha256,data.recomputed.acceptance.checks[0].outputSha256);
  const stored=readFileSync(file,"utf8");
  for(const secret of ["private-public.tap","private-acceptance.tap","TAP version 13","duration_ms","logFile","inputProofBefore"])
    assert.equal(stored.includes(secret),false,secret);
  assert.deepEqual(new ProjectPoUCLedger(root).lookup(reference(receipt)),receipt);
  receipt.subject.projectId="caller-mutated";
  assert.equal(ledger.lookup(reference(receipt)).subject.projectId,data.subject.projectId);
  assert.throws(()=>ledger.lookup({...reference(receipt),proofDigest:"0".repeat(64)}),/project_pouc_receipt_not_found/);
}));

test("same fixed computation deduplicates despite timing/output changes, after validating the supplied checks",()=>fixture(({file,ledger})=>{
  const first=ledger.record(input()),next=input();
  next.original=run({duration:"5.55"});next.recomputed=run({duration:"9.99"});
  const second=ledger.record(next);
  assert.equal(second.deduplicated,true);
  assert.deepEqual(second.receipt,first.receipt);
  assert.equal(JSON.parse(readFileSync(file,"utf8")).entries.length,1);
  next.recomputed.acceptance.checks[0].terminationConfirmed=false;
  assert.throws(()=>ledger.record(next),/invalid_project_pouc_check_result/);
  assert.equal(JSON.parse(readFileSync(file,"utf8")).entries.length,1);
}));

test("different fixed input or successful test counts are rejected as mismatched recomputation",()=>fixture(({ledger,file})=>{
  for(const change of [
    data=>{data.recomputed.public.inputProofBefore=sha("different inputs");data.recomputed.public.inputProofAfter=data.recomputed.public.inputProofBefore;},
    data=>{data.recomputed.acceptance=result("acceptance",{tests:4});}
  ]){
    const data=input();change(data);
    assert.throws(()=>ledger.record(data),/project_pouc_recomputation_mismatch/);
  }
  assert.equal(JSON.parse(readFileSync(file,"utf8")).entries.length,0);
}));

test("incomplete, uncertain, skipped and fabricated successful check observations are rejected",()=>fixture(({ledger})=>{
  const invalid=[
    value=>{value.passed=false;},
    value=>{value.terminationUnconfirmed=true;},
    value=>{value.inputProofAfter=sha("changed during execution");},
    value=>{value.checks=[];},
    value=>{value.checks[0].exitCode=1;},
    value=>{value.checks[0].error="project_check_cancelled";},
    value=>{value.checks[0].timedOut=true;},
    value=>{value.checks[0].terminationConfirmed=false;},
    value=>{value.checks[0].testSummary.skipped=1;},
    value=>{value.checks[0].testSummary.cancelled=1;},
    value=>{value.checks[0].testSummary.todo=1;},
    value=>{value.checks[0].testSummary.tests=0;value.checks[0].testSummary.pass=0;},
    value=>{value.checks[0].testSummary.pass=2;},
    value=>{value.checks[0].outputSha256=sha("unrelated output");},
    value=>{value.checks[0].id="public";},
    value=>{value.uncertain=false;}
  ];
  for(const mutate of invalid){const data=input();mutate(data.recomputed.acceptance);
    assert.throws(()=>ledger.record(data),/invalid_project_pouc_check_result/);}
  const data=input();data.original.acceptance.checks[0].testSummary.fail=1;
  assert.throws(()=>ledger.record(data),/invalid_project_pouc_check_result/);
}));

test("subject and request identities accept only exact bounded registration fields",()=>fixture(({ledger})=>{
  for(const change of [
    value=>{value.subject.projectId="../other";},
    value=>{value.subject.projectId="_leading";},
    value=>{value.subject.candidateCommit="A".repeat(40);},
    value=>{value.subject.planDigest="0".repeat(63);},
    value=>{value.subject.workId="private-work";},
    value=>{delete value.subject.diffSha256;}
  ]){const data=input();change(data);assert.throws(()=>ledger.record(data),/invalid_project_pouc_subject/);}
  assert.throws(()=>ledger.record({...input(),villageId:"village-1"}),/invalid_project_pouc_record/);
  assert.throws(()=>ledger.lookup({computationDigest:sha("x"),proofDigest:sha("y"),sessionId:"private-session"}),/invalid_project_pouc_lookup/);
}));

test("every saved receipt is revalidated and tampering cannot be hidden by an already open ledger",()=>fixture(({root,file,ledger})=>{
  const {receipt}=ledger.record(input()),saved=JSON.parse(readFileSync(file,"utf8"));
  const cases=[
    value=>{value.entries[0].proofDigest="0".repeat(64);},
    value=>{value.entries[0].computationDigest="0".repeat(64);},
    value=>{value.entries[0].recomputed.public.checks[0].outputSha256=sha("modified output");},
    value=>{value.entries[0].subject.extra="unknown";},
    value=>{value.entries[0].original.acceptance.checks[0].logFile="private path";},
    value=>{value.extra=true;},
    value=>{value.entries.push(structuredClone(value.entries[0]));},
    value=>{value.entries=Array.from({length:1001},()=>structuredClone(value.entries[0]));},
    value=>{
      const row=value.entries[0];row.recomputed.public.inputProof=sha("different input");
      const {computationDigest,proofDigest,...body}=row;row.proofDigest=digest(body);
    }
  ];
  for(const change of cases){
    const tampered=structuredClone(saved);change(tampered);writeFileSync(file,JSON.stringify(tampered));
    assert.throws(()=>new ProjectPoUCLedger(root),/invalid_project_pouc_checkpoint/);
    assert.throws(()=>ledger.lookup(reference(receipt)),/invalid_project_pouc_checkpoint/);
    assert.throws(()=>ledger.record(input()),/invalid_project_pouc_checkpoint/);
  }
  writeFileSync(file,JSON.stringify(saved));
  assert.deepEqual(ledger.lookup(reference(receipt)),receipt);
}));

test("proof digest covers all retained observations while computation identity excludes outputs",()=>fixture(({ledger})=>{
  const first=ledger.record(input()).receipt;
  const {computationDigest,proofDigest,...body}=first;
  assert.equal(proofDigest,digest(body));
  const changed=input();changed.subject.candidateCommit="b".repeat(40);
  const second=ledger.record(changed).receipt;
  assert.notEqual(second.computationDigest,computationDigest);
  assert.notEqual(second.proofDigest,proofDigest);
}));
