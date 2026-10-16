import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,readdirSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {RegisteredProjectSessions} from "../../mini/project-session.mjs";
import {createRegisteredProjectPlan,commitRegisteredWorkspace,inspectRegisteredCandidate,inspectRegisteredApply} from "../../mini/project-tools.mjs";

// Real disposable Git projects and actual Node checks; the worker is this test
// using ordinary file edits and the host committer. No model/CLI is simulated.
const broken='export const cleanName = value => value.trim();\n';
const fixed='export const cleanName = value => value.trim().toLowerCase();\n';
const wrong='export const cleanName = value => value.trim().toUpperCase();\n';
const overfit='export const cleanName = value => value.trim() === "Ada" ? "ada" : value.trim();\n';
const HIDDEN="SEALED_SESSION_ACCEPTANCE_SENTINEL";
const publicTest=`import test from "node:test";import assert from "node:assert/strict";
import {message} from "../src/message.mjs";
test("public customer-name reproduction",()=>assert.equal(message("  Ada  "),"Hello, ada"));\n`;
const put=(root,path,text)=>{const full=join(root,...path.split("/"));mkdirSync(dirname(full),{recursive:true});writeFileSync(full,text);};
const git=(root,args)=>execFileSync("git",["-c","core.autocrlf=false","-c","core.fsmonitor=false",
  "-c","core.hooksPath="+join(root,".git","disabled-session-fixture-hooks"),"-c","commit.gpgsign=false",
  "-c","user.name=Session Fixture","-c","user.email=fixture@local.invalid",...args],
  {cwd:root,windowsHide:true,shell:false,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
async function isolated(fn){
  const prefix=join(tmpdir(),"metron-project-session-"),root=mkdtempSync(prefix);
  try{return await fn(root);}finally{
    assert.ok(resolve(root).startsWith(resolve(prefix)),"cleanup remains inside this newly created fixture");
    rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});
  }
}
function fixture(root,{publicBody=publicTest}={}){
  const paths=Object.fromEntries(["repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot"]
    .map(key=>[key,join(root,key)]));Object.values(paths).forEach(path=>mkdirSync(path));
  git(paths.repositoryRoot,["init","-q"]);git(paths.repositoryRoot,["config","core.autocrlf","false"]);
  put(paths.repositoryRoot,"src/name.mjs",broken);
  put(paths.repositoryRoot,"src/message.mjs",'import {cleanName} from "./name.mjs";\nexport const message = name => "Hello, " + cleanName(name);\n');
  put(paths.repositoryRoot,"tests/public.test.mjs",publicBody);put(paths.repositoryRoot,"tests/smoke.test.mjs",publicTest);
  put(paths.repositoryRoot,"README.md","A customer-name project, unrelated to numeric expression repair.\n");
  git(paths.repositoryRoot,["add","."]);git(paths.repositoryRoot,["commit","-qm","pinned failing customer-name baseline"]);
  const baseCommit=git(paths.repositoryRoot,["rev-parse","HEAD"]);
  for(const key of ["baselineRoot","candidateRoot","applyRoot"])
    git(paths.repositoryRoot,["worktree","add","--detach",paths[key],baseCommit]);
  put(paths.acceptanceRoot,"sealed/customer.test.mjs",`import test from "node:test";import assert from "node:assert/strict";
import {cleanName} from "../src/name.mjs";
test("${HIDDEN}",()=>{assert.equal(cleanName("\\tMIXED  "),"mixed");assert.equal(cleanName("  "),"");});\n`);
  const config={id:"customer-session",label:"Registered customer-name project",...paths,baseCommit,
    allowedEdits:[{path:"src/name.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],
    acceptanceTests:["sealed/customer.test.mjs"],postApplyTests:["tests/smoke.test.mjs"]};
  const plan=createRegisteredProjectPlan(config),ledger=join(root,"session-ledger");
  let clock=1700000000000;
  const construct=()=>new RegisteredProjectSessions({root:ledger,plans:[plan],now:()=>clock});
  const engine=construct();
  const input={villageId:"village-1",workId:"work_"+"1".repeat(32),runId:"case_"+"2".repeat(32),workIdentityDigest:"3".repeat(64),
    goal:"Investigate and repair customer-name normalization",incidentContext:{source:"actual saved Gateway symptom",knowledge:[]},
    projectId:plan.id,symptom:"Mixed-case names remain capitalized",evidence:["Actual public reproduction is pinned"],allowStart:true};
  return {plan,config,ledger,engine,input,construct,advance:ms=>{clock+=ms;}};
}
const owner=(engine,sessionId)=>engine.state({sessionId,operator:true});
const claim=(engine,start,claimId="claim_1")=>engine.claim({sessionId:start.session.id,dispatchToken:start.dispatchToken,
  workerId:"existing-codex-worker",claimId});
function candidate(plan,lease,source=fixed){
  put(lease.attempt.workspaceRoot,"src/name.mjs",source);
  return commitRegisteredWorkspace(plan,{workerRoot:lease.attempt.workspaceRoot,message:"Repair observed customer-name behavior"});
}
function report(engine,start,lease,committed,reportId="report_1"){
  const input={sessionId:start.session.id,leaseToken:lease.leaseToken,report:{reportId,candidateCommit:committed.candidateCommit,
    diagnosis:"Normalize trimmed customer names before constructing the message",operations:["Read name and message modules",
      "Read the pinned public reproduction", "Edited registered source and committed actual bytes"],unresolved:[]}};
  return {input,result:engine.report(input)};
}
async function verified(f){
  const start=await f.engine.start(f.input),lease=claim(f.engine,start),committed=candidate(f.plan,lease);
  assert.throws(()=>f.engine.dispatchCapability({sessionId:start.session.id}),{code:"project_operator_capability_required"});
  assert.deepEqual(f.engine.dispatchCapability({sessionId:start.session.id,operator:true}),{dispatchToken:start.dispatchToken});
  report(f.engine,start,lease,committed);
  const review=f.engine.review({sessionId:start.session.id});
  const result=await f.engine.validate({sessionId:start.session.id,reviewedDiffSha256:review.diffSha256,verifier:"independent fixture owner",allowValidation:true});
  assert.equal(result.verification.status,"verified");
  return {start,lease,committed,review,result};
}

test("verified project checks are recomputed for PoUC, bound durably, deduplicated and fenced after interruption",{timeout:240000},async()=>isolated(async root=>{
  const f=fixture(root),{start}=await verified(f),sessionId=start.session.id,v=owner(f.engine,sessionId).verification;
  const request={sessionId,candidateCommit:v.candidateCommit,diffSha256:v.diffSha256,verificationId:v.id,
    reviewer:"local useful-work verifier",allowPoUC:true};
  await assert.rejects(()=>f.engine.reverifyUsefulWork({...request,diffSha256:"0".repeat(64)}),{code:"exact_project_pouc_confirmation_required"});
  const before=readdirSync(f.plan.evidenceRoot).length,first=await f.engine.reverifyUsefulWork(request);
  assert.equal(first.session.status,"candidate_verified");assert.equal(first.session.pouc.status,"verified");
  assert.equal(first.contribution.deduplicated,false);assert.equal(readdirSync(f.plan.evidenceRoot).length,before+2);
  assert.equal(first.contribution.receipt.productionRepairVerified,false);
  assert.equal(first.contribution.receipt.distributedTrust,false);
  assert.equal(JSON.stringify(first.contribution.receipt).includes(HIDDEN),false);
  assert.equal(JSON.stringify(first.contribution.receipt).includes(root),false);
  assert.equal(f.engine.state({sessionId,dispatchToken:start.dispatchToken}).pouc,undefined,"worker view does not acquire sealed receipt evidence");
  const proof=first.session.pouc.proofDigest,ledgerFile=join(f.ledger,"project-pouc-ledger.json"),ledgerBytes=readFileSync(ledgerFile,"utf8");
  const restart=f.construct(),logs=readdirSync(f.plan.evidenceRoot).length;
  assert.equal(owner(restart,sessionId).pouc.proofDigest,proof);assert.equal(readdirSync(f.plan.evidenceRoot).length,logs);
  const duplicate=await restart.reverifyUsefulWork(request);
  assert.equal(duplicate.contribution.deduplicated,true);assert.equal(duplicate.session.pouc.attempts,1);
  assert.equal(readFileSync(ledgerFile,"utf8"),ledgerBytes);assert.equal(readdirSync(f.plan.evidenceRoot).length,logs);
  assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit,"PoUC does not apply code");
  const bad=JSON.parse(ledgerBytes);bad.entries[0].subject.diffSha256="0".repeat(64);writeFileSync(ledgerFile,JSON.stringify(bad));
  assert.throws(()=>f.construct(),{code:"invalid_project_pouc_checkpoint"});writeFileSync(ledgerFile,ledgerBytes);
  // A durable running intent without an observed child close is a checkpoint
  // recovery fixture, not a claim that an actual process crash was exercised.
  const file=join(f.ledger,sessionId+".json"),saved=JSON.parse(readFileSync(file,"utf8"));
  saved.status="pouc_running";saved.pouc={schemaVersion:1,status:"running",attempts:2,verificationId:v.id,
    previousStatus:"candidate_verified",reviewer:request.reviewer,startedAt:1700000000000};
  writeFileSync(file,JSON.stringify(saved));const interrupted=f.construct(),state=owner(interrupted,sessionId);
  assert.equal(state.status,"validation_interrupted");assert.equal(state.pouc.status,"interrupted");
  assert.equal(state.terminationUnconfirmed,true);assert.equal(readdirSync(f.plan.evidenceRoot).length,logs);
  await assert.rejects(()=>interrupted.reverifyUsefulWork(request),{code:"project_execution_termination_unconfirmed"});
}));

function requirementsPlan(root,previous,previousCandidateCommit,index=1){
  const ownerRoot=join(root,"owner-requirements-"+index);
  git(previous.repositoryRoot,["worktree","add","--detach",ownerRoot,previousCandidateCommit]);
  const requirementTest=`import test from "node:test";import assert from "node:assert/strict";
import {message} from "../src/message.mjs";
test("owner-added internal whitespace requirement ${index}",()=>assert.equal(message("  Ada   Lovelace  "),"Hello, ada lovelace"));\n`;
  put(ownerRoot,"tests/public.test.mjs",requirementTest);put(ownerRoot,"tests/smoke.test.mjs",requirementTest);
  put(ownerRoot,"README.md","Owner-added requirements: collapse internal name whitespace. Revision "+index+".\n");
  git(ownerRoot,["add","tests/public.test.mjs","tests/smoke.test.mjs","README.md"]);
  git(ownerRoot,["commit","-qm","Add approved message requirements without changing source"]);
  const baseCommit=git(ownerRoot,["rev-parse","HEAD"]);
  const paths=Object.fromEntries(["baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot"]
    .map(key=>[key,join(root,"revision-"+index+"-"+key)]));Object.values(paths).forEach(path=>mkdirSync(path));
  for(const key of ["baselineRoot","candidateRoot","applyRoot"])
    git(previous.repositoryRoot,["worktree","add","--detach",paths[key],baseCommit]);
  for(const entry of previous.acceptanceManifest)put(paths.acceptanceRoot,entry.path,readFileSync(join(previous.acceptanceRoot,entry.path)));
  return createRegisteredProjectPlan({id:"customer-session-v"+(index+1),label:"Approved message requirements "+index,
    repositoryRoot:previous.repositoryRoot,...paths,baseCommit,allowedEdits:previous.allowedEdits,
    publicTests:previous.publicTests,acceptanceTests:previous.acceptanceTests,postApplyTests:previous.postApplyTests});
}

test("requirements revisions preserve the first success, bind same-work lineage and share the three-attempt budget",{timeout:240000},()=>isolated(async root=>{
  const f=fixture(root),first=await verified(f),oldFile=join(f.ledger,first.start.session.id+".json"),oldBytes=readFileSync(oldFile,"utf8");
  const nextPlan=requirementsPlan(root,f.plan,first.committed.candidateCommit);
  let engine=new RegisteredProjectSessions({root:f.ledger,plans:[f.plan,nextPlan]});
  const request={previousSessionId:first.start.session.id,reviewedPreviousCandidate:first.committed.candidateCommit,
    projectId:nextPlan.id,requirements:"Collapse internal whitespace in customer names",symptom:"Names retain repeated internal spaces",
    evidence:["Owner-added public reproduction"],allowRevision:true};
  await assert.rejects(()=>engine.startRevision({...request,allowRevision:false}),{code:"explicit_project_requirements_revision_required"});
  await assert.rejects(()=>engine.startRevision({...request,reviewedPreviousCandidate:f.plan.baseCommit}),{code:"verified_project_predecessor_required"});
  const revised=await engine.startRevision(request),id=revised.session.id;
  assert.throws(()=>engine.dispatchCapability({sessionId:first.start.session.id,operator:true}),{code:"project_session_superseded"});
  assert.notEqual(id,first.start.session.id);assert.equal(revised.session.workId,first.start.session.workId);
  assert.equal(revised.session.runId,first.start.session.runId);assert.equal(revised.session.workIdentityDigest,f.input.workIdentityDigest);
  assert.deepEqual(revised.session.incidentContext,f.input.incidentContext);
  assert.equal(revised.session.status,"ready_worker");assert.equal(revised.session.baseline.checks[0].testSummary.fail,1);
  assert.equal(revised.session.workAttemptCount,1);assert.equal(revised.session.revision.depth,1);
  assert.equal(revised.session.revision.previousVerificationDigest,first.result.verification.evidenceDigest);
  assert.equal(readFileSync(oldFile,"utf8"),oldBytes,"the successful predecessor is never rewritten");
  const logs=readdirSync(nextPlan.evidenceRoot).length;
  assert.equal((await engine.startRevision(request)).duplicate,true);
  await assert.rejects(()=>engine.startRevision({...request,requirements:"A conflicting requirement replay"}),{code:"project_work_binding_conflict"});
  assert.equal(readdirSync(nextPlan.evidenceRoot).length,logs);
  assert.throws(()=>engine.cancel({sessionId:first.start.session.id,reason:"Cannot mutate the frozen predecessor"}),{code:"project_session_superseded"});
  const second=claim(engine,revised,"revision_claim_1");
  assert.equal(second.attempt.parentCommit,nextPlan.baseCommit);assert.equal(second.budget.used,2);
  assert.equal(second.attempt.number,1);assert.equal(second.attempt.workAttemptNumber,2);
  assert.equal(second.revision.requirements,request.requirements);assert.equal(JSON.stringify(second).includes(HIDDEN),false);
  const stillWrong=candidate(nextPlan,second,wrong);report(engine,revised,second,stillWrong,"revision_report_1");
  let review=engine.review({sessionId:id});
  const failed=await engine.validate({sessionId:id,reviewedDiffSha256:review.diffSha256,verifier:"independent fixture owner",allowValidation:true});
  assert.equal(failed.session.status,"revision_ready");assert.equal(failed.session.workAttemptCount,2);
  const third=claim(engine,revised,"revision_claim_2");
  assert.equal(third.budget.used,3);
  assert.equal(third.attempt.number,2);assert.equal(third.attempt.workAttemptNumber,3);
  const corrected=candidate(nextPlan,third,'export const cleanName = value => value.trim().toLowerCase().replace(/\\s+/g," ");\n');
  report(engine,revised,third,corrected,"revision_report_2");review=engine.review({sessionId:id});
  const final=await engine.validate({sessionId:id,reviewedDiffSha256:review.diffSha256,verifier:"independent fixture owner",allowValidation:true});
  assert.equal(final.session.status,"candidate_verified");assert.equal(final.session.workAttemptCount,3);
  const finalFile=join(f.ledger,id+".json"),finalBytes=readFileSync(finalFile,"utf8");
  const thirdPlan=requirementsPlan(root,nextPlan,corrected.candidateCommit,2);
  engine=new RegisteredProjectSessions({root:f.ledger,plans:[f.plan,nextPlan,thirdPlan]});
  await assert.rejects(()=>engine.startRevision({...request,previousSessionId:id,reviewedPreviousCandidate:corrected.candidateCommit,
    projectId:thirdPlan.id}),{code:"project_attempt_budget_exhausted"});
  assert.equal(owner(engine,id).workAttemptCount,3);assert.equal(readFileSync(oldFile,"utf8"),oldBytes);
  assert.equal(readFileSync(finalFile,"utf8"),finalBytes);
  const tampered=JSON.parse(finalBytes);tampered.revision.previousSessionId=id;
  // Binding tampering fails before any source/check execution.
  writeFileSync(finalFile,JSON.stringify(tampered));
  assert.throws(()=>owner(engine,id),{code:"invalid_project_session_checkpoint"});writeFileSync(finalFile,finalBytes);
  const rebind=record=>{
    const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?
      Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
    record.bindingDigest=createHash("sha256").update(stable([record.villageId,record.workId,record.runId,record.workIdentityDigest,
      record.projectId,record.planDigest,record.goal,record.incidentContext,record.symptom,record.evidence,record.revision])).digest("hex");
    writeFileSync(finalFile,JSON.stringify(record));
  };
  for(const change of [{previousSessionId:id},{previousVerificationDigest:"f".repeat(64)},{depth:3}]){
    const record=JSON.parse(finalBytes);Object.assign(record.revision,change);rebind(record);
    assert.throws(()=>owner(engine,id),{code:"project_revision_lineage_invalid"});
  }
  writeFileSync(finalFile,finalBytes);
}));

test("session reproduces a real baseline, binds/deduplicates work, and issues one renewable worker lease",()=>isolated(async root=>{
  const f=fixture(root);
  await assert.rejects(()=>f.engine.start({...f.input,allowStart:false}),{code:"explicit_registered_project_start_required"});
  const start=await f.engine.start(f.input),sessionId=start.session.id;
  assert.equal(start.session.status,"ready_worker");assert.equal(start.session.baseline.passed,false);
  assert.equal(start.session.baseline.checks[0].exitCode,1);assert.equal(start.session.baseline.checks[0].testSummary.fail,1);
  assert.ok(existsSync(join(f.plan.evidenceRoot,start.session.baseline.checks[0].logFile)));
  const duplicate=await f.engine.start(f.input);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.session.id,sessionId);
  assert.equal(duplicate.dispatchToken,start.dispatchToken);assert.equal(duplicate.session.history.length,start.session.history.length);
  await assert.rejects(()=>f.engine.start({...f.input,symptom:"Different incident"}),{code:"project_work_binding_conflict"});
  for(const changed of [{runId:"case_"+"4".repeat(32)},{goal:"A different goal"},{incidentContext:{source:"different context"}}])
    await assert.rejects(()=>f.engine.start({...f.input,...changed}),{code:"project_work_binding_conflict"});
  assert.throws(()=>f.engine.claim({sessionId,dispatchToken:"0".repeat(64),workerId:"existing-codex-worker",claimId:"bad_claim"}),{code:"project_worker_claim_invalid"});
  const lease=claim(f.engine,start),again=claim(f.engine,start);
  assert.equal(again.duplicate,true);assert.equal(again.leaseToken,lease.leaseToken);assert.equal(again.attempt.workspaceRoot,lease.attempt.workspaceRoot);
  assert.equal(owner(f.engine,sessionId).attempts.length,1);
  assert.equal(git(lease.attempt.workspaceRoot,["rev-parse","HEAD"]),f.plan.baseCommit);
  assert.equal(existsSync(join(lease.attempt.workspaceRoot,"sealed/customer.test.mjs")),false);
  const expiry=lease.attempt.leaseExpiresAt;f.advance(1000);
  assert.ok(f.engine.heartbeat({sessionId,leaseToken:lease.leaseToken}).attempt.leaseExpiresAt>expiry);
  assert.equal(JSON.stringify(owner(f.engine,sessionId)).includes(lease.leaseToken),false);
  assert.equal(JSON.stringify(owner(f.engine,sessionId)).includes(start.dispatchToken),false);
}));

