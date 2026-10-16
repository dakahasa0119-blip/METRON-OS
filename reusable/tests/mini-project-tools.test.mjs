import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import childProcess from "node:child_process";
import {syncBuiltinESMExports} from "node:module";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,readdirSync,renameSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname,resolve,sep} from "node:path";
import {createRegisteredProjectPlan,projectPlanPublic,createRegisteredAttempt,inspectRegisteredCandidate,
  commitRegisteredWorkspace,runRegisteredChecks,applyRegisteredCandidate,rollbackRegisteredCandidate,inspectRegisteredApply,
  inspectRegisteredProjectRevision} from "../../mini/project-tools.mjs";

const put=(root,path,text)=>{const full=join(root,...path.split("/"));mkdirSync(dirname(full),{recursive:true});writeFileSync(full,text);};
const git=(root,args)=>execFileSync("git",["-c","core.autocrlf=false","-c","core.fsmonitor=false",
  "-c","core.hooksPath="+join(root,".git","disabled-fixture-hooks"),
  "-c","commit.gpgsign=false","-c","user.name=Project Tools Fixture","-c","user.email=fixture@local.invalid",...args],
  {cwd:root,windowsHide:true,shell:false,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const broken='export const cleanName = value => value.trim();\n';
const fixed='export const cleanName = value => value.trim().toLowerCase();\n';
const publicTest=`import test from "node:test";import assert from "node:assert/strict";
import {message} from "../src/message.mjs";
test("normalizes the customer name",()=>assert.equal(message("  Ada  "),"Hello, ada"));\n`;
async function isolated(fn){
  const prefix=join(tmpdir(),"metron-project-tools-"),root=mkdtempSync(prefix);
  try{return await fn(root);}finally{
    assert.ok(resolve(root).startsWith(resolve(prefix)),"cleanup is confined to this newly created fixture");
    rmSync(root,{recursive:true,force:true});
  }
}
function fixture(root,{publicBody=publicTest,extraEdits=[]}={}){
  const paths=Object.fromEntries(["repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot"]
    .map(key=>[key,join(root,key)]));
  Object.values(paths).forEach(path=>mkdirSync(path));
  git(paths.repositoryRoot,["init","-q"]);
  git(paths.repositoryRoot,["config","core.autocrlf","false"]);
  put(paths.repositoryRoot,"src/clean.mjs",broken);
  put(paths.repositoryRoot,"src/message.mjs",'import {cleanName} from "./clean.mjs";\nexport const message = name => "Hello, " + cleanName(name);\n');
  put(paths.repositoryRoot,"src/legacy.mjs","export const unused = true;\n");
  put(paths.repositoryRoot,"tests/public.test.mjs",publicBody);
  put(paths.repositoryRoot,"tests/smoke.test.mjs",publicTest);
  put(paths.repositoryRoot,"README.md","A generic customer-message project.\n");
  git(paths.repositoryRoot,["add","."]);git(paths.repositoryRoot,["commit","-qm","generic project baseline"]);
  const baseCommit=git(paths.repositoryRoot,["rev-parse","HEAD"]);
  for(const key of ["baselineRoot","candidateRoot","applyRoot"])
    git(paths.repositoryRoot,["worktree","add","--detach",paths[key],baseCommit]);
  put(paths.acceptanceRoot,"acceptance/private.test.mjs",`import test from "node:test";import assert from "node:assert/strict";
import {cleanName} from "../src/clean.mjs";
test("independently selected names",()=>{assert.equal(cleanName("\\tMIXED  "),"mixed");assert.equal(cleanName("  "),"");});\n`);
  const config={id:"customer-message",label:"Trusted customer-message project",...paths,baseCommit,
    allowedEdits:[{path:"src/clean.mjs",operations:["edit"]},{path:"src/legacy.mjs",operations:["delete"]},
      {path:"src/tag.mjs",operations:["add"]},...extraEdits],
    publicTests:["tests/public.test.mjs"],acceptanceTests:["acceptance/private.test.mjs"],postApplyTests:["tests/smoke.test.mjs"]};
  return {config,plan:createRegisteredProjectPlan(config)};
}
function commit(root,changes){
  for(const [path,text] of Object.entries(changes)){
    if(text===null)rmSync(join(root,path));else put(root,path,text);
  }
  git(root,["add","."]);git(root,["commit","-qm","candidate based on observed failure"]);
  return git(root,["rev-parse","HEAD"]);
}
test("requirements revision proves ancestry and unchanged source without disclosing private acceptance",t=>isolated(root=>{
  const {plan,config}=fixture(root),worker=createRegisteredAttempt(plan,{sessionId:"revision_source",attemptId:"first",parentCommit:plan.baseCommit});
  const prior=commit(worker.root,{"src/clean.mjs":fixed});
  const requirementRoot=join(root,"requirements-owner");git(plan.repositoryRoot,["worktree","add","--detach",requirementRoot,prior]);
  const newBase=commit(requirementRoot,{"tests/public.test.mjs":publicTest+'test("new requirement",()=>assert.equal(message("Ada   Lovelace"),"Hello, ada lovelace"));\n',
    "README.md":"A new owner-approved whitespace requirement.\n"});
  const paths=Object.fromEntries(["baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot"]
    .map(key=>[key,join(root,"next-"+key)]));Object.values(paths).forEach(path=>mkdirSync(path));
  for(const key of ["baselineRoot","candidateRoot","applyRoot"])git(plan.repositoryRoot,["worktree","add","--detach",paths[key],newBase]);
  put(paths.acceptanceRoot,"acceptance/private.test.mjs",readFileSync(join(plan.acceptanceRoot,"acceptance/private.test.mjs")));
  const next=createRegisteredProjectPlan({...config,...paths,id:"customer-message-v2",baseCommit:newBase});
  const measured=operation=>{
    const original=childProcess.spawnSync,calls=[];let result;const began=performance.now();
    childProcess.spawnSync=(command,args,...options)=>{if(command==="git")calls.push([...args]);return original(command,args,...options);};
    syncBuiltinESMExports();
    try{result=operation();}finally{childProcess.spawnSync=original;syncBuiltinESMExports();}
    return {result,calls,ms:performance.now()-began};
  };
  const cold=measured(()=>inspectRegisteredProjectRevision(plan,next,{previousCandidateCommit:prior})),proof=cold.result;
  const warm=measured(()=>inspectRegisteredProjectRevision(plan,next,{previousCandidateCommit:prior}));
  assert.deepEqual(warm.result,proof);assert.ok(cold.calls.length>20);assert.equal(warm.calls.length,2);
  assert.ok(warm.calls.every(args=>args.includes("rev-parse")),"cache hits retain live Git common-dir checks only");
  warm.result.changedRequirementPaths.push("cannot-poison-cache");
  assert.deepEqual(inspectRegisteredProjectRevision(plan,next,{previousCandidateCommit:prior}),proof);
  t.diagnostic(`revision proof Git processes: cold=${cold.calls.length}, warm=${warm.calls.length}; elapsed ms cold=${Math.round(cold.ms)}, warm=${Math.round(warm.ms)}`);
  assert.equal(proof.sourceUnchanged,true);assert.equal(proof.newBaseCommit,newBase);
  assert.deepEqual(proof.changedRequirementPaths,["README.md","tests/public.test.mjs"]);
  assert.match(proof.requirementDiffSha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(proof).includes("private.test.mjs"),false);
  assert.throws(()=>inspectRegisteredProjectRevision(plan,{...next,commonRoot:next.commonRoot+"-other"},{previousCandidateCommit:prior}),
    {code:"project_revision_registration_mismatch"});
  assert.throws(()=>inspectRegisteredProjectRevision(plan,{...next,allowedEdits:[{path:"src/clean.mjs",operations:["edit"]}]},{previousCandidateCommit:prior}),
    {code:"project_revision_registration_mismatch"});
  const changedSource=commit(requirementRoot,{"src/message.mjs":"export const message = () => 'changed source';\n"});
  assert.throws(()=>inspectRegisteredProjectRevision(plan,{...next,baseCommit:changedSource},{previousCandidateCommit:prior}),
    {code:"project_revision_source_changed"});
  assert.throws(()=>inspectRegisteredProjectRevision(plan,{...next,baseCommit:prior},{previousCandidateCommit:prior}),
    {code:"project_revision_requirements_unchanged"});
  const objects=join(plan.commonRoot,"objects"),savedObjects=join(plan.commonRoot,"saved-test-objects");
  for(const path of [objects,savedObjects])assert.ok(resolve(path).startsWith(resolve(root)+sep));
  renameSync(objects,savedObjects);mkdirSync(objects);
  try{
    assert.throws(()=>inspectRegisteredProjectRevision(plan,next,{previousCandidateCommit:prior}),{code:"project_git_failed"},
      "replacing the object directory invalidates a successful cached proof");
  }finally{rmSync(objects,{recursive:true,force:true});renameSync(savedObjects,objects);}
}));
const attempt=(plan,id="attempt_"+"0".repeat(32),parentCommit=plan.baseCommit)=>
  createRegisteredAttempt(plan,{sessionId:"agent_"+"1".repeat(32),attemptId:id,parentCommit});

test("owner registration freezes public metadata, opaque private-test digest and isolated Git roots",()=>isolated(root=>{
  const {config,plan}=fixture(root),visible=projectPlanPublic(plan),encoded=JSON.stringify(visible);
  assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.allowedEdits[0].operations));
  assert.equal(visible.acceptanceTestCount,1);assert.match(visible.planDigest,/^[a-f0-9]{64}$/);
  assert.equal(encoded.includes(root),false);assert.equal(encoded.includes("private.test.mjs"),false);
  assert.equal(encoded.includes("independently selected names"),false);
  assert.throws(()=>createRegisteredProjectPlan({...config,applyRoot:config.candidateRoot}),{code:"project_roots_overlap"});
  assert.throws(()=>createRegisteredProjectPlan({...config,allowedEdits:[{path:"../escape.mjs",operations:["edit"]}]}),{code:"project_unsafe_relative_path"});
  assert.throws(()=>createRegisteredProjectPlan({...config,allowedEdits:[{path:"node_modules/x.mjs",operations:["add"]}]}),{code:"project_unsafe_relative_path"});
  assert.throws(()=>createRegisteredProjectPlan({...config,allowedEdits:[{path:"tests/smoke.test.mjs",operations:["edit"]}]}),{code:"project_tests_not_pinned"});
  put(config.acceptanceRoot,"acceptance/private.test.mjs","// Changed private input\n");
  assert.notEqual(createRegisteredProjectPlan(config).planDigest,plan.planDigest);
}));

