// Simulated adapter/plan/transport boundaries only. These tests never start
// Codex, invoke a model, use credentials, make HTTP requests or edit a project.
import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,statSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {projectCodexCli} from "../../mini/project-codex-cli.mjs";

const DISPATCH="b".repeat(64),SESSION="agent_"+"a".repeat(32);
async function temporary(fn){
  const prefix=join(tmpdir(),"metron-codex-cli-simulated-"),root=mkdtempSync(prefix);
  try{return await fn(root);}finally{
    assert.ok(resolve(root).startsWith(resolve(prefix)),"cleanup stays inside this newly created fixture");
    rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});
  }
}
function fixture(root){
  mkdirSync(root,{recursive:true});
  const registry=join(root,"registry.json"),workerToken=join(root,"worker.txt");
  const config={id:"registered-fixture",evidenceRoot:join(root,"evidence"),
    acceptanceRoot:join(root,"private-acceptance-do-not-print")};
  mkdirSync(config.evidenceRoot);writeFileSync(registry,JSON.stringify([config]));writeFileSync(workerToken,DISPATCH+"\n");
  const argv=["--registry",registry,"--project-id",config.id,"--url","http://127.0.0.1:8766",
    "--session-id",SESSION,"--worker-token-file",workerToken,"--codex-executable",join(root,"codex.exe"),
    "--worker-id","simulated-worker","--claim-id","simulated-claim","--confirm-external-codex"];
  const calls={plans:[],clients:[],attempts:[],stdout:[],stderr:[]},signals=new EventEmitter();
  const sessions=Object.freeze({claim(){throw Error("Simulated adapter must not claim");}});
  const result={status:"reported_awaiting_independent_review",sessionId:SESSION,projectId:config.id,
    modelProcessStarted:true,terminationUnconfirmed:false,duplicate:false,
    evidenceDirectory:join(config.evidenceRoot,"simulated-attempt"),cliEvents:{identity:"simulated_not_real_ai"}};
  const dependencies={signalTarget:signals,stdout:text=>calls.stdout.push(text),stderr:text=>calls.stderr.push(text),
    createPlan:value=>{calls.plans.push(value);return Object.freeze({...value});},
    createClient:value=>{calls.clients.push(value);return sessions;},
    runAttempt:async value=>{calls.attempts.push(value);return {...result};}};
  const withOption=(key,value)=>{
    const args=argv.slice(),index=args.indexOf(key);args[index+1]=value;return args;
  };
  return {registry,workerToken,config,argv,calls,signals,sessions,result,dependencies,withOption};
}
function noWork(f){
  assert.equal(f.calls.plans.length,0);assert.equal(f.calls.clients.length,0);assert.equal(f.calls.attempts.length,0);
}

test("external Codex confirmation is mandatory before any registry load, claim or adapter call",()=>temporary(async root=>{
  const f=fixture(root),missing=f.argv.filter(value=>value!=="--confirm-external-codex");
  const index=missing.indexOf("--registry");missing[index+1]=join(root,"must-not-be-read.json");
  await assert.rejects(()=>projectCodexCli(missing,f.dependencies),{code:"explicit_external_codex_confirmation_required"});
  noWork(f);assert.equal(f.calls.stdout.length,0);assert.equal(f.calls.stderr.length,0);
  await assert.rejects(()=>projectCodexCli([...f.argv,"true"],f.dependencies),{code:"invalid_project_codex_cli_arguments"});
  noWork(f);
}));

test("exact arguments reject duplicate flags, missing values and authority or command overrides",()=>temporary(async root=>{
  const f=fixture(root);
  for(const extra of [["--url","http://127.0.0.1:9000"],["--operator-token-file","must-not-read"],
    ["--command","arbitrary"],["--model","arbitrary"],["--sandbox","danger-full-access"],
    ["--evidence-root",root],["--confirm-external-codex"],["--output"]])
    await assert.rejects(()=>projectCodexCli([...f.argv,...extra],f.dependencies),{code:"invalid_project_codex_cli_arguments"});
  for(const key of ["--registry","--project-id","--url","--session-id","--worker-token-file",
    "--codex-executable","--worker-id","--claim-id"]){
    const args=f.argv.slice(),index=args.indexOf(key);args.splice(index,2);
    await assert.rejects(()=>projectCodexCli(args,f.dependencies),{code:"invalid_project_codex_cli_arguments"});
  }
  noWork(f);
}));