test("healthy and skipped baselines cannot bypass reproduction through cancellation and resume",async()=>{
  for(const [name,publicBody] of [["healthy",'import test from "node:test";test("healthy baseline",()=>{});\n'],
    ["skipped",'import test from "node:test";test("healthy check",()=>{});test.skip("unconfirmed reproduction",()=>{});\n']])
    await isolated(async root=>{
      const f=fixture(root,{publicBody}),start=await f.engine.start(f.input),sessionId=start.session.id;
      assert.equal(start.session.status,name==="healthy"?"not_reproduced":"baseline_unconfirmed");
      assert.equal(start.session.baseline.checks[0].exitCode,0);
      assert.throws(()=>claim(f.engine,start),{code:"project_not_ready_for_worker"});
      if(name==="healthy")assert.throws(()=>f.engine.cancel({sessionId,reason:"Try to resume a healthy baseline"}),{code:"project_session_not_cancellable"});
      else{
        assert.equal(start.session.baseline.checks[0].testSummary.skipped,1);
        assert.equal(f.engine.cancel({sessionId,reason:"Stop an unconfirmed baseline"}).status,"cancelled");
      }
      assert.throws(()=>f.engine.resume({sessionId,allowResume:true}),{code:"project_baseline_reproduction_required"});
      assert.equal(owner(f.engine,sessionId).attempts.length,0);
      assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit);
    });
});

