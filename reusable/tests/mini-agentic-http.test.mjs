import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createMiniServer} from "../../mini/server.mjs";

async function tmp(fn){
  const root=mkdtempSync(join(tmpdir(),"metron-mini-agentic-http-"));
  try{return await fn(root);}
  finally{rmSync(root,{recursive:true,force:true});}
}
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