test("only a literal loopback server and a named local Codex executable reach plan loading",()=>temporary(async root=>{
  const f=fixture(root);
  for(const url of ["https://127.0.0.1:8766","http://localhost:8766","http://127.0.0.2:8766",
    "http://127.0.0.1:8766/path","http://user@127.0.0.1:8766","http://127.0.0.1:0","http://127.0.0.1:65536"])
    await assert.rejects(()=>projectCodexCli(f.withOption("--url",url),f.dependencies),{code:"project_loopback_url_required"});
  for(const executable of ["codex.exe",join(root,"arbitrary.exe")])
    await assert.rejects(()=>projectCodexCli(f.withOption("--codex-executable",executable),f.dependencies),
      {code:"project_codex_official_executable_required"});
  noWork(f);
}));

test("a BOM registry selects the full local plan and invokes only the worker client and explicit adapter",()=>temporary(async root=>{
  const f=fixture(root),other={id:"another-fixture",evidenceRoot:join(root,"other")};
  writeFileSync(f.registry,"\uFEFF"+JSON.stringify([other,f.config]));writeFileSync(f.workerToken,DISPATCH+"\r\n");
  const result=await projectCodexCli(f.argv,{...f.dependencies,timeoutMs:12345,requestTimeoutMs:5432});
  assert.equal(result.status,"reported_awaiting_independent_review");
  assert.deepEqual(f.calls.plans,[f.config]);assert.deepEqual(f.calls.clients,[{url:"http://127.0.0.1:8766",timeoutMs:5432}]);
  assert.equal(f.calls.attempts.length,1);const input=f.calls.attempts[0];
  assert.equal(input.sessions,f.sessions);assert.deepEqual(input.plan,f.config);
  assert.equal(input.sessionId,SESSION);assert.equal(input.dispatchToken,DISPATCH);
  assert.equal(input.workerId,"simulated-worker");assert.equal(input.claimId,"simulated-claim");
  assert.equal(input.executable,join(root,"codex.exe"));assert.equal(input.evidenceRoot,f.config.evidenceRoot);
  assert.equal(input.timeoutMs,12345);assert.equal(input.signal.aborted,false);
  assert.deepEqual(Object.keys(input).sort(),["claimId","dispatchToken","evidenceRoot","executable","plan","sessionId","sessions","signal","timeoutMs","workerId"].sort());
  assert.match(f.calls.stderr.join(""),/OpenAI.*installed login/);
  const printed=JSON.parse(f.calls.stdout.join(""));
  assert.deepEqual(printed,{status:result.status,receiptPath:join(result.evidenceDirectory,"receipt.json"),
    modelProcessStarted:true,terminationUnconfirmed:false,duplicate:false});
  for(const privateValue of [DISPATCH,f.config.acceptanceRoot,"cliEvents"])
    assert.equal(f.calls.stdout.join("").includes(privateValue),false);
  assert.equal(f.signals.listenerCount("SIGINT"),0);assert.equal(f.signals.listenerCount("SIGTERM"),0);
}));

test("invalid registry and worker files are bounded and rejected before plan or adapter work",()=>temporary(async root=>{
  const f=fixture(root);
  for(const value of [[],{},[f.config,f.config],[{...f.config,id:"other"}]]){
    writeFileSync(f.registry,JSON.stringify(value));
    await assert.rejects(()=>projectCodexCli(f.argv,f.dependencies),
      {code:Array.isArray(value)&&value.length===1?"registered_project_not_found":"invalid_project_codex_registry"});
  }
  for(const bytes of [Buffer.from("not JSON"),Buffer.from([0xff,0xfe])]){
    writeFileSync(f.registry,bytes);
    await assert.rejects(()=>projectCodexCli(f.argv,f.dependencies),{code:"invalid_project_codex_registry_json"});
  }
  writeFileSync(f.registry," ".repeat(32769));
  await assert.rejects(()=>projectCodexCli(f.argv,f.dependencies),{code:"invalid_project_codex_registry_file"});
  writeFileSync(f.registry,JSON.stringify([f.config]));
  for(const value of ["b".repeat(63),"B".repeat(64),DISPATCH+"\n\n","x".repeat(257)]){
    writeFileSync(f.workerToken,value);
    await assert.rejects(()=>projectCodexCli(f.argv,f.dependencies),{code:"invalid_project_codex_worker_token_file"});
  }
  noWork(f);
}));

test("output receipts are private, exclusively created and never overwrite an existing file",()=>temporary(async root=>{
  const f=fixture(root),output=join(root,"private-receipt.json");writeFileSync(output,"existing owner file");
  await assert.rejects(()=>projectCodexCli([...f.argv,"--output",output],f.dependencies),{code:"project_codex_output_file_exists"});
  assert.equal(readFileSync(output,"utf8"),"existing owner file");noWork(f);
  rmSync(output);const result=await projectCodexCli([...f.argv,"--output",output],f.dependencies);
  assert.deepEqual(JSON.parse(readFileSync(output,"utf8")),result);
  assert.equal(JSON.parse(f.calls.stdout.join("")).receiptPath,resolve(output));
  if(process.platform!=="win32")assert.equal(statSync(output).mode&0o777,0o600);
}));