test("host-committed candidate requires exact independent approval before real apply, postcheck and rollback",()=>isolated(async root=>{
  const f=fixture(root),v=await verified(f),sessionId=v.start.session.id;
  assert.deepEqual(v.review.changedPaths,["src/name.mjs"]);assert.equal(v.result.session.status,"candidate_verified");
  assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit,"verification must not apply the candidate");
  const state=owner(f.engine,sessionId),a=state.attempts[0];
  assert.equal(a.publicResult.checks[0].testSummary.pass,1);assert.equal(a.acceptanceResult.checks[0].testSummary.pass,1);
  assert.equal(a.publicResult.inputProofBefore,a.publicResult.inputProofAfter);
  const approval={sessionId,candidateCommit:v.committed.candidateCommit,diffSha256:v.review.diffSha256,
    verificationId:v.result.verification.id,expectedHead:f.plan.baseCommit,reviewer:"fixture project owner",allowApply:true};
  for(const changed of [{allowApply:false},{candidateCommit:f.plan.baseCommit},{diffSha256:"0".repeat(64)},
    {verificationId:"verification_wrong"},{expectedHead:v.committed.candidateCommit}]){
    await assert.rejects(()=>f.engine.apply({...approval,...changed}),{code:"exact_project_application_approval_required"});
    assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit);
  }
  const applied=await f.engine.apply(approval);
  assert.equal(applied.session.status,"applied_verified");assert.equal(applied.application.postApply.passed,true);
  assert.equal(applied.application.readback.head,v.committed.candidateCommit);
  assert.equal(readFileSync(join(f.plan.applyRoot,"src/name.mjs"),"utf8"),fixed);
  const evidenceFiles=readdirSync(f.plan.evidenceRoot),again=await f.engine.apply(approval);
  assert.equal(again.duplicate,true);assert.equal(again.application.id,applied.application.id);
  assert.deepEqual(readdirSync(f.plan.evidenceRoot),evidenceFiles,"uncertain-request retry must not reapply or rerun postchecks");
  assert.throws(()=>f.engine.cancel({sessionId,reason:"Cannot turn applied work back into a resumable worker"}),{code:"project_session_not_cancellable"});
  const rollback={sessionId,expectedHead:v.committed.candidateCommit,reviewer:"fixture project owner",allowRollback:true};
  for(const changed of [{allowRollback:false},{expectedHead:f.plan.baseCommit}])
    assert.throws(()=>f.engine.rollback({...rollback,...changed}),{code:"exact_project_rollback_approval_required"});
  git(f.plan.applyRoot,["switch","--detach",f.plan.baseCommit]);
  assert.throws(()=>f.engine.rollback(rollback),{code:"project_checkout_identity_changed"});
  assert.equal(owner(f.engine,sessionId).status,"application_unresolved");
  assert.equal(owner(f.engine,sessionId).rollback.status,"rollback_unresolved");
  assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit,"a moved target must never be forced");
  git(f.plan.applyRoot,["switch","--detach",v.committed.candidateCommit]);
  const restored=f.engine.rollback(rollback);assert.equal(restored.status,"rolled_back");
  assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit);
  assert.equal(readFileSync(join(f.plan.applyRoot,"src/name.mjs"),"utf8"),broken);
  assert.equal(git(f.plan.repositoryRoot,["rev-parse","HEAD"]),f.plan.baseCommit);
}));

