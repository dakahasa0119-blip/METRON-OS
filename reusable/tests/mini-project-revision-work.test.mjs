import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createRegisteredProjectPlan,commitRegisteredWorkspace} from "../../mini/project-tools.mjs";
import {createMiniServer} from "../../mini/server.mjs";
import {projectWorkerCli} from "../../mini/project-worker-cli.mjs";

// Explicitly authored source changes exercise real Git/Node lifecycle behavior.
// They are fixture data, never a model or coding CLI success claim.
const OPERATOR="a".repeat(64),owner={operator:true};
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=x=>createHash("sha256").update(x).digest("hex");
const git=(root,args)=>execFileSync("git",["-c","core.autocrlf=false","-c","commit.gpgsign=false",
  "-c","core.hooksPath="+join(root,".git","disabled-fixture-hooks"),"-c","user.name=Revision Fixture",
  "-c","user.email=fixture@local.invalid",...args],{cwd:root,shell:false,windowsHide:true,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
function put(root,path,text){const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);}
const check=extra=>'import test from "node:test";import assert from "node:assert/strict";import {name} from "../src/name.mjs";'+
  'test("normalizes case",()=>assert.equal(name(" Ada "),"ada"));'+(extra?'test("collapses internal whitespace",()=>assert.equal(name(" Ada   Lovelace "),"ada lovelace"));':'')+'\n';
function fixture(root){
  const paths=Object.fromEntries(["repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot"]
    .map(k=>[k,join(root,"v1-"+k)]));Object.values(paths).forEach(p=>mkdirSync(p));
  git(paths.repositoryRoot,["init","-q"]);git(paths.repositoryRoot,["config","core.autocrlf","false"]);
  put(paths.repositoryRoot,"src/name.mjs","export const name = input => input.trim();\n");
  put(paths.repositoryRoot,"README.md","Normalize names to lower case.\n");
  for(const path of ["tests/public.test.mjs","tests/post.test.mjs"])put(paths.repositoryRoot,path,check(false));
  git(paths.repositoryRoot,["add","."]);git(paths.repositoryRoot,["commit","-qm","Initial failing fixture"]);
  const baseCommit=git(paths.repositoryRoot,["rev-parse","HEAD"]);
  for(const path of [paths.baselineRoot,paths.candidateRoot,paths.applyRoot])git(paths.repositoryRoot,["worktree","add","--detach",path,baseCommit]);
  put(paths.acceptanceRoot,"sealed/accept.test.mjs",check(false).replace('name(" Ada ")','name(" MIXED ")').replace('"ada"','"mixed"'));
  return createRegisteredProjectPlan({id:"revision-message-v1",label:"Synthetic revision message",...paths,baseCommit,
    allowedEdits:[{path:"src/name.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],
    acceptanceTests:["sealed/accept.test.mjs"],postApplyTests:["tests/post.test.mjs"]});
}
function revisedPlan(root,old,candidate,{suffix="v2",sourceOverride=null}={}){
  const paths=Object.fromEntries(["repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot"]
    .map(k=>[k,join(root,suffix+"-"+k)]));Object.values(paths).forEach(p=>mkdirSync(p));
  git(old.repositoryRoot,["worktree","add","--detach",paths.repositoryRoot,candidate]);
  for(const path of ["tests/public.test.mjs","tests/post.test.mjs"])put(paths.repositoryRoot,path,check(true));
  put(paths.repositoryRoot,"README.md","Normalize names to lower case and collapse internal whitespace.\n");
  if(sourceOverride!==null)put(paths.repositoryRoot,"src/name.mjs",sourceOverride);
  git(paths.repositoryRoot,["add","."]);git(paths.repositoryRoot,["commit","-qm","Owner revision fixture baseline"]);
  const baseCommit=git(paths.repositoryRoot,["rev-parse","HEAD"]);
  for(const path of [paths.baselineRoot,paths.candidateRoot,paths.applyRoot])git(old.repositoryRoot,["worktree","add","--detach",path,baseCommit]);
  put(paths.acceptanceRoot,"sealed/accept.test.mjs",check(true));
  return createRegisteredProjectPlan({id:"revision-message-"+suffix,label:"Added whitespace requirement",...paths,baseCommit,
    allowedEdits:[{path:"src/name.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],
    acceptanceTests:["sealed/accept.test.mjs"],postApplyTests:["tests/post.test.mjs"]});
}
async function candidate(app,plan,begun,source){
  const sessionId=begun.session.id,lease=await app.work.projectAction({action:"claim",sessionId,dispatchToken:begun.dispatchToken,
    workerId:"explicit_fixture_worker",claimId:"fixture_claim"});
  put(lease.attempt.workspaceRoot,"src/name.mjs",source);
  const observed=commitRegisteredWorkspace(plan,{workerRoot:lease.attempt.workspaceRoot,message:"Explicit authored fixture candidate"});
  await app.work.projectAction({action:"report",sessionId,leaseToken:lease.leaseToken,report:{reportId:"fixture_report",
    candidateCommit:observed.candidateCommit,diagnosis:"Synthetic normalization gap",operations:["Fixture source edit and host commit"],unresolved:[]}});
  const review=await app.work.projectAction({action:"review",sessionId},owner);
  const verified=await app.work.projectAction({action:"validate",sessionId,reviewedDiffSha256:review.diffSha256,
    verifier:"independent fixture verifier",allowValidation:true},owner);
  assert.equal(verified.session.status,"candidate_verified");
  const applied=await app.work.projectAction({action:"apply",sessionId,candidateCommit:observed.candidateCommit,
    diffSha256:review.diffSha256,verificationId:verified.session.verification.id,expectedHead:plan.baseCommit,
    reviewer:"fixture owner",allowApply:true},owner);
  assert.equal(applied.session.status,"applied_verified");
  return applied;
}
function publish(app,work,body){
  const prepared=app.work.prepareShare({villageId:work.villageId,workId:work.id,body,repairSummary:{diagnosis:"Reviewed synthetic normalization gap",
    applicability:"This registered fixture version",limitations:"Independent sender checks; public main unchanged"}},owner);
  return app.work.publishShare({villageId:work.villageId,workId:work.id,reviewedRumorSha256:prepared.candidate.rumor.sha256,allowPublish:true},owner).work;
}
const logCount=plans=>plans.reduce((n,p)=>n+readdirSync(p.evidenceRoot).length,0);

test("requirements revision preserves the same work and frozen published success through recovery, verification and explicit sharing",{timeout:240000},async()=>{
  const prefix=join(tmpdir(),"metron-revision-work-"),root=mkdtempSync(prefix),data=join(root,"data");let app;
  try{
    const first=fixture(root);app=await createMiniServer({root:data,port:0,projectOperatorToken:OPERATOR,workOptions:{projectPlans:[first]}});
    const source=app.runtime.submit({from:"A",to:"B",message:"PRIVATE_REVISION_INCIDENT",code:""});
    const work=app.work.create({villageId:"village-1",goal:"Normalize the registered message",sourceMessageId:source.messageId,knowledgeIds:[]}).work;
    const begun=await app.work.projectAction({action:"start",villageId:work.villageId,workId:work.id,projectId:first.id,
      symptom:"Case normalization fails",evidence:["Pinned public assertion"],allowStart:true},owner);
    const v1=await candidate(app,first,begun,"export const name = input => input.trim().toLowerCase();\n");
    const published=publish(app,v1.work,"Reviewed lower-case normalization."),oldRumor=published.publication.rumor;
    const snapshot=Object.fromEntries(["projectRepair","result","sharingCandidate","publication","scope"].map(k=>[k,published[k]]));
    const firstSessionPath=join(data,"project-sessions",begun.session.id+".json"),firstSessionBytes=readFileSync(firstSessionPath,"utf8");
    const invalid=revisedPlan(root,first,published.result.candidateCommit,{suffix:"invalid-source",
      sourceOverride:'export const name = input => input.trim().replace(/\\s+/g, " ").toLowerCase();\n'});
    const second=revisedPlan(root,first,published.result.candidateCommit),plans=[first,invalid,second];
    await app.close();app=null;
    app=await createMiniServer({root:data,port:0,projectOperatorToken:OPERATOR,workOptions:{projectPlans:plans}});
    const input={villageId:work.villageId,workId:work.id,previousSessionId:begun.session.id,reviewedPreviousCandidate:published.result.candidateCommit,
      projectId:second.id,requirements:"Also collapse internal whitespace before lower-case conversion.",symptom:"Repeated spaces remain in normalized names",evidence:["Owner-added public assertion"]};
    const revision={action:"revise",...input,allowRevision:true};
    // This is a valid local registration with an invalid revision relationship:
    // its baseline already changes the reviewed candidate source. Reject it
    // before saving an intent, so the corrected plan can still revise the work.
    const workPath=join(data,"work-ledger",work.id+".json"),beforeRejectedRevision=readFileSync(workPath,"utf8"),
      logsBeforeRejectedRevision=logCount(plans),sessionsBeforeRejectedRevision=readdirSync(join(data,"project-sessions"));
    await assert.rejects(()=>app.work.projectAction({...revision,projectId:invalid.id},owner),{code:"project_revision_source_changed"});
    assert.equal(readFileSync(workPath,"utf8"),beforeRejectedRevision,"invalid revision must preserve exact work bytes, result and history");
    assert.equal(readFileSync(firstSessionPath,"utf8"),firstSessionBytes);
    assert.deepEqual(readdirSync(join(data,"project-sessions")),sessionsBeforeRejectedRevision);
    assert.equal(logCount(plans),logsBeforeRejectedRevision,"invalid revision must not run baseline checks");
    assert.deepEqual(app.civilization.square.read(oldRumor.id),oldRumor);
    await assert.rejects(()=>app.work.projectAction(revision),{code:"project_operator_capability_required"});
    await assert.rejects(()=>app.work.projectAction({...revision,allowRevision:false},owner),{code:"explicit_project_requirements_revision_required"});
    await assert.rejects(()=>app.work.projectAction({...revision,reviewedPreviousCandidate:"f".repeat(40)},owner),{code:"work_project_revision_conflict"});
    assert.equal(app.work.state({villageId:work.villageId,workId:work.id}).work.projectHistory,undefined);
    const forbidden=await fetch(app.url+"/api/project/action",{method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1",Origin:app.url},body:JSON.stringify(revision)});
    assert.equal(forbidden.status,403);assert.equal((await forbidden.json()).error,"project_operator_capability_required");
    const cap=join(root,"operator.txt"),packet=join(root,"revision.json");writeFileSync(cap,OPERATOR);writeFileSync(packet,JSON.stringify(input));
    const cli=["revise","--url",app.url,"--input",packet,"--operator-token-file",cap];
    await assert.rejects(()=>projectWorkerCli(cli,{stdout(){}}),{code:"explicit_project_confirmation_required"});
    const next=await projectWorkerCli([...cli,"--confirm"],{stdout(){}});
    assert.equal(next.session.status,"ready_worker");assert.notEqual(next.session.id,begun.session.id);
    assert.equal(next.session.baseline.passed,false);assert.equal(next.session.baseline.checks[0].testSummary.fail,1);
    assert.equal(next.session.workAttemptCount,1);assert.equal(next.work.projectRepair.attemptCount,1);
    for(const key of ["id","goal","runId","sourceMessage","incidentContext","identityDigest"])assert.deepEqual(next.work[key],work[key]);
    assert.deepEqual(next.work.projectHistory[0].snapshot,snapshot);assert.equal(next.work.result,null);assert.equal(next.work.sharingCandidate,null);
    assert.equal(next.work.publication,null);assert.deepEqual(app.civilization.square.read(oldRumor.id),oldRumor);
    const beforeRetry=logCount(plans),duplicate=await app.work.projectAction(revision,owner);
    assert.equal(duplicate.duplicate,true);assert.equal(duplicate.session.id,next.session.id);assert.equal(logCount(plans),beforeRetry);
    await assert.rejects(()=>app.work.projectAction({...revision,requirements:"Conflicting revision"},owner),{code:"work_project_revision_conflict"});
    // Stop after the session result was saved but before the work pointer was saved.
    const saved=JSON.parse(readFileSync(workPath,"utf8"));
    saved.projectRepair.sessionId=null;saved.projectRepair.status="start_intent";saved.projectRepair.historyLength=0;
    saved.projectRepair.bindingDigest=sha(stable([saved.villageId,saved.id,saved.runId,saved.identityDigest,second.id,second.planDigest,null]));
    writeFileSync(workPath,JSON.stringify(saved));await app.close();app=null;
    app=await createMiniServer({root:data,port:0,projectOperatorToken:OPERATOR,workOptions:{projectPlans:plans}});
    const recovered=app.work.state({villageId:work.villageId,workId:work.id}).work;
    assert.equal(recovered.projectRepair.sessionId,next.session.id);assert.equal(logCount(plans),beforeRetry);
    assert.deepEqual(recovered.projectHistory[0].snapshot,snapshot);
    const v2=await candidate(app,second,next,'export const name = input => input.trim().replace(/\\s+/g, " ").toLowerCase();\n');
    assert.equal(v2.work.projectRepair.attemptCount,2);assert.equal(v2.work.projectHistory[0].snapshot.result.status,"verified_candidate");
    assert.equal(v2.work.sharingCandidate.rumor.parentRumorId,oldRumor.id);assert.equal(app.civilization.villages[work.villageId].published.length,1);
    const final=publish(app,v2.work,"Reviewed whitespace and case normalization."),newRumor=final.publication.rumor;
    assert.equal(newRumor.parentRumorId,oldRumor.id);assert.notEqual(newRumor.id,oldRumor.id);
    assert.equal(final.result.productionChanged,false);assert.equal(final.result.registeredApplication.status,"applied_verified");
    assert.equal(readFileSync(firstSessionPath,"utf8"),firstSessionBytes);assert.deepEqual(final.projectHistory[0].snapshot,snapshot);
    const privateBytes=JSON.stringify(newRumor);for(const value of [root,"PRIVATE_REVISION_INCIDENT",next.dispatchToken])assert.equal(privateBytes.includes(value),false);
    const finalBytes=readFileSync(workPath,"utf8"),beforeRestart=logCount(plans);
    // A recomputed container checksum cannot substitute for the saved service proof.
    const tampered=JSON.parse(finalBytes),entry=tampered.projectHistory[0];entry.snapshot.projectRepair.verification.evidenceDigest="f".repeat(64);
    entry.snapshot.result.verificationDigest="f".repeat(64);entry.snapshot.sharingCandidate=null;entry.snapshot.publication=null;
    entry.digest=sha(stable([work.id,work.villageId,work.runId,work.identityDigest,entry.version,entry.snapshot]));writeFileSync(workPath,JSON.stringify(tampered));
    assert.throws(()=>app.work.state({villageId:work.villageId,workId:work.id}),{code:"work_project_verification_changed"});writeFileSync(workPath,finalBytes);
    await app.close();app=null;app=await createMiniServer({root:data,port:0,projectOperatorToken:OPERATOR,workOptions:{projectPlans:plans}});
    const restarted=app.work.state({villageId:work.villageId,workId:work.id}).work;
    assert.equal(restarted.publication.rumor.id,newRumor.id);assert.deepEqual(restarted.projectHistory[0].snapshot,snapshot);
    assert.equal(logCount(plans),beforeRestart);assert.equal(app.civilization.villages[work.villageId].published.length,2);
    assert.equal(readFileSync(firstSessionPath,"utf8"),firstSessionBytes);
    await app.close();app=null;app=await createMiniServer({root:data,port:0});
    const historical=app.work.state({villageId:work.villageId,workId:work.id}).work;
    assert.equal(historical.projectRegistrationRequired,true);assert.deepEqual(historical.projectHistory[0].snapshot,snapshot);
    assert.equal(historical.publication.rumor.id,newRumor.id);assert.equal(logCount(plans),beforeRestart);
    assert.equal(readFileSync(workPath,"utf8"),finalBytes);
  }finally{if(app)await app.close();assert.ok(resolve(root).startsWith(resolve(prefix)));rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