test("failed adapter results and exceptions keep diagnostics private and leave a bounded receipt",()=>temporary(async root=>{
  const f=fixture(root),output=join(root,"failure-receipt.json");
  const failed={...f.result,status:"failed_requires_owner_reconciliation",reason:"simulated_private_failure",
    terminationUnconfirmed:true,modelProcessStarted:false};
  await projectCodexCli(f.argv,{...f.dependencies,runAttempt:async()=>failed});
  assert.deepEqual(JSON.parse(f.calls.stdout.join("")),{status:failed.status,
    receiptPath:join(failed.evidenceDirectory,"receipt.json"),modelProcessStarted:false,
    terminationUnconfirmed:true,duplicate:false});
  f.calls.stdout.length=0;
  await assert.rejects(()=>projectCodexCli([...f.argv,"--output",output],{...f.dependencies,runAttempt:async()=>{
    throw Object.assign(new Error("RAW private diagnostic "+DISPATCH),{code:"simulated_adapter_failure"});
  }}),{code:"simulated_adapter_failure"});
  const saved=readFileSync(output,"utf8");
  assert.equal(JSON.parse(saved).reason,"simulated_adapter_failure");
  assert.equal(saved.includes(DISPATCH),false);assert.equal(saved.includes("RAW"),false);
  assert.equal(f.calls.stdout.length,0);assert.equal(f.calls.stderr.join("").includes("RAW"),false);
  assert.equal(f.signals.listenerCount("SIGINT"),0);assert.equal(f.signals.listenerCount("SIGTERM"),0);
}));

test("linked registry ancestors are rejected without loading their content",t=>temporary(async(root)=>{
  const f=fixture(root),linked=join(root,"linked"),actual=join(root,"actual");mkdirSync(actual);
  writeFileSync(join(actual,"registry.json"),JSON.stringify([f.config]));
  try{symlinkSync(actual,linked,process.platform==="win32"?"junction":"dir");}
  catch(error){if(["EPERM","EACCES","ENOSYS"].includes(error.code)){t.skip("Host does not permit creating a simulated directory link");return;}throw error;}
  await assert.rejects(()=>projectCodexCli(f.withOption("--registry",join(linked,"registry.json")),f.dependencies),
    {code:"project_codex_cli_symlink_rejected"});noWork(f);
}));

test("SIGINT and SIGTERM abort the owned adapter without operator cancellation and handlers are removed",()=>temporary(async root=>{
  for(const event of ["SIGINT","SIGTERM"]){
    const path=join(root,event);mkdirSync(path);const f=fixture(path);let started;
    const pendingStart=new Promise(resolveStart=>{started=resolveStart;});
    const existing=()=>{};f.signals.on(event,existing);
    const work=projectCodexCli(f.argv,{...f.dependencies,runAttempt:async input=>{
      f.calls.attempts.push(input);started();await new Promise(done=>input.signal.addEventListener("abort",done,{once:true}));
      return {...f.result,status:"failed_requires_owner_reconciliation",terminationUnconfirmed:true};
    }});
    await pendingStart;f.signals.emit(event);const result=await work;
    assert.equal(f.calls.attempts[0].signal.aborted,true);assert.equal(result.terminationUnconfirmed,true);
    assert.equal(f.signals.listenerCount(event),1);assert.equal(f.signals.listeners(event)[0],existing);
    assert.equal(f.signals.listenerCount(event==="SIGINT"?"SIGTERM":"SIGINT"),0);
  }
}));

test("external aborts forward to the owned controller and adapter failures remove signal handlers",()=>temporary(async root=>{
  const f=fixture(root),external=new AbortController();let started;
  const pendingStart=new Promise(resolveStart=>{started=resolveStart;});
  const work=projectCodexCli(f.argv,{...f.dependencies,signal:external.signal,runAttempt:async input=>{
    started();await new Promise(done=>input.signal.addEventListener("abort",done,{once:true}));
    throw Object.assign(new Error("PRIVATE simulated diagnostics must not print"),{code:"simulated_adapter_failure"});
  }});
  await pendingStart;external.abort();await assert.rejects(work,{code:"simulated_adapter_failure"});
  assert.equal(f.signals.listenerCount("SIGINT"),0);assert.equal(f.signals.listenerCount("SIGTERM"),0);
  assert.equal(f.calls.stdout.length,0);assert.equal(f.calls.stderr.join("").includes("PRIVATE"),false);
  const alreadyAborted=new AbortController();alreadyAborted.abort();
  const untouched=fixture(join(root,"already-aborted"));
  await assert.rejects(()=>projectCodexCli(untouched.argv,{...untouched.dependencies,signal:alreadyAborted.signal}),{code:"project_codex_cancelled"});
  noWork(untouched);
}));
