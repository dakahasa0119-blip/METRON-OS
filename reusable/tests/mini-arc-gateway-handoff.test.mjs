import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createMiniServer} from "../../mini/server.mjs";
import {ArcHandoff} from "../../mini/arc-handoff.mjs";
import {MetronMiniRuntime} from "../../mini/runtime.mjs";
const temp=async fn=>{const root=mkdtempSync(join(tmpdir(),"metron-arc-gateway-"));try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
test("one-time ARC handoff delivers real response to same-village MotherShip B",()=>temp(async root=>{
 const app=await createMiniServer({root,port:0});
 const headers={"Content-Type":"application/json","X-Metron-Mini":"1"};
 const call=async body=>{const r=await fetch(app.url+"/api/arc/handoff",{
  method:"POST",headers,body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  const session=(await call({action:"start"})).data;
  const response=await call({action:"deliver",...session,text:"実際の外部AI回答"});
  assert.equal(response.status,200);
  assert.equal(response.data.submitted,true);
  assert.equal(response.data.accepted,true);
  assert.equal(app.runtime.mailbox("B").messages.some(x=>x.body.includes("実際の外部AI回答")),true);
  assert.equal((await call({action:"deliver",...session,text:"再送"})).status,400);
  const noOrigin=await fetch(app.url+"/api/arc/handoff",{
   method:"POST",headers:{...headers,Origin:"https://chatgpt.com"},
   body:JSON.stringify({action:"start"})});
  assert.equal(noOrigin.status,403);
  assert.equal((await call({action:"deliver",id:"invalid",token:"x",text:"x"})).status,400);
 }finally{await app.close();}
}));

test("bounded drain returns a pending ARC receipt and eventually delivers once",()=>temp(async root=>{
 const app=await createMiniServer({root,port:0});
 const call=async body=>{const r=await fetch(app.url+"/api/arc/handoff",{
  method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
  body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  // Seed real durable work without submit's automatic bounded drain.
  for(let i=0;i<101;i++)app.runtime.gateway.enqueue("backlog_"+i,{
   envelope:{id:"backlog_"+i,sender:"A",recipient:"B",type:"ACK",
    body:"Earlier work",traceId:"backlog_trace_"+i},meta:{}});
  const session=(await call({action:"start"})).data;
  const text="ARC reply waiting behind the queue";
  const response=await call({action:"deliver",...session,text});
  assert.equal(response.status,200);
  const receipt=response.data;
  assert.equal(receipt.submitted,true);
  assert.equal(receipt.accepted,false);
  assert.equal(receipt.jobState,"pending");
  assert.match(receipt.messageId,/^m_[a-f0-9]{32}$/);
  assert.equal(app.runtime.mailbox("B").messages.length,100);
  assert.equal(app.runtime.gateway.getJob(receipt.messageId).state,"pending");
  assert.equal((await call({action:"deliver",...session,text})).status,400);
  app.runtime.drain();
  app.runtime.drain();
  assert.equal(app.runtime.gateway.getJob(receipt.messageId).state,"done");
  assert.equal(app.runtime.mailbox("B").messages.filter(x=>x.id===receipt.messageId).length,1);
  assert.equal(app.runtime.mailbox("A").messages.filter(x=>x.id==="ack_"+receipt.messageId).length,1);
  assert.equal(app.runtime.gateway.queue.snapshot().jobs.filter(x=>x.payload?.envelope?.body.includes(text)).length,1);
 }finally{await app.close();}
}));

test("failure after durable enqueue returns the existing pending ARC job",()=>temp(root=>{
 const runtime=new MetronMiniRuntime(root);
 const handoff=new ArcHandoff(runtime);
 const session=handoff.start();
 const drain=runtime.drain;
 runtime.drain=()=>{throw new Error("temporary drain failure");};
 const receipt=handoff.deliver({...session,text:"Durably submitted reply"});
 assert.equal(receipt.submitted,true);
 assert.equal(receipt.accepted,false);
 assert.equal(receipt.jobState,"pending");
 assert.throws(()=>handoff.deliver({...session,text:"Durably submitted reply"}),
  {code:"arc_session_expired_or_used"});
 runtime.drain=drain;
 // Reopen the checkpoint to verify this receipt describes durable work.
 const restored=new MetronMiniRuntime(root);
 assert.equal(restored.gateway.getJob(receipt.messageId).state,"pending");
 restored.drain();
 restored.drain();
 assert.equal(restored.gateway.getJob(receipt.messageId).state,"done");
 assert.equal(restored.mailbox("B").messages.filter(x=>x.id===receipt.messageId).length,1);
}));

test("failure before enqueue does not claim a submitted ARC receipt",()=>temp(root=>{
 const runtime=new MetronMiniRuntime(root);
 const handoff=new ArcHandoff(runtime);
 const session=handoff.start();
 const failure=new Error("enqueue unavailable");
 runtime.gateway.enqueue=()=>{throw failure;};
 assert.throws(()=>handoff.deliver({...session,text:"Not submitted"}),error=>error===failure);
 assert.equal(runtime.gateway.queue.snapshot().jobs.length,0);
 assert.throws(()=>handoff.deliver({...session,text:"Not submitted"}),
  {code:"arc_session_expired_or_used"});
}));

test("state-read failure after completed delivery retains the accepted ARC receipt",()=>temp(root=>{
 const runtime=new MetronMiniRuntime(root);
 const handoff=new ArcHandoff(runtime);
 runtime.state=()=>{throw new Error("state view unavailable");};
 const receipt=handoff.deliver({...handoff.start(),text:"Already delivered"});
 assert.equal(receipt.submitted,true);
 assert.equal(receipt.accepted,true);
 assert.equal(receipt.jobState,"done");
 assert.equal(runtime.mailbox("B").messages.filter(x=>x.id===receipt.messageId).length,1);
}));
