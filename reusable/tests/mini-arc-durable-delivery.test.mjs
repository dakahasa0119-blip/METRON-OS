import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,rmSync,readFileSync,readdirSync,statSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {MetronMiniRuntime} from "../../mini/runtime.mjs";
import {ArcHandoff} from "../../mini/arc-handoff.mjs";
import {ARC_MAX_BYTES} from "../../mini/arc-artifact.mjs";
import {createMiniServer} from "../../mini/server.mjs";
import {writeAtomicJson} from "../gateway-jobs/checkpoint.mjs";

const id=n=>"arc_"+n.toString(16).padStart(32,"0");
const request=(n,text="  日本語とemoji🙂をそのまま保存\n ")=>({messageId:id(n),text,
  sha256:createHash("sha256").update(text,"utf8").digest("hex"),totalBytes:Buffer.byteLength(text,"utf8")});
const isolated=async fn=>{const root=mkdtempSync(join(tmpdir(),"arc-durable-backend-"));
  try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const deliver=(handoff,value)=>handoff.deliver({version:2,...handoff.start(),...value});
function files(root,prefix=""){
  const result={};
  for(const entry of readdirSync(join(root,prefix),{withFileTypes:true})){
    const relative=join(prefix,entry.name),file=join(root,relative);
    if(entry.isDirectory())Object.assign(result,files(root,relative));
    else result[relative]={text:readFileSync(file,"utf8"),mtime:statSync(file).mtimeMs};
  }
  return result;
}

test("ARC V2 survives a fresh Node process and deduplicates the same logical ID",()=>isolated(root=>{
  const value=request(1),runtime=new MetronMiniRuntime(root);
  const first=deliver(new ArcHandoff(runtime),value);
  assert.equal(first.accepted,true);assert.equal(first.ackState,"received");
  assert.equal(runtime.arcArtifact(value.messageId).text,value.text);
  const moduleUrl=new URL("../../mini/runtime.mjs",import.meta.url).href;
  const script=`import fs from 'node:fs'; import {MetronMiniRuntime} from ${JSON.stringify(moduleUrl)};
    const value=JSON.parse(fs.readFileSync(0,'utf8'));
    const runtime=new MetronMiniRuntime(process.argv[1]);
    const receipt=runtime.submitArc(value);
    console.log(JSON.stringify({receipt,artifact:runtime.arcArtifact(value.messageId),
      a:runtime.mailbox('A').messages.length,b:runtime.mailbox('B').messages.length}));`;
  const env=Object.fromEntries(["PATH","Path","SystemRoot","WINDIR","TEMP","TMP"]
    .filter(key=>typeof process.env[key]==="string").map(key=>[key,process.env[key]]));
  const restored=JSON.parse(execFileSync(process.execPath,["--input-type=module","-e",script,root],
    {input:JSON.stringify(value),encoding:"utf8",env,windowsHide:true,timeout:30000}));
  assert.equal(restored.receipt.accepted,true);assert.equal(restored.receipt.deduplicated,true);
  assert.equal(restored.receipt.receiptHash,value.sha256);assert.equal(restored.artifact.text,value.text);
  assert.equal(restored.a,1);assert.equal(restored.b,1);
}));

test("ARC V2 rejects changed content or routing while identical text under another ID is a new message",()=>isolated(root=>{
  const runtime=new MetronMiniRuntime(root),value=request(2);
  runtime.submitArc(value);
  assert.throws(()=>runtime.submitArc(request(2,"different")),{code:"message_id_conflict"});
  assert.throws(()=>runtime.submitArc({...value,from:"B",to:"A"}),{code:"invalid_arc_request"});
  const second=runtime.submitArc(request(3,value.text));
  assert.equal(second.accepted,true);assert.equal(second.deduplicated,false);
  assert.equal(runtime.mailbox("B").messages.length,2);assert.equal(runtime.mailbox("A").messages.length,2);
  assert.equal(runtime.arcArtifact(value.messageId).text,value.text);
  for(const field of ["sender","recipient","type","body"]){
    const directory=join(root,field),pending=new MetronMiniRuntime(directory);
    pending.drain=()=>0;pending.submitArc(value);
    const file=join(directory,"gateway.json"),checkpoint=JSON.parse(readFileSync(file,"utf8"));
    const envelope=checkpoint.queue.jobs.find(job=>job.id===value.messageId).payload.envelope;
    envelope[field]={sender:"B",recipient:"A",type:"ACK",body:"changed"}[field];
    writeAtomicJson(file,checkpoint);
    const restored=new MetronMiniRuntime(directory);
    assert.throws(()=>restored.submitArc(value),{code:"message_id_conflict"});
    assert.equal(restored.mailbox("B").messages.length,0);
  }
}));

test("lost ARC response is recovered by a read-only one-use status and explicit same-ID resend",()=>isolated(root=>{
  const runtime=new MetronMiniRuntime(root),value=request(4);
  deliver(new ArcHandoff(runtime),value); // Pretend the successful HTTP response was lost.
  const handoff=new ArcHandoff(runtime),session=handoff.start(),snapshot=files(root),drain=runtime.drain;
  runtime.drain=()=>{throw new Error("status must not drain");};
  const receipt=handoff.status({version:2,...session,messageId:value.messageId});
  assert.equal(receipt.accepted,true);assert.equal(receipt.sha256,value.sha256);
  assert.deepEqual(files(root),snapshot);
  assert.throws(()=>handoff.status({version:2,...session,messageId:value.messageId}),{code:"arc_session_expired_or_used"});
  const unknown=handoff.status({version:2,...handoff.start(),messageId:id(999)});
  assert.equal(unknown.submitted,false);assert.equal(unknown.accepted,false);
  assert.equal(unknown.deliveryState,"unknown");assert.deepEqual(files(root),snapshot);
  runtime.drain=drain;
  const resent=deliver(handoff,value);
  assert.equal(resent.deduplicated,true);assert.equal(resent.accepted,true);
  assert.equal(runtime.mailbox("B").messages.length,1);assert.equal(runtime.mailbox("A").messages.length,1);
}));

test("B artifact and reference persist before a failed ACK enqueue and restoration delivers only once",()=>isolated(root=>{
  const value=request(5),runtime=new MetronMiniRuntime(root),enqueue=runtime.gateway.enqueue.bind(runtime.gateway);
  runtime.gateway.enqueue=(key,payload)=>{if(key==="ack_"+value.messageId)throw new Error("ACK write unavailable");return enqueue(key,payload);};
  const pending=runtime.submitArc(value);
  assert.equal(pending.accepted,false);assert.equal(pending.deliveryState,"ack_pending");
  assert.equal(runtime.mailbox("B").messages.length,1);assert.equal(runtime.mailbox("A").messages.length,0);
  assert.equal(runtime.arcArtifact(value.messageId).text,value.text);
  const restored=new MetronMiniRuntime(root); // The prior instance is idle; no concurrent writer.
  assert.equal(restored.arcStatus(value.messageId).accepted,false);
  const receipt=deliver(new ArcHandoff(restored),value);
  assert.equal(receipt.deduplicated,true);assert.equal(receipt.accepted,true);
  assert.equal(restored.mailbox("B").messages.length,1);assert.equal(restored.mailbox("A").messages.length,1);
  const ack=JSON.parse(restored.mailbox("A").messages[0].body);
  assert.equal(ack.sha256,value.sha256);assert.equal(ack.totalBytes,value.totalBytes);
}));

test("a completed ARC job stays unaccepted until the separate durable ACK reaches A",()=>isolated(root=>{
  const runtime=new MetronMiniRuntime(root),value=request(6);
  for(let i=0;i<99;i++)runtime.gateway.enqueue("earlier_"+i,{envelope:{id:"earlier_"+i,
    sender:"A",recipient:"B",type:"ACK",body:"earlier",traceId:"earlier_trace_"+i},meta:{}});
  const pending=runtime.submitArc(value);
  assert.equal(pending.jobState,"done");assert.equal(pending.accepted,false);
  assert.equal(pending.ackState,"pending");assert.equal(pending.deliveryState,"ack_pending");
  assert.equal(runtime.mailbox("A").messages.length,0);
  runtime.drain();assert.equal(runtime.arcStatus(value.messageId).accepted,true);
  assert.equal(runtime.mailbox("A").messages.length,1);
}));

test("long Unicode ARC text retains every byte in B and remains a short ordinary envelope reference",()=>isolated(root=>{
  const text=" \n"+"漢字🙂\n".repeat(12000)+"\n ",value=request(7,text),runtime=new MetronMiniRuntime(root);
  const receipt=runtime.submitArc(value),saved=runtime.arcArtifact(value.messageId);
  assert.equal(receipt.accepted,true);assert.equal(receipt.totalBytes,value.totalBytes);
  assert.equal(saved.text,text);assert.equal(saved.sha256,value.sha256);
  assert.equal(Buffer.byteLength(saved.text,"utf8"),value.totalBytes);
  assert.ok(runtime.mailbox("B").messages[0].body.length<1024);
  assert.equal(JSON.parse(readFileSync(join(root,"arc-artifacts","B",value.messageId+".json"),"utf8")).text,text);
  assert.throws(()=>runtime.submit({messageId:"ordinary",from:"A",to:"B",message:"x".repeat(1025),code:""}),{code:"invalid_message"});
}));

test("missing or corrupt persisted ARC chunks never create a B reference or accepted receipt",()=>isolated(root=>{
  for(const [index,damage] of ["missing","corrupt"].entries()){
    const directory=join(root,damage),runtime=new MetronMiniRuntime(directory),value=request(20+index,"文🙂".repeat(3000));
    runtime.drain=()=>0;runtime.submitArc(value);
    const file=join(directory,"gateway.json"),checkpoint=JSON.parse(readFileSync(file,"utf8"));
    const artifact=checkpoint.queue.jobs.find(job=>job.id===value.messageId).payload.arcArtifact;
    if(damage==="missing")artifact.chunks.pop();else artifact.chunks[0][1]="AAAA";
    writeAtomicJson(file,checkpoint);
    const restored=new MetronMiniRuntime(directory);
    assert.throws(()=>restored.drain(),{code:"delivery_failed"});
    assert.equal(restored.mailbox("B").messages.length,0);assert.equal(restored.arcArtifact(value.messageId),null);
    assert.equal(existsSync(join(directory,"arc-artifacts")),false);
    const receipt=restored.arcStatus(value.messageId);
    assert.equal(receipt.accepted,false);assert.equal(receipt.deliveryState,"invalid_artifact");
  }
}));

test("ARC V2 rejects forged digests, byte lengths, invalid Unicode and over-budget text before enqueue",()=>isolated(root=>{
  const runtime=new MetronMiniRuntime(root),value=request(8);
  assert.throws(()=>runtime.submitArc({...value,sha256:"0".repeat(64)}),{code:"arc_content_hash_mismatch"});
  assert.throws(()=>runtime.submitArc({...value,totalBytes:value.totalBytes+1}),{code:"arc_byte_length_mismatch"});
  assert.throws(()=>runtime.submitArc(request(8,"bad"+String.fromCharCode(0xd800))),{code:"invalid_arc_unicode"});
  assert.throws(()=>runtime.submitArc(request(8,"x".repeat(ARC_MAX_BYTES+1))),{code:"arc_reply_too_large"});
  assert.throws(()=>runtime.submitArc(request(8," \n\t ")),{code:"invalid_arc_reply"});
  assert.equal(runtime.gateway.queue.snapshot().jobs.length,0);
  assert.equal(existsSync(join(root,"arc-artifacts")),false);
}));

test("ARC HTTP V2 carries long text while status is read-only and ordinary route limits remain unchanged",()=>isolated(async root=>{
  const app=await createMiniServer({root,port:0});
  const headers={"Content-Type":"application/json","X-Metron-Mini":"1",Origin:"chrome-extension://"+"a".repeat(32)};
  const post=async body=>{const response=await fetch(app.url+"/api/arc/handoff",{method:"POST",headers,body:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};};
  const session=async()=>{const result=await post({action:"start"});assert.equal(result.status,200);return result.data;};
  try{
    const value=request(9,"日本語🙂".repeat(10000));
    const first=await post({action:"deliver",version:2,...await session(),...value});
    assert.equal(first.status,200);assert.equal(first.data.accepted,true);
    assert.equal(app.runtime.arcArtifact(value.messageId).text,value.text);
    const status=await post({action:"status",version:2,...await session(),messageId:value.messageId});
    assert.equal(status.status,200);assert.equal(status.data.accepted,true);assert.equal(status.data.receiptHash,value.sha256);
    const conflict=await post({action:"deliver",version:2,...await session(),...request(9,"changed")});
    assert.equal(conflict.status,400);assert.equal(conflict.data.error,"message_id_conflict");
    const mission=await fetch(app.url+"/api/mission",{method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
      body:JSON.stringify({from:"A",to:"B",message:"x".repeat(1025),code:""})});
    assert.equal(mission.status,400);assert.equal((await mission.json()).error,"invalid_message");
    const oversized=await fetch(app.url+"/api/mission",{method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
      body:JSON.stringify({from:"A",to:"B",message:"x".repeat(20000),code:""})});
    assert.equal(oversized.status,400);assert.equal((await oversized.json()).error,"payload_too_large");
  }finally{await app.close();}
}));
