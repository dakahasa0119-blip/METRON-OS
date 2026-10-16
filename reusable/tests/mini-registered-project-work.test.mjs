import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createRegisteredProjectPlan,commitRegisteredWorkspace} from "../../mini/project-tools.mjs";
import {MetronMiniRuntime} from "../../mini/runtime.mjs";
import {CivilizationExperienceV3} from "../../mini/civilization-v3.mjs";
import {VillageWorkflows} from "../../mini/village-work.mjs";

const stable=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==="object"&&!Array.isArray(entry)?
  Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
const sha=value=>createHash("sha256").update(value).digest("hex");
function put(root,path,text){const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);}
const git=(root,args)=>execFileSync("git",["-c","core.autocrlf=false","-c","commit.gpgsign=false",
  "-c","core.hooksPath="+join(root,".git","disabled-fixture-hooks"),"-c","user.name=Registered Work Fixture",
  "-c","user.email=fixture@local.invalid",...args],{cwd:root,shell:false,windowsHide:true,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
function fixture(root){
  const paths=Object.fromEntries(["repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot"]
    .map(key=>[key,join(root,key)]));Object.values(paths).forEach(path=>mkdirSync(path));
  git(paths.repositoryRoot,["init","-q"]);git(paths.repositoryRoot,["config","core.autocrlf","false"]);
  put(paths.repositoryRoot,"src/name.mjs","export const name = input => input.trim();\n");
  put(paths.repositoryRoot,"src/message.mjs",'import {name} from "./name.mjs";export const message = input => "Hello, " + name(input);\n');
  const check='import test from "node:test";import assert from "node:assert/strict";import {message} from "../src/message.mjs";test("normalizes a name",()=>assert.equal(message(" Ada "),"Hello, ada"));\n';
  put(paths.repositoryRoot,"tests/public.test.mjs",check);put(paths.repositoryRoot,"tests/post.test.mjs",check);
  git(paths.repositoryRoot,["add","."]);git(paths.repositoryRoot,["commit","-qm","Generic message fixture baseline"]);
  const baseCommit=git(paths.repositoryRoot,["rev-parse","HEAD"]);
  for(const path of [paths.baselineRoot,paths.candidateRoot,paths.applyRoot])git(paths.repositoryRoot,["worktree","add","--detach",path,baseCommit]);
  put(paths.acceptanceRoot,"sealed/accept.test.mjs",'import test from "node:test";import assert from "node:assert/strict";import {message} from "../src/message.mjs";test("independent case",()=>assert.equal(message(" MIXED "),"Hello, mixed"));\n');
  const config={id:"message-project",label:"Generic message project",...paths,baseCommit,
    allowedEdits:[{path:"src/name.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],
    acceptanceTests:["sealed/accept.test.mjs"],postApplyTests:["tests/post.test.mjs"]};
  return createRegisteredProjectPlan(config);
}
test("missing owner registration preserves saved project work and session files without running project operations",async()=>{
  const prefix=join(tmpdir(),"metron-unconfigured-project-"),root=mkdtempSync(prefix);
  try{
    const runtime=new MetronMiniRuntime(root),world=new CivilizationExperienceV3(root,runtime);
    let workflows=new VillageWorkflows(world);
    const source=runtime.submit({from:"A",to:"B",message:"Synthetic persisted work",code:""});
    const work=workflows.create({villageId:"village-1",goal:"Resume after restoring registration",sourceMessageId:source.messageId,knowledgeIds:[]}).work;
    const sessionId="agent_"+"1".repeat(32),planDigest="a".repeat(64);
    work.scope="registered_project_coding_agent";work.stage="unresolved";
    work.projectRepair={schemaVersion:1,sessionId,projectId:"saved-project",planDigest,status:"ready_worker",attemptCount:0,
      historyLength:2,verification:null,application:null,bindingDigest:sha(stable([
        work.villageId,work.id,work.runId,work.identityDigest,"saved-project",planDigest,sessionId]))};
    const file=join(root,"work-ledger",work.id+".json"),bytes=JSON.stringify(work),sessionFile=join(root,"project-sessions",sessionId+".json");
    writeFileSync(file,bytes);writeFileSync(sessionFile,"{}");
    workflows=new VillageWorkflows(world);
    const restored=workflows.state({villageId:work.villageId,workId:work.id}).work;
    assert.equal(restored.projectRegistrationRequired,true);assert.equal(restored.nextAction,"restore_registered_project_configuration");
    assert.equal(readFileSync(file,"utf8"),bytes);assert.equal(readFileSync(sessionFile,"utf8"),"{}");
    await assert.rejects(()=>workflows.projectAction({action:"start",villageId:work.villageId,workId:work.id,projectId:"saved-project",
      symptom:"Persisted issue",evidence:[],allowStart:true},{operator:true}),{code:"registered_project_plan_missing_or_changed"});
    assert.throws(()=>workflows.prepareShare({villageId:work.villageId,workId:work.id,body:"Cannot share an unavailable project"},{operator:true}),
      {code:"registered_project_plan_missing_or_changed"});
    assert.equal(readFileSync(file,"utf8"),bytes);assert.equal(readFileSync(sessionFile,"utf8"),"{}");
  }finally{assert.ok(resolve(root).startsWith(resolve(prefix)));rmSync(root,{recursive:true,force:true});}
});
test("a saved village incident retains project proof, recovers start intent, recomputes PoUC, applies separately and shares adoptable knowledge",{timeout:240000},async()=>{
  const prefix=join(tmpdir(),"metron-registered-work-"),root=mkdtempSync(prefix);
  try{
    const plan=fixture(root),data=join(root,"data"),runtime=new MetronMiniRuntime(data);
    let world=new CivilizationExperienceV3(data,runtime),workflows=new VillageWorkflows(world,{projectPlans:[plan]});
    const source=runtime.submit({from:"A",to:"B",message:"PRIVATE_SYNTHETIC_SOURCE_CONTEXT",code:""});
    const work=workflows.create({villageId:"village-1",goal:"Repair the registered message project",sourceMessageId:source.messageId,knowledgeIds:[]}).work;
    const start={action:"start",villageId:work.villageId,workId:work.id,projectId:plan.id,
      symptom:"Mixed-case names are not normalized",evidence:["Synthetic local control-plane fixture"],allowStart:true};
    await assert.rejects(()=>workflows.projectAction(start,{operator:false}),{code:"project_operator_capability_required"});
    await assert.rejects(()=>workflows.projectAction({...start,runId:"forged"},{operator:true}),{code:"invalid_work_request"});
    const begun=await workflows.projectAction(start,{operator:true});assert.equal(begun.session.status,"ready_worker");
    assert.equal(begun.session.runId,work.runId);assert.equal(begun.session.workIdentityDigest,work.identityDigest);
    assert.equal(begun.session.incidentContext.sourceMessage.body,"PRIVATE_SYNTHETIC_SOURCE_CONTEXT");
    assert.equal(JSON.stringify(begun.work).includes(begun.dispatchToken),false);
    const id=begun.session.id,path=join(data,"work-ledger",work.id+".json"),saved=JSON.parse(readFileSync(path,"utf8"));
    // Simulate a stop after the service persisted its result but before the
    // work pointer received the start response. Reading must not rerun checks.
    saved.projectRepair.sessionId=null;saved.projectRepair.status="start_intent";
    saved.projectRepair.historyLength=0;saved.projectRepair.bindingDigest=sha(stable([
      saved.villageId,saved.id,saved.runId,saved.identityDigest,plan.id,plan.planDigest,null]));
    saved.stage="running";writeFileSync(path,JSON.stringify(saved));
    const beforeLogs=readdirSync(plan.evidenceRoot).length;
    world=new CivilizationExperienceV3(data,new MetronMiniRuntime(data));workflows=new VillageWorkflows(world,{projectPlans:[plan]});
    const recovered=workflows.state({villageId:work.villageId,workId:work.id}).work;
    assert.equal(recovered.projectRepair.sessionId,id);assert.equal(recovered.projectRepair.status,"ready_worker");
    assert.equal(readdirSync(plan.evidenceRoot).length,beforeLogs);
    assert.throws(()=>workflows.projectState({sessionId:id,dispatchToken:"0".repeat(64)}),{code:"project_worker_capability_required"});
    await assert.rejects(()=>workflows.run({villageId:work.villageId,workId:work.id,provider:"ollama"}),{code:"registered_project_explicit_workflow_required"});
    const claim=await workflows.projectAction({action:"claim",sessionId:id,dispatchToken:begun.dispatchToken,workerId:"fixture_worker",claimId:"claim_1"});
    assert.equal(claim.status,"worker_active");assert.equal(Object.hasOwn(claim,"work"),false);
    put(claim.attempt.workspaceRoot,"src/name.mjs","export const name = input => input.trim().toLowerCase();\n");
    const candidate=commitRegisteredWorkspace(plan,{workerRoot:claim.attempt.workspaceRoot,message:"Normalize the fixture message name"});
    await workflows.projectAction({action:"report",sessionId:id,leaseToken:claim.leaseToken,
      report:{reportId:"report_1",candidateCommit:candidate.candidateCommit,diagnosis:"A missing normalization operation",
        operations:["Synthetic fixture source edit and local commit"],unresolved:[]}});
    const reviewed=await workflows.projectAction({action:"review",sessionId:id},{operator:true});
    const validated=await workflows.projectAction({action:"validate",sessionId:id,reviewedDiffSha256:reviewed.diffSha256,
      verifier:"independent fixture verifier",allowValidation:true},{operator:true});
    assert.equal(validated.session.status,"candidate_verified");assert.equal(validated.work.stage,"candidate_verified");
    const original=readFileSync(path,"utf8"),tampered=JSON.parse(original);
    tampered.projectRepair.verification.evidenceDigest="f".repeat(64);tampered.result.verificationDigest="f".repeat(64);
    writeFileSync(path,JSON.stringify(tampered));
    assert.throws(()=>workflows.state({villageId:work.villageId,workId:work.id}),{code:"work_project_verification_changed"});
    writeFileSync(path,original);
    const poucRequest={action:"pouc",sessionId:id,candidateCommit:candidate.candidateCommit,diffSha256:reviewed.diffSha256,
      verificationId:validated.session.verification.id,reviewer:"fixture useful-work verifier",allowPoUC:true};
    await assert.rejects(()=>workflows.projectAction(poucRequest),{code:"project_operator_capability_required"});
    const pouc=await workflows.projectAction(poucRequest,{operator:true});
    assert.equal(pouc.work.projectRepair.pouc.status,"verified");
    assert.equal(pouc.work.projectRepair.pouc.verificationId,validated.session.verification.id);
    const poucDigest=pouc.work.projectRepair.pouc.proofDigest;
    const applied=await workflows.projectAction({action:"apply",sessionId:id,candidateCommit:candidate.candidateCommit,
      diffSha256:reviewed.diffSha256,verificationId:validated.session.verification.id,expectedHead:plan.baseCommit,
      reviewer:"fixture owner",allowApply:true},{operator:true});
    assert.equal(applied.work.stage,"candidate_verified");assert.equal(applied.session.status,"applied_verified");
    assert.equal(applied.work.result.productionChanged,false);
    assert.deepEqual(applied.work.result.registeredApplication,{targetKind:"registered_isolated_apply_root",status:"applied_verified",head:candidate.candidateCommit});
    const savedBeforeUnconfiguredRead=readFileSync(path,"utf8"),logsBeforeUnconfiguredRead=readdirSync(plan.evidenceRoot).length;
    const withoutRegistration=new VillageWorkflows(world);
    const historical=withoutRegistration.state({villageId:work.villageId,workId:work.id}).work;
    assert.equal(historical.projectRegistrationRequired,true);assert.equal(historical.nextAction,"restore_registered_project_configuration");
    assert.equal(historical.result.candidateCommit,candidate.candidateCommit);
    assert.equal(readFileSync(path,"utf8"),savedBeforeUnconfiguredRead);
    assert.equal(readdirSync(plan.evidenceRoot).length,logsBeforeUnconfiguredRead);
    assert.throws(()=>withoutRegistration.prepareShare({villageId:work.villageId,workId:work.id,body:"Must not share without registration"},{operator:true}),
      {code:"registered_project_plan_missing_or_changed"});
    const beforeRejectedShare=readFileSync(path,"utf8");
    assert.throws(()=>workflows.prepareShare({villageId:work.villageId,workId:work.id,body:"Owner review is required"}),
      {code:"project_operator_capability_required"});
    assert.throws(()=>workflows.prepareShare({villageId:work.villageId,workId:work.id,body:"Forged body capability",operator:true},{operator:true}),
      {code:"invalid_work_request"});
    assert.equal(readFileSync(path,"utf8"),beforeRejectedShare);
    const shared=workflows.prepareShare({villageId:work.villageId,workId:work.id,body:"Normalize names before producing a greeting. Local PoUC receipt: "+poucDigest,
      repairSummary:{diagnosis:"Name normalization omitted letter-case conversion",applicability:"The reviewed message project only",
        limitations:"Isolated target checked; public main unchanged; sender claim"}},{operator:true});
    const rumor=shared.candidate.rumor,publicBytes=JSON.stringify(rumor);
    assert.equal(rumor.repairEvidence.scope,"registered_project_coding_agent");
    assert.equal(rumor.repairEvidence.candidateCommit,candidate.candidateCommit);assert.equal(rumor.repairEvidence.productionApplied,false);
    for(const privateValue of [root,begun.dispatchToken,claim.leaseToken,"PRIVATE_SYNTHETIC_SOURCE_CONTEXT","sealed/accept.test.mjs"])
      assert.equal(publicBytes.includes(privateValue),false);
    const publication={villageId:work.villageId,workId:work.id,reviewedRumorSha256:rumor.sha256,allowPublish:true};
    assert.throws(()=>workflows.publishShare(publication),{code:"project_operator_capability_required"});
    assert.equal(world.villages[work.villageId].published.length,0);
    workflows.publishShare(publication,{operator:true});
    world.receive({villageId:"village-2",rumorId:rumor.id});
    assert.equal(world.villages["village-2"].knowledge.length,1);
    world.review({villageId:"village-2",rumorId:rumor.id,decision:"adopt"});
    const nextSource=world.runtimes["village-2"].submit({from:"A",to:"B",message:"A new local message task",code:""});
    const next=workflows.create({villageId:"village-2",goal:"Use reviewed normalization knowledge",sourceMessageId:nextSource.messageId,
      knowledgeIds:["knowledge_"+rumor.id]}).work;
    assert.deepEqual(next.incidentContext.knowledge[0].repairEvidence,rumor.repairEvidence);
    assert.equal(next.incidentContext.knowledge[0].rumorSha256,rumor.sha256);
    assert.ok(next.incidentContext.knowledge[0].text.includes(poucDigest),"explicitly reviewed PoUC reference follows adopted knowledge");
    assert.equal(next.projectRepair,undefined,"adoption grants no local project execution or revalidation claim");
    await workflows.waitForIdle();
    // A stop after the switch leaves an intent, not a verified application.
    // Recovery reads the actual isolated target and never reruns a check.
    const sessionFile=join(data,"project-sessions",id+".json"),interrupted=JSON.parse(readFileSync(sessionFile,"utf8"));
    interrupted.status="applying";interrupted.application.status="intent";
    interrupted.application.readback.head=plan.baseCommit;writeFileSync(sessionFile,JSON.stringify(interrupted));
    const logsBeforeRecovery=readdirSync(plan.evidenceRoot).length,headBeforeRecovery=git(plan.applyRoot,["rev-parse","HEAD"]);
    world=new CivilizationExperienceV3(data,new MetronMiniRuntime(data));workflows=new VillageWorkflows(world,{projectPlans:[plan]});
    const recoveredApplication=workflows.state({villageId:work.villageId,workId:work.id}).work;
    assert.equal(recoveredApplication.stage,"candidate_verified");
    assert.deepEqual(recoveredApplication.result.registeredApplication,{targetKind:"registered_isolated_apply_root",
      status:"applied_unverified",head:candidate.candidateCommit});
    assert.equal(recoveredApplication.result.productionChanged,false);
    assert.equal(readdirSync(plan.evidenceRoot).length,logsBeforeRecovery);
    assert.equal(git(plan.applyRoot,["rev-parse","HEAD"]),headBeforeRecovery);
  }finally{
    assert.ok(resolve(root).startsWith(resolve(prefix)));rmSync(root,{recursive:true,force:true});
  }
});
