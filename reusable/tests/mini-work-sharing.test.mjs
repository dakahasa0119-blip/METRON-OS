// Actual local HTTP, Gateway, files and Node test children. The repair reasoner
// below is labelled injected data, never evidence of a live AI or ARC login.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createMiniServer} from "../../mini/server.mjs";
import {createRumor,verifyRumor} from "../../mini/rumor-protocol.mjs";

const headers={"Content-Type":"application/json","X-Metron-Mini":"1"};
const summary={diagnosis:"Invoice calculation omitted quantity multiplication.",
  applicability:"Only the disposable first-party invoice fixture was checked.",
  limitations:"Injected test reasoner; no live AI, production application or general repair evidence."};
const proposal=JSON.stringify({diagnosis:"Correct both first-party fixture calculations",changes:[
  {path:"src/pricing.mjs",content:"export function unitPrice(base, discount) { return base - discount; }\n"},
  {path:"src/invoice.mjs",content:'import { unitPrice } from "./pricing.mjs";\nexport function invoiceTotal(base, discount, quantity) { return unitPrice(base, discount) * quantity; }\n'}]});
async function post(app,path,body){
  const r=await fetch(app.url+path,{method:"POST",headers,body:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
}
const action=(app,body)=>post(app,"/api/work/action",body);
async function setup(root){
  let calls=0;
  const options={root,port:0,workOptions:{runnerOptions:{env:{},askModel:async()=>{calls++;return proposal;}}}};
  const app=await createMiniServer(options);
  return {app,options,calls:()=>calls};
}
async function repaired(app,label){
  const source=app.runtime.submit({from:"A",to:"B",message:"PRIVATE synthetic answer "+label,code:""});
  let r=await action(app,{action:"create",villageId:"village-1",sourceMessageId:source.messageId,
    goal:"PRIVATE synthetic work goal "+label,knowledgeIds:[]});
  assert.equal(r.status,200);let w=r.data.work;
  r=await post(app,"/api/agent/run",{villageId:w.villageId,workId:w.id,provider:"ollama",allowExternalCalls:false});
  assert.equal(r.status,200,JSON.stringify(r.data));w=r.data.work;
  assert.equal(w.stage,"candidate_verified");
  assert.equal(w.sharingCandidate.body.includes(w.id),false,"default prose must not insert private work IDs");
  assert.equal(w.sharingCandidate.body.includes(w.attempts.at(-1).diagnosis),false,"model diagnosis requires human selection");
  return w;
}
const prepare=(app,w,body="Reviewed fixture repair knowledge")=>action(app,{action:"prepare-share",
  villageId:w.villageId,workId:w.id,body,repairSummary:summary});
const publish=(app,w,extra={})=>action(app,{action:"publish-share",villageId:w.villageId,workId:w.id,
  reviewedRumorSha256:w.sharingCandidate.rumor.sha256,allowPublish:true,...extra});
const squarePath=(root,id)=>join(root,"village-square","rumors",id+".json");

test("reviewed work shares only bound summary/fingerprints and remains idempotent across restart",async()=>{
  const root=mkdtempSync(join(tmpdir(),"metron-work-share-"));
  const fixture=await setup(root);let {app}=fixture;
  try{
    let w=await repaired(app,"first");
    assert.equal((await publish(app,w)).status,400,"old private V1 draft is not a reviewed repair publication");
    const prepared=await prepare(app,w);assert.equal(prepared.status,200);w=prepared.data.work;
    const r=w.sharingCandidate.rumor;
    assert.equal(r.schemaVersion,"metron-rumor-v2");verifyRumor(r);
    assert.equal(r.repairEvidence.modelProvenance,"test_injected_not_real_ai");
    assert.equal(r.repairEvidence.candidateDigest,w.attempts.at(-1).candidateDigest);
    assert.equal(r.repairEvidence.checks[1].outputSha256,w.attempts.at(-1).holdoutEvidenceHash);
    assert.equal(r.repairEvidence.productionApplied,false);
    assert.equal((await action(app,{action:"prepare-share",villageId:w.villageId,workId:w.id,body:r.body,
      repairSummary:{...summary,candidateCommit:"0".repeat(40)}})).status,400,"caller cannot supply verification fields");
    const privateLedger=join(root,"work-ledger",w.id+".json"),savedLedger=readFileSync(privateLedger);
    const changed=structuredClone(w);
    changed.sharingCandidate.rumor=createRumor({originVillage:w.villageId,body:r.body,
      repairEvidence:{...r.repairEvidence,candidateDigest:"0".repeat(64)}});
    writeFileSync(privateLedger,JSON.stringify(changed));
    const changedState=await fetch(app.url+"/api/work/state?villageId="+w.villageId+"&workId="+w.id);
    assert.equal(changedState.status,400);assert.equal((await changedState.json()).error,"work_sharing_evidence_changed");
    writeFileSync(privateLedger,savedLedger);
    assert.equal(app.civilization.square.list().length,0,"prepare is a private save");
    for(const allowPublish of [false,"true",1])assert.equal((await publish(app,w,{allowPublish})).status,400);
    assert.equal((await publish(app,w,{reviewedRumorSha256:"0".repeat(64)})).status,400);
    assert.equal(app.civilization.square.list().length,0);
    const result=await publish(app,w);assert.equal(result.status,200,JSON.stringify(result.data));
    assert.equal(result.data.work.publication.status,"published");
    assert.equal(result.data.rumor.id,r.id);assert.deepEqual(result.data.rumor,r);
    const shared=readFileSync(squarePath(root,r.id),"utf8");
    for(const privateValue of ["PRIVATE",w.id,w.runId,w.sourceMessage.id,w.goal,w.sourceMessage.body,
      "publicEvidence","candidateFiles","invocationHistory"])
      assert.equal(shared.includes(privateValue),false,privateValue);
    const jobs=app.runtime.state().gateway.jobs;
    const duplicate=await publish(app,w);assert.equal(duplicate.status,200);assert.equal(duplicate.data.duplicate,true);
    assert.equal(app.runtime.state().gateway.jobs,jobs);
    assert.equal((await prepare(app,w,"Changed after publication")).status,400);
    assert.equal(app.civilization.villages["village-2"].incoming.length,0);
    await app.close();app=await createMiniServer(fixture.options);
    assert.equal(fixture.calls(),1,"restart never invokes a model");
    assert.equal(app.civilization.square.list().length,1);
    const again=await publish(app,w);assert.equal(again.status,200);assert.equal(again.data.duplicate,true);
    assert.equal(app.runtime.state().gateway.jobs,jobs);
    assert.equal(readdirSync(join(root,"village-square","rumors")).length,1);
    assert.equal(app.civilization.villages["village-1"].events.filter(e=>e.kind==="rumor_published").length,1);
    app.civilization.receive({villageId:"village-2",rumorId:r.id});
    // A missing shared file must report unavailable evidence without killing
    // the HTTP process; other local village routes must remain available.
    rmSync(squarePath(root,r.id));
    const unavailable=await fetch(app.url+"/api/civilization/state");
    assert.equal(unavailable.status,400);assert.equal((await unavailable.json()).error,"rumor_not_found");
    assert.equal((await fetch(app.url+"/api/health")).status,200);
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});

test("uncertain publication preserves exact intent; restart never publishes and explicit retry reuses the file",async()=>{
  const root=mkdtempSync(join(tmpdir(),"metron-share-intent-"));
  const fixture=await setup(root);let {app}=fixture;
  try{
    let w=await repaired(app,"uncertain");w=(await prepare(app,w)).data.work;
    const publishReal=app.civilization.publishPreparedRumor.bind(app.civilization);
    app.civilization.publishPreparedRumor=r=>{publishReal(r);throw Error("Simulated response loss after shared write");};
    const uncertain=await publish(app,w);assert.equal(uncertain.status,400);
    const ledger=join(root,"work-ledger",w.id+".json");
    assert.equal(JSON.parse(readFileSync(ledger,"utf8")).publication.status,"intent");
    const jobs=app.runtime.state().gateway.jobs;
    const bytes=readFileSync(squarePath(root,w.sharingCandidate.rumor.id),"utf8");
    await app.close();app=await createMiniServer(fixture.options);
    assert.equal(fixture.calls(),1);assert.equal(app.runtime.state().gateway.jobs,jobs);
    assert.equal(JSON.parse(readFileSync(ledger,"utf8")).publication.status,"intent");
    assert.equal((await prepare(app,w)).status,400,"uncertain payload cannot be edited");
    const retried=await publish(app,w);assert.equal(retried.status,200,JSON.stringify(retried.data));
    assert.equal(retried.data.work.publication.status,"published");assert.equal(retried.data.duplicate,true);
    assert.equal(app.runtime.state().gateway.jobs,jobs);
    assert.equal(readFileSync(squarePath(root,w.sharingCandidate.rumor.id),"utf8"),bytes);
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});

test("a prepared publication intent before any shared write waits for explicit restart continuation",async()=>{
  const root=mkdtempSync(join(tmpdir(),"metron-share-before-write-"));
  const fixture=await setup(root);let {app}=fixture;
  try{
    let w=await repaired(app,"before-write");w=(await prepare(app,w)).data.work;
    app.civilization.publishPreparedRumor=()=>{throw Error("Simulated stop before shared write");};
    assert.equal((await publish(app,w)).status,400);assert.equal(app.civilization.square.list().length,0);
    await app.close();app=await createMiniServer(fixture.options);
    assert.equal(fixture.calls(),1);assert.equal(app.civilization.square.list().length,0);
    assert.equal((await publish(app,w)).status,200);assert.equal(app.civilization.square.list().length,1);
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});

test("adopted repair provenance reaches the next village work; quarantine does not",async()=>{
  const root=mkdtempSync(join(tmpdir(),"metron-share-adopt-"));
  const fixture=await setup(root);let {app}=fixture;
  const civil=body=>post(app,"/api/civilization/action",body);
  try{
    let w=await repaired(app,"quarantine");w=(await prepare(app,w)).data.work;
    const quarantined=(await publish(app,w)).data.rumor;
    await civil({action:"receive",villageId:"village-2",rumorId:quarantined.id});
    await civil({action:"review",villageId:"village-2",rumorId:quarantined.id,decision:"quarantine"});
    assert.equal(app.civilization.villages["village-2"].knowledge.length,1);
    w=await repaired(app,"adopt");w=(await prepare(app,w,"Reviewed knowledge for explicit adoption")).data.work;
    const rumor=(await publish(app,w)).data.rumor;
    const received=await civil({action:"receive",villageId:"village-2",rumorId:rumor.id});
    assert.equal(received.data.receipt.status,"pending");
    assert.deepEqual(received.data.receipt.repairEvidence,rumor.repairEvidence);
    assert.equal(app.civilization.villages["village-2"].knowledge.length,1);
    assert.equal((await civil({action:"review",villageId:"village-2",rumorId:rumor.id,decision:"adopt"})).status,200);
    await app.close();app=await createMiniServer(fixture.options);
    assert.equal(fixture.calls(),2);
    const knowledgeId="knowledge_"+rumor.id;
    const source=app.civilization.runtimes["village-2"].submit({from:"A",to:"B",message:"Synthetic next-village task",code:""});
    const next=await action(app,{action:"create",villageId:"village-2",sourceMessageId:source.messageId,
      knowledgeIds:[knowledgeId],goal:"Inspect adopted repair applicability before reuse"});
    assert.equal(next.status,200,JSON.stringify(next.data));
    assert.deepEqual(next.data.work.incidentContext.knowledge[0].repairEvidence,rumor.repairEvidence);
    assert.equal(next.data.work.knowledge[0].rumorSha256,rumor.sha256);
    assert.equal(next.data.work.knowledge[0].sourceVillage,"village-1");
    assert.equal(next.data.work.knowledge[0].parentRumorId,rumor.id);
    const duplicate=await civil({action:"receive",villageId:"village-2",rumorId:rumor.id});
    assert.equal(duplicate.data.deduplicated,true);assert.equal(app.civilization.villages["village-2"].knowledge.length,2);
    const derived=await civil({action:"publish",from:"village-2",text:"Reviewed derived applicability note",parentRumorId:rumor.id});
    assert.equal(derived.status,200);assert.equal(derived.data.rumor.parentRumorId,rumor.id);
    assert.equal((await civil({action:"receive",villageId:"village-1",rumorId:derived.data.rumor.id})).status,200);
    // Dropping evidence from adopted knowledge must not silently weaken a work snapshot.
    const file=join(root,"village-2-knowledge.json");
    const checkpoint=JSON.parse(readFileSync(file,"utf8"));delete checkpoint.knowledge[1].repairEvidence;
    writeFileSync(file,JSON.stringify(checkpoint));
    await app.close();app=await createMiniServer(fixture.options);
    assert.equal((await action(app,{action:"create",villageId:"village-2",sourceMessageId:source.messageId,
      knowledgeIds:[knowledgeId],goal:"Must reject stripped verification provenance"})).status,400);
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});

test("shared candidate provenance follows the successful AI choice instead of the incident's first provider",async()=>{
  // Fake transport responses test attribution only. No provider is contacted.
  const root=mkdtempSync(join(tmpdir(),"metron-share-provider-"));
  const calls=[];
  const partial=JSON.parse(proposal);partial.changes=partial.changes.slice(0,1);
  const app=await createMiniServer({root,port:0,workOptions:{runnerOptions:{
    env:{METRON_LOCAL_MODEL:"mock-local",METRON_REPAIR_MODEL:"mock-remote",OPENAI_API_KEY:"not-a-credential"},
    fetcher:async url=>{
      calls.push(String(url));
      if(String(url)==="http://127.0.0.1:11434/api/generate")
        return new Response(JSON.stringify({response:JSON.stringify(partial)}));
      assert.equal(String(url),"https://api.openai.com/v1/responses");
      return new Response(JSON.stringify({output_text:proposal}));
    }}}});
  try{
    const source=app.runtime.submit({from:"A",to:"B",message:"Synthetic provider attribution incident",code:""});
    let w=(await action(app,{action:"create",villageId:"village-1",sourceMessageId:source.messageId,
      goal:"Fix fixture with an explicit provider change",knowledgeIds:[]})).data.work;
    const local=await post(app,"/api/agent/run",{villageId:w.villageId,workId:w.id,provider:"ollama",allowExternalCalls:false});
    assert.equal(local.status,200);assert.equal(local.data.work.stage,"unresolved");
    const switched=await post(app,"/api/agent/run",{villageId:w.villageId,workId:w.id,provider:"openai",allowExternalCalls:true});
    assert.equal(switched.status,200);w=switched.data.work;assert.equal(w.stage,"candidate_verified");
    assert.equal(w.result.modelProvenance,"ollama","original incident provenance remains historical context");
    assert.equal(w.attempts.at(-1).provider,"openai");
    const shared=await prepare(app,w);assert.equal(shared.status,200,JSON.stringify(shared.data));
    assert.equal(shared.data.candidate.rumor.repairEvidence.modelProvenance,"openai");
    assert.equal(calls.length,2);assert.equal(app.civilization.square.list().length,0);
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});

test("large selected repair summaries reject before saving work instead of losing provenance",async()=>{
  const root=mkdtempSync(join(tmpdir(),"metron-share-context-"));
  const fixture=await setup(root);const {app}=fixture;
  try{
    const w=await repaired(app,"context-budget"),prepared=(await prepare(app,w)).data.work;
    const evidence=prepared.sharingCandidate.rumor.repairEvidence,ids=[];
    for(let i=0;i<3;i++){
      const rumor=createRumor({originVillage:"village-1",body:"Large explicitly selected test evidence "+i,
        repairEvidence:{...evidence,diagnosis:"\u65e5".repeat(500),applicability:"\u65e5".repeat(500),limitations:"\u65e5".repeat(500)}});
      app.civilization.publishPreparedRumor(rumor);
      app.civilization.receive({villageId:"village-2",rumorId:rumor.id});
      app.civilization.review({villageId:"village-2",rumorId:rumor.id,decision:"adopt"});
      ids.push("knowledge_"+rumor.id);
    }
    const source=app.civilization.runtimes["village-2"].submit({from:"A",to:"B",message:"Synthetic bounded-context task",code:""});
    const rejected=await action(app,{action:"create",villageId:"village-2",sourceMessageId:source.messageId,
      knowledgeIds:ids,goal:"Must not truncate selected provenance"});
    assert.equal(rejected.status,400);assert.equal(rejected.data.error,"work_context_too_large_choose_fewer_knowledge");
    assert.equal(app.work.state({villageId:"village-2"}).works.length,0);
    const bounded=await action(app,{action:"create",villageId:"village-2",sourceMessageId:source.messageId,
      knowledgeIds:ids.slice(0,1),goal:"Use one complete evidence record"});
    assert.equal(bounded.status,200);assert.equal(bounded.data.work.knowledge[0].repairEvidence.diagnosis.length,500);
    assert.equal(fixture.calls(),1,"context selection does not invoke a model");
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
