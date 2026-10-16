import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,unlinkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createRumor,verifyRumor,validateRepairEvidence} from "../../mini/rumor-protocol.mjs";
import {MetronMiniRuntime} from "../../mini/runtime.mjs";
import {CivilizationExperienceV3} from "../../mini/civilization-v3.mjs";

const v1="village-1",v2="village-2",hash="a".repeat(64);
const evidence=(extra={})=>({schemaVersion:1,scope:"first_party_disposable_two_file_fixture_only",
  diagnosis:"Discount was applied after multiplication",applicability:"The reviewed fixture arithmetic only",
  limitations:"Sender claim; not independently validated by the receiving village",
  candidateCommit:null,candidateDigest:hash,diffSha256:null,verificationDigest:"b".repeat(64),
  modelProvenance:"labelled_protocol_fixture",checks:[
    {id:"baseline",outcome:"expected_failure",outputSha256:"c".repeat(64)},
    {id:"regression",outcome:"passed",outputSha256:"d".repeat(64)}],productionApplied:false,...extra});
const prepared=(extra={})=>createRumor({originVillage:v1,body:"Reviewed repair knowledge; application still requires review",
  repairEvidence:evidence(),...extra});
function isolated(fn){
  const root=mkdtempSync(join(tmpdir(),"metron-repair-rumor-"));
  try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}
}
const setup=root=>new CivilizationExperienceV3(root,new MetronMiniRuntime(root));
const rumorPath=(root,id)=>join(root,"village-square","rumors",id+".json");
const ledgerPath=(root,id)=>join(root,id+"-knowledge.json");
const stable=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==="object"&&!Array.isArray(entry)?
  Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
// Construct a changed, internally checksum-valid sender claim. A received
// checkpoint must reject replacement even when its new checksum is valid.
function reseal(rumor){
  const fields=[rumor.schemaVersion,rumor.id,rumor.originVillage,rumor.originCore,
    rumor.kind,rumor.body,rumor.createdAt,rumor.parentRumorId];
  return {...rumor,sha256:createHash("sha256").update("METRON_RUMOR_V2\n"+
    JSON.stringify(fields)+"\n"+stable(rumor.repairEvidence)).digest("hex")};
}

test("V1 golden bytes and nine-field creation remain compatible",()=>{
  const golden='{"schemaVersion":"metron-rumor-v1","id":"r_legacy","originVillage":"village-1","originCore":"A","kind":"KNOWLEDGE","body":"Legacy public knowledge","createdAt":123,"parentRumorId":null,"sha256":"b4416f715394b0e5bc6006d8f2ebe9effad6c81d99116c3e64ff3d92ed020bf8"}';
  assert.equal(JSON.stringify(verifyRumor(JSON.parse(golden))),golden);
  const rumor=createRumor({originVillage:v1,body:"  Legacy public knowledge  ",createdAt:123,parentRumorId:"r_parent"});
  assert.equal(rumor.schemaVersion,"metron-rumor-v1");assert.equal(Object.keys(rumor).length,9);
  assert.equal(rumor.parentRumorId,"r_parent");assert.equal(rumor.body,"Legacy public knowledge");
  assert.deepEqual(verifyRumor(rumor),rumor);
  assert.throws(()=>verifyRumor({...JSON.parse(golden),repairEvidence:evidence()}));
});

test("V2 binds canonical structured evidence, accepts reordered keys and refuses tampering",()=>{
  const input=evidence(),rumor=prepared({repairEvidence:input,parentRumorId:"r_parent"});
  assert.equal(rumor.schemaVersion,"metron-rumor-v2");assert.equal(Object.keys(rumor).length,10);
  input.checks[0].outcome="passed";assert.equal(rumor.repairEvidence.checks[0].outcome,"expected_failure");
  const reordered=structuredClone(rumor);
  reordered.repairEvidence=Object.fromEntries(Object.entries(reordered.repairEvidence).reverse());
  reordered.repairEvidence.checks=reordered.repairEvidence.checks.map(check=>Object.fromEntries(Object.entries(check).reverse()));
  assert.deepEqual(verifyRumor(reordered),reordered);
  for(const change of [r=>{r.body="Different summary";},r=>{r.parentRumorId="r_other";},
    r=>{r.repairEvidence.diagnosis="Changed sender diagnosis";},
    r=>{r.repairEvidence.checks[0].outputSha256="e".repeat(64);},
    r=>{r.repairEvidence.candidateDigest="f".repeat(64);},
    r=>{r.extra=true;},r=>{delete r.repairEvidence;}]){
    const changed=structuredClone(rumor);change(changed);assert.throws(()=>verifyRumor(changed));
  }
  const result=verifyRumor(rumor);result.repairEvidence.diagnosis="Caller mutation";
  assert.notEqual(result.repairEvidence.diagnosis,rumor.repairEvidence.diagnosis);
});

