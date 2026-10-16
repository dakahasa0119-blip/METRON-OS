import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,lstatSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {runCodexProjectAttempt,inspectCodexExecutable} from "../../mini/project-codex-worker.mjs";
import {registeredAttemptRoot} from "../../mini/project-tools.mjs";

// Injected CLI/process fixtures verify control flow only. No model or service
// is called, and fixture event text is not evidence of actual AI execution.
const SESSION="agent_"+"a".repeat(32),ATTEMPT="attempt_"+"b".repeat(32),DISPATCH="c".repeat(64),LEASE="d".repeat(64);
const BASE="e".repeat(40),CANDIDATE="f".repeat(40),PLAN="1".repeat(64);
const final={diagnosis:"The pending items are incorrectly filtered after normalization.",
  operations:["Read actual source and Git history", "Changed permitted source", "Ran public tests"],unresolved:[]};
const events=[{type:"thread.started",thread_id:"test-observed-thread"},{type:"turn.started"},
  {type:"item.completed",item:{type:"command_execution",command:"node --test tests/public.test.mjs",exit_code:0}},
  {type:"turn.completed",usage:{input_tokens:111,cached_input_tokens:12,output_tokens:44}}];

async function fixture(fn,{onExec,onBeat,onState,onVersion,claimPatch}={}){
  const root=mkdtempSync(join(tmpdir(),"metron-codex-control-"));
  try{
    const tempRoot=join(root,"temp"),evidenceRoot=join(root,"evidence");mkdirSync(tempRoot);mkdirSync(evidenceRoot);
    const plan={id:"project-alpha",planDigest:PLAN,tempRoot,evidenceRoot};
    const workspaceRoot=registeredAttemptRoot(plan,{sessionId:SESSION,attemptId:ATTEMPT});mkdirSync(workspaceRoot,{recursive:true});
    const executable=join(root,process.platform==="win32"?"codex.exe":"codex");writeFileSync(executable,"Injected process fixture only");
    const claim={schemaVersion:1,sessionId:SESSION,projectId:plan.id,planDigest:PLAN,status:"worker_active",
      goal:"Restore pending item listing",incidentContext:{incident:"Synthetic owner-selected project",knowledge:["Preserve completed items"]},
      symptom:"Pending rows disappear after normalization",evidence:["Public baseline: 1 failed assertion"],leaseToken:LEASE,
      scope:{id:plan.id,planDigest:PLAN,baseCommit:BASE,allowedEdits:[{path:"src/items.mjs",operations:["edit"]}],
        publicTests:["tests/public.test.mjs"],acceptanceTestCount:1,acceptanceManifestDigest:"2".repeat(64)},
      attempt:{id:ATTEMPT,number:1,parentCommit:BASE,workspaceRoot,
        feedback:{passed:false,checks:[{exitCode:1,outputSha256:"3".repeat(64),output:"actual public assertion",testSummary:{fail:1,pass:2}}]}}};
    if(claimPatch)claimPatch(claim,root);
    const seen={spawns:[],claims:0,beats:0,reports:[],commits:[],kills:0,inspections:[]};
    const sessions={
      async state(input){assert.deepEqual(input,{sessionId:SESSION,dispatchToken:DISPATCH});if(onState)return onState();
        return {sessionId:SESSION,projectId:plan.id,planDigest:PLAN};},
      async claim(input){seen.claims++;assert.equal(input.dispatchToken,DISPATCH);return structuredClone(claim);},
      async heartbeat(input){seen.beats++;assert.deepEqual(input,{sessionId:SESSION,leaseToken:LEASE});if(onBeat)await onBeat(seen);return claim;},
      async report(input){seen.reports.push(input);return {session:{status:"awaiting_review"}};}
    };
    const spawnProcess=(path,args,options)=>{
      seen.spawns.push({path,args,options});
      const child=new EventEmitter();child.pid=20261015;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
      const input=[];child.stdin.on("data",chunk=>input.push(chunk));
      const close=code=>{child.stdout.end();child.stderr.end();child.emit("close",code);};
      child.kill=()=>{seen.kills++;setImmediate(()=>close(null));return true;};
      child.stdin.once("finish",()=>setImmediate(()=>{
        if(args[0]==="--version"){onVersion?.({executable});child.stdout.write("codex-cli 0.162.0-alpha.17.2\n");close(0);return;}
        const context={child,args,options,prompt:Buffer.concat(input).toString("utf8"),close,
          complete(value=final,eventValues=events){writeFileSync(args[args.indexOf("--output-last-message")+1],JSON.stringify(value));
            child.stdout.write(eventValues.map(e=>JSON.stringify(e)).join("\n")+"\n");close(0);}};
        seen.prompt=context.prompt;
        if(onExec)onExec(context);else context.complete();
      }));return child;
    };
    const input={sessions,plan,sessionId:SESSION,dispatchToken:DISPATCH,workerId:"official-codex",claimId:"claim-one",
      executable,evidenceRoot,timeoutMs:5000,heartbeatMs:60000};
    const dependencies={spawnProcess,inspectWorkspace(p,commit,options){seen.inspections.push({p,commit,options});return {};},
      async commitWorkspace(p,options){seen.commits.push({p,options});return {candidateCommit:CANDIDATE,diffSha256:"4".repeat(64),sourceProof:"5".repeat(64)};}};
    await fn({root,input,dependencies,seen,claim});
  }finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
}

