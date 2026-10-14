import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
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
test("No available models returns blocked and never invents a repair",()=>sandbox(async root=>{
 const result=await runAgenticRepair({root,
  providerOrder:["ollama","openai"],allowExternalCalls:true,env:{}
 });
 assert.equal(result.status,"blocked");
 assert.equal(result.productionChanged,false);
 assert.equal(result.attempts.length,0);
}));
test("Failover does not silently spend external model tokens without consent",()=>sandbox(async root=>{
 const result=await runAgenticRepair({root,
  providerOrder:["ollama","openai"],allowExternalCalls:false,
  env:{OPENAI_API_KEY:"fixture",METRON_REPAIR_MODEL:"fixture"}
 });
 assert.equal(result.status,"blocked");
 assert.equal(result.reason,"external_model_operator_consent_required");
}));
