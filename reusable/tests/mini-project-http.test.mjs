import test from "node:test";
import assert from "node:assert/strict";
import {request} from "node:http";
import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname,resolve} from "node:path";
import {createMiniServer} from "../../mini/server.mjs";
import {createRegisteredProjectPlan,commitRegisteredWorkspace} from "../../mini/project-tools.mjs";

// Real loopback HTTP, Gateway delivery, disposable Git worktrees and Node checks.
// The explicitly authored test candidate below exists only to exercise private
// output redaction. No model, coding CLI, remote service or live project is used.
const OPERATOR="a".repeat(64),WRONG="f".repeat(64);
const HIDDEN="HTTP_SEALED_ACCEPTANCE_OUTPUT_SENTINEL";
const incident="Observed customer names retain their original capitalization.";
const goal="Investigate the delivered customer-name incident in the registered project";
const broken='export const cleanName = value => value.trim();\n';
const publicTest=`import test from "node:test";import assert from "node:assert/strict";
import {message} from "../src/message.mjs";
test("public HTTP customer-name reproduction",()=>assert.equal(message("  Ada  "),"Hello, ada"));\n`;
const put=(root,path,text)=>{
  const file=join(root,...path.split("/"));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);
};
const git=(root,args)=>execFileSync("git",["-c","core.autocrlf=false","-c","core.fsmonitor=false",
  "-c","core.hooksPath="+join(root,".git","disabled-http-fixture-hooks"),"-c","commit.gpgsign=false",
  "-c","user.name=HTTP Project Fixture","-c","user.email=fixture@local.invalid",...args],
  {cwd:root,windowsHide:true,shell:false,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();

function fixture(root){
  const paths=Object.fromEntries(["repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot"]
    .map(key=>[key,join(root,key)]));Object.values(paths).forEach(path=>mkdirSync(path));
  git(paths.repositoryRoot,["init","-q"]);git(paths.repositoryRoot,["config","core.autocrlf","false"]);
  put(paths.repositoryRoot,"src/name.mjs",broken);
  put(paths.repositoryRoot,"src/message.mjs",'import {cleanName} from "./name.mjs";\nexport const message = name => "Hello, " + cleanName(name);\n');
  put(paths.repositoryRoot,"src/metadata.mjs","export const format = 'customer-greeting';\n");
  put(paths.repositoryRoot,"tests/public.test.mjs",publicTest);put(paths.repositoryRoot,"tests/smoke.test.mjs",publicTest);
  put(paths.repositoryRoot,"README.md","A dependency-free customer-name parser used only by this HTTP test.\n");
  git(paths.repositoryRoot,["add","."]);git(paths.repositoryRoot,["commit","-qm","Pinned public HTTP reproduction"]);
  const baseCommit=git(paths.repositoryRoot,["rev-parse","HEAD"]);
  for(const key of ["baselineRoot","candidateRoot","applyRoot"])
    git(paths.repositoryRoot,["worktree","add","--detach",paths[key],baseCommit]);
  put(paths.acceptanceRoot,"sealed/customer.test.mjs",`import test from "node:test";import assert from "node:assert/strict";
import {cleanName} from "../src/name.mjs";
test("${HIDDEN}",()=>assert.equal(cleanName("  GRACE  "),"grace"));\n`);
  const config={id:"http-customer",label:"HTTP fixture customer-name project",...paths,baseCommit,
    allowedEdits:[{path:"src/name.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],
    acceptanceTests:["sealed/customer.test.mjs"],postApplyTests:["tests/smoke.test.mjs"]};
  return {config,plan:createRegisteredProjectPlan(config)};
}

async function isolated(fn){
  const prefix=join(tmpdir(),"metron-project-http-"),root=mkdtempSync(prefix);let app;
  try{
    const registered=fixture(root);
    app=await createMiniServer({root:join(root,"runtime"),port:0,projectOperatorToken:OPERATOR,
      workOptions:{projectPlans:[registered.plan],runnerOptions:{env:{}}}});
    return await fn({root,app,...registered});
  }finally{
    if(app)await app.close();
    assert.ok(resolve(root).startsWith(resolve(prefix)),"cleanup is confined to this newly created fixture");
    rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});
  }
}

function http(app,path,{method="GET",body,rawBody,headers={}}={}){
  const encoded=rawBody??(body===undefined?null:JSON.stringify(body));
  const timeoutMs=path==="/api/project/action"&&["start","validate"].includes(body?.action)?120000:20000;
  return new Promise((resolveResponse,reject)=>{
    const req=request(new URL(path,app.url),{method,agent:false,headers:{
      ...(encoded===null?{}:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(encoded)}),...headers
    }},res=>{
      const chunks=[];res.on("data",chunk=>chunks.push(chunk));res.on("error",reject);
      res.on("end",()=>{
        try{resolveResponse({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks).toString("utf8")),headers:res.headers});}
        catch(error){reject(error);}
      });
    });
    req.on("error",reject);req.setTimeout(timeoutMs,()=>req.destroy(new Error("HTTP fixture "+method+" "+
      new URL(path,app.url).pathname+(body?.action?" "+body.action:"")+" timed out after "+timeoutMs+"ms")));
    req.end(encoded);
  });
}
const post=(app,path,body,{operator=false,headers={},rawBody}={})=>http(app,path,{method:"POST",body,rawBody,
  headers:{"X-Metron-Mini":"1",Origin:app.url,...(operator?{"X-Metron-Project-Operator":OPERATOR}:{}),...headers}});