test("official worker scopes one CLI attempt, preserves context and reports a host-created candidate",()=>fixture(async({input,dependencies,seen})=>{
  const result=await runCodexProjectAttempt(input,dependencies);
  assert.equal(result.status,"reported_awaiting_independent_review");assert.equal(result.modelProcessStarted,true);
  assert.equal(result.candidateCommit,CANDIDATE);assert.equal(result.parentCommit,BASE);assert.equal(result.attemptId,ATTEMPT);
  assert.equal(result.terminationUnconfirmed,false);assert.equal(result.cliEvents.threadId,"test-observed-thread");
  assert.deepEqual(result.cliEvents.usage,{input_tokens:111,cached_input_tokens:12,output_tokens:44});
  assert.match(result.identity,/not_model_authentication_attestation/);assert.match(result.executable.version,/0\.162/);
  assert.equal(seen.spawns.length,2);assert.deepEqual(seen.spawns[0].args,["--version"]);
  const invocation=seen.spawns[1];assert.equal(invocation.path,input.executable);assert.equal(invocation.options.cwd,result.workspaceRoot);
  assert.equal(invocation.options.shell,false);assert.equal(invocation.options.windowsHide,true);
  assert.ok(invocation.args.includes("workspace-write"));assert.ok(invocation.args.includes("--json"));assert.ok(invocation.args.includes("--ephemeral"));
  assert.ok(invocation.args.includes("--output-schema"));assert.ok(invocation.args.includes("--output-last-message"));
  assert.ok(!invocation.args.some(arg=>/danger|bypass|skip-git|ignore-user-config|approve-for-me|add-dir/.test(arg)));
  assert.match(seen.prompt,/Restore pending item listing/);assert.match(seen.prompt,/actual public assertion/);
  assert.match(seen.prompt,/Preserve completed items/);assert.match(seen.prompt,/Git history/);
  assert.ok(!seen.prompt.includes(DISPATCH));assert.ok(!seen.prompt.includes(LEASE));assert.ok(!seen.prompt.includes(input.evidenceRoot));
  assert.equal(seen.inspections[0].commit,BASE);assert.equal(seen.commits.length,1);assert.ok(seen.beats>=3);
  assert.equal(seen.reports.length,1);assert.deepEqual(seen.reports[0].report,{reportId:"codex_"+ATTEMPT.slice(8),candidateCommit:CANDIDATE,...final});
  const privateFiles=readdirSync(result.evidenceDirectory);assert.ok(privateFiles.includes("events.jsonl"));assert.ok(privateFiles.includes("prompt.txt"));
  if(process.platform!=="win32")assert.equal(lstatSync(result.evidenceDirectory).mode&0o777,0o700);
  const receipt=readFileSync(join(result.evidenceDirectory,"receipt.json"),"utf8");
  assert.ok(!receipt.includes(DISPATCH));assert.ok(!receipt.includes(LEASE));assert.ok(!receipt.includes("actual public assertion"));
}));

