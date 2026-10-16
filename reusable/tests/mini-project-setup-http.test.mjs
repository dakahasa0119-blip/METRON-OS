// Owner-slot preparation through real loopback HTTP and real local Git worktrees.
// Synthetic new repositories/sealed fixtures only; no test program, model or remote Git is invoked.
import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync,lstatSync,rmSync} from "node:fs";
import {join,resolve,relative,isAbsolute} from "node:path";
import {createMiniServer} from "../../mini/server.mjs";
import {startMini} from "../../mini/start.mjs";

const PHASE=resolve(import.meta.dirname,"../../../metron-evidence/village-bootstrap-20261015");
const OWNER="3".repeat(64),OTHER="4".repeat(64); // Synthetic HTTP capabilities, not user credentials.
const requestId=()=>"setup_"+randomUUID().replaceAll("-","");
const sha=b=>createHash("sha256").update(b).digest("hex");
function gitEnvironment(){
  const env={GIT_TERMINAL_PROMPT:"0"};
  for(const key of ["PATH","SystemRoot","WINDIR","COMSPEC","TEMP","TMP"])
    if(typeof process.env[key]==="string")env[key]=process.env[key];
  return env;
}
async function isolated(fn){
  mkdirSync(PHASE,{recursive:true});const root=mkdtempSync(join(PHASE,"setup-http-"));
  let passed=false;try{const result=await fn(root);passed=true;return result;}finally{
    const child=relative(PHASE,root);assert.ok(child&&!child.startsWith("..")&&!isAbsolute(child));
    if(passed)rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
}
function git(root,args){
  const result=spawnSync("git",["--no-replace-objects","-c","core.fsmonitor=false","-c","core.autocrlf=false",
    "-c","core.hooksPath="+join(root,".disabled-http-test-hooks"),"-c","commit.gpgsign=false",
    "-c","user.name=Setup HTTP fixture","-c","user.email=fixture@local.invalid",...args],
  {cwd:root,shell:false,windowsHide:true,encoding:"utf8",timeout:30000,maxBuffer:4*1024*1024,
    env:gitEnvironment()});
  assert.equal(result.status,0,"local fixture Git failed: "+args[0]+"\n"+result.stderr);return result.stdout.trim();
}
function put(root,path,body){const full=join(root,...path.split("/"));mkdirSync(join(full,".."),{recursive:true});writeFileSync(full,body);}
function fixture(root){
  const source=join(root,"source"),sealed=join(root,"sealed"),allocation=join(root,"allocation");
  mkdirSync(source);mkdirSync(sealed);
  git(source,["init","-q"]);
  git(source,["config","--local","core.autocrlf","false"]);
  put(source,"src/value.mjs","export const value = 1;\n");
  const marker=join(root,"unexpected-public-check-run");
  put(source,"tests/public.test.mjs",`import {writeFileSync} from "node:fs";\nwriteFileSync(${JSON.stringify(marker)},"unexpected");\nthrow Error("Setup HTTP fixture checks must not run during preparation");\n`);
  put(source,"tests/smoke.test.mjs","throw Error('Setup HTTP fixture smoke must not run during preparation');\n");
  const sealedMarker=join(root,"unexpected-sealed-check-run");
  put(sealed,"owner.test.mjs",`import {writeFileSync} from "node:fs";\nwriteFileSync(${JSON.stringify(sealedMarker)},"unexpected");\nthrow Error("Synthetic sealed setup fixture must not execute during preparation");\n`);
  git(source,["add","."]);git(source,["commit","-qm","Synthetic owner-approved setup HTTP baseline"]);
  const base=git(source,["rev-parse","HEAD"]),slot={id:"http-setup-slot",label:"Prepared HTTP fixture",repositoryRoot:source,
    baseCommit:base,allowedEdits:[{path:"src/value.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],
    postApplyTests:["tests/smoke.test.mjs"],acceptanceRoot:sealed,acceptanceTests:["owner.test.mjs"],allocationRoot:allocation};
  return {source,sealed,allocation,base,slot,marker,sealedMarker};
}
function sourceProof(f){
  return {head:git(f.source,["rev-parse","HEAD"]),status:git(f.source,["status","--porcelain=v1","--untracked-files=all"]),
    refs:git(f.source,["show-ref"]),files:Object.fromEntries(["src/value.mjs","tests/public.test.mjs","tests/smoke.test.mjs"]
      .map(path=>[path,sha(readFileSync(join(f.source,...path.split("/"))))])),
    sealed:sha(readFileSync(join(f.sealed,"owner.test.mjs")))};
}
async function http(app,path,{body,raw,owner=OWNER,origin,contentType="application/json",explicit=true}={}){
  const headers={};if(owner)headers["X-Metron-Project-Operator"]=owner;
  if(body!==undefined||raw!==undefined){headers["Content-Type"]=contentType;if(explicit)headers["X-Metron-Mini"]="1";}
  if(origin)headers.Origin=origin;
  const response=await fetch(app.url+path,{method:body!==undefined||raw!==undefined?"POST":"GET",headers,
    ...(body!==undefined||raw!==undefined?{body:raw??JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
}
const options=(root,f)=>({root:join(root,"data"),port:0,projectOperatorToken:OWNER,projectSetupSlots:[f.slot]});

test("project setup HTTP permits only owner-approved slots and strict requests, with read-only GETs",{timeout:120000},()=>isolated(async root=>{
  const f=fixture(root),before=sourceProof(f),app=await createMiniServer(options(root,f));try{
    for(const path of ["/api/project/setup","/api/project/setup/state?slotId="+f.slot.id]){
      assert.equal((await http(app,path,{owner:null})).status,403);
      assert.equal((await http(app,path,{owner:OTHER})).status,403);
    }
    const catalog=await http(app,"/api/project/setup");assert.equal(catalog.status,200);
    assert.equal(catalog.data.slots.length,1);const slot=catalog.data.slots[0];assert.equal(slot.status,"unprepared");
    assert.equal(slot.publicScope.acceptanceTestCount,1);assert.deepEqual(catalog.data.activeJobs,[]);
    for(const hidden of [f.source,f.sealed,f.allocation,"owner.test.mjs",OWNER])
      assert.equal(JSON.stringify(catalog.data).includes(hidden),false,"catalog omits host paths, sealed names and capabilities");
    const body={slotId:f.slot.id,setupDigest:slot.setupDigest,requestId:requestId(),allowPrepare:true};
    assert.equal((await http(app,"/api/project/setup/prepare",{body,owner:null})).status,403);
    assert.equal((await http(app,"/api/project/setup/prepare",{body,owner:OTHER})).status,403);
    assert.equal((await http(app,"/api/project/setup/prepare",{body,origin:"https://example.invalid"})).status,403);
    assert.equal((await http(app,"/api/project/setup/prepare",{body,explicit:false})).status,403);
    assert.equal((await http(app,"/api/project/setup/prepare",{body,contentType:"text/plain"})).status,415);
    assert.equal((await http(app,"/api/project/setup/prepare",{raw:"{"})).data.error,"invalid_json");
    for(const invalid of [[],null,{...body,allowPrepare:false},{...body,repositoryRoot:f.source},
      {...body,command:"not a command channel"},{...body,requestId:"request_"+"a".repeat(32)}])
      assert.equal((await http(app,"/api/project/setup/prepare",{body:invalid})).data.error,"project_setup_explicit_prepare_required");
    assert.equal((await http(app,"/api/project/setup/prepare",{body:{...body,slotId:"not-host-approved"}})).data.error,"project_setup_slot_required");
    assert.equal((await http(app,"/api/project/setup/prepare",{body:{...body,setupDigest:"0".repeat(64)}})).data.error,"project_setup_digest_mismatch");
    for(const path of ["/api/project/setup?repositoryRoot=override","/api/project/setup/state?slotId=x&slotId=y"])
      assert.equal((await http(app,path)).data.error,"invalid_management_query");
    assert.equal((await http(app,"/api/project/catalog")).data.projects.length,0);
    assert.equal((await http(app,"/api/project/availability",{owner:null})).data.registeredProjectsConfigured,false);
    assert.equal(existsSync(f.allocation),false);assert.deepEqual(sourceProof(f),before);
    assert.equal(existsSync(f.marker)||existsSync(f.sealedMarker),false);
  }finally{await app.close();}
}));

test("normal startup prepares real Git worktrees by HTTP and rehydrates ready catalog without a model or repeated preparation",{timeout:180000},()=>isolated(async root=>{
  const f=fixture(root),before=sourceProof(f),manifest=join(root,"host-slots.json");
  writeFileSync(manifest,JSON.stringify([f.slot]));
  const env={METRON_MINI_DATA:join(root,"data"),METRON_MINI_PORT:"0",METRON_PROJECT_SETUP_MANIFEST:manifest,METRON_VILLAGE_BOOTSTRAP:"0"};
  async function start(){const messages=[];const app=await startMini({env,log:message=>messages.push(message)});
    const match=messages.map(s=>s.match(/\/experience#project-operator=([a-f0-9]{64})/)).find(Boolean);
    assert.ok(match,"normal startup must provide its owner page");return {app,owner:match[1]};}
  let running=await start(),app=running.app,owner=running.owner;
  try{
    const first=await http(app,"/api/project/setup",{owner}),slot=first.data.slots[0];
    assert.equal(slot.status,"unprepared");assert.equal(existsSync(f.allocation),false);
    assert.equal((await http(app,"/api/project/catalog",{owner})).data.projects.length,0);
    const body={slotId:f.slot.id,setupDigest:slot.setupDigest,requestId:requestId(),allowPrepare:true};
    const accepted=await http(app,"/api/project/setup/prepare",{body,owner});assert.equal(accepted.status,202);
    assert.equal(accepted.data.duplicate,false);const jobId=accepted.data.job.id;
    const duplicate=await http(app,"/api/project/setup/prepare",{body,owner});assert.equal(duplicate.status,202);
    assert.equal(duplicate.data.duplicate,true);assert.equal(duplicate.data.job.id,jobId);
    await app.projectSetup.waitForIdle();
    const ready=await http(app,"/api/project/setup/state?slotId="+f.slot.id,{owner});assert.equal(ready.status,200);
    assert.equal(ready.data.slot.status,"ready",ready.data.job?.reason);assert.equal(ready.data.job.status,"ready");
    const catalog=await http(app,"/api/project/catalog",{owner});assert.equal(catalog.status,200);
    assert.equal(catalog.data.projects.length,1);assert.equal(catalog.data.projects[0].id,f.slot.id);
    assert.equal(catalog.data.projects[0].planDigest,ready.data.job.planDigest);
    assert.equal((await http(app,"/api/project/availability",{owner:null})).data.registeredProjectsConfigured,true);
    assert.equal(app.projectDesk.availability().workerConfigured,false);assert.equal(app.projectDesk.tasks.size,0);
    for(const name of ["b","c","a"]){const directory=join(f.allocation,name);
      assert.equal(git(directory,["rev-parse","HEAD"]),f.base);assert.equal(git(directory,["status","--porcelain=v1"]),"");
      const valueBytes=readFileSync(join(directory,"src","value.mjs"));assert.equal(valueBytes.includes(0),false);
      const valueText=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(valueBytes);
      assert.equal(valueText.replace(/\r\n/g,"\n"),"export const value = 1;\n");}
    assert.equal(git(f.source,["worktree","list","--porcelain"]).split("\n").filter(s=>s.startsWith("worktree ")).length,4);
    assert.deepEqual(sourceProof(f),before);assert.equal(existsSync(f.marker)||existsSync(f.sealedMarker),false);
    assert.equal((await http(app,"/api/project/setup/prepare",{body:{...body,requestId:requestId()},owner})).data.error,"project_setup_slot_already_attempted");
    const recordFile=join(env.METRON_MINI_DATA,"project-setup",f.slot.id+".json"),recordBefore=readFileSync(recordFile);
    const previousOwner=owner;await app.close();running=await start();app=running.app;owner=running.owner;
    assert.notEqual(owner,previousOwner);
    assert.equal((await http(app,"/api/project/setup",{owner:previousOwner})).status,403);
    for(let i=0;i<2;i++){
      const state=await http(app,"/api/project/setup/state?slotId="+f.slot.id,{owner});assert.equal(state.data.slot.status,"ready");
      assert.equal(state.data.job.id,jobId);assert.equal((await http(app,"/api/project/catalog",{owner})).data.projects.length,1);
      assert.equal(app.projectSetup.pending.size,0);assert.equal(app.projectDesk.tasks.size,0);
    }
    assert.deepEqual(readFileSync(recordFile),recordBefore,"startup and state reads do not rewrite or rerun ready preparation");
    const retried=await http(app,"/api/project/setup/prepare",{body,owner});assert.equal(retried.data.duplicate,true);
    assert.equal(retried.data.job.id,jobId);assert.equal(app.projectSetup.pending.size,0);
    assert.equal(git(f.source,["worktree","list","--porcelain"]).split("\n").filter(s=>s.startsWith("worktree ")).length,4);
    assert.deepEqual(sourceProof(f),before);assert.equal(existsSync(f.marker)||existsSync(f.sealedMarker),false);
  }finally{await app.close();}
}));

test("setup cannot overwrite an occupied host allocation and restart preserves the failed attempt without retry",{timeout:120000},()=>isolated(async root=>{
  const f=fixture(root),before=sourceProof(f);mkdirSync(f.allocation);const occupied=join(f.allocation,"owner-existing.txt");
  writeFileSync(occupied,"Synthetic owner data must not be replaced\n");const bytes=readFileSync(occupied);
  const opts=options(root,f);let app=await createMiniServer(opts);try{
    const slot=(await http(app,"/api/project/setup")).data.slots[0],body={slotId:f.slot.id,setupDigest:slot.setupDigest,requestId:requestId(),allowPrepare:true};
    assert.equal((await http(app,"/api/project/setup/prepare",{body})).status,202);await app.projectSetup.waitForIdle();
    const failed=await http(app,"/api/project/setup/state?slotId="+f.slot.id);
    assert.equal(failed.data.slot.status,"requires_owner_reconciliation");assert.equal(failed.data.job.reason,"project_setup_allocation_not_empty");
    assert.deepEqual(readFileSync(occupied),bytes);assert.deepEqual(readdirSync(f.allocation),["owner-existing.txt"]);
    const jobId=failed.data.job.id;await app.close();app=await createMiniServer(opts);
    const restored=await http(app,"/api/project/setup/state?slotId="+f.slot.id);
    assert.equal(restored.data.job.id,jobId);assert.equal(restored.data.slot.status,"requires_owner_reconciliation");
    assert.equal(app.projectSetup.pending.size,0);assert.equal((await http(app,"/api/project/catalog")).data.projects.length,0);
    assert.equal((await http(app,"/api/project/setup/prepare",{body})).data.duplicate,true);assert.equal(app.projectSetup.pending.size,0);
    assert.deepEqual(readFileSync(occupied),bytes);assert.deepEqual(sourceProof(f),before);
  }finally{await app.close();}
}));
