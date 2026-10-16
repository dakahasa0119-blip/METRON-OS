// Real isolated Chromium, production DOM controls, loopback HTTP, Git and Node
// checks. The registered worker is an explicitly injected LOCAL TEST FIXTURE.
// No Codex executable, model, external provider, user profile or CUA is invoked.
import test from "node:test";
import assert from "node:assert/strict";
import {createServer,request} from "node:http";
import {execFile,execFileSync} from "node:child_process";
import {promisify} from "node:util";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {createMiniServer} from "../../mini/server.mjs";
import {createRegisteredProjectPlan,commitRegisteredWorkspace,inspectRegisteredApply} from "../../mini/project-tools.mjs";
import {verifyRumor} from "../../mini/rumor-protocol.mjs";

const execute=promisify(execFile),OPERATOR="a".repeat(64),WRONG="f".repeat(64);
const LABEL="INJECTED LOCAL WORKER - NOT REAL AI",HIDDEN="SEALED_UI_ASSERTION_TEXT";
const sha=value=>createHash("sha256").update(value).digest("hex");
const TEST_SOURCE_SHA256=sha(readFileSync(new URL(import.meta.url)));
const STATIC_ASSETS=new Set(["/","/experience","/client.js","/experience.js","/project-ui.js","/style.css","/experience.css","/arc-kit.mjs"]);
function chromium(){
  return [process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser",
    process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,"Google","Chrome","Application","chrome.exe"),
    process.env["PROGRAMFILES(X86)"]&&join(process.env["PROGRAMFILES(X86)"],"Microsoft","Edge","Application","msedge.exe")
  ].filter(Boolean).find(existsSync)||null;
}
const put=(root,path,text)=>{const file=join(root,...path.split("/"));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
const git=(root,args)=>execFileSync("git",["-c","core.longpaths=true","-c","core.autocrlf=false","-c","core.fsmonitor=false",
  "-c","core.hooksPath="+join(root,".git","disabled-browser-fixture-hooks"),"-c","commit.gpgsign=false",
  "-c","user.name=Registered Browser Fixture","-c","user.email=fixture@local.invalid",...args],
  {cwd:root,windowsHide:true,shell:false,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
function fixture(root){
  const paths=Object.fromEntries(["repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot"]
    .map(key=>[key,join(root,key)]));Object.values(paths).forEach(path=>mkdirSync(path));
  git(paths.repositoryRoot,["init","-q"]);git(paths.repositoryRoot,["config","core.autocrlf","false"]);
  put(paths.repositoryRoot,"src/name.mjs","export const cleanName = value => value.trim();\n");
  put(paths.repositoryRoot,"src/message.mjs",'import {cleanName} from "./name.mjs";\nexport const message = name => "Hello, " + cleanName(name);\n');
  const publicTest='import test from "node:test";import assert from "node:assert/strict";import {message} from "../src/message.mjs";\n'+
    'test("public registered-browser name reproduction",()=>assert.equal(message("  Ada  "),"Hello, ada"));\n';
  put(paths.repositoryRoot,"tests/public.test.mjs",publicTest);put(paths.repositoryRoot,"tests/smoke.test.mjs",publicTest);
  put(paths.repositoryRoot,"README.md","First-party disposable customer-name fixture for registered UI tests.\n");
  git(paths.repositoryRoot,["add","."]);git(paths.repositoryRoot,["commit","-qm","Pinned registered-browser reproduction"]);
  const baseCommit=git(paths.repositoryRoot,["rev-parse","HEAD"]);
  for(const key of ["baselineRoot","candidateRoot","applyRoot"])git(paths.repositoryRoot,["worktree","add","--detach",paths[key],baseCommit]);
  put(paths.acceptanceRoot,"sealed/owner.test.mjs",'import test from "node:test";import assert from "node:assert/strict";import {cleanName} from "../src/name.mjs";\n'+
    `test("${HIDDEN}",()=>assert.equal(cleanName("  GRACE  "),"grace"));\n`);
  return createRegisteredProjectPlan({id:"browser-customer",label:"Registered browser customer fixture",...paths,baseCommit,
    allowedEdits:[{path:"src/name.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],
    acceptanceTests:["sealed/owner.test.mjs"],postApplyTests:["tests/smoke.test.mjs"]});
}

function localWorker(){
  const calls=[],held=new Map(),released=new Set();
  return {calls,release:number=>{released.add(number);held.get(number)?.();},releaseAll:()=>{for(const release of held.values())release();},
    runAttempt:async({sessions,plan,sessionId,dispatchToken,workerId,claimId,signal})=>{
      const number=calls.length+1,record={number,sessionId,workerId,claimId,label:LABEL,modelCalls:0};calls.push(record);
      const visible=await sessions.state({sessionId,dispatchToken});assert.equal(visible.projectId,plan.id);
      const lease=await sessions.claim({sessionId,dispatchToken,workerId,claimId});
      record.attemptId=lease.attempt.id;record.parentCommit=lease.attempt.parentCommit;
      assert.equal(JSON.stringify(lease).includes(HIDDEN),false);
      assert.equal(existsSync(join(lease.attempt.workspaceRoot,"sealed/owner.test.mjs")),false);
      await sessions.heartbeat({sessionId,leaseToken:lease.leaseToken});
      await new Promise(resolveHeld=>{held.set(number,resolveHeld);if(released.has(number)||signal?.aborted)resolveHeld();else signal?.addEventListener("abort",resolveHeld,{once:true});});
      held.delete(number);assert.notEqual(signal?.aborted,true,"fixture must not continue after cancellation");
      // These are deliberately authored fixture candidates, never AI output.
      put(lease.attempt.workspaceRoot,"src/name.mjs",number===1?
        "export const cleanName = value => value.trim().toUpperCase();\n":
        "export const cleanName = value => value.trim().toLowerCase();\n");
      const candidate=commitRegisteredWorkspace(plan,{workerRoot:lease.attempt.workspaceRoot,message:"Labelled local browser fixture attempt "+number});
      record.candidateCommit=candidate.candidateCommit;record.diffSha256=candidate.diffSha256;
      const reported=await sessions.report({sessionId,leaseToken:lease.leaseToken,report:{reportId:"browser_report_"+number,
        candidateCommit:candidate.candidateCommit,diagnosis:LABEL+": authored fixture candidate "+number,
        operations:["Claimed the real registered lease","Edited only allowed source","Host committed actual bytes"],unresolved:[]}});
      assert.equal(reported.session.status,"awaiting_review");
      return {status:"reported_awaiting_independent_review",modelLaunchIntent:false,modelProcessStarted:false,terminationUnconfirmed:false,
        attemptId:lease.attempt.id,candidateCommit:candidate.candidateCommit,diffSha256:candidate.diffSha256,process:{exitCode:0}};
    }};
}

// Test-only module injected by a loopback proxy. Production changes below are
// caused only by DOM clicks. Test release endpoints control worker timing only.
async function browserDriver(config){
  const $=id=>document.getElementById(id),text=id=>$(id)?.textContent||"",key="registered-browser-fixture";
  const saved=JSON.parse(sessionStorage.getItem(key)||"null")||{phase:"console",startedAt:Date.now(),snapshots:[]};
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const change=(id,value,type="input")=>{$(id).value=value;$(id).dispatchEvent(new Event(type,{bubbles:true}));};
  async function metrics(){const response=await fetch("/__project-browser/metrics",{cache:"no-store"});check(response.ok,"metrics failed");return response.json();}
  async function waitFor(predicate,label){
    const deadline=Math.min(Date.now()+30000,saved.startedAt+180000);
    while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}
    throw Error("Timed out: "+label+"; project="+text("project-status")+"; notice="+text("work-notice"));
  }
  const snapshot=phase=>saved.snapshots.push({phase,workId:$("work-saved").value,runId:$("agent-resume-id").value,
    projectStatus:text("project-status"),diff:text("project-diff"),history:text("project-history"),work:text("work-readback")});
  function visibleState(){try{return JSON.parse(text("project-status").split("\n\n")[0]);}catch{return null;}}
  async function stateIs(status){
    const m=await metrics(),visible=visibleState();if(m.sessionStatus!==status||visible?.workId!==saved.workId)return false;
    if(["ready_worker","worker_active","awaiting_review","revision_ready"].includes(status))return visible.nextAction==="project_"+status;
    if(status==="candidate_verified")return !!visible.verification?.id&&!visible.application;
    if(status==="applied_verified")return visible.application?.status==="applied_verified";
    return false;
  }
  async function connect(){
    await waitFor(()=>!$("project-load-catalog").disabled,"owner connection control");
    change("project-operator-key",config.operator);$("project-load-catalog").click();
    await waitFor(()=>[...$("project-plan").options].some(option=>option.value===config.projectId)&&!$("project-refresh").disabled,"configured project catalog and state read");
    change("project-plan",config.projectId,"change");
    check(document.body.textContent.includes(config.workerLabel),"Injected worker must be visibly labelled");
  }
  async function release(number){await fetch("/__project-browser/release",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number})});}
  async function dispatch(number){
    check(!$("project-codex-consent").checked,"Worker consent persisted from an earlier action");
    $("project-codex-consent").click();await waitFor(()=>!$("project-dispatch").disabled,"explicit worker dispatch");
    $("project-dispatch").click();$("project-dispatch").click();
    await waitFor(async()=>{const m=await metrics();return m.workerCalls===number&&await stateIs("worker_active")&&
      /running|worker_active|queued/.test(text("project-status"));},"visible running registered worker");
    check($("project-dispatch").disabled,"Running work allowed another dispatch");snapshot("running-"+number);
    await release(number);await waitFor(()=>stateIs("awaiting_review"),"reported candidate "+number);
    check(!$("project-codex-consent").checked,"Dispatch did not consume explicit consent");
  }
  async function reviewAndValidate(expected){
    await waitFor(()=>!$("project-review-diff").disabled&&!$("project-reviewer").disabled,"enabled independent diff-review controls");
    change("project-reviewer","Independent browser fixture owner");
    check($("project-validate").disabled&&!$("project-diff-reviewed").checked,"Validation was approved without a reviewed diff");
    $("project-review-diff").click();await waitFor(()=>text("project-diff").includes("src/name.mjs"),"actual Git diff");
    check($("project-validate").disabled,"Fetching a diff authorized validation");
    $("project-diff-reviewed").click();await waitFor(()=>!$("project-validate").disabled,"independent diff review gate");
    $("project-validate").click();await waitFor(()=>stateIs(expected),"independent validation outcome "+expected);snapshot(expected);
  }
  async function finish(ok,error){
    const marker=document.createElement("pre");marker.id="project-browser-verification";marker.dataset.result=ok?"pass":"fail";
    marker.textContent=JSON.stringify({ok,error,phase:saved.phase,workId:saved.workId});document.body.append(marker);
    await fetch("/__project-browser/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok,error,...saved,
      finalWorkId:$("work-saved").value,finalWork:text("work-readback")})});
  }
  try{
    if(saved.phase==="console"){
      await waitFor(async()=>$("submit-mission")&&!$("submit-mission").disabled&&(await metrics()).consoleReady,"Console mission form");
      change("message-text",config.symptom);change("code-excerpt","");$("submit-mission").click();
      await waitFor(async()=>{const m=await metrics();return m.missionSuccesses===1&&m.sourceDelivered;},"actual UI-requested Gateway OBSERVE delivery");
      const delivered=await metrics();saved.sourceId=delivered.sourceId;saved.phase="first";
      sessionStorage.setItem(key,JSON.stringify(saved));
      const open=document.querySelector('a[href="/experience"]');check(open,"Console has no experience navigation control");open.click();return;
    }
    await waitFor(()=>$("project-load-catalog")&&!$("work-village").disabled,"registered UI ready");
    if(saved.phase==="first"){
      change("project-operator-key",config.wrongOperator);$("project-load-catalog").click();
      await waitFor(async()=> (await metrics()).deniedCatalogs===1,"denied owner capability");
      check(![...$("project-plan").options].some(option=>option.value===config.projectId),"Unauthorized catalog populated projects");
      await connect();
      await waitFor(()=>[...$("work-source").options].some(option=>option.value===saved.sourceId),"delivered source option");
      change("work-source",saved.sourceId,"change");change("agent-goal",config.goal);
      $("create-work").click();await waitFor(()=>$("work-saved").value&&text("work-readback").includes(config.goal),"saved same-village work");
      saved.workId=$("work-saved").value;saved.runId=$("agent-resume-id").value;
      change("project-plan",config.projectId,"change");change("project-symptom",config.symptom);change("project-evidence","Pinned public registered-browser reproduction");
      check($("project-start").disabled&&!$("project-scope-reviewed").checked,"Start allowed an unreviewed target scope");
      $("project-scope-reviewed").click();await waitFor(()=>!$("project-start").disabled,"explicit target and scope review gate");
      $("project-start").click();$("project-start").click();await waitFor(()=>stateIs("ready_worker"),"real pinned baseline failure");
      const baseline=await metrics();check(baseline.baselineFailed===true&&baseline.workerCalls===0,"Start did not reproduce before worker dispatch");
      snapshot("baseline-reproduced");await dispatch(1);await reviewAndValidate("revision_ready");
      check($("project-apply").disabled,"A public-failing candidate became applicable");
      const failed=await metrics();check(failed.publicFailures===1&&failed.workerCalls===1,"Actual first public failure was lost");
      saved.phase="retry";sessionStorage.setItem(key,JSON.stringify(saved));location.reload();return;
    }
    check(saved.phase==="retry","Unexpected persisted driver phase");
    await waitFor(()=>$("work-saved").value===saved.workId,"same saved work after reload");
    check($("agent-resume-id").value===saved.runId,"Reload changed the saved run identity");
    check(!$("project-operator-key").value&&!$("project-codex-consent").checked&&!$("project-diff-reviewed").checked&&!$("project-apply-reviewed").checked,
      "Reload retained capability or owner approval");
    check((await metrics()).workerCalls===1,"Reload automatically ran a worker");await connect();
    await waitFor(()=>stateIs("revision_ready"),"retained failure after owner reconnection");
    check((await metrics()).workerCalls===1,"Catalog reconnection automatically retried");snapshot("reloaded-failure");
    await dispatch(2);change("project-reviewer","Independent browser fixture owner");await reviewAndValidate("candidate_verified");
    check($("project-apply").disabled&&!$("project-apply-reviewed").checked,"Validation authorized application");
    $("project-apply-reviewed").click();await waitFor(()=>!$("project-apply").disabled,"exact isolated apply confirmation");
    $("project-apply").click();$("project-apply").click();await waitFor(()=>stateIs("applied_verified"),"isolated apply and postcheck");snapshot("applied");
    check((await metrics()).workerCalls===2,"Apply invoked another worker");
    change("work-share-body",config.shareBody);change("work-share-diagnosis","Labelled local fixture repair checked on actual committed source.");
    change("work-share-applicability","Only this registered first-party browser-test fixture.");
    change("work-share-limitations","Injected local worker only; no model or external AI was executed.");
    await waitFor(()=>!$("save-work-share").disabled,"private registered sharing draft");$("save-work-share").click();
    await waitFor(()=>text("work-share-evidence").includes('"metron-rumor-v2"')&&!$("save-work-share").disabled,"saved V2 evidence");
    check($("publish-work-share").disabled,"Private save authorized publication");
    const rumor=JSON.parse(text("work-share-evidence")).rumor;saved.rumorId=rumor.id;saved.rumorSha256=rumor.sha256;
    $("work-publish-reviewed").click();await waitFor(()=>!$("publish-work-share").disabled,"separate publication review");
    $("publish-work-share").click();$("publish-work-share").click();
    await waitFor(()=>text("work-publication-status").includes(rumor.id),"local publication readback");
    const card=[...document.querySelectorAll("#square-proposals .proposal")].find(node=>node.textContent.includes(config.shareBody));
    check(card,"Published registered Rumor card missing");card.querySelector(".proposal-actions button").click();
    await waitFor(()=>[...document.querySelectorAll("#village-incoming .proposal")].some(node=>node.textContent.includes(config.shareBody)&&node.querySelector(".proposal-actions button")),"recipient Gateway receipt");
    const incoming=[...document.querySelectorAll("#village-incoming .proposal")].find(node=>node.textContent.includes(config.shareBody));
    incoming.querySelector(".proposal-actions button").click();
    await waitFor(async()=> (await metrics()).adopted===true,"explicit recipient adoption");
    await waitFor(()=>!$("work-village").disabled,"recipient village selector ready");
    change("work-village","village-2","change");
    await waitFor(()=>!$("work-saved").disabled&&[...document.querySelectorAll("#work-knowledge input")].some(input=>input.value==="knowledge_"+rumor.id),"adopted next-work knowledge option");
    change("work-saved","","change");
    await waitFor(()=>!$("work-source").disabled&&[...$("work-source").options].some(option=>option.value)&&
      [...document.querySelectorAll("#work-knowledge input")].some(input=>input.value==="knowledge_"+rumor.id&&!input.disabled),"recipient delivered source");
    change("work-source",[...$("work-source").options].find(option=>option.value).value,"change");change("agent-goal",config.nextGoal);
    [...document.querySelectorAll("#work-knowledge input")].find(input=>input.value==="knowledge_"+rumor.id).click();
    await waitFor(()=>!$("create-work").disabled,"recipient next-work create");$("create-work").click();
    await waitFor(()=>$("work-saved").value!==saved.workId&&text("work-readback").includes(rumor.sha256),"persisted adopted knowledge fingerprint");
    saved.nextWorkId=$("work-saved").value;snapshot("adopted-next-work");
    check((await metrics()).workerCalls===2,"Knowledge adoption or next work invoked a worker");
    const storage=JSON.stringify([sessionStorage.getItem(key),...Object.keys(localStorage).map(name=>localStorage.getItem(name))]);
    check(!storage.includes(config.operator),"Owner capability persisted in browser storage");
    check(!document.body.textContent.includes(config.operator)&&!document.body.textContent.includes(config.hiddenSentinel),"Capability or private acceptance output was rendered");
    await finish(true);
  }catch(error){await finish(false,error.stack||String(error));}
}

