import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createMiniServer} from "../../mini/server.mjs";
const base=new URL("../../mini/arc-browser/",import.meta.url);
test("extension uses optional localhost permission and explicit user action",()=>{
 const manifest=JSON.parse(readFileSync(new URL("manifest.json",base),"utf8"));
 assert.deepEqual(manifest.optional_host_permissions,["http://127.0.0.1/*"]);
 const bg=readFileSync(new URL("background.js",base),"utf8");
 const content=readFileSync(new URL("content.js",base),"utf8");
 assert.match(bg,/chrome.permissions.request/);
 assert.match(bg,/arc_gateway_handoff/);
 assert.match(content,/forward.addEventListener\("click"/);
 assert.match(content,/chrome.runtime.sendMessage/);
});
test("extension origin is accepted, unrelated web origin rejected, and mailbox persists",async()=>{
 const root=mkdtempSync(join(tmpdir(),"arc-extension-http-"));
 const app=await createMiniServer({root,port:0});
 const headers={"Content-Type":"application/json","X-Metron-Mini":"1",
  Origin:"chrome-extension://"+"a".repeat(32)};
 const post=async body=>{
  const r=await fetch(app.url+"/api/arc/handoff",{method:"POST",headers,
   body:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
 };
 try{
  const session=await post({action:"start"});
  assert.equal(session.status,200);
  const delivered=await post({action:"deliver",...session.data,text:"ARC captured answer"});
  assert.equal(delivered.status,200);
  assert.equal(delivered.data.accepted,true);
  assert.ok(app.runtime.mailbox("B").messages.some(x=>x.body.includes("ARC captured answer")));
  assert.equal((await post({action:"deliver",...session.data,text:"replay"})).status,400);
  const blocked=await fetch(app.url+"/api/arc/handoff",{method:"POST",
   headers:{...headers,Origin:"https://chatgpt.com"},
   body:JSON.stringify({action:"start"})});
  assert.equal(blocked.status,403);
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