test("real public failure drives a new attempt with prior candidate parent and actual failure feedback",()=>isolated(async root=>{
  const f=fixture(root),start=await f.engine.start(f.input),first=claim(f.engine,start),bad=candidate(f.plan,first,wrong);
  const reported=report(f.engine,start,first,bad),duplicate=f.engine.report(reported.input);
  assert.equal(duplicate.duplicate,true);
  assert.throws(()=>f.engine.report({...reported.input,report:{...reported.input.report,diagnosis:"Different report with same identity"}}),{code:"project_report_id_conflict"});
  assert.throws(()=>f.engine.heartbeat({sessionId:start.session.id,leaseToken:first.leaseToken}),{code:"project_worker_lease_revoked"});
  const reviewed=f.engine.review({sessionId:start.session.id});
  await assert.rejects(()=>f.engine.validate({sessionId:start.session.id,reviewedDiffSha256:reviewed.diffSha256,verifier:"owner",allowValidation:false}),
    {code:"explicit_project_independent_validation_required"});
  await assert.rejects(()=>f.engine.validate({sessionId:start.session.id,reviewedDiffSha256:"0".repeat(64),verifier:"owner",allowValidation:true}),
    {code:"project_reviewed_diff_changed"});
  const failed=await f.engine.validate({sessionId:start.session.id,reviewedDiffSha256:reviewed.diffSha256,verifier:"owner",allowValidation:true});
  assert.equal(failed.verification.status,"public_failed");assert.equal(failed.session.status,"revision_ready");
  assert.equal(failed.session.attempts[0].publicResult.checks[0].exitCode,1);
  assert.equal(failed.session.attempts[0].acceptanceResult,undefined,"public failure must not invoke hidden acceptance");
  const second=claim(f.engine,start,"claim_2");assert.notEqual(second.attempt.workspaceRoot,first.attempt.workspaceRoot);
  assert.equal(second.attempt.parentCommit,bad.candidateCommit);assert.equal(readFileSync(join(second.attempt.workspaceRoot,"src/name.mjs"),"utf8"),wrong);
  assert.match(second.attempt.feedback.checks[0].output,/public customer-name reproduction/);
  assert.equal(second.attempt.feedback.checks[0].testSummary.fail,1);
  assert.equal(second.attempt.feedback.checks[0].outputSha256,failed.session.attempts[0].publicResult.checks[0].outputSha256);
  const repaired=candidate(f.plan,second);assert.equal(git(second.attempt.workspaceRoot,["rev-parse",repaired.candidateCommit+"^"]),bad.candidateCommit);
  report(f.engine,start,second,repaired,"report_2");const review=f.engine.review({sessionId:start.session.id});
  const passed=await f.engine.validate({sessionId:start.session.id,reviewedDiffSha256:review.diffSha256,verifier:"owner",allowValidation:true});
  assert.equal(passed.session.status,"candidate_verified");assert.equal(passed.session.attempts.length,2);
  assert.equal(passed.session.attempts[0].publicResult.checks[0].testSummary.fail,1);
}));

