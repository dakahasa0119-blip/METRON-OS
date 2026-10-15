// Protocol fixtures only. The real ARC repair has separate worker/verifier logs.
// No model, Codex CLI, network beyond loopback, or arbitrary patch execution.
import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {createMiniServer} from "../../mini/server.mjs";
import {workerCli} from "../../mini/worker-cli.mjs";
import {validateExternalRecord,summarizeWorkerTestOutput} from "../../mini/external-worker.mjs";
const SOURCE="mini/arc-browser/content.js",REPRO="reusable/tests/mini-arc-extension-behavior.test.mjs";
const sha=s=>createHash("sha256").update(s).digest("hex");
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==="object"&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const git=(root,args)=>execFileSync("git",["-c","user.name=Protocol Fixture","-c","user.email=fixture@local.invalid",...args],{
 cwd:root,windowsHide:true,shell:false,stdio:["ignore","pipe","pipe"],encoding:"utf8"}).trim();
function put(root,path,text){const file=join(root,...path.split("/"));mkdirSync(join(file,".."),{recursive:true});writeFileSync(file,text);}
function fixture(root){
 const repo=join(root,"candidate"),baseline=join(root,"baseline");mkdirSync(repo);
 git(repo,["init","-q"]);put(repo,SOURCE,"// baseline protocol fixture\n");put(repo,REPRO,"// base\n");
 put(repo,"modules/gas/BAKU/DNA_ANALYST.js","// tracked regression input\n");
 git(repo,["add","."]);git(repo,["commit","-qm","protocol fixture base"]);const base=git(repo,["rev-parse","HEAD"]);
 const testBody="// A deliberately non-reproducing protocol fixture; not evidence of an ARC repair.\n";
 put(repo,REPRO,testBody);git(repo,["add","."]);git(repo,["commit","-qm","protocol fixture reproducer"]);
 const repro=git(repo,["rev-parse","HEAD"]);git(root,["clone","-q","--no-hardlinks",repo,baseline]);
 put(repo,SOURCE,"// candidate protocol fixture\n");git(repo,["add","."]);git(repo,["commit","-qm","protocol fixture candidate"]);
 const candidate=git(repo,["rev-parse","HEAD"]);
 const spec={id:"protocol-fixture",repository:"local-protocol-fixture",baseCommit:base,reproductionCommit:repro,
  reproducer:{path:REPRO,sha256:sha(testBody)},allowedFiles:[{path:SOURCE,operation:"edit"},{path:REPRO,operation:"pinned_reproducer_only"}],
  validation:[{id:"reproduction",command:"node",args:["--test",REPRO]},
   {id:"regression",command:"node",args:["--test","--test-concurrency=1","reusable/tests/*.test.mjs"]}]};
 const plan={...spec,planDigest:sha(stable(spec)),repositoryRoot:repo,baselineRoot:baseline,candidateRoot:repo,
  artifactRoot:join(root,"validation"),tempRoot:join(root,"tmp")};
 return {repo,baseline,base,repro,candidate,plan};
}
async function isolated(fn){const root=mkdtempSync(join(tmpdir(),"metron-worker-protocol-"));try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
const post=async(app,body)=>{const r=await fetch(app.url+"/api/work/action",{method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
async function work(app){
 const r=await fetch(app.url+"/api/mission",{method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},body:JSON.stringify({from:"A",to:"B",message:"Protocol fixture issue, not a real-model response",code:""})});
 const source=await r.json();const c=await post(app,{action:"create",villageId:"village-1",goal:"Protocol boundary fixture",sourceMessageId:source.messageId,knowledgeIds:[]});
 assert.equal(c.status,200);return c.data.work;
}
const exportBody=w=>({action:"worker-export",villageId:w.villageId,workId:w.id,planId:"protocol-fixture",allowWorker:true,symptom:"Fixture symptom",reproduction:"Fixture reproduction",evidence:["Explicit protocol fixture"]});
const report=(w,request,f)=>({schemaVersion:1,requestId:request.requestId,requestDigest:request.requestDigest,
 villageId:w.villageId,workId:w.id,runId:w.runId,baseCommit:f.base,candidateCommit:f.candidate,
 changedPaths:[SOURCE,REPRO],worker:"protocol fixture worker",summary:"A claim is not verification",operations:["fixture local edit"],unresolved:[]});
const action=(w,name,extra={})=>({action:"worker-"+name,villageId:w.villageId,workId:w.id,...extra});

test("verifier reads actual Node TAP and spec summaries without treating arbitrary text as results",()=>{
 for(const prefix of ["#","ℹ"]){
  assert.deepEqual(summarizeWorkerTestOutput(["tests 20","pass 19","fail 1","cancelled 0","skipped 0"].map(x=>prefix+" "+x).join("\n")),
   {tests:20,pass:19,fail:1,cancelled:0,skipped:0});
 }
 assert.equal(summarizeWorkerTestOutput("success true\n# fail 0"),null);
});

test("explicit export pins existing work/context/consent and restart does not execute a worker",()=>isolated(async root=>{
 const f=fixture(root),data=join(root,"data"),opts={root:data,port:0,workOptions:{workerPlans:[f.plan]}};
 let app=await createMiniServer(opts);try{
  const w=await work(app),denied=await post(app,{...exportBody(w),allowWorker:false});assert.equal(denied.status,400);
  const exported=await post(app,exportBody(w));assert.equal(exported.status,200);const request=exported.data.request;
  assert.equal(request.workId,w.id);assert.equal(request.runId,w.runId);assert.equal(request.workIdentityDigest,w.identityDigest);
  assert.equal(request.plan.baseCommit,f.base);assert.equal(request.consent.approved,true);
  assert.ok(!JSON.stringify(request).includes(root));
  f.plan.validation[0].args.push("--unapproved-after-construction");
  await app.close();app=await createMiniServer({...opts,workOptions:{workerPlans:[]}});
  const state=await fetch(app.url+"/api/work/state?villageId=village-1&workId="+w.id).then(r=>r.json());
  assert.equal(state.work.externalRepair.status,"exported");assert.deepEqual(state.work.externalRepair.request,request);
  assert.equal(state.work.executions.length,1);assert.equal(state.work.executions[0].externalConsent,false);
  assert.equal((await post(app,{action:"worker-review",villageId:w.villageId,workId:w.id})).status,400);
 }finally{await app.close();}
}));

test("candidate import stays unverified, is idempotent and rejects wrong bindings/commands/success claims",()=>isolated(async root=>{
 const f=fixture(root),app=await createMiniServer({root:join(root,"data"),port:0,workOptions:{workerPlans:[f.plan]}});
 try{
  const w=await work(app),request=(await post(app,exportBody(w))).data.request,r=report(w,request,f);
  for(const altered of [{...r,baseCommit:"0".repeat(40)},{...r,requestDigest:"0".repeat(64)},
   {...r,villageId:"village-2"},{...r,commands:["execute arbitrary command"]},{...r,success:true}])
   assert.equal((await post(app,action(w,"import",{report:altered}))).status,400);
  assert.equal((await post(app,{...action(w,"import",{report:r}),villageId:"village-2"})).status,400);
  const imported=await post(app,action(w,"import",{report:r}));assert.equal(imported.status,200);
  assert.equal(imported.data.work.stage,"unresolved");assert.equal(imported.data.work.externalRepair.status,"candidate_unverified");
  assert.equal(imported.data.work.result,null);assert.equal(imported.data.work.sharingCandidate,null);
  const duplicate=await post(app,action(w,"import",{report:r}));assert.equal(duplicate.data.duplicate,true);assert.equal(duplicate.data.work.externalRepair.imports.length,1);
  const normal=await fetch(app.url+"/api/agent/run",{method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},body:JSON.stringify({villageId:w.villageId,workId:w.id,provider:"openai",allowExternalCalls:true})});
  assert.equal(normal.status,400);
  assert.equal((await post(app,{action:"prepare-share",villageId:w.villageId,workId:w.id,body:"Cannot share this yet"})).status,400);
  assert.equal(git(f.repo,["rev-parse","HEAD"]),f.candidate);
 }finally{await app.close();}
}));

test("trusted review recollects all tracked bytes even when Git status hides a changed regression input",()=>isolated(async root=>{
 const f=fixture(root),app=await createMiniServer({root:join(root,"data"),port:0,workOptions:{workerPlans:[f.plan]}});
 try{
  const w=await work(app),request=(await post(app,exportBody(w))).data.request;
  await post(app,action(w,"import",{report:report(w,request,f)}));
  assert.equal((await post(app,action(w,"review"))).status,200);
  const path="modules/gas/BAKU/DNA_ANALYST.js";git(f.repo,["update-index","--assume-unchanged",path]);put(f.repo,path,"// hidden modification\n");
  assert.equal(git(f.repo,["status","--porcelain"]),"");
  const denied=await post(app,action(w,"review"));assert.equal(denied.status,400);assert.equal(denied.data.error,"worker_input_changed");
 }finally{await app.close();}
}));

test("worker claims cannot replace the original reproduction; validation failure persists and restores unfinished",()=>isolated(async root=>{
 const f=fixture(root),opts={root:join(root,"data"),port:0,workOptions:{workerPlans:[f.plan]}};let app=await createMiniServer(opts);
 try{
  const w=await work(app),request=(await post(app,exportBody(w))).data.request;await post(app,action(w,"import",{report:report(w,request,f)}));
  const reviewed=(await post(app,action(w,"review"))).data;
  assert.equal((await post(app,action(w,"verify",{reviewedDiffSha256:"0".repeat(64),allowValidation:true,verifier:"independent fixture verifier"}))).status,400);
  const result=await post(app,action(w,"verify",{reviewedDiffSha256:reviewed.diffSha256,allowValidation:true,verifier:"independent fixture verifier"}));
  assert.equal(result.status,200);assert.equal(result.data.verification.status,"failed");
  assert.equal(result.data.verification.reason,"worker_original_reproduction_unconfirmed");
  assert.equal(result.data.verification.checks.length,1);assert.equal(result.data.verification.checks[0].exitCode,0);
  assert.equal(result.data.work.stage,"unresolved");assert.equal(result.data.work.sharingCandidate,null);
  await app.close();app=await createMiniServer(opts);
  const state=await fetch(app.url+"/api/work/state?villageId=village-1&workId="+w.id).then(r=>r.json());
  assert.equal(state.work.externalRepair.status,"verification_failed");assert.equal(state.work.externalRepair.verifications.length,1);
  assert.equal(state.work.stage,"unresolved");
 }finally{await app.close();}
}));

test("restart marks an interrupted independent verifier unfinished and rejects request tampering",()=>isolated(async root=>{
 const f=fixture(root),data=join(root,"data"),opts={root:data,port:0,workOptions:{workerPlans:[f.plan]}};let app=await createMiniServer(opts);
 try{
  const w=await work(app);await post(app,exportBody(w));await app.close();app=null;
  const file=join(data,"work-ledger",w.id+".json"),saved=JSON.parse(readFileSync(file,"utf8"));
  saved.stage="running";saved.externalRepair.status="verifying";
  saved.externalRepair.verifications.push({id:"fixture-interruption",status:"running",checks:[]});writeFileSync(file,JSON.stringify(saved));
  app=await createMiniServer(opts);
  const state=await fetch(app.url+"/api/work/state?villageId=village-1&workId="+w.id).then(r=>r.json());
  assert.equal(state.work.stage,"unresolved");assert.equal(state.work.externalRepair.status,"verification_interrupted");
  assert.equal(state.work.externalRepair.verifications[0].status,"interrupted");
  assert.equal(state.work.externalRepair.terminationUnconfirmed,true);
  const retry=await post(app,action(w,"verify",{reviewedDiffSha256:"0".repeat(64),allowValidation:true,verifier:"independent fixture verifier"}));
  assert.equal(retry.status,400);assert.equal(retry.data.error,"worker_validator_termination_unconfirmed");
  assert.equal(state.work.externalRepair.verifications.length,1);
  const tampered=structuredClone(state.work);tampered.externalRepair.request.goal="tampered";
  assert.throws(()=>validateExternalRecord(tampered),{code:"invalid_external_work_checkpoint"});
 }finally{if(app)await app.close();}
}));

test("operator CLI rejects remote URLs, unknown overrides and local redirects without forwarding",()=>isolated(async root=>{
 await assert.rejects(()=>workerCli(["review","--url","https://example.com"]),{code:"worker_loopback_url_required"});
 await assert.rejects(()=>workerCli(["review","--url","http://127.0.0.1:1","--command","execute"]),{code:"invalid_worker_cli_arguments"});
 const {createServer}=await import("node:http");let received=0;
 const server=createServer((_req,res)=>{received++;res.writeHead(307,{Location:"http://127.0.0.1:1/forbidden"});res.end();});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{await assert.rejects(()=>workerCli(["review","--url","http://127.0.0.1:"+server.address().port]));assert.equal(received,1);}
 finally{await new Promise(resolve=>server.close(resolve));}
}));
