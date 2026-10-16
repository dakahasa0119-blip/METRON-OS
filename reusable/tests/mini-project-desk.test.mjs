import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {ProjectDesk} from "../../mini/project-desk.mjs";

// This suite tests transport/lifecycle with an injected controller boundary.
// Actual Git/session/worker integration is covered by the browser fixture.
const TOKEN="a".repeat(64),SESSION="agent_"+"1".repeat(32),PLAN="2".repeat(64),CANDIDATE="3".repeat(40),DIFF="4".repeat(64),ATTEMPT="attempt_"+"5".repeat(32);
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
function fixture(root){
  const evidenceRoot=join(root,"private-evidence");mkdirSync(evidenceRoot);
  const plan={id:"desk-project",label:"Desk fixture",planDigest:PLAN,evidenceRoot,baseCommit:"6".repeat(40),allowedEdits:[{path:"src/message.mjs",operations:["edit"]}],
    schemaVersion:1,publicTests:["test/public.test.mjs"],postApplyTests:["test/smoke.test.mjs"],acceptanceTestCount:1,
    acceptanceManifestDigest:"7".repeat(64),baselineManifestDigest:"8".repeat(64)};
  const session={id:SESSION,projectId:plan.id,planDigest:PLAN,workId:"work_"+"9".repeat(32),villageId:"village-1",runId:"case_"+"0".repeat(32),
    workIdentityDigest:"b".repeat(64),bindingDigest:"c".repeat(64),status:"ready_worker",workAttemptCount:0,attempts:[],history:[],
    work:{projectRepair:{sessionId:SESSION,planDigest:PLAN}}};
  const work={projectSessions:{plans:new Map([[plan.id,plan]]),state(input){assert.deepEqual(input,{sessionId:SESSION,operator:true});return structuredClone(session);},
    dispatchCapability(input){assert.deepEqual(input,{sessionId:SESSION,operator:true});return {dispatchToken:TOKEN};}},
    projectState(input){assert.deepEqual(input,{sessionId:SESSION,operator:true});return structuredClone(session);}};
  const request={sessionId:SESSION,projectId:plan.id,planDigest:PLAN,requestId:"request_"+"d".repeat(32),allowExternalCodex:true};
  const reported=()=>{session.status="awaiting_review";session.attempts=[{id:ATTEMPT,report:{candidateCommit:CANDIDATE},observed:{diffSha256:DIFF}}];return {
    status:"reported_awaiting_independent_review",attemptId:ATTEMPT,candidateCommit:CANDIDATE,diffSha256:DIFF,
    modelLaunchIntent:false,modelProcessStarted:false,terminationUnconfirmed:false,process:{exitCode:0},
    executable:{path:root},leaseToken:TOKEN,output:"PRIVATE RAW OUTPUT",evidenceDirectory:evidenceRoot};};
  return {plan,session,work,request,reported};
}
async function isolated(fn){const prefix=join(tmpdir(),"metron-desk-"),root=mkdtempSync(prefix);try{return await fn(root);}finally{
  assert.ok(resolve(root).startsWith(resolve(prefix)));rmSync(root,{recursive:true,force:true});}}
const noSecrets=(value,root)=>{const text=JSON.stringify(value);for(const secret of [root,TOKEN,"PRIVATE RAW OUTPUT","private-evidence"])assert.equal(text.includes(secret),false);};

test("desk durably queues one explicit request, returns promptly, binds its report and never exposes private receipt fields",()=>isolated(async root=>{
  const f=fixture(root);let release,started,invocations=0;
  const began=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const desk=new ProjectDesk({root,work:f.work,projectCodexOptions:{label:"Injected local worker",runAttempt:async input=>{
    invocations++;assert.equal(input.plan,f.plan);assert.equal(input.dispatchToken,TOKEN);assert.equal(typeof input.sessions.claim,"function");
    started();await gate;return f.reported();}}});
  try{
    assert.equal(desk.catalog().worker.mode,"injected_worker_test");
    assert.throws(()=>desk.dispatch({...f.request,allowExternalCodex:false},{url:"http://127.0.0.1:1"}),{code:"project_desk_explicit_codex_consent_required"});
    assert.throws(()=>desk.dispatch({...f.request,executable:"arbitrary"},{url:"http://127.0.0.1:1"}),{code:"project_desk_invalid_request"});
    const accepted=desk.dispatch(f.request,{url:"http://127.0.0.1:1"});assert.equal(accepted.job.status,"queued");assert.equal(invocations,0);
    const intent=readFileSync(join(root,"project-desk-jobs",accepted.job.id+".json"),"utf8");assert.equal(intent.includes(TOKEN),false);
    await began;assert.equal(desk.jobs({sessionId:SESSION}).jobs[0].status,"running");
    assert.equal(desk.jobs({sessionId:SESSION}).dispatchBlocked,true);
    assert.equal(desk.jobs({sessionId:SESSION}).dispatchBlockedReason,"project_desk_job_active");
    assert.equal(desk.dispatch(f.request,{url:"http://127.0.0.1:1"}).duplicate,true);assert.equal(invocations,1);
    release();await desk.waitForIdle();
    const job=desk.jobs({sessionId:SESSION}).jobs[0];assert.equal(job.status,"reported_awaiting_independent_review");
    assert.equal(job.candidateCommit,CANDIDATE);assert.equal(job.modelProcessStarted,false);assert.equal(job.exitCode,0);
    assert.equal(desk.jobs({sessionId:SESSION}).dispatchBlocked,false);assert.equal(desk.jobs({sessionId:SESSION}).dispatchBlockedReason,null);
    noSecrets(job,root);noSecrets(desk.catalog(),root);
    assert.equal(desk.dispatch(f.request,{url:"http://127.0.0.1:1"}).duplicate,true);
    assert.throws(()=>desk.dispatch({...f.request,requestId:"request_"+"e".repeat(32)},{url:"http://127.0.0.1:1"}),{code:"project_desk_session_not_ready"});
    const restored=new ProjectDesk({root,work:f.work,projectCodexOptions:{runAttempt:()=>{throw new Error("restart must never call worker");}}});
    assert.equal(restored.jobs({sessionId:SESSION}).jobs[0].candidateCommit,CANDIDATE);await restored.close();
  }finally{release();await desk.close();}
}));