const project=(app,body,options)=>post(app,"/api/project/action",body,options);
const projectState=(app,sessionId,headers={})=>http(app,"/api/project/state?sessionId="+encodeURIComponent(sessionId),{headers});
const assertError=(response,status,error)=>{assert.equal(response.status,status,JSON.stringify(response.data));assert.equal(response.data.error,error);};
const withoutSecrets=(value,secrets)=>{
  const encoded=JSON.stringify(value);
  for(const secret of secrets)assert.equal(encoded.includes(secret),false,"response must redact a private field or capability");
};

async function deliveredWork(app){
  const delivery=await post(app,"/api/mission",{from:"A",to:"B",message:incident,code:""});
  assert.equal(delivery.status,200,JSON.stringify(delivery.data));
  assert.equal(delivery.data.job.state,"done");assert.equal(delivery.data.job.payload.envelope.type,"OBSERVE");
  assert.equal(delivery.data.state.ships.B.messages.find(message=>message.id===delivery.data.messageId)?.body,incident);
  const created=await post(app,"/api/work/action",{action:"create",villageId:"village-1",goal,
    sourceMessageId:delivery.data.messageId,knowledgeIds:[]});
  assert.equal(created.status,200,JSON.stringify(created.data));
  assert.equal(created.data.work.sourceMessage.deliveryState,"done");
  assert.equal(created.data.work.sourceMessage.id,delivery.data.messageId);
  return created.data.work;
}
const startInput=(work,plan)=>({action:"start",villageId:work.villageId,workId:work.id,projectId:plan.id,
  symptom:incident,evidence:["The owner-pinned public customer-name reproduction fails"],allowStart:true});
async function start(app,work,plan){
  const response=await project(app,startInput(work,plan),{operator:true});
  assert.equal(response.status,200,JSON.stringify(response.data));
  const result=response.data;assert.equal(result.session.status,"ready_worker");
  assert.equal(result.session.workId,work.id);assert.equal(result.session.runId,work.runId);
  assert.equal(result.session.goal,goal);assert.equal(result.session.incidentContext.sourceMessage.body,incident);
  assert.equal(result.session.baseline.passed,false);
  assert.equal(result.session.baseline.checks[0].exitCode,1);assert.equal(result.session.baseline.checks[0].testSummary.fail,1);
  assert.match(result.session.baseline.checks[0].output,/public HTTP customer-name reproduction/);
  assert.match(result.dispatchToken,/^[a-f0-9]{64}$/);
  return result;
}
async function claim(app,started){
  const input={action:"claim",sessionId:started.session.id,dispatchToken:started.dispatchToken,
    workerId:"existing-http-test-worker",claimId:"http_claim"};
  const response=await project(app,input);
  assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.status,"worker_active");
  assert.match(response.data.leaseToken,/^[a-f0-9]{64}$/);
  return {input,lease:response.data};
}

