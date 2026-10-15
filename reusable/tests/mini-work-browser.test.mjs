// Real isolated Chromium + local HTTP/UI/files/test processes. The reasoner is
// an injected fixture; this is NOT real AI, live ChatGPT, or ARC-extension E2E.
import test from "node:test";
import assert from "node:assert/strict";
import {createServer,request} from "node:http";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtempSync,mkdirSync,rmSync,existsSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {createMiniServer} from "../../mini/server.mjs";
import {verifyRumor} from "../../mini/rumor-protocol.mjs";

const execAsync=promisify(execFile);
const sha=value=>createHash("sha256").update(value).digest("hex");
const pricing="export function unitPrice(base, discount) { return base - discount; }\n";
const invoice='import { unitPrice } from "./pricing.mjs";\n'+
  'export function invoiceTotal(base, discount, quantity) { return unitPrice(base, discount) * quantity; }\n';
const partialDiagnosis="Correct unit price before fixing invoice multiplier";
function proposal(complete){
  return JSON.stringify({diagnosis:complete?"Multiply corrected unit price by quantity":partialDiagnosis,
    changes:[{path:"src/pricing.mjs",content:pricing},
      ...(complete?[{path:"src/invoice.mjs",content:invoice}]:[])]});
}
function availableChromium(){
  return [process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
    "/usr/bin/chromium","/usr/bin/chromium-browser",
    process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,"Google","Chrome","Application","chrome.exe"),
    process.env["PROGRAMFILES(X86)"]&&join(process.env["PROGRAMFILES(X86)"],"Microsoft","Edge","Application","msedge.exe")
  ].filter(Boolean).find(existsSync)||null;
}

