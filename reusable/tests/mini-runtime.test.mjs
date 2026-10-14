import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetronMiniRuntime } from "../../mini/runtime.mjs";
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
  const result=runtime.submit(req("replay","function changed(){return 2;}"));
  assert.equal(result.deduplicated,true);
  assert.equal(result.state.gateway.jobs,2);
  assert.equal(runtime.state().ships.B.count,1);
  assert.throws(()=>runtime.submit({...req("replay"),message:"different body"}),/messageId has different content/);
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
