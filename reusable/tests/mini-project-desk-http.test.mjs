import test from "node:test";
import assert from "node:assert/strict";
import {request} from "node:http";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createMiniServer} from "../../mini/server.mjs";

// HTTP capability/lifecycle coverage with an explicitly injected worker and
// controller boundary. The browser fixture exercises real Git/session checks.
const OWNER="e".repeat(64),WORKER="a".repeat(64),SESSION="agent_"+"1".repeat(32),PLAN="2".repeat(64);
async function isolated(fn){
  const prefix=join(tmpdir(),"metron-desk-http-"),root=mkdtempSync(prefix);let app;
  try{return await fn(root,async options=>(app=await createMiniServer({root,port:0,...options})));}
  finally{if(app)await app.close();assert.ok(resolve(root).startsWith(resolve(prefix)));rmSync(root,{recursive:true,force:true});}
}
function http(app,path,{method="GET",body,headers={},json=true}={}){
  const encoded=body===undefined?null:JSON.stringify(body);
  return new Promise((resolveResponse,reject)=>{
    const req=request(new URL(path,app.url),{method,agent:false,headers:{...(encoded?{"Content-Type":"application/json","Content-Length":Buffer.byteLength(encoded)}:{}),...headers}},res=>{
      const chunks=[];res.on("data",chunk=>chunks.push(chunk));res.on("error",reject);res.on("end",()=>{
        try{const text=Buffer.concat(chunks).toString("utf8");resolveResponse({status:res.statusCode,headers:res.headers,data:json?JSON.parse(text):text});}catch(error){reject(error);}
      });
    });
    req.on("error",reject);req.setTimeout(5000,()=>req.destroy(new Error("desk HTTP test timed out")));req.end(encoded);
  });
}
const owner={"X-Metron-Project-Operator":OWNER};
const post=(app,path,body,headers={})=>http(app,path,{method:"POST",body,headers:{"X-Metron-Mini":"1",Origin:app.url,...owner,...headers}});

test("ordinary Mini exposes only boolean project availability and keeps owner desk routes locked",()=>isolated(async(root,start)=>{
  const app=await start();
  assert.deepEqual((await http(app,"/api/project/availability")).data,{registeredProjectsConfigured:false,workerConfigured:false,mode:"unavailable"});
  assert.equal((await http(app,"/api/project/catalog")).status,403);
  assert.equal((await http(app,"/api/project/jobs?sessionId="+SESSION)).status,403);
  const guide=await http(app,"/project-guide",{json:false});assert.equal(guide.status,200);
  assert.equal(guide.headers["content-type"],"text/html; charset=utf-8");assert.ok(guide.data.includes('<html lang="ja">'));
  assert.ok(guide.data.includes('href="/project-guide-source"'));
  assert.ok(guide.data.includes('href="/project-guide.css"')&&guide.data.includes('src="/project-guide.js"'));
  assert.equal(guide.headers["content-security-policy"].includes("'unsafe-inline'"),false);
  for(const [asset,type] of [["/project-guide.css","text/css; charset=utf-8"],["/project-guide.js","text/javascript; charset=utf-8"]]){
    const served=await http(app,asset,{json:false});assert.equal(served.status,200);assert.equal(served.headers["content-type"],type);
  }
  assert.equal((await http(app,"/project-guide?path=untrusted-input",{json:false})).data,guide.data);
  const source=await http(app,"/project-guide-source",{json:false});assert.equal(source.status,200);
  assert.equal(source.headers["content-type"],"text/plain; charset=utf-8");assert.ok(source.data.length>100);
  assert.equal((await http(app,"/project-guide-source?path=untrusted-input",{json:false})).data,source.data);
}));