test("full-length runtime IDs use bounded attempt paths, never reuse roots and inherit committed history",()=>isolated(root=>{
  const {plan}=fixture(root),first=attempt(plan);
  assert.equal(first.commit,plan.baseCommit);assert.equal(git(first.root,["rev-parse","HEAD"]),plan.baseCommit);
  assert.equal(first.root.includes("agent_"+"1".repeat(32)),false);
  assert.equal(first.root.includes("attempt_"+"0".repeat(32)),false);
  assert.throws(()=>attempt(plan),{code:"project_attempt_root_already_exists"});
  const candidate=commit(first.root,{"src/clean.mjs":fixed});
  const second=attempt(plan,"attempt_"+"0".repeat(31)+"1",candidate);assert.notEqual(first.root,second.root);
  assert.equal(readFileSync(join(second.root,"src/clean.mjs"),"utf8"),fixed);
  assert.equal(existsSync(join(second.root,"acceptance/private.test.mjs")),false);
  assert.throws(()=>inspectRegisteredCandidate(plan,candidate,{workerRoot:plan.baselineRoot}),{code:"project_worker_root_not_registered"});
}));

test("actual Git edits/additions/deletions are scoped and tracked bytes are checked beyond Git status",()=>isolated(root=>{
  const {plan}=fixture(root),worker=attempt(plan);
  const candidate=commit(worker.root,{"src/clean.mjs":fixed,"src/legacy.mjs":null,"src/tag.mjs":"export const tag = 'reviewed';\n"});
  const inspected=inspectRegisteredCandidate(plan,candidate,{workerRoot:worker.root});
  assert.deepEqual(inspected.changedPaths,["src/clean.mjs","src/legacy.mjs","src/tag.mjs"]);
  assert.match(inspected.diffSha256,/^[a-f0-9]{64}$/);assert.match(inspected.sourceProof,/^[a-f0-9]{64}$/);
  git(worker.root,["update-index","--assume-unchanged","src/message.mjs"]);put(worker.root,"src/message.mjs","// hidden changed input\n");
  assert.equal(git(worker.root,["status","--porcelain"]),"");
  assert.throws(()=>inspectRegisteredCandidate(plan,candidate,{workerRoot:worker.root}),{code:"project_tracked_bytes_changed"});
}));

