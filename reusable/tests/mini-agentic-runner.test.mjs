import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readdirSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {runAgenticRepair,realRepairReasoner} from "../../mini/agentic-runner.mjs";

const originalPricing=new URL("../../mini/fixtures/pricing/src/pricing.mjs",import.meta.url);
const originalInvoice=new URL("../../mini/fixtures/pricing/src/invoice.mjs",import.meta.url);
const repairPricing="export function unitPrice(base, discount) {\n  return base - discount;\n}\n";
const repairInvoice='import { unitPrice } from "./pricing.mjs";\n'+
  'export function invoiceTotal(base, discount, quantity) {\n'+
  '  return unitPrice(base, discount) * quantity;\n}\n';

async function withTemp(fn) {
  const root=mkdtempSync(join(tmpdir(),"baku-agentic-test-"));
  try{return await fn(root);}
  finally{rmSync(root,{recursive:true,force:true});}
}
test("real OS process tests enable a two-attempt, two-file tool-agent repair",()=>withTemp(async root=>{
  const before=readFileSync(originalPricing,"utf8");
  const beforeInvoice=readFileSync(originalInvoice,"utf8");
  const prompts=[];
  const result=await runAgenticRepair({
    root,maxAttempts:3,
    askModel:async prompt=>{
      prompts.push(prompt);
      if(prompts.length===1)return JSON.stringify({
        diagnosis:"The per-item discount is added, not subtracted.",
        changes:[{path:"src/pricing.mjs",content:repairPricing}]
      });
      return JSON.stringify({
        diagnosis:"The invoice must multiply the corrected unit price by quantity.",
        changes:[{path:"src/invoice.mjs",content:repairInvoice}]
      });
    }
  });
  assert.equal(result.status,"verified_candidate");
  assert.equal(result.attempts.length,2);
  assert.equal(result.attempts[0].publicPassed,false);
  assert.equal(result.attempts[1].publicPassed,true);
  assert.equal(result.attempts[1].holdoutPassed,true);
  assert.equal(result.readbackVerified,true);
  assert.equal(result.approved,false);
  assert.equal(result.productionChanged,false);
  assert.equal(result.modelProvenance,"test_injected_not_real_ai");
  assert.ok(prompts[1].includes("Previously rejected attempts"));
  assert.ok(prompts[1].includes("publicPassed"));
  assert.ok(prompts.every(p=>!p.includes("holdout.test.mjs")));
  assert.equal(readFileSync(originalPricing,"utf8"),before);
  assert.equal(readFileSync(originalInvoice,"utf8"),beforeInvoice);
  const audit=JSON.parse(readFileSync(join(root,"baku-agent-journal",result.runId+".json"),"utf8"));
  assert.equal(audit.status,"verified_candidate");
  assert.equal(audit.attempts.length,2);
  assert.deepEqual(readdirSync(root).sort(),["baku-agent-journal"]);
}));
test("no real local model configured fails closed, without inventing a repair",()=>withTemp(async root=>{
  const result=await runAgenticRepair({
    root,provider:"ollama",env:{},maxAttempts:1
  });
  assert.equal(result.status,"blocked");
  assert.equal(result.reason,"local_repair_model_not_configured");
  assert.equal(result.productionChanged,false);
  assert.equal(result.attempts.length,0);
}));
test("real external-model use requires explicit per-request consent",()=>withTemp(async root=>{
  const result=await runAgenticRepair({
    root,provider:"openai",env:{
      OPENAI_API_KEY:"fixture-never-contacted",METRON_REPAIR_MODEL:"fixture"
    }
  });
  assert.equal(result.status,"blocked");
  assert.equal(result.reason,"external_model_operator_consent_required");
}));
test("untrusted patch cannot edit tests or read external source files",()=>withTemp(async root=>{
  const result=await runAgenticRepair({
    root,askModel:async()=>JSON.stringify({
      diagnosis:"try to alter the acceptance test",
      changes:[{path:"tests/holdout.test.mjs",content:"test('fake',()=>{})"}]
    })
  });
  assert.equal(result.status,"blocked");
  assert.equal(result.reason,"out_of_scope_patch");
  assert.equal(result.productionChanged,false);
}));
test("untrusted code that attempts filesystem APIs is rejected before tests",()=>withTemp(async root=>{
  const result=await runAgenticRepair({
    root,askModel:async()=>JSON.stringify({
      diagnosis:"malicious patch",
      changes:[{path:"src/pricing.mjs",content:
        'import fs from "node:fs";\nexport function unitPrice(){fs.writeFileSync("x","y");return 1;}'}]
    })
  });
  assert.equal(result.status,"blocked");
  assert.equal(result.reason,"unsafe_patch_content");
}));
test("model that keeps failing eventually reports unresolved, not success",()=>withTemp(async root=>{
  const result=await runAgenticRepair({
    root,maxAttempts:2,askModel:async()=>JSON.stringify({
      diagnosis:"This change is not a fix",
      changes:[{path:"src/pricing.mjs",content:
        "export function unitPrice(base,discount){return base * discount;}\n"}]
    })
  });
  assert.equal(result.status,"unresolved");
  assert.equal(result.attempts.length,2);
  assert.ok(result.attempts.every(x=>x.publicPassed===false));
  assert.equal(result.productionChanged,false);
}));
test("Ollama reasoner endpoint emits a JSON content string without a fake fallback",async()=>{
  const mock=async(url,init)=>{
    assert.equal(url,"http://127.0.0.1:11434/api/generate");
    assert.equal(JSON.parse(init.body).stream,false);
    return new Response(JSON.stringify({response:JSON.stringify({
      diagnosis:"fixture answer",changes:[{path:"src/pricing.mjs",content:repairPricing}]
    })}),{status:200});
  };
  const raw=await realRepairReasoner("FIX",{provider:"ollama",
    env:{METRON_LOCAL_MODEL:"test-fixture-not-a-real-model"},
    fetcher:mock});
  assert.match(raw,/fixture answer/);
});