test("requirements-added attempt preserves verified prior success and sends only new public failure feedback",()=>fixture(async({input,dependencies,seen,claim})=>{
  const result=await runCodexProjectAttempt(input,dependencies);
  assert.equal(result.status,"reported_awaiting_independent_review");
  const marker="Registered context and actual prior public-check feedback:\n\n";
  const context=JSON.parse(seen.prompt.slice(seen.prompt.indexOf(marker)+marker.length));
  assert.equal(context.goal,"Restore pending item listing");
  assert.deepEqual(context.incidentContext,claim.incidentContext);
  assert.deepEqual(context.revision,claim.revision);
  assert.equal(context.revision.scenario,"requirements_added");
  assert.equal(context.revision.previousCandidateCommit,CANDIDATE);
  assert.equal(context.revision.previousVerificationId,"verification_previous_success");
  assert.equal(context.revision.previousVerificationDigest,"6".repeat(64));
  assert.equal(context.revision.requirements,"Also retain archived items when includeArchived is requested.");
  assert.equal(context.attempt.number,1);assert.equal(context.attempt.workAttemptNumber,2);
  assert.equal(context.attempt.parentCommit,BASE);
  assert.deepEqual(context.observedPublicFailure,claim.attempt.feedback);
  assert.match(context.observedPublicFailure.checks[0].output,/includeArchived=true omitted archived item/);
  assert.equal(context.observedPublicFailure.checks[0].outputSha256,"8".repeat(64));
  assert.deepEqual(context.observedPublicFailure.checks[0].testSummary,{fail:1,pass:4});
  assert.match(seen.prompt,/previous candidate was already verified under its original requirements/);
  assert.match(seen.prompt,/preserve the prior success/);
  for(const excluded of [DISPATCH,LEASE,"private-acceptance-output-never-send","private-acceptance-path-never-send",
    "private-provider-credential-never-send","actual public assertion"])
    assert.ok(!seen.prompt.includes(excluded),"Private/obsolete field leaked into revision prompt: "+excluded);
  assert.equal(seen.commits.length,1);assert.equal(seen.reports.length,1);
},{claimPatch(claim){
  claim.revision={scenario:"requirements_added",previousSessionId:"agent_"+"9".repeat(32),
    previousCandidateCommit:CANDIDATE,previousVerificationId:"verification_previous_success",
    previousVerificationDigest:"6".repeat(64),requirements:"Also retain archived items when includeArchived is requested.",
    requirementDiffSha256:"7".repeat(64),depth:1};
  claim.attempt.workAttemptNumber=2;
  claim.attempt.feedback={passed:false,checks:[{exitCode:1,outputSha256:"8".repeat(64),
    output:"New public baseline: includeArchived=true omitted archived item",testSummary:{fail:1,pass:4}}]};
  claim.acceptanceResult={output:"private-acceptance-output-never-send"};
  claim.acceptanceRoot="private-acceptance-path-never-send";
  claim.providerCredential="private-provider-credential-never-send";
}}));

test("same completed claim returns durable receipt without a second model or commit",()=>fixture(async({input,dependencies,seen})=>{
  const first=await runCodexProjectAttempt(input,dependencies),second=await runCodexProjectAttempt(input,dependencies);
  assert.equal(second.duplicate,true);assert.equal(second.requestDigest,first.requestDigest);
  assert.equal(seen.spawns.length,2);assert.equal(seen.claims,1);assert.equal(seen.commits.length,1);assert.equal(seen.reports.length,1);
  await assert.rejects(()=>runCodexProjectAttempt({...input,timeoutMs:4000},dependencies),{code:"project_codex_claim_configuration_conflict"});
  assert.equal(seen.spawns.length,2);
}));

test("preflight checks only local version and never starts exec",()=>fixture(async({input,dependencies,seen})=>{
  const value=await inspectCodexExecutable({executable:input.executable,tempRoot:input.plan.tempRoot},dependencies);
  assert.match(value.version,/codex-cli/);assert.match(value.sha256,/^[a-f0-9]{64}$/);assert.equal(seen.spawns.length,1);
  assert.deepEqual(seen.spawns[0].args,["--version"]);assert.equal(seen.claims,0);
}));

test("executable replacement during preflight cannot claim a session or start inference",()=>fixture(async({input,dependencies,seen})=>{
  const result=await runCodexProjectAttempt(input,dependencies);
  assert.equal(result.reason,"project_codex_executable_changed");assert.equal(result.modelLaunchIntent,false);
  assert.equal(seen.spawns.length,1);assert.equal(seen.claims,0);assert.equal(seen.commits.length,0);assert.equal(seen.reports.length,0);
},{onVersion({executable}){writeFileSync(executable,"Replaced injected executable fixture");}}));

