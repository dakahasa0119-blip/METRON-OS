// Real loopback HTTP, fixed Runtime children, native Git and fixed host checks.
// The repair worker authors one explicit fixture change: NOT REAL AI or Codex.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync} from "node:fs";
import {join,dirname,resolve,relative,isAbsolute,sep} from "node:path";
import {tmpdir} from "node:os";
import {execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {createMiniServer} from "../../mini/server.mjs";
import {createRegisteredProjectPlan,commitRegisteredWorkspace} from "../../mini/project-tools.mjs";
import {createRumor} from "../../mini/rumor-protocol.mjs";

const OWNER="d".repeat(64),WRONG="e".repeat(64),CANARY="DYNAMIC_FIXTURE_AUTHORITY_NEVER_COPY";
const LABEL="INJECTED LOCAL DYNAMIC VILLAGE WORKER - NOT REAL AI";
const requestId=()=>"request_"+randomUUID().replaceAll("-","");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const put=(root,path,text)=>{const file=join(root,...path.split("/"));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
async function http(app,path,{body,owner=OWNER,explicit=true}={}){
  const headers={};if(owner)headers["X-Metron-Project-Operator"]=owner;
  if(body!==undefined){headers["Content-Type"]="application/json";headers.Origin=app.url;if(explicit)headers["X-Metron-Mini"]="1";}
  const response=await fetch(app.url+path,{method:body===undefined?"GET":"POST",headers,
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
  return {status:response.status,data:await response.json()};
}
async function ok(app,path,body,status=200){const response=await http(app,path,{body});assert.equal(response.status,status,JSON.stringify(response.data));return response.data;}
const world=app=>ok(app,"/api/civilization/state");
const workState=(app,villageId,workId)=>ok(app,"/api/work/state?"+new URLSearchParams({villageId,...(workId?{workId}:{})}));
const villageAction=(app,id,action,extra={})=>ok(app,"/api/village/action",{action,requestId:requestId(),newVillageId:id,...extra});
const project=(app,body)=>ok(app,"/api/project/action",body);
function options(root,extra={}){return {root:join(root,"data"),port:0,projectOperatorToken:OWNER,
  villageBootstrapOptions:{baseRoot:join(root,"villages"),maxRunMs:300000},...extra};}
async function isolated(fn){
  const prefix=join(tmpdir(),"mdv-http-"),root=mkdtempSync(prefix);let app;
  const start=async opts=>{assert.equal(app,undefined);app=await createMiniServer(opts);return app;};
  const stop=async()=>{if(app){await app.close();app=undefined;}};
  try{return await fn(root,start,stop);}finally{
    await stop();const rel=relative(resolve(dirname(prefix)),resolve(root));
    assert.ok(rel&&!isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+sep));
    rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}
async function sourceFixture(app,dataRoot){
  const rumor=(await ok(app,"/api/civilization/action",{action:"publish",from:"village-2",text:"Selected reference knowledge for a separately owned village."})).rumor;
  await ok(app,"/api/civilization/action",{action:"receive",villageId:"village-1",rumorId:rumor.id});
  await ok(app,"/api/civilization/action",{action:"review",villageId:"village-1",rumorId:rumor.id,decision:"adopt"});
  const sourceBody="INHERITED_SOURCE_NOT_PUBLIC: normalize the registered local greeting.";
  const delivered=await ok(app,"/api/mission",{from:"A",to:"B",message:sourceBody,code:""});
  const work=(await ok(app,"/api/work/action",{action:"create",villageId:"village-1",goal:"Normalize the registered local greeting",
    sourceMessageId:delivered.messageId,knowledgeIds:[]})).work;
  // Host fixture metadata verifies that inheritance projects data, not authority.
  const file=join(dataRoot,"work-ledger",work.id+".json"),saved=JSON.parse(readFileSync(file,"utf8"));
  Object.assign(saved,{dispatchToken:CANARY,allowExternalCalls:true,env:{OPENAI_API_KEY:CANARY},application:{allowApply:true}});
  writeFileSync(file,JSON.stringify(saved));
  return {work,sourceBody,knowledgeId:"knowledge_"+rumor.id,rumor};
}
async function prepare(app,id,source,{selected=true}={}){
  const selection={newVillageId:id,directoryName:id+"-home",sourceVillageId:"village-1",
    ...(selected?{sourceWorkId:source.work.id}:{}),inheritGoal:selected,inheritSourceMessage:selected,
    knowledgeIds:selected?[source.knowledgeId]:[],purpose:"Explicit dynamic-village HTTP fixture"};
  const preview=await ok(app,"/api/village/preview",selection);
  const input={action:"create",requestId:requestId(),...selection,previewDigest:preview.previewDigest,allowCreate:true,dataReviewed:true};
  const made=await ok(app,"/api/village/action",input);return {selection,preview,input,made};
}
function evidenceFiles(root){
  const files={};function visit(dir,prefix=""){for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name),key=prefix+entry.name;
    if(entry.isDirectory())visit(path,key+"/");else if(entry.isFile())files[key]=sha(readFileSync(path));
  }}visit(root);return files;
}

test("owned dynamic membership keeps selected references distinct from adoption and relaunch never replays inherited delivery",{timeout:90000},()=>isolated(async(root,start,stop)=>{
  const opts=options(root);let app=await start(opts);const source=await sourceFixture(app,opts.root);
  const prepared=await prepare(app,"born-reference",source),id=prepared.selection.newVillageId;
  assert.equal(prepared.made.bundle.status,"prepared");assert.equal(prepared.made.runtime,null);
  assert.equal((await ok(app,"/api/village/action",prepared.input)).duplicate,true);
  const beforeLaunch=(await world(app)).villages;
  assert.deepEqual(Object.keys(beforeLaunch).sort(),["born-reference","village-1","village-2"]);
  assert.equal(beforeLaunch[id].dynamic,true);assert.equal(beforeLaunch[id].available,false);
  assert.equal(beforeLaunch[id].inheritance.inheritedGoal.text,source.work.goal);
  const inherited=beforeLaunch[id].knowledge[0];
  assert.equal(inherited.inheritance.kind,"selected_reference");assert.equal(inherited.adoptedIn,null);
  assert.equal(inherited.inheritance.sourceAdoptedIn,"village-1");assert.equal(inherited.parentRumorId,source.rumor.id);
  assert.deepEqual(beforeLaunch[id].incoming,[]);
  for(const forbidden of [OWNER,CANARY,"dispatchToken","allowExternalCalls","OPENAI_API_KEY","allowApply"])
    assert.equal(JSON.stringify(prepared.made.bundle.seed).includes(forbidden),false,forbidden);
  const create={action:"create",villageId:id,goal:"Explicit child work",sourceMessageId:source.work.sourceMessage.id,knowledgeIds:[inherited.id]};
  assert.equal((await http(app,"/api/work/action",{body:create,owner:null})).status,403);
  assert.equal((await http(app,"/api/work/action",{body:create})).data.error,"village_bootstrap_runtime_unavailable");
  assert.equal((await http(app,"/api/village/action",{body:{action:"launch",requestId:requestId(),newVillageId:id,allowLaunch:false}})).status,400);
  const launched=await villageAction(app,id,"launch",{allowLaunch:true});assert.notEqual(launched.runtime.pid,process.pid);
  const sources=await workState(app,id),seedSources=sources.sources.filter(s=>s.body===source.sourceBody);
  assert.equal(seedSources.length,1);assert.notEqual(seedSources[0].id,source.work.sourceMessage.id);
  assert.equal(seedSources[0].id,app.villageBootstrap.runtimePort(id).seedSourceMessageId);
  assert.equal(sources.knowledge[0].inheritance.kind,"selected_reference");assert.equal(sources.knowledge[0].adoptedIn,null);
  const childWork=(await ok(app,"/api/work/action",{...create,sourceMessageId:seedSources[0].id})).work;
  assert.equal(childWork.incidentContext.knowledge[0].adoptedIn,null);
  assert.equal(childWork.incidentContext.knowledge[0].inheritance.kind,"selected_reference");
  assert.notEqual(childWork.runId,source.work.runId);
  const send={action:"send-local",requestId:requestId(),newVillageId:id,message:"A deduplicated local child observation",allowSend:true};
  await ok(app,"/api/village/action",send);assert.equal((await ok(app,"/api/village/action",send)).duplicate,true);
  const delivered=await ok(app,"/api/village/state?newVillageId="+id),bCount=delivered.runtime.transport.ships.B.count;
  assert.equal(bCount,2);assert.equal((await world(app)).villages[id].available,true);
  const invalid=await http(app,"/api/civilization/action",{body:{action:"register",villageId:"wire-only"}});assert.equal(invalid.status,400);
  assert.equal((await http(app,"/api/work/state?villageId=wire-only")).status,400);
  assert.equal(Object.hasOwn((await world(app)).villages,"wire-only"),false);
  const unregistered=createRumor({originVillage:"wire-only",body:"A checksum is not village membership"});
  app.civilization.square.publish(unregistered); // Host-authored protocol fixture, never membership enrollment.
  assert.equal((await http(app,"/api/civilization/action",{body:{action:"receive",villageId:id,rumorId:unregistered.id}})).data.error,"unregistered_rumor_origin");
  assert.equal((await world(app)).villages[id].incoming.length,0);
  const firstPid=launched.runtime.pid;await villageAction(app,id,"stop",{allowStop:true});
  const offline=await http(app,"/api/work/action",{body:{...create,sourceMessageId:seedSources[0].id}});
  assert.equal(offline.data.error,"village_bootstrap_runtime_unavailable");
  await stop();app=await start(opts);
  for(let i=0;i<2;i++){assert.equal((await world(app)).villages[id].available,false);assert.equal((await workState(app,id,childWork.id)).work.id,childWork.id);}
  assert.equal(app.villageBootstrap.children.size,0);
  const again=await villageAction(app,id,"launch",{allowLaunch:true});assert.notEqual(again.runtime.pid,firstPid);
  assert.equal(again.runtime.transport.ships.B.count,bCount);
  assert.equal((await workState(app,id)).sources.filter(s=>s.body===source.sourceBody).length,1);
  assert.equal((await world(app)).villages[id].knowledge.filter(k=>k.inheritance).length,1);
}));

function git(root,args){return execFileSync("git",["--no-pager","-c","core.autocrlf=false","-c","core.fsmonitor=false",
  "-c","core.hooksPath="+join(root,"disabled-fixture-hooks"),"-c","commit.gpgsign=false",
  "-c","user.name=Dynamic Village Fixture","-c","user.email=fixture@local.invalid",...args],{
  cwd:root,shell:false,windowsHide:true,encoding:"utf8",timeout:15000,stdio:["ignore","pipe","pipe"],
  env:{...process.env,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:process.platform==="win32"?"NUL":"/dev/null",GIT_TERMINAL_PROMPT:"0"}}).trim();}
function registeredFixture(root){
  const base=join(root,"p"),names={repositoryRoot:"r",baselineRoot:"b",candidateRoot:"c",applyRoot:"a",evidenceRoot:"e",tempRoot:"t",acceptanceRoot:"h"};
  const paths=Object.fromEntries(Object.entries(names).map(([key,name])=>[key,join(base,name)]));
  for(const path of Object.values(paths))mkdirSync(path,{recursive:true});
  const template=join(root,"empty-template");mkdirSync(template);git(paths.repositoryRoot,["init","--template="+template]);
  git(paths.repositoryRoot,["config","core.autocrlf","false"]);
  put(paths.repositoryRoot,"src/name.mjs","export const name = input => input.trim();\n");
  put(paths.repositoryRoot,"src/message.mjs",'import {name} from "./name.mjs";export const message = input => "Hello, " + name(input);\n');
  const check='import test from "node:test";import assert from "node:assert/strict";import {message} from "../src/message.mjs";test("normalizes a greeting",()=>assert.equal(message(" Ada "),"Hello, ada"));\n';
  put(paths.repositoryRoot,"tests/public.test.mjs",check);put(paths.repositoryRoot,"tests/post.test.mjs",check);
  git(paths.repositoryRoot,["add","."]);git(paths.repositoryRoot,["commit","-m","Deliberately faulty dynamic fixture baseline"]);
  const baseCommit=git(paths.repositoryRoot,["rev-parse","HEAD"]);
  for(const path of [paths.baselineRoot,paths.candidateRoot,paths.applyRoot])git(paths.repositoryRoot,["worktree","add","--detach",path,baseCommit]);
  put(paths.acceptanceRoot,"sealed/accept.test.mjs",check.replace('message(" Ada ")','message(" MIXED ")').replace('"Hello, ada"','"Hello, mixed"'));
  return createRegisteredProjectPlan({id:"dynamic-greeting",label:LABEL,...paths,baseCommit,
    allowedEdits:[{path:"src/name.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],
    acceptanceTests:["sealed/accept.test.mjs"],postApplyTests:["tests/post.test.mjs"]});
}
function injectedWorker(){
  const calls=[];return {calls,runAttempt:async({sessions,plan,sessionId,dispatchToken,workerId,claimId,signal})=>{
    assert.notEqual(signal.aborted,true);const lease=await sessions.claim({sessionId,dispatchToken,workerId,claimId});
    calls.push({sessionId,attemptId:lease.attempt.id,label:LABEL,modelCalls:0});
    assert.equal(existsSync(join(lease.attempt.workspaceRoot,"sealed/accept.test.mjs")),false);
    put(lease.attempt.workspaceRoot,"src/name.mjs","export const name = input => input.trim().toLowerCase();\n");
    const candidate=commitRegisteredWorkspace(plan,{workerRoot:lease.attempt.workspaceRoot,message:LABEL});
    await sessions.report({sessionId,leaseToken:lease.leaseToken,report:{reportId:"dynamic_fixture_report",
      candidateCommit:candidate.candidateCommit,diagnosis:LABEL+": normalize case",operations:["Explicit fixture source edit and real local Git commit"],unresolved:[]}});
    return {status:"reported_awaiting_independent_review",modelLaunchIntent:false,modelProcessStarted:false,terminationUnconfirmed:false,
      attemptId:lease.attempt.id,candidateCommit:candidate.candidateCommit,diffSha256:candidate.diffSha256,process:{exitCode:0}};
  }};
}

test("a Runtime-backed new village repairs a registered target, shares once for explicit adoption/quarantine and rolls back only its isolated target",{timeout:180000},()=>isolated(async(root,start,stop)=>{
  const plan=registeredFixture(root),worker=injectedWorker(),opts=options(root,{workOptions:{projectPlans:[plan],runnerOptions:{env:{}}},
    projectCodexOptions:{label:LABEL,executable:join(root,"never-launched","codex.exe"),runAttempt:worker.runAttempt}});
  let app=await start(opts);const source=await sourceFixture(app,opts.root);
  await prepare(app,"repair-born",source);await prepare(app,"receive-born",source,{selected:false});
  await villageAction(app,"repair-born","launch",{allowLaunch:true});await villageAction(app,"receive-born","launch",{allowLaunch:true});
  const selected=await workState(app,"repair-born"),seed=selected.sources.find(s=>s.body===source.sourceBody);
  assert.ok(seed);const work=(await ok(app,"/api/work/action",{action:"create",villageId:"repair-born",goal:source.work.goal,
    sourceMessageId:seed.id,knowledgeIds:[selected.knowledge[0].id]})).work;
  const begin={action:"start",villageId:work.villageId,workId:work.id,projectId:plan.id,symptom:"Greeting retains uppercase names",
    evidence:["Public assertion in the approved disposable fixture"],allowStart:true};
  assert.equal((await http(app,"/api/project/action",{body:begin,owner:null})).status,403);
  assert.equal((await http(app,"/api/project/action",{body:{...begin,allowStart:false}})).status,400);
  const begun=await project(app,begin),sessionId=begun.session.id;assert.equal(begun.session.status,"ready_worker");
  assert.equal(begun.session.baseline.passed,false);assert.equal(worker.calls.length,0);
  const dispatch={sessionId,projectId:plan.id,planDigest:plan.planDigest,requestId:requestId(),allowExternalCodex:true};
  await villageAction(app,work.villageId,"stop",{allowStop:true});
  assert.equal((await http(app,"/api/project/dispatch",{body:dispatch})).data.error,"village_bootstrap_runtime_unavailable");
  assert.equal(worker.calls.length,0);await villageAction(app,work.villageId,"launch",{allowLaunch:true});
  assert.equal((await http(app,"/api/project/dispatch",{body:{...dispatch,allowExternalCodex:false}})).data.error,"project_desk_explicit_codex_consent_required");
  assert.equal((await http(app,"/api/project/dispatch",{body:dispatch,owner:WRONG})).status,403);
  assert.equal((await http(app,"/api/project/dispatch",{body:dispatch,explicit:false})).status,403);
  await ok(app,"/api/project/dispatch",dispatch,202);await app.projectDesk.waitForIdle();
  assert.equal((await ok(app,"/api/project/dispatch",dispatch,202)).duplicate,true);assert.equal(worker.calls.length,1);
  const jobs=await ok(app,"/api/project/jobs?sessionId="+sessionId);assert.equal(jobs.jobs[0].mode,"injected_worker_test");
  assert.equal(jobs.jobs[0].status,"reported_awaiting_independent_review");assert.equal(jobs.jobs[0].modelProcessStarted,false);
  const reviewed=await project(app,{action:"review",sessionId});
  const validation={action:"validate",sessionId,reviewedDiffSha256:reviewed.diffSha256,verifier:"Independent fixed fixture checks",allowValidation:true};
  assert.equal((await http(app,"/api/project/action",{body:{...validation,allowValidation:false}})).status,400);
  const validated=await project(app,validation);assert.equal(validated.session.status,"candidate_verified");
  assert.equal(validated.session.attempts.length,1);assert.equal(validated.session.attempts[0].publicResult.passed,true);
  const candidate=validated.session.verification.candidateCommit,initialApply=readFileSync(join(plan.applyRoot,"src/name.mjs"),"utf8");
  const apply={action:"apply",sessionId,candidateCommit:candidate,diffSha256:reviewed.diffSha256,
    verificationId:validated.session.verification.id,expectedHead:plan.baseCommit,reviewer:"Fixture owner",allowApply:true};
  assert.equal((await http(app,"/api/project/action",{body:{...apply,allowApply:false}})).status,400);
  assert.equal(git(plan.applyRoot,["rev-parse","HEAD"]),plan.baseCommit);
  const prepared=await ok(app,"/api/work/action",{action:"prepare-share",villageId:work.villageId,workId:work.id,
    body:"Reviewed name normalization in an owned disposable greeting project.",repairSummary:{diagnosis:"Case conversion was missing",
      applicability:"The registered fixture only",limitations:"Sender claim; receiving village must review independently"}});
  const rumor=prepared.candidate.rumor;assert.equal(rumor.originVillage,work.villageId);
  assert.equal(rumor.repairEvidence.candidateCommit,candidate);assert.equal(rumor.repairEvidence.productionApplied,false);
  for(const privateValue of [root,OWNER,CANARY,begun.dispatchToken,source.sourceBody,"sealed/accept.test.mjs"])
    assert.equal(JSON.stringify(rumor).includes(privateValue),false,String(privateValue));
  const publish={action:"publish-share",villageId:work.villageId,workId:work.id,reviewedRumorSha256:rumor.sha256,allowPublish:true};
  assert.equal((await http(app,"/api/work/action",{body:publish,owner:null})).status,403);
  assert.equal((await http(app,"/api/work/action",{body:{...publish,allowPublish:false}})).status,400);
  // Hold only this Rumor's actual child submission. Apply must finish while
  // publication awaits IPC; its later completion must preserve that newer work.
  const port=app.civilization.runtimes[work.villageId],originalSubmit=port.submit;
  const publishMessageId="m_"+sha("rumor-publish:"+rumor.id).slice(0,32);
  let entered,release,deferredCalls=0,publicationFinished=false,publication,applied;
  const waiting=new Promise(done=>{entered=done;}),gate=new Promise(done=>{release=done;});
  port.submit=async input=>{
    if(input.messageId===publishMessageId){deferredCalls++;entered();await gate;}
    return originalSubmit.call(port,input);
  };
  try{
    publication=ok(app,"/api/work/action",publish).then(result=>{publicationFinished=true;return result;});
    await Promise.race([waiting,publication.then(()=>assert.fail("Publication completed without awaiting its Runtime submission"))]);
    assert.equal(publicationFinished,false);assert.equal(deferredCalls,1);
    applied=await project(app,apply);assert.equal(applied.session.status,"applied_verified");
    assert.equal(git(plan.applyRoot,["rev-parse","HEAD"]),candidate);assert.equal(applied.work.result.productionChanged,false);
    assert.equal(publicationFinished,false,"publication remains held until the real child submit is released");
    release();const published=await publication;
    for(const saved of [published.work,(await workState(app,work.villageId,work.id)).work]){
      assert.equal(saved.publication.status,"published");assert.equal(saved.publication.rumorSha256,rumor.sha256);
      assert.equal(saved.projectRepair.status,"applied_verified");
      assert.deepEqual(saved.projectRepair.verification,applied.work.projectRepair.verification);
      assert.deepEqual(saved.projectRepair.application,applied.work.projectRepair.application);
      assert.deepEqual(saved.result.registeredApplication,applied.work.result.registeredApplication);
      assert.equal(saved.result.registeredApplication.head,candidate);
      assert.equal(saved.result.registeredApplication.status,"applied_verified");
    }
  }finally{release();port.submit=originalSubmit;if(publication)await publication.catch(()=>{});}
  const publishedJobs=(await world(app)).villages[work.villageId].transport.gatewayJobs;
  await ok(app,"/api/work/action",publish);const publishedWorld=await world(app);
  assert.equal(publishedWorld.villages[work.villageId].published.length,1);assert.equal(publishedWorld.villages[work.villageId].transport.gatewayJobs,publishedJobs);
  assert.equal(publishedWorld.square.filter(r=>r.id===rumor.id).length,1);
  const receive={action:"receive",villageId:"receive-born",rumorId:rumor.id};
  assert.equal((await http(app,"/api/civilization/action",{body:receive,owner:null})).status,403);
  const received=await ok(app,"/api/civilization/action",receive);assert.equal(received.receipt.status,"pending");
  assert.equal((await world(app)).villages["receive-born"].knowledge.length,0);
  assert.equal((await ok(app,"/api/civilization/action",receive)).deduplicated,true);
  const adopt={action:"review",villageId:"receive-born",rumorId:rumor.id,decision:"adopt"};
  assert.equal((await http(app,"/api/civilization/action",{body:adopt,owner:null})).status,403);await ok(app,"/api/civilization/action",adopt);
  assert.equal((await http(app,"/api/civilization/action",{body:adopt})).data.error,"rumor_already_reviewed");
  const recipient=(await world(app)).villages["receive-born"],knowledge=recipient.knowledge[0];
  assert.equal(recipient.knowledge.length,1);assert.equal(knowledge.sourceVillage,work.villageId);assert.equal(knowledge.parentRumorId,rumor.id);
  assert.equal(knowledge.rumorSha256,rumor.sha256);assert.deepEqual(knowledge.repairEvidence,rumor.repairEvidence);
  assert.equal(Object.hasOwn(knowledge,"inheritance"),false);
  await ok(app,"/api/civilization/action",{action:"receive",villageId:"village-2",rumorId:rumor.id});
  await ok(app,"/api/civilization/action",{action:"review",villageId:"village-2",rumorId:rumor.id,decision:"quarantine"});
  assert.equal((await world(app)).villages["village-2"].incoming.find(r=>r.rumorId===rumor.id).status,"quarantined");
  assert.equal((await world(app)).villages["village-2"].knowledge.some(k=>k.parentRumorId===rumor.id),false);
  const rollback={action:"rollback",sessionId,expectedHead:candidate,reviewer:"Fixture owner",allowRollback:true};
  assert.equal((await http(app,"/api/project/action",{body:{...rollback,expectedHead:plan.baseCommit}})).status,400);
  assert.equal(git(plan.applyRoot,["rev-parse","HEAD"]),candidate);
  const rolledBack=await project(app,rollback);assert.equal(rolledBack.session.status,"rolled_back");
  assert.equal(git(plan.applyRoot,["rev-parse","HEAD"]),plan.baseCommit);
  assert.equal(readFileSync(join(plan.applyRoot,"src/name.mjs"),"utf8"),initialApply);
  assert.equal(git(plan.applyRoot,["status","--porcelain"]),""); // Exact deliberately faulty baseline, not a healthy repair.
  await villageAction(app,"repair-born","stop",{allowStop:true});await villageAction(app,"receive-born","stop",{allowStop:true});
  await stop();const evidenceBefore=evidenceFiles(plan.evidenceRoot);app=await start(opts);
  for(let i=0;i<2;i++){
    const restored=await workState(app,work.villageId,work.id);assert.equal(restored.work.publication.rumor.id,rumor.id);
    assert.equal((await ok(app,"/api/project/state?sessionId="+sessionId)).status,"rolled_back");
    const state=await world(app);assert.equal(state.villages[work.villageId].available,false);
    assert.equal(state.villages["receive-born"].knowledge.filter(k=>k.parentRumorId===rumor.id).length,1);
  }
  assert.equal(app.villageBootstrap.children.size,0);assert.equal(worker.calls.length,1);
  assert.deepEqual(evidenceFiles(plan.evidenceRoot),evidenceBefore);assert.equal(git(plan.applyRoot,["rev-parse","HEAD"]),plan.baseCommit);
}));
