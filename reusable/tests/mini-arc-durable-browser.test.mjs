// Owned Chromium DOM -> actual ARC scripts -> test-only Chrome API/VM bridge
// -> real isolated Mini/Gateway/B. No extension installation or live AI/login.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {createMiniServer} from "../../mini/server.mjs";
import {availableChromium,createArcBrowserHarness,runArcChromium} from "./helpers/arc-browser-harness.mjs";

const sha=text=>createHash("sha256").update(text,"utf8").digest("hex");
const html=[
  "<!doctype html><html><head><meta charset='utf-8'><title>Owned synthetic ARC conversation</title></head><body>",
  "<label>Harmless synthetic prompt<textarea id='provider-input'></textarea></label>",
  "<button id='provider-send'>Send synthetic response</button>",
  "<button id='provider-stop' data-testid='stop-button' hidden>Stop generating</button>",
  "<div id='provider-seed' style='white-space:pre-wrap'>Prior harmless seeded reply.</div>",
  "<div id='provider-answer' style='white-space:pre-wrap' hidden></div>",
  "<script>window.syntheticProvider={calls:0,inputEvents:0};",
  "document.getElementById('provider-input').addEventListener('input',()=>window.syntheticProvider.inputEvents++);",
  "document.getElementById('provider-send').addEventListener('click',()=>{",
  "window.syntheticProvider.calls++;const a=document.getElementById('provider-answer');a.hidden=false;",
  "a.textContent='Partial synthetic response';a.setAttribute('aria-busy','true');",
  "document.getElementById('provider-stop').hidden=false;document.getElementById('provider-send').setAttribute('aria-disabled','true');});",
  "</script></body></html>"
].join("");

