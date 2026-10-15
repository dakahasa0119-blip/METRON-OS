import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createMiniServer} from "../../mini/server.mjs";
import {execFileSync} from "node:child_process";

async function tmp(fn){
  const root=mkdtempSync(join(tmpdir(),"metron-mini-agentic-http-"));
  try{return await fn(root);}
  finally{rmSync(root,{recursive:true,force:true});}
}
test("legacy auto route allows local validation without external consent",()=>tmp(root=>{
  // Exercise the actual route handler in an isolated process, with a fake HTTP
  // listener and provider fetch. No sockets or inherited provider keys are used.
  const serverUrl=new URL("../../mini/server.mjs",import.meta.url).href;
  const code=`import assert from 'node:assert/strict';
    import http from 'node:http';import {EventEmitter} from 'node:events';
    import {syncBuiltinESMExports} from 'node:module';
    let handler;http.createServer=fn=>{handler=fn;const server=new EventEmitter();
      server.address=()=>({port:54321});server.listen=(_,__,ready)=>{queueMicrotask(ready);return server;};
      server.close=done=>done();return server;};syncBuiltinESMExports();
    const {createMiniServer}=await import(${JSON.stringify(serverUrl)});
    const calls=[];globalThis.fetch=async url=>{
      calls.push(String(url));assert.equal(String(url),'http://127.0.0.1:11434/api/generate');
      return new Response(JSON.stringify({response:JSON.stringify({diagnosis:'Injected local transport fixture',changes:[
        {path:'src/pricing.mjs',content:'export function unitPrice(base, discount) { return base - discount; }'},
        {path:'src/invoice.mjs',content:'import { unitPrice } from "./pricing.mjs";\\nexport function invoiceTotal(base, discount, quantity) { return unitPrice(base, discount) * quantity; }'}
      ]})}),{status:200});};
    const app=await createMiniServer({root:process.argv[1],port:0});
    async function request(body){let status,data;const req={method:'POST',url:'/api/agent/run',
      headers:{host:'127.0.0.1:54321','content-type':'application/json','x-metron-mini':'1'},
      async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};
      await handler(req,{writeHead(code){status=code;},end(text){data=JSON.parse(text);}});
      return {status,data};}
    try{const automatic=await request({provider:'auto',providerOrder:['ollama','openai'],allowExternalCalls:false});
      assert.equal(automatic.status,200);assert.equal(automatic.data.status,'verified_candidate');
      assert.equal(automatic.data.attempts[0].provider,'ollama');
      const denied=await request({provider:'openai',allowExternalCalls:false});
      assert.equal(denied.status,403);assert.equal(denied.data.error,'remote_ai_requires_explicit_consent');
      assert.equal(calls.length,1);console.log(JSON.stringify({localCalls:calls.length,externalCalls:0}));
    }finally{await app.close();}`;
  const result=execFileSync(process.execPath,["--input-type=module","-e",code,root],{
    shell:false,windowsHide:true,encoding:"utf8",timeout:20000,maxBuffer:48000,
    env:{PATH:process.env.PATH||"",SystemRoot:process.env.SystemRoot||"",TEMP:tmpdir(),TMP:tmpdir(),
      METRON_LOCAL_MODEL:"fixture-local",METRON_REPAIR_MODEL:"fixture-remote",OPENAI_API_KEY:"fixture"}
  });
  assert.deepEqual(JSON.parse(result),{localCalls:1,externalCalls:0});
}));
test("real browser exposes original BAKU agent loop, not merely backup recovery",()=>tmp(async root=>{
  const service=await createMiniServer({root,port:0});
  try{
    const page=await fetch(service.url+"/experience");
    assert.equal(page.status,200);
    const html=await page.text();
    assert.match(html,/id="baku-agentic-demo"/);
    assert.match(html,/id="try-agentic-repair"/);
    assert.match(html,/id="agent-model"/);
    assert.match(html,/id="agent-resume-id"/);
    const js=await fetch(service.url+"/experience.js").then(r=>r.text());
    assert.match(js,/\/api\/agent\/run/);
  }finally{await service.close();}
}));
test("model-unavailable BAKU route fails closed with durable incident and no file application",()=>tmp(async root=>{
  const service=await createMiniServer({root,port:0});
  try{
    const status=await fetch(service.url+"/api/agent/status").then(r=>r.json());
    assert.equal(status.scope,"first_party_disposable_multifile_fixture_only");
    assert.equal(status.productionChanges,false);
    const response=await fetch(service.url+"/api/agent/run",{
      method:"POST",headers:{
        "Content-Type":"application/json","X-Metron-Mini":"1"
      },
      body:JSON.stringify({
        provider:"ollama",
        goal:"Invoice total is not correct for discounted items."
      })
    });
    assert.equal(response.status,200);
    const result=await response.json();
    // No real Ollama model configured on CI: there must be no invented result.
    if(!status.configured.ollama){
      assert.equal(result.status,"blocked");
      assert.equal(result.reason,"local_repair_model_not_configured");
      assert.ok(result.runId?.startsWith("case_"));
      assert.equal(result.productionChanged,false);
      assert.equal(existsSync(join(root,"agentic-baku",
        "baku-agent-journal",result.runId+".json")),true);
    }
  }finally{await service.close();}
}));
test("BAKU external model endpoint has explicit per-request consent gate",()=>tmp(async root=>{
  const service=await createMiniServer({root,port:0});
  try{
    const response=await fetch(service.url+"/api/agent/run",{
      method:"POST",headers:{
        "Content-Type":"application/json","X-Metron-Mini":"1"
      },body:JSON.stringify({provider:"openai",goal:"Invoice incorrect"})
    });
    assert.equal(response.status,403);
    assert.equal((await response.json()).error,"remote_ai_requires_explicit_consent");
    const invalidOrigin=await fetch(service.url+"/api/agent/run",{
      method:"POST",headers:{
        "Content-Type":"application/json","X-Metron-Mini":"1",
        Origin:"https://untrusted.example"
      },body:JSON.stringify({provider:"ollama",goal:"Invoice incorrect"})
    });
    assert.equal(invalidOrigin.status,403);
    const noHeader=await fetch(service.url+"/api/agent/run",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({provider:"ollama",goal:"Invoice incorrect"})
    });
    assert.equal(noHeader.status,403);
  }finally{await service.close();}
}));