// Runs only as an external same-origin module appended by the test proxy.
// Every production mutation below is caused by a real DOM control's click.
async function browserDriver(config){
  const $=id=>document.getElementById(id);
  const key="metron-work-browser-test";
  let saved=JSON.parse(sessionStorage.getItem(key)||"null")||{phase:"create",startedAt:Date.now(),snapshots:[]};
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const remember=()=>sessionStorage.setItem(key,JSON.stringify(saved));
  async function waitFor(predicate,label){
    const deadline=Math.min(Date.now()+12000,saved.startedAt+50000);
    while(Date.now()<deadline){
      if(predicate())return;
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    throw Error("Timed out waiting for "+label+"; notice="+$("work-notice")?.textContent);
  }
  const change=(id,value,type="change")=>{
    $(id).value=value;$(id).dispatchEvent(new Event(type,{bubbles:true}));
  };
  async function metrics(){
    const response=await fetch("/__work-browser/metrics",{cache:"no-store"});
    check(response.ok,"Harness metrics failed");return await response.json();
  }
  const readback=()=>({workId:$("work-saved").value,runId:$("agent-resume-id").value,
    context:$("work-readback").textContent,result:$("agentic-repair-result").textContent,
    history:$("work-history").textContent,share:$("work-share-body").value,
    sharingEvidence:$("work-share-evidence").textContent});
  function checkContext(){
    const context=$("work-readback").textContent;
    for(const value of [saved.workId,config.goal,config.sourceId,config.sourceBody,
      config.sourceSha,config.knowledgeId,config.knowledgeText])
      check(context.includes(value),"Saved UI context missing "+value);
    check($("agent-resume-id").value===saved.runId,"Saved repair identity changed");
  }
  async function reload(phase){
    saved.phase=phase;remember();location.reload();
  }
  async function finish(ok,error){
    const marker=document.createElement("pre");marker.id="work-browser-verification";
    marker.dataset.result=ok?"pass":"fail";
    marker.textContent=JSON.stringify({ok,error,phase:saved.phase,workId:saved.workId});
    document.body.append(marker);
    await fetch("/__work-browser/complete",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ok,error,...saved,final:readback()})});
  }
  try{
    await waitFor(()=>$("work-village")&&!$("work-village").disabled,"initial work-state read");
    check($("work-village").value==="village-1","Wrong village selected");
    if(saved.phase==="create"){
      await waitFor(()=>[...$("work-source").options].some(x=>x.value===config.sourceId)&&
        [...document.querySelectorAll("#work-knowledge input")].some(x=>x.value===config.knowledgeId),
      "real delivered source and adopted knowledge options");
      check((await metrics()).calls===0,"Initial page read called the reasoner");
      change("work-source",config.sourceId);
      change("agent-goal",config.goal,"input");
      const selected=[...document.querySelectorAll("#work-knowledge input")].find(x=>x.value===config.knowledgeId);
      selected.click();check(selected.checked,"Adopted knowledge was not selected");
      check($("work-source-preview").textContent.includes(config.sourceSha),"Source digest not visible");
      await waitFor(()=>!$("create-work").disabled,"enabled create control");
      $("create-work").click();
      await waitFor(()=>$("work-saved").value&&$("work-readback").textContent.includes(config.goal)&&
        !$("try-agentic-repair").disabled,"saved work readback");
      saved.workId=$("work-saved").value;saved.runId=$("agent-resume-id").value;
      checkContext();
      check((await metrics()).calls===0,"Creating work called the reasoner");
      saved.snapshots.push({phase:"created",...readback(),modelCalls:0});
      change("agent-model","ollama");
      check((await metrics()).calls===0,"Selecting a provider called the reasoner");
      $("try-agentic-repair").click();$("try-agentic-repair").click();
      await waitFor(()=>$("agentic-repair-result").textContent.includes('"status": "unresolved"')&&
        !$("try-agentic-repair").disabled,"persisted first unresolved attempt");
      checkContext();
      check($("work-history").textContent.includes(config.partialDiagnosis),"Real first failure absent from history");
      check((await metrics()).calls===1,"First explicit click must call the reasoner once");
      saved.snapshots.push({phase:"unresolved",...readback(),modelCalls:1});
      await reload("resume");return;
    }
    await waitFor(()=>$("work-saved").value===saved.workId,"same work after full page reload");
    checkContext();
    if(saved.phase==="resume"){
      await waitFor(()=>!$("try-agentic-repair").disabled,"explicit resume control");
      check($("agentic-repair-result").textContent.includes('"status": "unresolved"'),"Reload lost saved failure");
      let counts=await metrics();
      check(counts.calls===1&&counts.runs===1,"Reload automatically called or resumed the model");
      check(!$("agent-cloud-consent").checked,"Reload retained external consent");
      saved.snapshots.push({phase:"reloaded-unresolved",...readback(),modelCalls:counts.calls});
      // A different explicit provider choice exercises saved identity and per-click
      // consent. askModel remains injected; no real OpenAI request is made.
      change("agent-model","openai");$("agent-cloud-consent").click();
      counts=await metrics();check(counts.calls===1,"Provider/consent change automatically resumed work");
      $("try-agentic-repair").click();$("try-agentic-repair").click();
      await waitFor(()=>$("agentic-repair-result").textContent.includes('"status": "verified_candidate"')&&
        !$("work-share-body").disabled,"verified second candidate and editable sharing draft");
      checkContext();
      check($("try-agentic-repair").disabled,"Verified work remains runnable");
      check(!$("agent-cloud-consent").checked,"Run did not consume one-time consent");
      check((await metrics()).calls===2,"Explicit resume must add exactly one reasoner call");
      check($("agentic-repair-result").textContent.includes("invoiceTotal"),"Candidate source missing from result readback");
      saved.snapshots.push({phase:"verified",...readback(),modelCalls:2});
      change("work-share-body",config.editedShare,"input");
      await waitFor(()=>!$("save-work-share").disabled,"save sharing draft control");
      $("save-work-share").click();
      await waitFor(()=>!$("save-work-share").disabled&&
        $("work-share-evidence").textContent.includes(config.editedShare),"saved edited sharing draft readback");
      await reload("final-readback");return;
    }
    check(saved.phase==="final-readback","Unexpected driver phase");
    await waitFor(()=>$("work-share-body").value===config.editedShare&&!$("work-share-body").disabled,
      "persisted human-edited sharing draft after reload");
    const counts=await metrics();
    check(counts.calls===2&&counts.runs===2,"Final reload automatically invoked the reasoner");
    check(counts.publishes===0,"Sharing edit published a rumor");
    check($("agentic-repair-result").textContent.includes('"readbackVerified": true'),"Verified source readback missing");
    check($("work-share-evidence").textContent.includes("human_review_required"),"Human review boundary missing");
    check($("work-share-evidence").querySelector("b")===null,"Draft text was interpreted as HTML");
    saved.snapshots.push({phase:"reloaded-verified-draft",...readback(),modelCalls:counts.calls});
    await finish(true);
  }catch(error){await finish(false,error.stack||String(error));}
}