test("repair evidence has an exact bounded public schema and returns a detached clone",()=>{
  const valid=evidence();const cloned=validateRepairEvidence(valid);cloned.checks[0].id="changed";
  assert.equal(valid.checks[0].id,"baseline");
  assert.ok(validateRepairEvidence(evidence({scope:"human_reviewed_external_worker",candidateCommit:"1".repeat(40),candidateDigest:null,diffSha256:hash})));
  const invalid=[null,[],{...valid,unknown:true},{...valid,schemaVersion:2},{...valid,scope:"verified_everywhere"},
    {...valid,diagnosis:" "},{...valid,diagnosis:" leading"},{...valid,applicability:"x".repeat(501)},
    {...valid,limitations:"trailing "},{...valid,candidateCommit:"1".repeat(39)},
    {...valid,candidateCommit:null,candidateDigest:null},{...valid,candidateDigest:"A".repeat(64)},
    {...valid,diffSha256:"bad"},{...valid,verificationDigest:null},{...valid,modelProvenance:""},
    {...valid,modelProvenance:"x".repeat(121)},{...valid,checks:[]},{...valid,checks:Array(1)},
    {...valid,checks:Array.from({length:9},()=>valid.checks[0])},{...valid,productionApplied:true}];
  for(const field of ["logs","paths","workId","runId","sourceMessageId"])invalid.push({...valid,[field]:"forbidden"});
  for(const check of [{...valid.checks[0],id:"Bad-ID"},{...valid.checks[0],id:"x".repeat(65)},
    {...valid.checks[0],outcome:"claimed_success"},{...valid.checks[0],outputSha256:"bad"},
    {...valid.checks[0],log:"raw output"}])invalid.push({...valid,checks:[check]});
  const missing=structuredClone(valid);delete missing.diffSha256;invalid.push(missing);
  for(const value of invalid)assert.throws(()=>validateRepairEvidence(value),{code:"invalid_repair_evidence"});
});

test("prepared publication preserves original bytes and has one Gateway job pair and event across retries",()=>isolated(root=>{
  let world=setup(root);const rumor=prepared();
  assert.equal(world.publishPreparedRumor(rumor).duplicate,false);
  const path=rumorPath(root,rumor.id),bytes=readFileSync(path,"utf8");
  assert.equal(bytes,JSON.stringify(rumor));
  const jobs=world.runtimes[v1].state().gateway.jobs;assert.equal(jobs,2);
  assert.equal(world.publishPreparedRumor(rumor).duplicate,true);
  world=setup(root);assert.equal(world.publishPreparedRumor(rumor).duplicate,true);
  assert.equal(readFileSync(path,"utf8"),bytes);assert.equal(world.runtimes[v1].state().gateway.jobs,jobs);
  assert.equal(world.villages[v1].events.filter(event=>event.kind==="rumor_published").length,1);
  assert.equal(world.villages[v1].published.length,1);
  world.villages[v1].events=[];world.publishPreparedRumor(rumor);
  assert.equal(world.villages[v1].events.length,0,"truncated events do not create another publication event");
  const changed=reseal({...rumor,body:"Conflicting valid summary"});
  assert.throws(()=>world.publishPreparedRumor(changed),{code:"rumor_id_conflict"});
  assert.equal(readFileSync(path,"utf8"),bytes);assert.equal(world.runtimes[v1].state().gateway.jobs,jobs);
}));

test("a shared-write interruption resumes with the same file, Gateway job and one publication event",()=>isolated(root=>{
  let world=setup(root);const rumor=prepared(),publish=world.square.publish.bind(world.square);
  world.square.publish=value=>{publish(value);throw new Error("Injected after shared-file write");};
  assert.throws(()=>world.publishPreparedRumor(rumor),/Injected/);
  const bytes=readFileSync(rumorPath(root,rumor.id),"utf8");
  assert.equal(world.villages[v1].published.length,0);world=setup(root);
  assert.equal(world.publishPreparedRumor(rumor).duplicate,true);
  assert.equal(world.runtimes[v1].state().gateway.jobs,2);
  assert.equal(readFileSync(rumorPath(root,rumor.id),"utf8"),bytes);
  assert.equal(world.villages[v1].published.length,1);
  assert.equal(world.villages[v1].events.filter(event=>event.kind==="rumor_published").length,1);
}));

test("publication capacity and an existing conflicting file are rejected before Gateway or shared writes",()=>isolated(root=>{
  const world=setup(root),rumor=prepared();
  world.villages[v1].published=Array.from({length:120},(_,index)=>({rumorId:"r_full_"+index,rumorSha256:hash}));
  assert.throws(()=>world.publishPreparedRumor(rumor),{code:"publication_limit_reached"});
  assert.equal(existsSync(rumorPath(root,rumor.id)),false);assert.equal(world.runtimes[v1].state().gateway.jobs,0);
  world.villages[v1].published=[];
  const changed=reseal({...rumor,body:"Existing different sender content"});world.square.publish(changed);
  assert.throws(()=>world.publishPreparedRumor(rumor),{code:"rumor_id_conflict"});
  assert.equal(world.runtimes[v1].state().gateway.jobs,0);assert.deepEqual(world.square.read(rumor.id),changed);
}));

