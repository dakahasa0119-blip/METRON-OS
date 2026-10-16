/** Fake async transport ports exercise world ownership/ordering only.
 * These tests do not claim to launch a child or prove real IPC transport. */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {MetronMiniRuntime} from "../../mini/runtime.mjs";
import {CivilizationExperienceV3} from "../../mini/civilization-v3.mjs";
import {createRumor,verifyRumor} from "../../mini/rumor-protocol.mjs";

const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
const sha=value=>createHash("sha256").update(value).digest("hex"),digest=value=>sha(stable(value));
const copy=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function isolated(fn){
  const root=mkdtempSync(join(tmpdir(),"metron-dynamic-world-"));
  try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}
}
const setup=root=>new CivilizationExperienceV3(root,new MetronMiniRuntime(root));
const seed=(knowledge=[])=>({purpose:"Owned synthetic village",inheritedGoal:null,sourceMessage:null,
  knowledge,provenance:{sourceVillageId:"village-1",sourceWorkId:null}});
const selected=(extra={})=>({id:"origin_village-1",text:"Selected reference without transferred authority",
  sha256:sha("Selected reference without transferred authority"),sourceVillage:"village-1",
  parentRumorId:null,rumorSha256:null,adoptedIn:"village-1",...extra});
const repairEvidence=()=>({schemaVersion:1,scope:"registered_project_coding_agent",
  diagnosis:"A reviewed synthetic candidate corrected the public behavior",
  applicability:"The registered synthetic project and its reviewed requirements",
  limitations:"Sender evidence is not independent verification by this recipient",
  candidateCommit:"a".repeat(40),candidateDigest:null,diffSha256:"b".repeat(64),
  verificationDigest:"c".repeat(64),modelProvenance:"explicit_fake_test_candidate",
  checks:[{id:"public",outcome:"passed",outputSha256:"d".repeat(64)}],productionApplied:false});
function fakeAsyncPort(root,{beforeSubmit=async()=>{}}={}){
  const jobs=new Map(),messages={A:[],B:[]};
  const port={root,online:true,submissions:[],
    assertActive(){if(!this.online)throw Object.assign(Error("Fake port offline"),{code:"village_bootstrap_not_running"});},
    state(){return {ships:Object.fromEntries(["A","B"].map(ship=>[ship,{owner:ship,count:messages[ship].length,messages:copy(messages[ship])}])),
      gateway:{jobs:jobs.size,byState:{done:jobs.size},recent:[]}};},
    mailbox(ship){return {schemaVersion:1,owner:ship,messages:copy(messages[ship])};},
    gateway:{getJob:id=>copy(jobs.get(id)),queue:{snapshot:()=>({jobs:copy([...jobs.values()])})}},
    async submit(input){
      this.assertActive();this.submissions.push(copy(input));await beforeSubmit(input);this.assertActive();
      const existing=jobs.get(input.messageId);
      if(existing){
        assert.equal(stable(existing.input),stable(input),"fake fixture also enforces stable message payload");
        return {messageId:input.messageId,deduplicated:true,job:copy(existing),state:this.state()};
      }
      const envelope={id:input.messageId,sender:input.from,recipient:input.to,type:"OBSERVE",body:input.message,traceId:"trace_"+input.messageId};
      const job={id:input.messageId,state:"done",payload:{envelope},input:copy(input)};
      jobs.set(job.id,job);messages[input.to].push(envelope);
      return {messageId:job.id,deduplicated:false,job:copy(job),state:this.state()};
    }
  };
  Object.defineProperty(port,"available",{get(){return this.online;}});
  return port;
}
function descriptor(root,id,ownedSeed=seed(),options={}){
  const participation=join(root,id,"participation");
  return {id,name:"Owned "+id,root:participation,seed:ownedSeed,seedDigest:digest(ownedSeed),
    runtime:fakeAsyncPort(participation,options)};
}
const register=(world,root,id,ownedSeed=seed(),options={})=>{
  const member=descriptor(root,id,ownedSeed,options);world.registerVillage(member);return member;
};
const rumorFile=(root,id)=>join(root,"village-square","rumors",id+".json");