async function bodyOf(req){
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>256000)throw Error("Harness body too large");chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function browserHarness(app,config,modelCalls){
  const requests=[],barriers=new Set(),origin=new URL(app.url);let report=null;
  const proxy=createServer(async(req,res)=>{
    try{
      const proxyOrigin="http://127.0.0.1:"+proxy.address().port;
      if(req.headers.host!==new URL(proxyOrigin).host||
        (req.headers.origin&&req.headers.origin!==proxyOrigin)){
        res.writeHead(403);res.end("Harness loopback origin required");return;
      }
      const pathname=new URL(req.url,proxyOrigin).pathname;
      if(pathname==="/__work-browser/driver.js"){
        res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"no-store"});
        res.end("("+browserDriver.toString()+")("+JSON.stringify(config)+");");return;
      }
      if(pathname==="/__work-browser/load-barrier.svg"){
        const complete=()=>{res.writeHead(200,{"Content-Type":"image/svg+xml","Cache-Control":"no-store"});res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');};
        if(report)complete();else{barriers.add(complete);res.once("close",()=>barriers.delete(complete));}
        return;
      }
      if(pathname==="/__work-browser/metrics"){
        res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
        res.end(JSON.stringify({calls:modelCalls(),runs:requests.filter(x=>x.path==="/api/agent/run").length,
          publishes:requests.filter(x=>x.path==="/api/civilization/action").length}));return;
      }
      const body=req.method==="POST"?await bodyOf(req):Buffer.alloc(0);
      if(pathname==="/__work-browser/complete"&&req.method==="POST"){
        report=JSON.parse(body.toString("utf8"));res.writeHead(200,{"Content-Type":"application/json"});res.end('{"received":true}');
        for(const complete of barriers)complete();barriers.clear();return;
      }
      // Synthetic test-only translation between TWO loopback origins. It is not
      // extension-Origin/production security proof. Only the exact proxy Origin
      // is accepted above, then forwarded to the unchanged app's own Host/Origin.
      const headers={...req.headers,host:origin.host};
      if(headers.origin)headers.origin=origin.origin;
      delete headers.connection;
      requests.push({path:pathname,method:req.method,
        body:body.length?JSON.parse(body.toString("utf8")):null,
        browserOrigin:req.headers.origin??null,forwardedHost:headers.host,
        forwardedOrigin:headers.origin??null});
      const upstream=request(app.url+req.url,{method:req.method,headers},up=>{
        if(pathname!=="/experience"){res.writeHead(up.statusCode,up.headers);up.pipe(res);return;}
        const chunks=[];up.on("data",chunk=>chunks.push(chunk));up.on("end",()=>{
          const original=Buffer.concat(chunks).toString("utf8");
          const injection='<img hidden alt="" src="/__work-browser/load-barrier.svg">'+
            '<script type="module" src="/__work-browser/driver.js"></script>';
          const html=original.replace("</body>",injection+"</body>");
          const responseHeaders={...up.headers,"content-length":Buffer.byteLength(html)};
          delete responseHeaders["transfer-encoding"];
          res.writeHead(up.statusCode,responseHeaders);res.end(html);
        });
      });
      upstream.setTimeout(20000,()=>upstream.destroy(Error("Local app proxy timeout")));
      upstream.on("error",error=>{if(!res.headersSent)res.writeHead(502);res.end(error.message);});
      upstream.end(body);
    }catch(error){if(!res.headersSent)res.writeHead(500);res.end(error.message);}
  });
  await new Promise((resolve,reject)=>{proxy.once("error",reject);proxy.listen(0,"127.0.0.1",resolve);});
  return {url:"http://127.0.0.1:"+proxy.address().port,requests,report:()=>report,
    close:async()=>{for(const complete of barriers)complete();barriers.clear();
      proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}};
}