test("V2 receipt remains pending until human review; quarantine/adoption retain evidence across restart",()=>isolated(root=>{
  let world=setup(root);const quarantined=prepared(),adopted=prepared({body:"Another reviewed repair summary"});
  world.publishPreparedRumor(quarantined);world.publishPreparedRumor(adopted);
  assert.equal(world.villages[v2].incoming.length,0);assert.equal(world.villages[v2].knowledge.length,1);
  const received=world.receive({villageId:v2,rumorId:quarantined.id});
  assert.equal(received.receipt.status,"pending");assert.equal(received.receipt.rumorSha256,quarantined.sha256);
  assert.deepEqual(received.receipt.repairEvidence,quarantined.repairEvidence);
  received.receipt.repairEvidence.diagnosis="Caller mutation";
  assert.notEqual(world.villages[v2].incoming[0].repairEvidence.diagnosis,"Caller mutation");
  world.review({villageId:v2,rumorId:quarantined.id,decision:"quarantine"});
  assert.equal(world.villages[v2].knowledge.length,1);
  world.receive({villageId:v2,rumorId:adopted.id});world=setup(root);
  world.review({villageId:v2,rumorId:adopted.id,decision:"adopt"});world=setup(root);
  const knowledge=world.state().villages[v2].knowledge.at(-1);
  assert.equal(knowledge.parentRumorId,adopted.id);assert.equal(knowledge.sourceVillage,v1);
  assert.equal(knowledge.rumorSha256,adopted.sha256);assert.deepEqual(knowledge.repairEvidence,adopted.repairEvidence);
  assert.equal(world.receive({villageId:v2,rumorId:adopted.id}).deduplicated,true);
  assert.equal(world.villages[v2].knowledge.length,2);
  assert.equal(world.villages[v2].incoming[0].status,"quarantined");
  const derived=world.publish({from:v2,text:"Human-written derived knowledge",parentRumorId:adopted.id}).rumor;
  assert.equal(derived.schemaVersion,"metron-rumor-v1");assert.equal(derived.parentRumorId,adopted.id);
}));

test("the shared-folder capacity across villages refuses a new publication without side effects",()=>isolated(root=>{
  const world=setup(root),rumor=prepared();
  for(let index=0;index<120;index++)world.square.publish(createRumor({originVillage:v2,
    body:"Existing public knowledge "+index}));
  assert.throws(()=>world.publishPreparedRumor(rumor),{code:"square_limit_reached"});
  assert.equal(existsSync(rumorPath(root,rumor.id)),false);
  assert.equal(world.runtimes[v1].state().gateway.jobs,0);assert.equal(world.villages[v1].published.length,0);
}));

test("a checksum-valid file replacement after receipt cannot be duplicated or adopted after restart",()=>isolated(root=>{
  let world=setup(root);const rumor=prepared();world.publishPreparedRumor(rumor);
  world.receive({villageId:v2,rumorId:rumor.id});
  const changed=reseal({...rumor,body:"Replaced but checksum-valid summary"});
  assert.deepEqual(verifyRumor(changed),changed);writeFileSync(rumorPath(root,rumor.id),JSON.stringify(changed));
  world=setup(root);
  assert.throws(()=>world.receive({villageId:v2,rumorId:rumor.id}),{code:"rumor_provenance_changed"});
  assert.throws(()=>world.review({villageId:v2,rumorId:rumor.id,decision:"adopt"}),{code:"rumor_provenance_changed"});
  assert.equal(world.villages[v2].knowledge.length,1);
}));

test("restart does not require public files, but missing files and altered receipt/knowledge fail closed on use",()=>isolated(root=>{
  let world=setup(root);const rumor=prepared();world.publishPreparedRumor(rumor);
  world.receive({villageId:v2,rumorId:rumor.id});unlinkSync(rumorPath(root,rumor.id));
  assert.doesNotThrow(()=>{world=setup(root);});
  assert.throws(()=>world.review({villageId:v2,rumorId:rumor.id,decision:"adopt"}),{code:"rumor_not_found"});
  writeFileSync(rumorPath(root,rumor.id),JSON.stringify(rumor));
  const file=ledgerPath(root,v2),saved=JSON.parse(readFileSync(file,"utf8"));
  saved.incoming[0].repairEvidence.diagnosis="Changed saved claim";writeFileSync(file,JSON.stringify(saved));world=setup(root);
  assert.throws(()=>world.review({villageId:v2,rumorId:rumor.id,decision:"adopt"}),{code:"rumor_provenance_changed"});
  saved.incoming[0].repairEvidence=rumor.repairEvidence;writeFileSync(file,JSON.stringify(saved));world=setup(root);
  world.review({villageId:v2,rumorId:rumor.id,decision:"adopt"});
  const adopted=JSON.parse(readFileSync(file,"utf8"));adopted.knowledge.at(-1).repairEvidence.diagnosis="Changed adopted claim";
  writeFileSync(file,JSON.stringify(adopted));world=setup(root);
  assert.throws(()=>world.state(),{code:"rumor_provenance_changed"});
}));