test("a candidate touching unregistered public files is refused",()=>isolated(root=>{
  const {plan}=fixture(root),worker=attempt(plan);
  const candidate=commit(worker.root,{"README.md":"Unregistered rewrite\n"});
  assert.throws(()=>inspectRegisteredCandidate(plan,candidate,{workerRoot:worker.root}),{code:"project_candidate_out_of_scope"});
}));

test("real baseline failure, immutable public/acceptance checks, separate apply and explicit rollback",()=>isolated(async root=>{
  const {config,plan}=fixture(root),worker=attempt(plan);
  const baseline=await runRegisteredChecks(plan,{kind:"baseline",commit:plan.baseCommit,attemptId:"baseline"});
  assert.equal(baseline.passed,false);assert.equal(baseline.checks[0].exitCode,1);
  assert.equal(baseline.checks[0].testSummary.fail,1);assert.equal(baseline.terminationUnconfirmed,false);
  const candidate=commit(worker.root,{"src/clean.mjs":fixed});
  for(const kind of ["public","acceptance"]){
    const result=await runRegisteredChecks(plan,{kind,commit:candidate,attemptId:"fixed_"+kind,workerRoot:worker.root});
    assert.equal(result.passed,true,JSON.stringify(result.checks.map(check=>({error:check.error,output:check.output}))));
    assert.equal(result.inputProofBefore,result.inputProofAfter);assert.equal(result.checks[0].testSummary.tests,1);
    assert.ok(existsSync(join(plan.evidenceRoot,result.checks[0].logFile)));
    assert.equal(result.checks[0].output.includes(root),false);
    assert.equal(existsSync(join(worker.root,"acceptance/private.test.mjs")),false);
  }
  assert.equal(inspectRegisteredApply(plan).head,plan.baseCommit);
  const applied=applyRegisteredCandidate(plan,{expectedHead:plan.baseCommit,candidateCommit:candidate});
  assert.equal(applied.head,candidate);assert.equal(applied.rollbackCommit,plan.baseCommit);
  const recoveredPlan=createRegisteredProjectPlan(config);
  assert.equal(recoveredPlan.planDigest,plan.planDigest);assert.equal(inspectRegisteredApply(recoveredPlan).head,candidate);
  const smoke=await runRegisteredChecks(plan,{kind:"post_apply",commit:candidate,attemptId:"smoke"});
  assert.equal(smoke.passed,true);assert.equal(inspectRegisteredApply(plan).sourceProof,applied.sourceProof);
  assert.throws(()=>applyRegisteredCandidate(plan,{expectedHead:plan.baseCommit,candidateCommit:candidate}),{code:"project_checkout_identity_changed"});
  assert.equal(rollbackRegisteredCandidate(plan,{expectedHead:candidate}).head,plan.baseCommit);
  assert.equal(git(plan.baselineRoot,["rev-parse","HEAD"]),plan.baseCommit);
}));