test("real Chromium controls create, reload, explicitly resume and edit a persistent local village work",
  {skip:!availableChromium(),timeout:90000},async t=>{
    const parent=process.env.METRON_WORK_EVIDENCE_DIR||tmpdir();mkdirSync(parent,{recursive:true});
    const root=mkdtempSync(join(parent,"metron-work-browser-"));
    const dataRoot=join(root,"data"),prompts=[];let app,harness;
    try{
      app=await createMiniServer({root:dataRoot,port:0,workOptions:{runnerOptions:{env:{},
        askModel:async prompt=>{prompts.push(prompt);return proposal(prompts.length>1);}}}});
      const sourceId="browser_source",sourceBody="Saved Gateway answer: inspect discounted invoice quantity multiplication.";
      const delivered=app.runtime.submit({messageId:sourceId,from:"A",to:"B",message:sourceBody});
      assert.equal(delivered.job.state,"done");
      const rumor=app.civilization.publish({from:"village-2",
        text:"Adopted invoice knowledge: subtract each unit discount before multiplying by quantity."}).rumor;
      app.civilization.receive({villageId:"village-1",rumorId:rumor.id});
      app.civilization.review({villageId:"village-1",rumorId:rumor.id,decision:"adopt"});
      const squareBefore=app.civilization.square.list();
      const otherVillageBefore=structuredClone(app.civilization.villages["village-2"]);
      const config={sourceId,sourceBody,sourceSha:sha(sourceBody),knowledgeId:"knowledge_"+rumor.id,
        knowledgeText:rumor.body,goal:"Use this saved reply and adopted knowledge to repair the discounted invoice fixture.",
        partialDiagnosis,editedShare:"Human-edited <b>fixture</b> result: two local source files verified; production and general applicability unverified."};
      harness=await browserHarness(app,config,()=>prompts.length);
      const browser=availableChromium();
      const args=["--headless=new","--disable-gpu","--disable-background-networking","--no-first-run",
        "--no-default-browser-check","--disable-extensions","--user-data-dir="+join(root,"browser-profile"),
        "--dump-dom",harness.url+"/experience"];
      if(process.getuid?.()===0)args.unshift("--no-sandbox");
      const {stdout,stderr}=await execAsync(browser,args,{timeout:65000,maxBuffer:8*1024*1024,windowsHide:true});
      writeFileSync(join(root,"browser-dom.html"),stdout);
      const report=harness.report();
      assert.ok(report,"Chromium did not complete the bounded DOM driver: "+stderr.slice(-2000));
      assert.equal(report.ok,true,report.error);
      assert.match(stdout,/<pre id="work-browser-verification" data-result="pass">/);
      assert.equal(prompts.length,2);
      const state=await fetch(app.url+"/api/work/state?villageId=village-1&workId="+report.workId).then(r=>r.json());
      const work=state.work;
      assert.equal(work.id,report.workId);assert.equal(work.runId,report.runId);
      assert.equal(work.stage,"candidate_verified");assert.equal(work.attempts.length,2);
      assert.equal(work.attempts[0].publicPassed,false);
      assert.equal(work.attempts[1].publicPassed,true);assert.equal(work.attempts[1].holdoutPassed,true);
      assert.equal(work.goal,config.goal);assert.equal(work.sourceMessage.body,sourceBody);
      assert.equal(work.sourceMessage.bodySha256,config.sourceSha);
      assert.deepEqual(work.knowledge.map(x=>x.id),[config.knowledgeId]);
      assert.equal(work.knowledge[0].rumorSha256,rumor.sha256);
      assert.equal(work.result.modelProvenance,"test_injected_not_real_ai");
      assert.equal(work.result.productionChanged,false);assert.equal(work.result.readbackVerified,true);
      assert.deepEqual(work.result.candidateFiles,[{path:"src/pricing.mjs",content:pricing},{path:"src/invoice.mjs",content:invoice}]);
      assert.equal(work.sharingCandidate.body,config.editedShare);
      assert.equal(work.sharingCandidate.status,"human_review_required");verifyRumor(work.sharingCandidate.rumor);
      assert.deepEqual(app.civilization.square.list(),squareBefore);
      assert.deepEqual(app.civilization.villages["village-2"],otherVillageBefore);
      const disk=JSON.parse(readFileSync(join(dataRoot,"work-ledger",work.id+".json"),"utf8"));
      assert.deepEqual(disk,work);
      const journal=JSON.parse(readFileSync(join(dataRoot,"work-repair",work.id,"baku-agent-journal",work.runId+".json"),"utf8"));
      assert.equal(journal.lastCandidate["src/pricing.mjs"],pricing);
      assert.equal(journal.lastCandidate["src/invoice.mjs"],invoice);
      for(const prompt of prompts)for(const value of [work.id,config.goal,sourceBody,rumor.body,rumor.sha256])
        assert.ok(prompt.includes(value),"Reasoner prompt missing saved context "+value);
      for(const value of [partialDiagnosis,"publicPassed",work.attempts[0].publicEvidence,"return base - discount"])
        assert.ok(prompts[1].includes(value)||prompts[1].includes(JSON.stringify(value).slice(1,-1)),"Resume prompt lost prior failure "+value);
      const posts=harness.requests.filter(x=>x.method==="POST");
      assert.deepEqual(posts.map(x=>x.path),["/api/work/action","/api/agent/run","/api/agent/run","/api/work/action"]);
      assert.deepEqual(posts[0].body,{action:"create",villageId:"village-1",goal:config.goal,
        sourceMessageId:sourceId,knowledgeIds:[config.knowledgeId]});
      assert.deepEqual(posts.slice(1,3).map(x=>x.body),[
        {villageId:"village-1",workId:work.id,provider:"ollama",allowExternalCalls:false},
        {villageId:"village-1",workId:work.id,provider:"openai",allowExternalCalls:true}]);
      assert.deepEqual(posts[3].body,{action:"prepare-share",villageId:"village-1",workId:work.id,body:config.editedShare});
      for(const post of posts){assert.equal(post.forwardedHost,new URL(app.url).host);assert.equal(post.forwardedOrigin,app.url);assert.equal(post.browserOrigin,harness.url);}
      assert.deepEqual(report.snapshots.map(x=>[x.phase,x.modelCalls]),[
        ["created",0],["unresolved",1],["reloaded-unresolved",1],["verified",2],["reloaded-verified-draft",2]]);
      const evidence={label:"REAL_LOCAL_CHROMIUM_UI_WITH_INJECTED_FIXTURE_REASONER_NOT_REAL_AI",
        browser,isolatedProfile:true,realChromium:true,liveChatGpt:false,arcExtension:false,
        harness:"test-only loopback proxy with synthetic exact Host/Origin translation; production CSP unchanged",
        workId:work.id,runId:work.runId,modelCalls:prompts.length,prompts,report,requests:harness.requests,
        sourceDelivery:delivered.job.state,final:work,squareUnchanged:true,otherVillageUnchanged:true};
      writeFileSync(join(root,"browser-work-evidence.json"),JSON.stringify(evidence,null,2));
      if(process.env.METRON_WORK_EVIDENCE_DIR)t.diagnostic("Saved real Chromium evidence: "+root);
    }finally{
      if(harness)await harness.close();if(app)await app.close();
      if(!process.env.METRON_WORK_EVIDENCE_DIR)rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
  });