test("restart converts unfinished intent to reconciliation without dispatch and blocks a fresh request until explicit cancel/resume",()=>isolated(async root=>{
  const f=fixture(root);let invocations=0;
  const desk=new ProjectDesk({root,work:f.work,projectCodexOptions:{runAttempt:async()=>{invocations++;return {status:"failed_requires_owner_reconciliation",
    reason:"project_codex_cancelled",modelLaunchIntent:false,modelProcessStarted:false,terminationUnconfirmed:false};}}});
  const accepted=desk.dispatch(f.request,{url:"http://127.0.0.1:1"});await desk.close();
  assert.equal(invocations,0);
  const file=join(root,"project-desk-jobs",accepted.job.id+".json"),job=JSON.parse(readFileSync(file,"utf8"));
  job.status="running";job.modelLaunchIntent=null;job.modelProcessStarted=null;delete job.digest;job.digest=createHash("sha256").update(stable(job)).digest("hex");writeFileSync(file,JSON.stringify(job));
  const restarted=new ProjectDesk({root,work:f.work,projectCodexOptions:{runAttempt:()=>{throw new Error("no automatic dispatch");}}});
  const recovered=restarted.jobs({sessionId:SESSION}).jobs[0];assert.equal(recovered.status,"requires_owner_reconciliation");assert.equal(recovered.terminationUnconfirmed,true);
  assert.equal(restarted.jobs({sessionId:SESSION}).dispatchBlockedReason,"project_desk_termination_unconfirmed");
  assert.throws(()=>restarted.dispatch({...f.request,requestId:"request_"+"e".repeat(32)},{url:"http://127.0.0.1:1"}),{code:"project_desk_session_requires_reconciliation"});
  assert.equal(restarted.dispatch(f.request,{url:"http://127.0.0.1:1"}).duplicate,true);await restarted.close();
}));

test("close aborts the owned worker and retains uncertainty",()=>isolated(async root=>{
  const f=fixture(root);let started,aborted=false;
  const began=new Promise(resolve=>{started=resolve;});
  const desk=new ProjectDesk({root,work:f.work,projectCodexOptions:{runAttempt:input=>new Promise(resolve=>{
    started();input.signal.addEventListener("abort",()=>{aborted=true;resolve({status:"failed_requires_owner_reconciliation",modelLaunchIntent:true,
      modelProcessStarted:true,terminationUnconfirmed:true,reason:"project_codex_cancelled"});},{once:true});})}});
  desk.dispatch(f.request,{url:"http://127.0.0.1:1"});await began;await desk.close();assert.equal(aborted,true);
  const job=desk.jobs({sessionId:SESSION}).jobs[0];assert.equal(job.status,"requires_owner_reconciliation");assert.equal(job.terminationUnconfirmed,true);
}));

test("an unbound success is rejected and a confirmed failure requires owner cancel/resume before another explicit job",()=>isolated(async root=>{
  const f=fixture(root);
  const desk=new ProjectDesk({root,work:f.work,projectCodexOptions:{runAttempt:async()=>({status:"reported_awaiting_independent_review",
    attemptId:ATTEMPT,candidateCommit:CANDIDATE,diffSha256:DIFF,modelLaunchIntent:false,modelProcessStarted:false,terminationUnconfirmed:false})}});
  try{
    desk.dispatch(f.request,{url:"http://127.0.0.1:1"});await desk.waitForIdle();
    assert.equal(desk.jobs({sessionId:SESSION}).jobs[0].reason,"project_desk_receipt_binding_invalid");
    assert.equal(desk.jobs({sessionId:SESSION}).dispatchBlocked,true);
    assert.equal(desk.jobs({sessionId:SESSION}).dispatchBlockedReason,"project_desk_owner_cancel_resume_required");
    const next={...f.request,requestId:"request_"+"e".repeat(32)};
    assert.throws(()=>desk.dispatch(next,{url:"http://127.0.0.1:1"}),{code:"project_desk_session_requires_reconciliation"});
    f.session.history.push({action:"operator_cancel_fences_all_worker_leases"},{action:"explicit_resume_allocates_a_new_attempt_root"});
    assert.equal(desk.jobs({sessionId:SESSION}).dispatchBlocked,false);assert.equal(desk.jobs({sessionId:SESSION}).dispatchBlockedReason,null);
    assert.equal(desk.dispatch(next,{url:"http://127.0.0.1:1"}).duplicate,false);await desk.waitForIdle();
  }finally{await desk.close();}
}));