test("registry retains synchronous builtins and treats prototype-like names only as explicit members",()=>isolated(root=>{
  const world=setup(root);
  assert.equal(world.hasVillage("constructor"),false);assert.equal(world.hasVillage("__proto__"),false);
  assert.equal(world.isDynamic("village-1"),false);assert.equal(world.requireActive("village-1"),world.runtimes["village-1"]);
  const legacy=world.publish({from:"village-1",text:"Legacy publication stays synchronous"});
  assert.equal(legacy.then,undefined);assert.equal(world.receive({villageId:"village-2",rumorId:legacy.rumor.id}).then,undefined);
  const member=register(world,root,"constructor");
  assert.equal(world.hasVillage("constructor"),true);assert.equal(world.isDynamic("constructor"),true);
  assert.equal(Object.getPrototypeOf(world.villages),null);assert.equal(Object.getPrototypeOf(world.runtimes),null);
  assert.equal(world.state().villages.constructor.id,"constructor");
  assert.equal(member.runtime.submissions.length,0);
  assert.throws(()=>world.registerVillage({...member,id:"village-1"}),{code:"invalid_village_registration"});
}));

test("selected knowledge remains an exact namespaced inherited reference with no adoption or repair-verification claim",()=>isolated(root=>{
  const text="Selected public repair fingerprints only";
  const original=selected({id:"knowledge_r_source",text,sha256:sha(text),sourceVillage:"village-2",
    parentRumorId:"r_source",rumorSha256:"e".repeat(64),adoptedIn:"village-1",
    repairProvenance:{candidateCommit:"a".repeat(40),diffSha256:"b".repeat(64),verificationDigest:"c".repeat(64)}});
  const ownedSeed=seed([original]),world=setup(root),member=register(world,root,"village-new",ownedSeed);
  const knowledge=world.villages[member.id].knowledge[0],projection=world.inheritedKnowledge(member.id,knowledge.id);
  assert.equal(knowledge.id,"inherited_"+sha(original.id).slice(0,32));
  assert.deepEqual(knowledge,projection);assert.equal(projection.text,original.text);
  assert.equal(projection.textSha256,original.sha256);assert.equal(projection.adoptedIn,null);
  assert.equal(projection.inheritance.sourceKnowledgeId,original.id);assert.equal(projection.inheritance.sourceAdoptedIn,"village-1");
  assert.equal(projection.inheritance.seedDigest,member.seedDigest);assert.deepEqual(projection.repairProvenance,original.repairProvenance);
  assert.equal(Object.hasOwn(projection,"repairEvidence"),false);
  assert.equal(world.villages[member.id].incoming.length,0);
  assert.equal(world.state().villages[member.id].inheritance.purpose,ownedSeed.purpose);
  ownedSeed.knowledge[0].text="Caller mutation";projection.text="Caller projection mutation";
  assert.equal(world.inheritedKnowledge(member.id,knowledge.id).text,text);
  assert.throws(()=>world.inheritedKnowledge(member.id,original.id),{code:"inherited_knowledge_not_selected"});
  world.villages[member.id].knowledge[0].repairProvenance.verificationDigest="f".repeat(64);
  assert.throws(()=>world.inheritedKnowledge(member.id,knowledge.id),{code:"village_inheritance_changed"});
}));

test("invalid seed hashes, extra authority fields and conflicting identities cannot initialize or replace a member",()=>isolated(root=>{
  const world=setup(root),bad=descriptor(root,"bad-seed",seed([selected()]));
  assert.throws(()=>world.registerVillage({...bad,seedDigest:"0".repeat(64)}),{code:"invalid_village_inheritance"});
  assert.equal(existsSync(join(bad.root,"knowledge.json")),false);
  const authority=descriptor(root,"bad-authority",{...seed(),provider:"forbidden"});
  assert.throws(()=>world.registerVillage(authority),{code:"invalid_village_inheritance"});
  const fullEvidence=selected({repairEvidence:repairEvidence()}),invalid=descriptor(root,"bad-evidence",seed([fullEvidence]));
  assert.throws(()=>world.registerVillage(invalid),{code:"invalid_village_inheritance"});
  const member=register(world,root,"owned-member",seed([selected()]));
  const before=readFileSync(join(member.root,"knowledge.json"),"utf8");
  world.registerVillage({...member,runtime:fakeAsyncPort(member.root)});
  assert.equal(readFileSync(join(member.root,"knowledge.json"),"utf8"),before);
  assert.throws(()=>world.registerVillage({...member,name:"Changed identity"}),{code:"village_registration_conflict"});
  const another=descriptor(root,"another-member");another.root=member.root;another.runtime=fakeAsyncPort(member.root);
  assert.throws(()=>world.registerVillage(another),{code:"village_registration_conflict"});
  assert.equal(world.hasVillage("another-member"),false);
}));