test("project HTTP start requires the owner capability and rejects request-supplied registry paths",{timeout:60000},()=>isolated(async({app,plan,config})=>{
  const work=await deliveredWork(app),input=startInput(work,plan);
  for(const headers of [{},{"X-Metron-Project-Operator":WRONG},{"X-Metron-Project-Worker":OPERATOR}])
    assertError(await project(app,input,{headers}),403,"project_operator_capability_required");
  assertError(await project(app,{...input,projectOperatorToken:OPERATOR}),403,"project_operator_capability_required");
  assertError(await project(app,input,{operator:true,headers:{Origin:"https://untrusted.example"}}),403,"invalid_origin");
  const noLocalHeader=await http(app,"/api/project/action",{method:"POST",body:input,
    headers:{"X-Metron-Project-Operator":OPERATOR,Origin:app.url}});
  assertError(noLocalHeader,403,"explicit_local_request_header_required");
  for(const key of ["repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot",
    "allowedEdits","publicTests","acceptanceTests","postApplyTests","projectPlans"]){
    const rejected=await project(app,{...input,[key]:key==="projectPlans"?[config]:"request-controlled-registration"},{operator:true});
    assert.equal(rejected.status,400,JSON.stringify(rejected.data));
    withoutSecrets(rejected.data,[config.acceptanceRoot,HIDDEN]);
  }
  assert.equal((await project(app,{...input,projectId:"unregistered-project"},{operator:true})).status,400);
  const started=await start(app,work,plan);
  assert.equal(started.duplicate,false,"rejected registration attempts must not create a session");
  assert.equal(started.work.id,work.id);assert.equal(started.work.projectRepair.sessionId,started.session.id);
  const duplicate=await project(app,input,{operator:true});
  assert.equal(duplicate.status,200);assert.equal(duplicate.data.duplicate,true);
  assert.equal(duplicate.data.session.id,started.session.id);
  withoutSecrets(started.session,[OPERATOR,started.dispatchToken,config.acceptanceRoot,HIDDEN]);
}));