async function bytesOf(req){const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>512000)throw Error("Fixture request limit");parts.push(chunk);}return Buffer.concat(parts);}
async function harness(app,config,worker){
  const requests=[],servedAssets=[],barriers=new Set(),origin=new URL(app.url);let report=null;
  const proxy=createServer(async(req,res)=>{
    try{
      const local="http://127.0.0.1:"+proxy.address().port;
      if(req.headers.host!==new URL(local).host||(req.headers.origin&&req.headers.origin!==local)){res.writeHead(403);res.end("Loopback fixture origin required");return;}
      const path=new URL(req.url,local).pathname;
      if(path==="/__project-browser/driver.js"){res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"no-store"});res.end("("+browserDriver.toString()+")("+JSON.stringify(config)+");");return;}
      if(path==="/__project-browser/barrier.svg"){
        const finish=()=>{res.writeHead(200,{"Content-Type":"image/svg+xml"});res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');};
        if(report)finish();else{barriers.add(finish);res.once("close",()=>barriers.delete(finish));}return;
      }
      if(path==="/__project-browser/metrics"){
        const w=app.work.state({villageId:"village-1"}).work,s=w?.projectRepair?.sessionId?
          app.work.projectState({sessionId:w.projectRepair.sessionId,operator:true}):null;
        const source=app.runtime.mailbox("B").messages.find(message=>message.type==="OBSERVE"&&message.body===config.symptom);
        const published=app.civilization.square.list().find(rumor=>rumor.body===config.shareBody);
        res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify({workerCalls:worker.calls.length,
          sourceId:source?.id??null,sourceDelivered:!!source&&app.runtime.gateway.getJob(source.id)?.state==="done",
          consoleReady:requests.some(item=>item.path==="/api/state"&&item.responseStatus===200),
          missionSuccesses:requests.filter(item=>item.path==="/api/mission"&&item.responseStatus===200).length,
          sessionStatus:s?.status??null,baselineFailed:s?.baseline?.checks?.[0]?.testSummary?.fail>0,
          publicFailures:s?.attempts.filter(attempt=>attempt.publicResult?.passed===false).length??0,
          deniedCatalogs:requests.filter(item=>item.path==="/api/project/catalog"&&item.responseStatus===403).length,
          adopted:!!published&&app.civilization.villages["village-2"].knowledge.some(item=>item.parentRumorId===published.id)}));return;
      }
      const body=req.method==="POST"?await bytesOf(req):Buffer.alloc(0);
      if(path==="/__project-browser/release"){
        const value=JSON.parse(body.toString("utf8"));assert.ok([1,2].includes(value.number));worker.release(value.number);res.writeHead(200);res.end('{}');return;
      }
      if(path==="/__project-browser/complete"){
        report=JSON.parse(body.toString("utf8"));res.writeHead(200,{"Content-Type":"application/json"});res.end('{"received":true}');
        for(const finish of barriers)finish();barriers.clear();return;
      }
      // Exact synthetic translation between two isolated loopback origins, as in
      // mini-work-browser. No operator/worker capability is added by the proxy.
      const headers={...req.headers,host:origin.host};if(headers.origin)headers.origin=origin.origin;delete headers.connection;
      const recorded={path,method:req.method,body:body.length?JSON.parse(body.toString("utf8")):null,
        operatorHeaderPresent:!!headers["x-metron-project-operator"],responseStatus:null};requests.push(recorded);
      const upstream=request(app.url+req.url,{agent:false,method:req.method,headers},up=>{
        recorded.responseStatus=up.statusCode;
        if(!STATIC_ASSETS.has(path)){res.writeHead(up.statusCode,up.headers);up.pipe(res);return;}
        const chunks=[];let size=0;up.on("data",chunk=>{
          size+=chunk.length;if(size>2*1024*1024){up.destroy(Error("Static fixture asset limit"));return;}chunks.push(chunk);
        });up.on("end",()=>{
          const original=Buffer.concat(chunks),isHtml=path==="/experience"||path==="/";
          const browserBytes=isHtml?Buffer.from(original.toString("utf8").replace("</body>",'<img hidden alt="" src="/__project-browser/barrier.svg"><script type="module" src="/__project-browser/driver.js"></script></body>')):original;
          servedAssets.push({path,status:up.statusCode,contentType:up.headers["content-type"],capturedAt:new Date().toISOString(),
            productionBytes:original.length,productionSha256:sha(original),browserBytes:browserBytes.length,browserSha256:sha(browserBytes),testDriverInjected:isHtml});
          const responseHeaders={...up.headers,"content-length":browserBytes.length};delete responseHeaders["transfer-encoding"];
          res.writeHead(up.statusCode,responseHeaders);res.end(browserBytes);
        });
        up.on("error",error=>{if(!res.headersSent)res.writeHead(502);res.end(error.message);});
      });
      upstream.setTimeout(120000,()=>upstream.destroy(Error("Loopback upstream timeout")));
      upstream.on("error",error=>{if(!res.headersSent)res.writeHead(502);res.end(error.message);});upstream.end(body);
    }catch(error){if(!res.headersSent)res.writeHead(500);res.end(error.message);}
  });
  await new Promise((ready,reject)=>{proxy.once("error",reject);proxy.listen(0,"127.0.0.1",ready);});
  return {url:"http://127.0.0.1:"+proxy.address().port,requests,servedAssets,report:()=>report,
    close:async()=>{for(const finish of barriers)finish();barriers.clear();proxy.closeAllConnections();await new Promise(done=>proxy.close(done));}};
}