test("async dynamic publication and reception deduplicate and preserve repair evidence across registry reconstruction",()=>isolated(async root=>{
  let world=setup(root);
  const sender=register(world,root,"dynamic-source"),target=register(world,root,"dynamic-target");
  const rumor=createRumor({originVillage:sender.id,body:"Reviewed synthetic public repair knowledge",repairEvidence:repairEvidence()});
  const first=world.publishPreparedRumor(rumor);assert.equal(typeof first.then,"function");
  const published=await Promise.all([first,world.publishPreparedRumor(rumor)]);
  assert.deepEqual(published.map(value=>value.duplicate),[false,true]);
  assert.equal(sender.runtime.gateway.queue.snapshot().jobs.length,1);
  const received=await Promise.all([world.receive({villageId:target.id,rumorId:rumor.id}),world.receive({villageId:target.id,rumorId:rumor.id})]);
  assert.deepEqual(received.map(value=>value.deduplicated),[false,true]);assert.equal(target.runtime.submissions.length,1);
  assert.equal(world.villages[target.id].knowledge.length,0);
  world.review({villageId:target.id,rumorId:rumor.id,decision:"adopt"});
  assert.deepEqual(world.villages[target.id].knowledge[0].repairEvidence,rumor.repairEvidence);
  const senderBytes=readFileSync(join(sender.root,"knowledge.json"),"utf8"),targetBytes=readFileSync(join(target.root,"knowledge.json"),"utf8");
  world=setup(root);world.registerVillage(sender);world.registerVillage(target);
  assert.equal(readFileSync(join(sender.root,"knowledge.json"),"utf8"),senderBytes);
  assert.equal(readFileSync(join(target.root,"knowledge.json"),"utf8"),targetBytes);
  assert.equal((await world.publishPreparedRumor(rumor)).duplicate,true);
  assert.equal((await world.receive({villageId:target.id,rumorId:rumor.id})).deduplicated,true);
  assert.equal(world.villages[sender.id].events.filter(item=>item.kind==="rumor_published").length,1);
  assert.equal(world.villages[target.id].events.filter(item=>item.kind==="rumor_received").length,1);
  assert.equal(world.villages[target.id].knowledge.length,1);
}));

test("concurrent asynchronous receipts merge current ledger and preserve a filter change during IPC",()=>isolated(async root=>{
  const entered=deferred(),release=deferred(),world=setup(root);
  let calls=0;
  const target=register(world,root,"queued-target",seed(),{beforeSubmit:async()=>{if(++calls===1){entered.resolve();await release.promise;}}});
  const one=world.publish({text:"First independently received public reference"}).rumor;
  const two=world.publish({text:"Second independently received public reference"}).rumor;
  const first=world.receive({villageId:target.id,rumorId:one.id}),second=world.receive({villageId:target.id,rumorId:two.id});
  await entered.promise;world.setFilter({villageId:target.id,level:2});release.resolve();
  await Promise.all([first,second]);
  assert.equal(world.villages[target.id].gatewayFilterLevel,2);
  assert.deepEqual(world.villages[target.id].incoming.map(item=>item.rumorId),[one.id,two.id]);
  assert.equal(world.villages[target.id].incoming[0].filterLevelAtReceipt,2);
  assert.equal(target.runtime.submissions.length,2);
}));

test("wire-valid unknown origins are not registered senders or eligible received knowledge",()=>isolated(root=>{
  const world=setup(root),rumor=createRumor({originVillage:"unknown-origin",body:"Checksum-valid claim from an unregistered origin"});
  assert.deepEqual(verifyRumor(rumor),rumor);world.square.publish(rumor);
  assert.throws(()=>world.receive({villageId:"village-2",rumorId:rumor.id}),{code:"unregistered_rumor_origin"});
  assert.equal(world.runtimes["village-2"].state().gateway.jobs,0);
  assert.throws(()=>world.publishPreparedRumor(rumor),{code:"invalid_village"});
  for(const origin of ["../escape","__proto__","A".repeat(49),"a".repeat(49)]){
    assert.throws(()=>createRumor({originVillage:origin,body:"Invalid origin syntax"}),{code:"invalid_rumor_input"});
  }
}));