test("project HTTP worker routes enforce dispatch and lease capabilities and state redacts sealed output",{timeout:180000},()=>isolated(async({app,plan,config})=>{
  const work=await deliveredWork(app),started=await start(app,work,plan),sessionId=started.session.id;
  assertError(await project(app,{action:"claim",sessionId,dispatchToken:WRONG,workerId:"http-worker",claimId:"bad_claim"}),400,"project_worker_claim_invalid");
  const {input,lease}=await claim(app,started);
  assert.equal(git(lease.attempt.workspaceRoot,["rev-parse","HEAD"]),plan.baseCommit);
  assert.equal(existsSync(join(lease.attempt.workspaceRoot,"sealed/customer.test.mjs")),false);
  const duplicate=await project(app,input);assert.equal(duplicate.status,200);
  assert.equal(duplicate.data.duplicate,true);assert.equal(duplicate.data.leaseToken,lease.leaseToken);
  assertError(await project(app,{...input,claimId:"another_claim"}),400,"project_not_ready_for_worker");
  const report={reportId:"http_report",candidateCommit:plan.baseCommit,diagnosis:"Test-owned candidate report",
    operations:["Read the public reproduction"],unresolved:[]};
  for(const action of ["heartbeat","ack-stop","report"]){
    const body={action,sessionId,leaseToken:WRONG,...(action==="report"?{report}:{})};
    assertError(await project(app,body),400,"project_worker_lease_required");
  }
  assertError(await project(app,{action:"review",sessionId},{headers:{"X-Metron-Project-Worker":started.dispatchToken}}),403,"project_operator_capability_required");
  const heartbeat=await project(app,{action:"heartbeat",sessionId,leaseToken:lease.leaseToken});
  assert.equal(heartbeat.status,200);withoutSecrets(heartbeat.data,[OPERATOR,started.dispatchToken,lease.leaseToken]);
  assertError(await projectState(app,sessionId),400,"project_worker_capability_required");
  assertError(await http(app,"/api/project/state?sessionId="+sessionId+"&dispatchToken="+started.dispatchToken),400,"project_worker_capability_required");
  assertError(await projectState(app,sessionId,{"X-Metron-Project-Worker":WRONG}),400,"project_worker_capability_required");

  // This public-only candidate deliberately leaves an unseen name unchanged;
  // the resulting real sealed assertion output lets HTTP redaction be observed.
  put(lease.attempt.workspaceRoot,"src/name.mjs",'export const cleanName = value => value.trim() === "Ada" ? "ada" : value.trim();\n');
  const committed=commitRegisteredWorkspace(plan,{workerRoot:lease.attempt.workspaceRoot,message:"HTTP fixture candidate for redaction coverage"});
  const reported=await project(app,{action:"report",sessionId,leaseToken:lease.leaseToken,
    report:{...report,candidateCommit:committed.candidateCommit}});
  assert.equal(reported.status,200);assert.equal(reported.data.session.status,"awaiting_review");
  const review=await project(app,{action:"review",sessionId},{operator:true});assert.equal(review.status,200);
  const validation=await project(app,{action:"validate",sessionId,reviewedDiffSha256:review.data.diffSha256,
    verifier:"independent HTTP fixture owner",allowValidation:true},{operator:true});
  assert.equal(validation.status,200,JSON.stringify(validation.data));assert.equal(validation.data.verification.status,"acceptance_rejected");
  const operator=await projectState(app,sessionId,{"X-Metron-Project-Operator":OPERATOR});
  assert.equal(operator.status,200);assert.equal(operator.data.id,sessionId);assert.equal(operator.data.work.id,work.id);
  assert.equal(operator.data.attempts[0].publicResult.passed,true);
  assert.match(operator.data.attempts[0].acceptanceResult.checks[0].output,new RegExp(HIDDEN));
  withoutSecrets(operator.data,[OPERATOR,started.dispatchToken,lease.leaseToken]);
  const worker=await projectState(app,sessionId,{"X-Metron-Project-Worker":started.dispatchToken});
  assert.equal(worker.status,200);assert.equal(worker.data.sessionId,sessionId);assert.equal(worker.data.status,"candidate_rejected");
  assert.equal(worker.data.scope.acceptanceTestCount,1);assert.equal(worker.data.work,undefined);
  withoutSecrets(worker.data,[OPERATOR,started.dispatchToken,lease.leaseToken,config.acceptanceRoot,
    HIDDEN,"sealed/customer.test.mjs","acceptanceResult"]);
  const ordinary=await http(app,"/api/work/state?villageId="+work.villageId+"&workId="+work.id);
  assert.equal(ordinary.status,200);withoutSecrets(ordinary.data,[OPERATOR,started.dispatchToken,lease.leaseToken,HIDDEN,"acceptanceResult"]);
  assert.equal(git(plan.applyRoot,["rev-parse","HEAD"]),plan.baseCommit);
}));

test("project HTTP accepts 32 KiB while existing actions retain their 16 KiB body limit",{timeout:60000},()=>isolated(async({app,plan})=>{
  const work=await deliveredWork(app),started=await start(app,work,plan),{lease}=await claim(app,started);
  const heartbeat=JSON.stringify({action:"heartbeat",sessionId:started.session.id,leaseToken:lease.leaseToken});
  const projectBoundary=heartbeat.padEnd(32768," ");assert.equal(Buffer.byteLength(projectBoundary),32768);
  const accepted=await project(app,undefined,{rawBody:projectBoundary});
  assert.equal(accepted.status,200,JSON.stringify(accepted.data));assert.equal(accepted.data.status,"worker_active");
  withoutSecrets(accepted.data,[OPERATOR,started.dispatchToken,lease.leaseToken]);
  assertError(await project(app,undefined,{rawBody:projectBoundary+" "}),400,"payload_too_large");
  const oldBoundary=JSON.stringify({action:"unknown-test-action"}).padEnd(16384," ");
  assert.equal(Buffer.byteLength(oldBoundary),16384);
  assertError(await post(app,"/api/work/action",undefined,{rawBody:oldBoundary}),400,"invalid_work_action");
  assertError(await post(app,"/api/work/action",undefined,{rawBody:oldBoundary+" "}),400,"payload_too_large");
  assertError(await post(app,"/api/work/action",undefined,{rawBody:projectBoundary}),400,"payload_too_large");
  const stillActive=await project(app,{action:"heartbeat",sessionId:started.session.id,leaseToken:lease.leaseToken});
  assert.equal(stillActive.status,200,"a rejected oversized request must leave the existing lease usable");
}));