test("real Chromium registered-project clicks retain a public failure, explicitly retry, review/apply and publish/adopt knowledge",{skip:!chromium(),timeout:240000},async t=>{
  const parent=process.env.METRON_WORK_EVIDENCE_DIR||tmpdir();mkdirSync(parent,{recursive:true});
  const prefix=join(parent,"metron-registered-browser-"),root=mkdtempSync(prefix),worker=localWorker();let app,proxy;
  try{
    const plan=fixture(root),data=join(root,"data");
    app=await createMiniServer({root:data,port:0,projectOperatorToken:OPERATOR,workOptions:{projectPlans:[plan],runnerOptions:{env:{}}},
      projectCodexOptions:{executable:join(root,"never-launched","codex.exe"),label:LABEL,runAttempt:worker.runAttempt}});
    const symptom="Customer-name greetings retain uppercase input.";
    const config={projectId:plan.id,operator:OPERATOR,wrongOperator:WRONG,symptom,workerLabel:LABEL,hiddenSentinel:HIDDEN,
      goal:"Repair this registered customer-name project using the saved Gateway observation.",
      shareBody:"Reviewed registered customer fixture repair from the injected local worker.",nextGoal:"Assess the adopted registered repair before further local use."};
    proxy=await harness(app,config,worker);
    const args=["--headless=new","--disable-gpu","--disable-background-networking","--no-first-run","--no-default-browser-check","--disable-extensions",
      "--user-data-dir="+join(root,"isolated-browser-profile"),"--dump-dom",proxy.url+"/"];
    if(process.getuid?.()===0)args.unshift("--no-sandbox");
    const {stdout,stderr}=await execute(chromium(),args,{timeout:205000,maxBuffer:12*1024*1024,windowsHide:true});
    writeFileSync(join(root,"browser-dom.html"),stdout);writeFileSync(join(root,"browser-stderr.log"),stderr);
    const report=proxy.report();assert.ok(report,"No browser driver completion receipt: "+stderr.slice(-1500));
    writeFileSync(join(root,"browser-report.json"),JSON.stringify(report,null,2));assert.equal(report.ok,true,report.error);
    assert.match(stdout,/<pre id="project-browser-verification" data-result="pass">/);
    assert.equal(worker.calls.length,2);assert.equal(worker.calls[0].modelCalls+worker.calls[1].modelCalls,0);
    assert.equal(worker.calls[1].parentCommit,worker.calls[0].candidateCommit);
    const original=app.work.state({villageId:"village-1",workId:report.workId}).work;
    assert.equal(original.sourceMessage.id,report.sourceId);assert.equal(original.sourceMessage.body,symptom);
    assert.equal(original.sourceMessage.deliveryState,"done");
    const owner=app.work.projectState({sessionId:original.projectRepair.sessionId,operator:true});
    assert.equal(owner.status,"applied_verified");assert.equal(owner.attempts.length,2);
    assert.equal(owner.baseline.checks[0].testSummary.fail,1);assert.equal(owner.attempts[0].publicResult.passed,false);
    assert.equal(owner.attempts[1].publicResult.passed,true);assert.equal(owner.attempts[1].acceptanceResult.passed,true);
    assert.equal(owner.application.postApply.passed,true);assert.equal(inspectRegisteredApply(plan).head,worker.calls[1].candidateCommit);
    assert.equal(git(plan.baselineRoot,["rev-parse","HEAD"]),plan.baseCommit);assert.equal(git(plan.repositoryRoot,["rev-parse","HEAD"]),plan.baseCommit);
    const rumor=verifyRumor(original.publication.rumor);assert.equal(rumor.sha256,report.rumorSha256);
    assert.equal(rumor.repairEvidence.candidateCommit,worker.calls[1].candidateCommit);
    const next=app.work.state({villageId:"village-2",workId:report.nextWorkId}).work;
    assert.equal(next.stage,"ready");assert.equal(next.knowledge[0].rumorSha256,rumor.sha256);
    assert.equal(next.incidentContext.knowledge[0].repairEvidence.candidateCommit,worker.calls[1].candidateCommit);
    const posts=proxy.requests.filter(item=>item.method==="POST");
    const actionCount=action=>posts.filter(item=>item.body?.action===action).length;
    assert.equal(posts.filter(item=>item.path==="/api/mission").length,1);
    assert.equal(actionCount("start"),1);assert.equal(posts.filter(item=>item.path==="/api/project/dispatch").length,2);
    assert.equal(actionCount("validate"),2);assert.equal(actionCount("apply"),1);assert.equal(actionCount("publish-share"),1);
    assert.equal(actionCount("receive"),1);assert.equal(actionCount("review")>=1,true);
    for(const path of STATIC_ASSETS)assert.ok(proxy.servedAssets.some(asset=>asset.path===path&&asset.status===200),"Production asset not captured: "+path);
    const apply=posts.find(item=>item.body?.action==="apply");
    assert.equal(apply.operatorHeaderPresent,true);assert.equal(apply.body.expectedHead,plan.baseCommit);
    assert.equal(apply.body.candidateCommit,worker.calls[1].candidateCommit);assert.equal(apply.body.diffSha256,worker.calls[1].diffSha256);
    assert.equal(apply.body.verificationId,owner.verification.id);
    for(const item of posts.filter(item=>["prepare-share","publish-share"].includes(item.body?.action)))assert.equal(item.operatorHeaderPresent,true);
    const checkReceipt=result=>result?{passed:result.passed,checks:(result.checks||[]).map(check=>({id:check.id,exitCode:check.exitCode,
      testSummary:check.testSummary,outputSha256:check.outputSha256}))}:null;
    const evidence={label:"REAL_ISOLATED_CHROMIUM_REGISTERED_UI_WITH_LOCAL_WORKER_FIXTURE_NOT_REAL_AI",realBrowser:true,
      modelCalls:0,workerCalls:worker.calls,hostConfiguredRegistration:true,uiCreatedGitRegistration:false,consoleMissionClicked:true,
      report,requests:proxy.requests,servedAssets:proxy.servedAssets,testSourceSha256:TEST_SOURCE_SHA256,workId:original.id,sessionId:owner.id,
      baselineFailed:true,firstPublicFailed:true,secondPublicAndAcceptancePassed:true,isolatedApplyHead:inspectRegisteredApply(plan).head,
      checks:{baseline:checkReceipt(owner.baseline),attempts:owner.attempts.map(attempt=>({attemptId:attempt.id,
        public:checkReceipt(attempt.publicResult),acceptance:checkReceipt(attempt.acceptanceResult)})),postApply:checkReceipt(owner.application.postApply)},
      postApplyPassed:true,rumorId:rumor.id,rumorSha256:rumor.sha256,nextWorkId:next.id};
    writeFileSync(join(root,"registered-browser-evidence.json"),JSON.stringify(evidence,null,2));
    if(process.env.METRON_WORK_EVIDENCE_DIR)t.diagnostic("Saved isolated Chromium registered UI evidence: "+root);
  }finally{
    if(proxy){
      writeFileSync(join(root,"browser-requests.json"),JSON.stringify(proxy.requests,null,2));
      writeFileSync(join(root,"served-assets.json"),JSON.stringify({testSourceSha256:TEST_SOURCE_SHA256,assets:proxy.servedAssets},null,2));
    }
    writeFileSync(join(root,"local-worker-calls.json"),JSON.stringify(worker.calls,null,2));
    worker.releaseAll();if(proxy)await proxy.close();if(app)await app.close();
    if(!process.env.METRON_WORK_EVIDENCE_DIR){assert.ok(resolve(root).startsWith(resolve(prefix)));rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
  }
});