test("the host committer stages only registered changes with a local identity and refuses outside staged edits",()=>isolated(root=>{
  const {plan}=fixture(root),worker=attempt(plan);
  put(worker.root,"src/clean.mjs",fixed);put(worker.root,"src/tag.mjs","export const tag = 'reviewed';\n");
  rmSync(join(worker.root,"src/legacy.mjs"));
  const result=commitRegisteredWorkspace(plan,{workerRoot:worker.root,message:"Repair customer-name normalization"});
  assert.deepEqual(result.changedPaths,["src/clean.mjs","src/legacy.mjs","src/tag.mjs"]);
  assert.equal(git(worker.root,["show","-s","--format=%an <%ae>","HEAD"]),"Codex <codex@local.invalid>");
  put(worker.root,"README.md","Unregistered staged edit\n");git(worker.root,["add","README.md"]);
  assert.throws(()=>commitRegisteredWorkspace(plan,{workerRoot:worker.root,message:"Refuse outside edit"}),{code:"project_candidate_out_of_scope"});
  assert.equal(git(worker.root,["rev-parse","HEAD"]),result.candidateCommit);
}));

test("Node verification cannot read outside its copy or start another process",()=>isolated(async root=>{
  const {plan}=fixture(root,{publicBody:`import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";import {spawnSync} from "node:child_process";
test("bounded verifier permissions",()=>{
 assert.throws(()=>readFileSync(new URL("../../outside.txt",import.meta.url)),{code:"ERR_ACCESS_DENIED"});
 assert.throws(()=>spawnSync(process.execPath,["-e","process.exit(0)"]),{code:"ERR_ACCESS_DENIED"});
});\n`});
  put(plan.tempRoot,"outside.txt","An isolated fixture outside the verification copy\n");
  const result=await runRegisteredChecks(plan,{kind:"baseline",commit:plan.baseCommit,attemptId:"permissions"});
  assert.equal(result.passed,true,result.checks[0].output);
}));

