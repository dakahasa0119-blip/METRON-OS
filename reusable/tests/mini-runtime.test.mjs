import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetronMiniRuntime } from "../../mini/runtime.mjs";
import { writeAtomicJson } from "../gateway-jobs/checkpoint.mjs";
import { receiveMailboxMessage } from "../mothership/mailbox.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMiniServer } from "../../mini/server.mjs";

function isolated(fn){
  const root=mkdtempSync(join(tmpdir(),"metron-mini-test-"));
  try{return fn(root);}
  finally{rmSync(root,{recursive:true,force:true});}
}
async function isolatedAsync(fn){
  const root=mkdtempSync(join(tmpdir(),"metron-mini-http-"));
  try{return await fn(root);}
  finally{rmSync(root,{recursive:true,force:true});}
}
const req=(id,code="function greet(){return 1;}")=>({
  messageId:id,from:"A",to:"B",
  message:"システムの配達確認をしてください",
  code,arc:{selectorsChecked:true}
});

test("METRON Mini integrates Gateway, A/B MotherShip, BAKU summary and ARC browser claim",()=>isolated(root=>{
  const runtime=new MetronMiniRuntime(root);
  const result=runtime.submit(req("first"));
  assert.equal(result.job.state,"done");
  assert.equal(result.state.ships.B.count,1);
  assert.equal(result.state.ships.A.count,1);
  assert.equal(result.state.gateway.jobs,2);
  assert.equal(result.state.gateway.byState.done,2);
  const original=result.state.ships.B.messages[0];
  const ack=result.state.ships.A.messages[0];
  assert.equal(original.type,"OBSERVE");
  assert.equal(ack.type,"ACK");
  assert.equal(ack.sender,"B");
  assert.equal(ack.recipient,"A");
  assert.equal(result.job.result.meta.baku.inspected,true);
  assert.deepEqual(result.job.result.meta.baku.cards.map(x=>x.name),["greet"]);
  assert.equal(result.job.result.meta.arc.selectorsChecked,true);
  const gatewayFile=readFileSync(join(root,"gateway.json"),"utf8");
  assert.ok(!gatewayFile.includes("function greet"));
  assert.ok(!gatewayFile.includes("return 1"));
}));

test("restart restores three persistent files; exact replay doesn't create duplicate messages",()=>isolated(root=>{
  let runtime=new MetronMiniRuntime(root);
  runtime.submit(req("replay"));
  runtime=new MetronMiniRuntime(root);
  assert.equal(runtime.state().ships.A.count,1);
  assert.equal(runtime.state().ships.B.count,1);
  const result=runtime.submit(req("replay"));
  assert.equal(result.deduplicated,true);
  assert.equal(result.state.gateway.jobs,2);
  assert.equal(runtime.state().ships.B.count,1);
  assert.throws(()=>runtime.submit({...req("replay"),message:"different body"}),/messageId has different content/);
  assert.throws(()=>runtime.submit(req("replay","function changed(){return 2;}")),/different content/);
}));

test("rejects invalid routes and oversized messages; code is not executed",()=>isolated(root=>{
  const runtime=new MetronMiniRuntime(root);
  assert.throws(()=>runtime.submit({...req("bad"),to:"A"}),/two different/);
  assert.throws(()=>runtime.submit({...req("bad"),message:""}),/message length/);
  assert.throws(()=>runtime.submit({...req("bad"),message:"x".repeat(1025)}),/message length/);
  assert.throws(()=>runtime.submit({...req("bad"),code:"x".repeat(4001)}),/at most 4,000/);
  const text="function unsafe(){ return eval('1+2'); }";
  const r=runtime.submit(req("staticOnly",text));
  assert.deepEqual(r.job.result.meta.baku.cards[0].flags,["dynamic-evaluation"]);
  assert.equal(r.job.result.meta.baku.cards[0].reviewRequired,true);
}));

test("local HTTP server serves all four systems and blocks cross-origin POST",()=>isolatedAsync(async root=>{
  const srv=await createMiniServer({root,port:0});
  try{
    assert.ok(srv.url.startsWith("http://127.0.0.1:"));
    const [html,client,kit]=await Promise.all([
      fetch(srv.url+"/").then(x=>x.text()),
      fetch(srv.url+"/client.js").then(x=>x.text()),
      fetch(srv.url+"/arc-kit.mjs").then(x=>x.text())
    ]);
    assert.match(html,/METRON Mini OS/);
    assert.match(client,/startPicker/);
    assert.match(kit,/function findDeep/);
    const start=await fetch(srv.url+"/api/state").then(r=>r.json());
    assert.equal(start.gateway.jobs,0);
    const noHeader=await fetch(srv.url+"/api/mission",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(req("noHeader"))
    });
    assert.equal(noHeader.status,403);
    const badOrigin=await fetch(srv.url+"/api/mission",{
      method:"POST",headers:{"Content-Type":"application/json",
        "X-Metron-Mini":"1","Origin":"https://untrusted.example"},
      body:JSON.stringify(req("badOrigin"))
    });
    assert.equal(badOrigin.status,403);
    const result=await fetch(srv.url+"/api/mission",{
      method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
      body:JSON.stringify(req("httpFirst"))
    });
    assert.equal(result.status,200);
    const value=await result.json();
    assert.equal(value.job.state,"done");
    assert.equal(value.state.ships.A.count,1);
    assert.equal(value.state.ships.B.count,1);
    assert.equal((await fetch(srv.url+"/api/health").then(r=>r.json())).status,"ok");
    assert.equal((await fetch(srv.url+"/../../LICENSE")).status,404);
  }finally{await srv.close();}
}));