test("invalid capability is rejected before a durable intent or CLI probe",()=>fixture(async({input,dependencies,seen})=>{
  await assert.rejects(()=>runCodexProjectAttempt(input,dependencies),{code:"project_worker_capability_required"});
  assert.equal(seen.spawns.length,0);assert.deepEqual(readdirSync(input.evidenceRoot),[]);
},{onState(){throw Object.assign(new Error("denied"),{code:"project_worker_capability_required"});}}));

test("workspace outside the unique registered attempt root cannot start inference",()=>fixture(async({input,dependencies,seen})=>{
  const result=await runCodexProjectAttempt(input,dependencies);assert.equal(result.reason,"project_codex_claim_binding_invalid");
  assert.equal(seen.spawns.length,1);assert.equal(result.modelLaunchIntent,false);assert.equal(seen.commits.length,0);
},{claimPatch(claim,root){claim.attempt.workspaceRoot=root;}}));

test("an existing manual or pull-worker claim cannot be redispatched through the CLI adapter",()=>fixture(async({input,dependencies,seen})=>{
  const result=await runCodexProjectAttempt(input,dependencies);
  assert.equal(result.reason,"project_codex_existing_claim_requires_reconciliation");
  assert.equal(result.status,"failed_requires_owner_reconciliation");assert.equal(result.modelLaunchIntent,false);
  assert.equal(result.modelProcessStarted,false);assert.equal(result.terminationUnconfirmed,false);
  assert.equal(seen.claims,1);assert.equal(seen.spawns.length,1);assert.deepEqual(seen.spawns[0].args,["--version"]);
  assert.equal(seen.commits.length,0);assert.equal(seen.reports.length,0);assert.equal(seen.inspections.length,0);
},{claimPatch(claim){claim.duplicate=true;}}));

test("unrelated provider keys and arbitrary environment secrets are excluded, existing proxy/home routing remains",()=>fixture(async({input,dependencies,seen})=>{
  const keys=["OPENAI_API_KEY","ANTHROPIC_API_KEY","METRON_UNRELATED_SECRET","HTTPS_PROXY"],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    process.env.OPENAI_API_KEY="fixture-provider-key";process.env.ANTHROPIC_API_KEY="fixture-other-key";
    process.env.METRON_UNRELATED_SECRET="fixture-unrelated-secret";process.env.HTTPS_PROXY="http://127.0.0.1:12345";
    const result=await runCodexProjectAttempt(input,dependencies),env=seen.spawns[1].options.env;
    assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.ANTHROPIC_API_KEY,undefined);assert.equal(env.METRON_UNRELATED_SECRET,undefined);
    assert.equal(env.HTTPS_PROXY,process.env.HTTPS_PROXY);
    const receipt=JSON.stringify(result);assert.ok(!receipt.includes("fixture-provider-key"));assert.ok(!receipt.includes("http://127.0.0.1:12345"));
  }finally{for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
}));

test("nonzero CLI exit saves private evidence without committing or reporting",()=>fixture(async({input,dependencies,seen})=>{
  const result=await runCodexProjectAttempt(input,dependencies);assert.equal(result.reason,"project_codex_exit_failed");
  assert.equal(result.status,"failed_requires_owner_reconciliation");assert.equal(result.terminationUnconfirmed,false);
  assert.equal(seen.commits.length,0);assert.equal(seen.reports.length,0);
  assert.equal(readFileSync(join(result.evidenceDirectory,"stderr.txt"),"utf8"),"Fixture service refused request");
},{onExec({child,close}){child.stderr.write("Fixture service refused request");close(1);}}));