test("hidden acceptance rejection is terminal and worker state never exposes private paths, assertions or output",()=>isolated(async root=>{
  const f=fixture(root),start=await f.engine.start(f.input),lease=claim(f.engine,start),committed=candidate(f.plan,lease,overfit);
  report(f.engine,start,lease,committed);const review=f.engine.review({sessionId:start.session.id});
  const result=await f.engine.validate({sessionId:start.session.id,reviewedDiffSha256:review.diffSha256,verifier:"owner",allowValidation:true});
  assert.equal(result.verification.status,"acceptance_rejected");assert.equal(result.session.status,"candidate_rejected");
  assert.equal(result.session.attempts[0].publicResult.passed,true);
  assert.match(result.session.attempts[0].acceptanceResult.checks[0].output,new RegExp(HIDDEN));
  const worker=f.engine.state({sessionId:start.session.id,dispatchToken:start.dispatchToken}),encoded=JSON.stringify(worker);
  assert.equal(worker.scope.acceptanceTestCount,1);assert.equal(worker.status,"candidate_rejected");
  for(const secret of [HIDDEN,"sealed/customer.test.mjs",f.plan.acceptanceRoot,"acceptanceResult"])
    assert.equal(encoded.includes(secret),false,secret);
  assert.equal(existsSync(join(lease.attempt.workspaceRoot,"sealed/customer.test.mjs")),false);
  assert.throws(()=>claim(f.engine,start,"hidden_retry"),{code:"project_not_ready_for_worker"});
  assert.throws(()=>f.engine.resume({sessionId:start.session.id,allowResume:true}),{code:"project_resume_requires_worker_outcome_review"});
  assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit);
}));