test("offline dynamic views remain read-only while every village mutation fails closed",()=>isolated(async root=>{
  const world=setup(root),member=register(world,root,"offline-member",seed([selected()]));
  const rumor=world.publish({text:"Offline recipient must await an explicit new launch"}).rumor;
  await world.receive({villageId:member.id,rumorId:rumor.id});
  const file=join(member.root,"knowledge.json"),before=readFileSync(file,"utf8");
  member.runtime.online=false;
  const info=world.state().villages[member.id];assert.equal(info.dynamic,true);assert.equal(info.available,false);
  assert.equal(world.inheritedKnowledge(member.id,info.knowledge[0].id).inheritance.kind,"selected_reference");
  assert.throws(()=>world.setFilter({villageId:member.id,level:2}),{code:"village_bootstrap_not_running"});
  assert.throws(()=>world.review({villageId:member.id,rumorId:rumor.id,decision:"adopt"}),{code:"village_bootstrap_not_running"});
  await assert.rejects(world.receive({villageId:member.id,rumorId:rumor.id}),{code:"village_bootstrap_not_running"});
  await assert.rejects(world.publish({from:member.id,text:"Cannot publish while stopped"}),{code:"village_bootstrap_not_running"});
  assert.equal(readFileSync(file,"utf8"),before);
  member.runtime.online=true;
  assert.equal((await world.receive({villageId:member.id,rumorId:rumor.id})).deduplicated,true);
}));

test("shared capacity is rechecked after asynchronous local publication preparation",()=>isolated(async root=>{
  const entered=deferred(),release=deferred(),world=setup(root);
  const member=register(world,root,"capacity-member",seed(),{beforeSubmit:async()=>{entered.resolve();await release.promise;}});
  const candidate=createRumor({originVillage:member.id,body:"A new publication awaiting its own Gateway"});
  const pending=world.publishPreparedRumor(candidate);await entered.promise;
  for(let index=0;index<120;index++)world.square.publish(createRumor({originVillage:"village-1",body:"Existing public item "+index}));
  release.resolve();await assert.rejects(pending,{code:"square_limit_reached"});
  assert.equal(existsSync(rumorFile(root,candidate.id)),false);assert.equal(world.villages[member.id].published.length,0);
}));

test("a checksum-valid replacement during asynchronous receipt is rejected before ledger adoption",()=>isolated(async root=>{
  const entered=deferred(),release=deferred(),world=setup(root);
  const member=register(world,root,"replacement-target",seed(),{beforeSubmit:async()=>{entered.resolve();await release.promise;}});
  const rumor=world.publish({text:"Original public reference with bound bytes"}).rumor;
  const pending=world.receive({villageId:member.id,rumorId:rumor.id});await entered.promise;
  const changed={...rumor,body:"Changed but checksum-valid public reference"};
  changed.sha256=sha("METRON_RUMOR_V1\n"+JSON.stringify([changed.schemaVersion,changed.id,changed.originVillage,
    changed.originCore,changed.kind,changed.body,changed.createdAt,changed.parentRumorId]));
  assert.equal(verifyRumor(changed).body,changed.body);
  writeFileSync(rumorFile(root,rumor.id),JSON.stringify(changed));release.resolve();
  await assert.rejects(pending,{code:"rumor_provenance_changed"});
  assert.equal(world.villages[member.id].incoming.length,0);assert.equal(world.villages[member.id].knowledge.length,0);
}));

test("offline transition during IPC blocks a late success and the per-village queue can recover",()=>isolated(async root=>{
  const entered=deferred(),release=deferred(),world=setup(root);let delayed=true;
  const member=register(world,root,"late-target",seed(),{beforeSubmit:async()=>{if(delayed){delayed=false;entered.resolve();await release.promise;}}});
  const rumor=world.publish({text:"Late IPC cannot establish active village authority"}).rumor;
  const pending=world.receive({villageId:member.id,rumorId:rumor.id});await entered.promise;
  member.runtime.online=false;release.resolve();await assert.rejects(pending,{code:"village_bootstrap_not_running"});
  assert.equal(world.villages[member.id].incoming.length,0);
  member.runtime.online=true;
  assert.equal((await world.receive({villageId:member.id,rumorId:rumor.id})).deduplicated,false);
}));