test("a worker cannot redefine pinned public tests and modified private acceptance tests cannot execute",()=>isolated(async root=>{
  const {plan}=fixture(root,{extraEdits:[{path:"tests/public.test.mjs",operations:["edit"]}]}),worker=attempt(plan);
  const candidate=commit(worker.root,{"tests/public.test.mjs":'import test from "node:test";test("worker says success",()=>{});\n'});
  const checked=await runRegisteredChecks(plan,{kind:"public",commit:candidate,attemptId:"public",workerRoot:worker.root});
  assert.equal(checked.passed,false);assert.equal(checked.checks[0].testSummary.fail,1);
  assert.match(checked.checks[0].output,/normalizes the customer name/);
  put(plan.acceptanceRoot,"acceptance/private.test.mjs","throw new Error('must not run');\n");
  await assert.rejects(()=>runRegisteredChecks(plan,{kind:"acceptance",commit:candidate,attemptId:"private",workerRoot:worker.root}),{code:"project_acceptance_input_changed"});
}));

test("dirty apply state and wrong expected commits refuse switch or rollback",()=>isolated(root=>{
  const {plan}=fixture(root),worker=attempt(plan),candidate=commit(worker.root,{"src/clean.mjs":fixed});
  put(plan.applyRoot,"README.md","Local uncommitted edit\n");assert.equal(inspectRegisteredApply(plan).clean,false);
  assert.throws(()=>applyRegisteredCandidate(plan,{expectedHead:plan.baseCommit,candidateCommit:candidate}),{code:"project_checkout_not_clean"});
  assert.equal(git(plan.applyRoot,["rev-parse","HEAD"]),plan.baseCommit);
  assert.throws(()=>applyRegisteredCandidate(plan,{expectedHead:candidate,candidateCommit:candidate}),{code:"project_apply_expected_base_required"});
  assert.throws(()=>rollbackRegisteredCandidate(plan,{expectedHead:candidate}),{code:"project_checkout_identity_changed"});
}));

test("skipped tests never pass and runtime environment does not inherit unregistered values",()=>isolated(async root=>{
  const {plan}=fixture(root,{publicBody:`import test from "node:test";import assert from "node:assert/strict";
test("environment is scrubbed",()=>assert.equal(process.env.PROJECT_TOOL_TEST_SENTINEL,undefined));
test.skip("no skipped success",()=>{});\n`});
  process.env.PROJECT_TOOL_TEST_SENTINEL="fixture-only";
  try{const result=await runRegisteredChecks(plan,{kind:"baseline",commit:plan.baseCommit,attemptId:"skip"});
    assert.equal(result.passed,false);assert.equal(result.checks[0].exitCode,0);assert.equal(result.checks[0].testSummary.skipped,1);
    assert.equal(result.checks[0].testSummary.pass,1);
  }finally{delete process.env.PROJECT_TOOL_TEST_SENTINEL;}
}));

test("aborting an actual test process preserves its verification copy and honestly quarantines descendants",()=>isolated(async root=>{
  const {plan}=fixture(root,{publicBody:'import test from "node:test";test("bounded long task",async()=>{await new Promise(resolve=>setTimeout(resolve,1000));});\n'});
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),200);
  try{const result=await runRegisteredChecks(plan,{kind:"baseline",commit:plan.baseCommit,attemptId:"cancel",signal:controller.signal});
    assert.equal(result.passed,false);assert.equal(result.terminationUnconfirmed,true);
    assert.equal(result.checks[0].error,"project_check_cancelled");
    assert.ok(readdirSync(plan.tempRoot).some(name=>name.startsWith("project-verification-")));
  }finally{clearTimeout(timer);await new Promise(resolve=>setTimeout(resolve,1200));}
}));