test("wrong recipient and conflicting ID preserve message integrity",()=>isolated(root=>{
  const runtime=new MetronMiniRuntime(root);
  runtime.submit(req("same"));
  assert.throws(()=>runtime.submit({...req("same"),to:"A"}),/two different/);
  assert.throws(()=>runtime.submit({...req("same"),from:"B",to:"A"}),/different content/);
  assert.equal(runtime.state().ships.A.count,1);
  assert.equal(runtime.state().ships.B.count,1);
}));


const execFileAsync=promisify(execFile);
function availableChromium(){
  return [
    process.env.CHROME_BIN,"/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable","/usr/bin/chromium",
    process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,"Google","Chrome","Application","chrome.exe"),
    process.env["PROGRAMFILES(X86)"]&&join(process.env["PROGRAMFILES(X86)"],"Microsoft","Edge","Application","msedge.exe")
  ].filter(Boolean).find(existsSync)||null;
}
test("METRON Mini dashboard starts ARC DOM checks in a real Chromium browser",
  {skip:!availableChromium()},
  ()=>isolatedAsync(async root=>{
    const server=await createMiniServer({root:join(root,"data"),port:0});
    try{
      const browser=availableChromium();
      const args=["--headless=new","--disable-gpu","--disable-background-networking",
        "--no-first-run","--no-default-browser-check","--disable-extensions",
        "--virtual-time-budget=4000","--user-data-dir="+join(root,"browser"),
        "--dump-dom",server.url+"/"];
      if(process.getuid?.()===0)args.unshift("--no-sandbox");
      const {stdout}=await execFileAsync(browser,args,{
        timeout:30000,maxBuffer:8*1024*1024,windowsHide:true
      });
      assert.match(stdout,/id="health">RUNNING<\/small>/);
      assert.match(stdout,/id="arc-ready">3 \/ 3<\/span>/);
      assert.match(stdout,/METRON Mini OS/);
    }finally{await server.close();}
  })
);


test("B to A requests create an independent automatic ACK from A to B",()=>isolated(root=>{
  const runtime=new MetronMiniRuntime(root);
  const sent=runtime.submit({
    messageId:"reverse",from:"B",to:"A",message:"Back from MotherShip B",code:""
  });
  assert.equal(sent.job.state,"done");
  assert.equal(runtime.state().ships.A.messages[0].sender,"B");
  assert.equal(runtime.state().ships.B.messages[0].sender,"A");
  assert.equal(runtime.state().ships.B.messages[0].type,"ACK");
}));

test("Mini recovers crash after receiver persisted before Gateway ACK without duplicate",()=>isolated(root=>{
  let now=1000;
  let runtime=new MetronMiniRuntime(root,{now:()=>now,leaseMs:10});
  const envelope={
    id:"crashOriginal",sender:"A",recipient:"B",
    type:"OBSERVE",body:"simulated local crash",traceId:"traceCrash"
  };
  runtime.gateway.enqueue(envelope.id,{
    envelope,meta:{workClass:"general",codeDigest:"",baku:{inspected:false,cards:[]}}
  });
  const lease=runtime.gateway.claim("lost-worker");
  assert.equal(lease.id,envelope.id);
  const delivered=receiveMailboxMessage(runtime.mailbox("B"),envelope);
  assert.equal(delivered.status,"accepted");
  writeAtomicJson(runtime.shipFiles.B,delivered.mailbox);
  // Worker dies before completion; lease expires, then a fresh Mini restores.
  now=1011;
  runtime=new MetronMiniRuntime(root,{now:()=>now,leaseMs:10});
  assert.equal(runtime.gateway.getJob(envelope.id).state,"pending");
  runtime.drain();
  const state=runtime.state();
  assert.equal(state.ships.B.count,1);
  assert.equal(state.ships.A.count,1);
  assert.equal(runtime.gateway.getJob(envelope.id).state,"done");
  assert.equal(runtime.gateway.getJob(envelope.id).result.delivery,"duplicate");
}));