test("owner dispatch returns 202 before an injected worker finishes, deduplicates, sanitizes and aborts on existing cancel action",()=>isolated(async(root,start)=>{
  let began,finish,workerCalls=0,observedAbort=false;
  const started=new Promise(resolve=>{began=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
  const app=await start({projectOperatorToken:OWNER,projectCodexOptions:{label:"Injected worker test",runAttempt:async input=>{
    workerCalls++;assert.equal(input.dispatchToken,WORKER);await input.sessions.state({sessionId:SESSION,dispatchToken:WORKER});
    input.signal.addEventListener("abort",()=>{observedAbort=true;finish();},{once:true});began();await gate;
    return {status:"failed_requires_owner_reconciliation",reason:"project_codex_cancelled",modelLaunchIntent:false,
      modelProcessStarted:false,terminationUnconfirmed:false,process:{exitCode:0},privateToken:WORKER,output:root};
  }}});
  const evidenceRoot=join(root,"private-desk-evidence");mkdirSync(evidenceRoot);
  const plan={id:"http-desk",label:"HTTP injected fixture",schemaVersion:1,planDigest:PLAN,evidenceRoot,
    baseCommit:"3".repeat(40),allowedEdits:[{path:"src/task.mjs",operations:["edit"]}],publicTests:["test/public.test.mjs"],
    postApplyTests:["test/smoke.test.mjs"],acceptanceTestCount:1,acceptanceManifestDigest:"4".repeat(64),baselineManifestDigest:"5".repeat(64)};
  app.work.projectSessions.plans.set(plan.id,plan);
  const session={id:SESSION,projectId:plan.id,planDigest:PLAN,workId:"work_"+"6".repeat(32),villageId:"village-1",runId:"case_"+"7".repeat(32),
    workIdentityDigest:"8".repeat(64),bindingDigest:"9".repeat(64),status:"ready_worker",workAttemptCount:0,attempts:[],history:[],
    work:{projectRepair:{sessionId:SESSION,planDigest:PLAN}}};
  app.work.projectState=input=>{
    assert.equal(input.sessionId,SESSION);
    if(!input.operator){assert.equal(input.dispatchToken,WORKER);return {sessionId:SESSION,projectId:plan.id,planDigest:PLAN,status:session.status};}
    return structuredClone(session);
  };
  app.work.projectSessions.dispatchCapability=input=>{assert.deepEqual(input,{sessionId:SESSION,operator:true});return {dispatchToken:WORKER};};
  app.work.projectAction=async(input,options)=>{assert.equal(options.operator,true);assert.equal(input.action,"cancel");session.status="cancelled";return {session};};
  const body={sessionId:SESSION,projectId:plan.id,planDigest:PLAN,requestId:"request_"+"b".repeat(32),allowExternalCodex:true};
  assert.equal((await http(app,"/api/project/catalog",{headers:{"X-Metron-Project-Operator":"f".repeat(64)}})).status,403);
  const availability=(await http(app,"/api/project/availability")).data;
  assert.deepEqual(availability,{registeredProjectsConfigured:true,workerConfigured:true,mode:"injected_worker_test"});
  const catalog=await http(app,"/api/project/catalog",{headers:owner});assert.equal(catalog.status,200);assert.equal(catalog.data.projects.length,1);
  assert.equal((await http(app,"/api/project/dispatch",{method:"POST",body,headers:owner})).status,403);
  assert.equal((await post(app,"/api/project/dispatch",body,{Origin:"https://foreign.invalid"})).status,403);
  assert.equal((await post(app,"/api/project/dispatch",body,{"X-Metron-Project-Operator":"f".repeat(64)})).status,403);
  assert.equal((await post(app,"/api/project/dispatch",{...body,allowExternalCodex:false})).status,400);
  assert.equal((await post(app,"/api/project/dispatch",{...body,executable:root})).status,400);
  const accepted=await post(app,"/api/project/dispatch",body);assert.equal(accepted.status,202);assert.equal(accepted.data.duplicate,false);
  await started;
  const duplicate=await post(app,"/api/project/dispatch",body);assert.equal(duplicate.status,202);assert.equal(duplicate.data.duplicate,true);assert.equal(workerCalls,1);
  const progress=await http(app,"/api/project/jobs?sessionId="+SESSION,{headers:owner});assert.equal(progress.data.jobs[0].status,"running");
  assert.equal(progress.data.dispatchBlocked,true);assert.equal(progress.data.dispatchBlockedReason,"project_desk_job_active");
  for(const value of [catalog.data,accepted.data,duplicate.data,progress.data]){
    const encoded=JSON.stringify(value);for(const privateValue of [root,OWNER,WORKER,"private-desk-evidence"])assert.equal(encoded.includes(privateValue),false);
  }
  const cancelled=await post(app,"/api/project/action",{action:"cancel",sessionId:SESSION,reason:"Explicit fixture stop"});assert.equal(cancelled.status,200);
  await app.projectDesk.waitForIdle();assert.equal(observedAbort,true);
  const completed=(await http(app,"/api/project/jobs?sessionId="+SESSION,{headers:owner})).data.jobs[0];
  assert.equal(completed.status,"failed_requires_owner_reconciliation");assert.equal(completed.reason,"project_codex_cancelled");
}));
