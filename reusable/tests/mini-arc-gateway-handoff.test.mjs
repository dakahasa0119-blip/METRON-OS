import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createMiniServer} from "../../mini/server.mjs";
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