test("lease expiry, cancellation and restart require explicit fresh attempts and fence prior roots/tokens",()=>isolated(async root=>{
  const f=fixture(root),start=await f.engine.start(f.input),first=claim(f.engine,start),sessionId=start.session.id;
  f.advance(300001);
  assert.throws(()=>f.engine.heartbeat({sessionId,leaseToken:first.leaseToken}),{code:"project_worker_lease_expired"});
  assert.equal(owner(f.engine,sessionId).status,"worker_outcome_unknown");
  assert.throws(()=>f.engine.resume({sessionId,allowResume:false}),{code:"explicit_project_resume_required"});
  f.engine.resume({sessionId,allowResume:true});const second=claim(f.engine,start,"claim_2");
  assert.notEqual(second.attempt.workspaceRoot,first.attempt.workspaceRoot);
  assert.throws(()=>f.engine.heartbeat({sessionId,leaseToken:first.leaseToken}),{code:"project_worker_lease_revoked"});
  const restarted=f.construct();assert.equal(owner(restarted,sessionId).status,"worker_outcome_unknown");
  assert.equal(owner(restarted,sessionId).attempts.length,2,"restart must not dispatch a new attempt");
  restarted.cancel({sessionId,reason:"Owner stops the unknown previous worker"});
  assert.equal(owner(restarted,sessionId).status,"cancelled");
  assert.throws(()=>restarted.heartbeat({sessionId,leaseToken:second.leaseToken}),{code:"project_worker_lease_revoked"});
  restarted.acknowledgeStop({sessionId,leaseToken:second.leaseToken});
  restarted.resume({sessionId,allowResume:true});const third=claim(restarted,start,"claim_3");
  assert.notEqual(third.attempt.workspaceRoot,second.attempt.workspaceRoot);
  put(second.attempt.workspaceRoot,"src/name.mjs",wrong);
  assert.equal(readFileSync(join(third.attempt.workspaceRoot,"src/name.mjs"),"utf8"),broken,"stale assigned-root edits must not affect the fresh attempt");
  assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit);
  assert.equal(owner(restarted,sessionId).attempts.length,3);
  restarted.cancel({sessionId,reason:"Review the exhausted attempt budget"});
  assert.throws(()=>restarted.resume({sessionId,allowResume:true}),{code:"project_attempt_budget_exhausted"});
}));

