import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {runAgenticRepair} from "../../mini/agentic-runner.mjs";

async function sandbox(fn){
 const root=mkdtempSync(join(tmpdir(),"baku-failover-"));
 try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}
}
const repair1="export function unitPrice(base, discount) { return base - discount; }\n";
const repair2='import { unitPrice } from "./pricing.mjs";\n'+
 'export function invoiceTotal(base, discount, quantity) { return unitPrice(base, discount) * quantity; }\n';
const repaired=JSON.stringify({diagnosis:"Injected arithmetic repair, not real AI",changes:[
 {path:"src/pricing.mjs",content:repair1},{path:"src/invoice.mjs",content:repair2}]});
const configured={METRON_LOCAL_MODEL:"fixture-local",OPENAI_API_KEY:"fixture",METRON_REPAIR_MODEL:"fixture-remote"};
test("BAKU repairs after unavailable local LLM using a different real-provider adapter",()=>sandbox(async root=>{
 const seen=[];
 const fetcher=async(url,init)=>{
  seen.push(String(url));
  assert.match(String(url),/api.openai.com/);
  return new Response(JSON.stringify({output_text:JSON.stringify({
   diagnosis:"Both unit price and invoice multiplier must be corrected",
   changes:[{path:"src/pricing.mjs",content:repair1},
            {path:"src/invoice.mjs",content:repair2}]
  })}),{status:200});
 };
 const result=await runAgenticRepair({root,
  providerOrder:["ollama","openai"],allowExternalCalls:true,
  env:{OPENAI_API_KEY:"fixture",METRON_REPAIR_MODEL:"fixture"},
  fetcher,maxAttempts:2
 });
 assert.equal(result.status,"verified_candidate");
 assert.equal(result.attempts[0].provider,"openai");
 assert.equal(result.attempts[0].holdoutPassed,true);
 assert.equal(result.productionChanged,false);
 assert.equal(seen.length,1);
 assert.equal(result.modelProvenance,"failover:ollama,openai");
}));
test("auto without configured candidates never asks for unnecessary external consent",async()=>{
 for(const allowExternalCalls of [false,true])await sandbox(async root=>{
  const result=await runAgenticRepair({root,
   providerOrder:["ollama","openai"],allowExternalCalls,env:{},
   fetcher:async()=>assert.fail("there is no configured provider to invoke")
  });
  assert.equal(result.status,"blocked");assert.equal(result.reason,"no_capable_provider");
  assert.equal(result.productionChanged,false);assert.equal(result.attempts.length,0);
 });
});
test("Failover does not silently spend external model tokens without consent",()=>sandbox(async root=>{
 const result=await runAgenticRepair({root,
  providerOrder:["ollama","openai"],allowExternalCalls:false,
  env:{OPENAI_API_KEY:"fixture",METRON_REPAIR_MODEL:"fixture"}
 });
 assert.equal(result.status,"blocked");
 assert.equal(result.reason,"external_model_operator_consent_required");
}));

test("auto runs a configured local model without external consent",()=>sandbox(async root=>{
 const calls=[];
 const result=await runAgenticRepair({root,maxAttempts:1,providerOrder:["ollama","openai"],
  allowExternalCalls:false,env:configured,fetcher:async url=>{
   calls.push(String(url));assert.equal(String(url),"http://127.0.0.1:11434/api/generate");
   return new Response(JSON.stringify({response:repaired}),{status:200});
  }});
 assert.equal(result.status,"verified_candidate");assert.equal(calls.length,1);
 assert.equal(result.attempts[0].provider,"ollama");
 assert.equal(result.invocationHistory[0].externalConsent,false);
 assert.deepEqual(result.invocationHistory[0].calls.map(c=>c.provider),["ollama"]);
}));

test("a failed local auto call cannot reach external transport without consent",()=>sandbox(async root=>{
 const calls=[];
 const result=await runAgenticRepair({root,maxAttempts:1,providerOrder:["ollama","openai"],
  allowExternalCalls:false,env:configured,fetcher:async url=>{
   calls.push(String(url));assert.equal(String(url),"http://127.0.0.1:11434/api/generate");
   throw Error("Injected local outage");
  }});
 assert.equal(result.status,"blocked");assert.equal(result.reason,"all_eligible_providers_failed");
 assert.equal(calls.length,1);assert.equal(result.attempts.length,0);
 assert.deepEqual(result.invocationHistory[0].calls.map(c=>c.provider),["ollama"]);
}));

test("external fallback requires consent and stays inside the explicit provider order",async()=>{
 for(const order of [["ollama","openai"],["ollama"]])await sandbox(async root=>{
  const calls=[];
  const result=await runAgenticRepair({root,maxAttempts:1,providerOrder:order,
   allowExternalCalls:true,env:configured,fetcher:async url=>{
    const local=String(url)==="http://127.0.0.1:11434/api/generate";calls.push(local?"ollama":"openai");
    if(local)throw Error("Injected local outage");
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    return new Response(JSON.stringify({output_text:repaired}),{status:200});
   }});
  assert.deepEqual(calls,order);
  assert.equal(result.status,order.length===2?"verified_candidate":"blocked");
 });
});

test("the invoke boundary rejects a truthy non-consent before external transport",()=>sandbox(async root=>{
 let calls=0;
 const result=await runAgenticRepair({root,maxAttempts:1,providerOrder:["ollama","openai"],
  allowExternalCalls:"not-explicit-consent",env:configured,fetcher:async url=>{
   calls++;assert.equal(String(url),"http://127.0.0.1:11434/api/generate");throw Error("Injected local outage");
  }});
 assert.equal(result.status,"blocked");assert.equal(calls,1);
 // The retry primitive treats a truthy value differently from explicit true.
 // The adapter boundary must still refuse it without recording a real call.
 const saved=JSON.parse(readFileSync(join(root,"baku-agent-journal",result.runId+".json"),"utf8"));
 assert.equal(saved.providerAttempts.at(-1).provider,"openai");
 assert.equal(saved.providerAttempts.at(-1).reason,"external_model_operator_consent_required");
 assert.deepEqual(result.invocationHistory[0].calls.map(c=>c.provider),["ollama"]);
}));

test("auto's local test hook runs without consent while an external hook is refused",async()=>{
 for(const provider of ["ollama","openai"])await sandbox(async root=>{
  let calls=0;
  const result=await runAgenticRepair({root,maxAttempts:1,providerOrder:[provider,"openai"],
   allowExternalCalls:false,env:{},askModel:async()=>{calls++;return repaired;}});
  assert.equal(result.status,provider==="ollama"?"verified_candidate":"blocked");
  assert.equal(calls,provider==="ollama"?1:0);
  if(provider==="openai")assert.equal(result.reason,"external_model_operator_consent_required");
 });
});