async function browserDriver(config){
  const $=id=>document.getElementById(id),arc=name=>$("metron-arc-"+name);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=(value,message)=>{if(!value)throw Error(message);};
  const metric=()=>fetch("/__arc/metrics",{cache:"no-store"}).then(r=>r.json());
  async function waitFor(predicate,label){
    const until=Date.now()+12000;
    while(Date.now()<until){if(await predicate())return;await delay(35);}
    throw Error("Timed out: "+label+"; ARC="+arc("result")?.textContent);
  }
  const change=(el,value)=>{el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));};
  const click=id=>window.arcTestTrustedClick(id);
  const clickArc=name=>click("metron-arc-"+name);
  const messageId=()=>{const value=arc("message-id")?.value??arc("message-id")?.textContent??"";return /^arc_[a-f0-9]{32}$/.test(value)?value:"";};
  async function select(response){
    for(const id of ["provider-input","provider-send",response])await click(id);
    await waitFor(()=>arc("capture")?.isConnected,"picker controls");
    change(arc("port"),String(config.port));
  }
  const review=async()=>{
    if(!arc("completion-reviewed").checked)await clickArc("completion-reviewed");
  };
  async function captureComplete(){
    await delay(700);await review();await clickArc("capture");
    await waitFor(()=>arc("preview")?.textContent===$("provider-answer").innerText,"complete raw response capture");
  }
  async function finish(ok,error,details={}){
    const marker=document.createElement("pre");marker.id="arc-durable-browser-result";
    marker.dataset.result=ok?"pass":"fail";marker.textContent=JSON.stringify({ok,error,...details});
    document.body.append(marker);
    await fetch("/__arc/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok,error,...details})});
  }
  try{
    const saved=JSON.parse(sessionStorage.getItem("arc-synthetic-human-recovery")||"null");
    if(!saved){
      // The page can see this DOM, but synthetic page clicks are not human actions.
      $("provider-input").click();
      check(!arc("picker").querySelector("pre").textContent,"Page code forged a picker selection");
      await select("provider-seed");
      change(arc("prompt"),"Produce only the approved synthetic long response.");
      arc("send").click();
      check(window.syntheticProvider.calls===0,"Page code forged an external AI send");
      await clickArc("send");
      check(window.syntheticProvider.calls===1,"ARC did not click the selected synthetic send button once");
      check(window.syntheticProvider.inputEvents===1,"ARC did not emit the real input event once");
      await clickArc("reselect");await select("provider-answer");
      await review();await clickArc("capture");await clickArc("forward");await delay(850);
      check((await metric()).delivers===0,"A partial response was forwarded");
      check(!arc("preview").textContent,"Partial text was called a complete capture");
      // A long pause while the provider still declares generation must not finish.
      await review();await clickArc("capture");await delay(350);
      check((await metric()).delivers===0,"A paused stream was treated as complete");
      $("provider-answer").textContent="A different partial response";
      await delay(120);
      check(!arc("completion-reviewed").checked,"Mutation retained a completion confirmation");
      $("provider-answer").textContent=config.text;
      $("provider-answer").setAttribute("aria-busy","false");
      $("provider-stop").hidden=true;$("provider-send").setAttribute("aria-disabled","false");
      await captureComplete();
      check(arc("preview").textContent===config.text,"Capture omitted or normalized part of the long Unicode text");
      if(!messageId())await clickArc("new-record");
      const firstId=messageId();check(/^arc_[a-f0-9]{32}$/.test(firstId),"Delivery identity was not fixed before forwarding");
      arc("forward").click();await delay(100);
      check((await metric()).delivers===0,"Page code forged a Gateway delivery");
      await clickArc("forward");
      await waitFor(async()=> (await metric()).delivers===1&&/未確認|不明/.test(arc("result").textContent),"lost ACK outcome");
      check(/未確認|不明/.test(arc("result").textContent),"Lost ACK was reported as confirmed delivery");
      const before=await metric();await delay(450);
      check((await metric()).delivers===before.delivers,"Lost ACK caused an automatic resend");
      sessionStorage.setItem("arc-synthetic-human-recovery",JSON.stringify({firstId}));
      await fetch("/__arc/reset-background",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      location.reload();return;
    }
    check(!messageId(),"Page reload silently resumed a delivery identity");
    const before=await metric();await delay(350);const unchanged=await metric();
    check(unchanged.delivers===before.delivers&&unchanged.statuses===before.statuses&&unchanged.starts===before.starts,
      "Reload performed an automatic network operation");
    $("provider-answer").hidden=false;$("provider-answer").textContent=config.text;
    $("provider-answer").setAttribute("aria-busy","false");
    $("provider-stop").hidden=true;$("provider-send").setAttribute("aria-disabled","false");
    await select("provider-answer");
    await clickArc("capture");
    check(!arc("preview").textContent,"Unknown completion was accepted without manual confirmation");
    arc("completion-reviewed").click();await delay(80);
    check(!arc("completion-reviewed").checked&&arc("capture").disabled,
      "Page checkbox click forged completion via a native change event");
    arc("completion-reviewed").checked=true;
    arc("completion-reviewed").dispatchEvent(new Event("change",{bubbles:true}));await delay(300);
    check(!arc("completion-reviewed").checked&&arc("capture").disabled,
      "Page checkbox change forged completion confirmation");
    change(arc("recovery-id"),saved.firstId);await clickArc("resume");
    check(messageId()===saved.firstId,"Explicit recovery did not retain the original delivery ID");
    await captureComplete();
    await clickArc("retry");
    await waitFor(async()=>{const m=await metric();return m.delivers===2&&m.permissionRequests===m.permissionRemoves&&!arc("status").disabled;},"same-ID retry after lost ACK");
    check(arc("result").textContent.includes(saved.firstId),"Retry omitted the confirmed record identity");
    await clickArc("status");
    await waitFor(async()=>{const m=await metric();return m.statuses===1&&m.permissionRequests===m.permissionRemoves&&!arc("new-record").disabled;},"explicit ACK status");
    check((await metric()).delivers===2,"Read-only ACK status submitted another delivery");
    await clickArc("new-record");const secondId=messageId();
    check(/^arc_[a-f0-9]{32}$/.test(secondId)&&secondId!==saved.firstId,"Explicit new record reused the old identity");
    if(arc("preview").textContent!==config.text)await captureComplete();
    await clickArc("forward");
    await waitFor(async()=>{const m=await metric();return m.delivers===3&&m.permissionRequests===m.permissionRemoves&&!arc("new-record").disabled;},"same text with a different ID");
    // Capture completion is revoked if the selected text changes after capture.
    $("provider-answer").textContent=config.text+"\nConflicting revision.";
    await delay(150);
    check(!arc("completion-reviewed").checked,"Changed text retained its manual completion confirmation");
    check(!arc("preview").textContent,"Changed text retained a stale captured payload");
    change(arc("recovery-id"),saved.firstId);await clickArc("resume");
    await captureComplete();
    await clickArc("retry");
    await waitFor(async()=> (await metric()).delivers===4&&/conflict|競合|異なる/.test(arc("result").textContent),"conflicting same-ID retry");
    check(/conflict|競合|異なる/.test(arc("result").textContent),"Conflicting same-ID text was not refused");
    const final=await metric();
    await clickArc("stop");
    $("provider-answer").textContent="Post-stop synthetic mutation";await delay(650);
    const stopped=await metric();
    check(!document.getElementById("metron-arc-picker"),"Stop left the ARC overlay active");
    check(stopped.delivers===final.delivers&&stopped.statuses===final.statuses&&stopped.starts===final.starts,
      "Stop caused an autonomous network operation");
    await finish(true,null,{firstId:saved.firstId,secondId,metrics:stopped,
      providerCallsAfterReload:window.syntheticProvider.calls,explicitRecovery:true,stopped:true,
      productBrowserStorageUsed:false,testDriverStorage:"Synthetic non-private recovery ID only"});
  }catch(error){await finish(false,error.stack||String(error));}
}

const browserSkip=!availableChromium()?"Chromium is unavailable":
  typeof WebSocket!=="function"?"Native browser input requires Node 22+ WebSocket (CI uses Node 24)":false;
test("real synthetic Chromium preserves full ARC replies across lost ACK, reload and explicit same-ID recovery",
  {skip:browserSkip,timeout:150000},async t=>{
    const parent=process.env.METRON_ARC_EVIDENCE_DIR||tmpdir();mkdirSync(parent,{recursive:true});
    const root=mkdtempSync(join(parent,"arc-durable-browser-"));
    const data=join(root,"data");
    const text="\nBEGIN full Unicode reply\n"+("漢字とひらがな 😀 e\u0301 / preserved line\n").repeat(280)+"END \t\n";
    const expectedHash=sha(text),expectedBytes=Buffer.byteLength(text,"utf8");
    assert.ok(text.length>5000);assert.ok(expectedBytes<262144);
    let app,harness;
    try{
      app=await createMiniServer({root:data,port:0});
      harness=await createArcBrowserHarness({app,html,driver:browserDriver,
        config:{text,port:Number(new URL(app.url).port)},dropDeliverAckOnce:true});
      let browser;
      try{browser=await runArcChromium({url:harness.url+"/",evidenceRoot:root,timeoutMs:110000,simulateDomRaceOnce:true});}
      catch(error){
        writeFileSync(join(root,"arc-browser-failure-state.json"),JSON.stringify({report:harness.report(),
          metrics:harness.metrics(),calls:harness.calls,error:String(error.message).slice(0,1000)},null,2)+"\n");
        throw error;
      }
      const report=harness.report();
      assert.ok(report,"No real Chromium report: "+browser.stderr?.slice(-1500));
      assert.equal(report.ok,true,report.error);
      assert.match(browser.stdout,/<pre id="arc-durable-browser-result" data-result="pass">/);
      assert.notEqual(report.firstId,report.secondId);
      const b=app.runtime.mailbox("B").messages.filter(m=>[report.firstId,report.secondId].includes(m.id));
      assert.equal(b.length,2,"Repeated first ID or conflicting text inserted another B record");
      for(const id of [report.firstId,report.secondId]){
        const receipt=app.runtime.arcStatus(id),artifact=app.runtime.arcArtifact(id);
        assert.equal(receipt.accepted,true);assert.equal(receipt.sha256,expectedHash);
        assert.equal(receipt.totalBytes,expectedBytes);assert.equal(artifact.text,text);
        assert.equal(artifact.sha256,expectedHash);assert.equal(artifact.totalBytes,expectedBytes);
        const disk=JSON.parse(readFileSync(join(data,"arc-artifacts","B",id+".json"),"utf8"));
        assert.equal(disk.text,text);assert.equal(sha(disk.text),expectedHash);
        const ack=app.runtime.mailbox("A").messages.filter(m=>m.id==="ack_"+id);
        assert.equal(ack.length,1,"ACK was missing or repeated");
      }
      const metrics=harness.metrics();
      assert.equal(metrics.delivers,4);assert.equal(metrics.statuses,1);
      assert.equal(metrics.permissionRequests,metrics.permissionRemoves);
      assert.equal(metrics.currentVMgeneration,2);
      assert.equal(metrics.nativeClicks,34,"Expected native input for each explicit ARC user action");
      assert.equal(metrics.pressAttempts,metrics.nativeClicks,"DOM retries must not replay a mouse press");
      assert.equal(metrics.injectedDomRaces,1);assert.ok(metrics.domRetries>=1);
      assert.equal(metrics.domRaceInjectionEnabled,true);assert.equal(metrics.uncertainInput,false);
      const evidence={label:"REAL_OWNED_CHROMIUM_SYNTHETIC_DOM_ACTUAL_ARC_CODE_TEST_CHROME_BRIDGE_REAL_MINI",
        liveChatGpt:false,installedExtension:false,realPermissionUx:false,realBrowser:true,
        userAppRestarted:false,cuaUsed:false,newRealAiSends:0,testOnlyBridge:true,nativeInput:true,
        sha256:expectedHash,totalBytes:expectedBytes,report,metrics,calls:harness.calls,
        browser:browser.browser,mailboxB:b,limitations:"No extension isolated-world or authenticated ChatGPT claim"};
      writeFileSync(join(root,"arc-browser-evidence.json"),JSON.stringify(evidence,null,2)+"\n");
      if(process.env.METRON_ARC_EVIDENCE_DIR)t.diagnostic("Saved owned synthetic ARC browser evidence: "+root);
    }finally{
      if(harness)await harness.close();if(app)await app.close();
      if(!process.env.METRON_ARC_EVIDENCE_DIR)rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
  });