for(const [name,mode] of [["invalid final schema","final"],["invalid JSONL","events"],["failed turn","failed"]])
  test(name+" blocks a candidate report",()=>fixture(async({input,dependencies,seen})=>{
    const result=await runCodexProjectAttempt(input,dependencies);assert.equal(result.status,"failed_requires_owner_reconciliation");
    assert.equal(seen.commits.length,0);assert.equal(seen.reports.length,0);
    assert.ok(["project_codex_final_invalid","project_codex_events_invalid","project_codex_turn_not_completed"].includes(result.reason));
  },{onExec(context){
    if(mode==="final")context.complete({...final,command:"injected field"});
    if(mode==="failed")context.complete(final,[events[0],{type:"turn.failed",error:{message:"Fixture failure"}}]);
    if(mode==="events"){writeFileSync(context.args[context.args.indexOf("--output-last-message")+1],JSON.stringify(final));context.child.stdout.write("not-json\n");context.close(0);}
  }}));

test("timeout only signals owned process and leaves descendant termination unconfirmed",()=>fixture(async({input,dependencies,seen})=>{
  const result=await runCodexProjectAttempt({...input,timeoutMs:15},dependencies);
  assert.equal(result.reason,"project_codex_timeout");assert.equal(result.terminationUnconfirmed,true);assert.equal(seen.kills,1);
  assert.equal(seen.commits.length,0);assert.equal(seen.reports.length,0);
},{onExec(){ /* A process fixture that remains active until the owned kill. */ }}));

test("cancellation during execution cannot commit or report, and durable guard prevents parallel or later redispatch",()=>fixture(async({input,dependencies,seen})=>{
  const controller=new AbortController(),running=runCodexProjectAttempt({...input,signal:controller.signal},dependencies);
  while(!seen.prompt)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(()=>runCodexProjectAttempt(input,dependencies),{code:"project_codex_attempt_already_started_requires_reconciliation"});
  controller.abort();const result=await running;assert.equal(result.reason,"project_codex_cancelled");assert.equal(result.terminationUnconfirmed,true);
  assert.equal(seen.commits.length,0);assert.equal(seen.reports.length,0);
  const repeated=await runCodexProjectAttempt(input,dependencies);assert.equal(repeated.duplicate,true);assert.equal(seen.spawns.length,2);
},{onExec(){}}));

test("revoked worker lease stops its owned CLI and cannot commit",()=>fixture(async({input,dependencies,seen})=>{
  const result=await runCodexProjectAttempt({...input,heartbeatMs:10},dependencies);
  assert.equal(result.reason,"project_codex_worker_lease_lost");assert.equal(result.terminationUnconfirmed,true);
  assert.equal(seen.kills,1);assert.equal(seen.commits.length,0);assert.equal(seen.reports.length,0);
},{onExec(){},onBeat(seen){if(seen.beats>1)throw new Error("revoked");}}));

test("lease rejected before launch does not start a model or invent an uncertain process",()=>fixture(async({input,dependencies,seen})=>{
  const result=await runCodexProjectAttempt(input,dependencies);
  assert.equal(result.reason,"project_codex_worker_lease_lost");assert.equal(result.modelProcessStarted,false);
  assert.equal(result.terminationUnconfirmed,false);assert.equal(seen.spawns.length,1);assert.equal(seen.commits.length,0);
},{onBeat(){throw new Error("revoked before launch");}}));

test("aborted input cannot claim or launch any child",()=>fixture(async({input,dependencies,seen})=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>runCodexProjectAttempt({...input,signal:controller.signal},dependencies),{code:"project_codex_cancelled"});
  assert.equal(seen.claims,0);assert.equal(seen.spawns.length,0);
}));

test("output cap stops the owned CLI, bounds evidence, and prevents a candidate",()=>fixture(async({input,dependencies,seen})=>{
  const result=await runCodexProjectAttempt(input,dependencies);assert.equal(result.reason,"project_codex_output_limit");
  assert.equal(result.terminationUnconfirmed,true);assert.equal(seen.commits.length,0);
  assert.ok(readFileSync(join(result.evidenceDirectory,"events.jsonl")).length<=4*1024*1024);
},{onExec({child}){child.stdout.write(Buffer.alloc(4*1024*1024+1,65));}}));

test("host scope validation failure remains unreported and records the exact local reason",()=>fixture(async({input,dependencies,seen})=>{
  dependencies.commitWorkspace=()=>{throw Object.assign(new Error("scope"),{code:"project_candidate_out_of_scope"});};
  const result=await runCodexProjectAttempt(input,dependencies);assert.equal(result.reason,"project_candidate_out_of_scope");
  assert.equal(seen.reports.length,0);assert.equal(result.status,"failed_requires_owner_reconciliation");
}));