test("restart quarantines an interrupted validator intent without rerunning Node checks",()=>isolated(async root=>{
  const f=fixture(root),start=await f.engine.start(f.input),path=join(f.ledger,start.session.id+".json");
  const evidenceBefore=readdirSync(f.plan.evidenceRoot),original=readFileSync(path,"utf8");
  // Inject only a crash checkpoint marker; no process is left running by this test.
  for(const interrupted of ["baseline_running","validating"]){
    const record=JSON.parse(original);record.status=interrupted;writeFileSync(path,JSON.stringify(record));
    const recovered=f.construct(),state=owner(recovered,start.session.id);
    assert.equal(state.status,"validation_interrupted");assert.equal(state.terminationUnconfirmed,true);
    assert.equal(state.interruptedOperation,interrupted);assert.deepEqual(readdirSync(f.plan.evidenceRoot),evidenceBefore);
    assert.throws(()=>recovered.resume({sessionId:start.session.id,allowResume:true}),{code:"project_execution_termination_unconfirmed"});
    assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit);
  }
}));

test("changed checkpoint bindings and plan registrations are refused before returning state",()=>isolated(async root=>{
  const f=fixture(root),start=await f.engine.start(f.input),path=join(f.ledger,start.session.id+".json"),original=readFileSync(path,"utf8");
  for(const changed of [{goal:"Tampered goal"},{workId:"work_"+"9".repeat(32)},{incidentContext:{source:"tampered"}}]){
    writeFileSync(path,JSON.stringify({...JSON.parse(original),...changed}));
    assert.throws(()=>owner(f.engine,start.session.id),{code:"invalid_project_session_checkpoint"});
  }
  writeFileSync(path,original);
  const changedPlan={...f.plan,planDigest:"0".repeat(64)};
  assert.throws(()=>new RegisteredProjectSessions({root:f.ledger,plans:[changedPlan]}),{code:"registered_project_plan_missing_or_changed"});
  const alternateApply=join(root,"alternate-apply");mkdirSync(alternateApply);
  git(f.plan.repositoryRoot,["worktree","add","--detach",alternateApply,f.plan.baseCommit]);
  const reRegistered=createRegisteredProjectPlan({...f.config,applyRoot:alternateApply});
  assert.equal(reRegistered.planDigest,f.plan.planDigest,"public pathless metadata intentionally stays identical");
  assert.throws(()=>new RegisteredProjectSessions({root:f.ledger,plans:[reRegistered]}),{code:"registered_project_plan_missing_or_changed"});
  assert.equal(git(alternateApply,["rev-parse","HEAD"]),f.plan.baseCommit);
  assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit);
}));

test("persisted verification tampering cannot authorize an unverified descendant candidate",()=>isolated(async root=>{
  const f=fixture(root),v=await verified(f),sessionId=v.start.session.id;
  const unverified=candidate(f.plan,v.lease,wrong),observed=inspectRegisteredCandidate(f.plan,unverified.candidateCommit,{workerRoot:v.lease.attempt.workspaceRoot});
  const path=join(f.ledger,sessionId+".json"),record=JSON.parse(readFileSync(path,"utf8"));
  record.verification.candidateCommit=unverified.candidateCommit;record.verification.diffSha256=observed.diffSha256;
  // Keep the original evidence digest: this commit never passed public/acceptance.
  writeFileSync(path,JSON.stringify(record));
  await assert.rejects(()=>f.engine.apply({sessionId,candidateCommit:unverified.candidateCommit,diffSha256:observed.diffSha256,
    verificationId:record.verification.id,expectedHead:f.plan.baseCommit,reviewer:"owner",allowApply:true}),
    "changed verification evidence must be rejected before application");
  assert.equal(inspectRegisteredApply(f.plan).head,f.plan.baseCommit);
  assert.equal(readFileSync(join(f.plan.applyRoot,"src/name.mjs"),"utf8"),broken);
}));
