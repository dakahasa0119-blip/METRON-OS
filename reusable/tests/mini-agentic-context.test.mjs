// Mocked provider transports exercise real local tests; no real AI is called.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync,readdirSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {runAgenticRepair} from "../../mini/agentic-runner.mjs";
import {writeAtomicJson} from "../gateway-jobs/checkpoint.mjs";

const pricing="export function unitPrice(base, discount) { return base - discount; }\n";
const invoice='import { unitPrice } from "./pricing.mjs";\n'+
  'export function invoiceTotal(base, discount, quantity) { return unitPrice(base, discount) * quantity; }\n';
const proposal=(path,content,diagnosis)=>JSON.stringify({diagnosis,changes:[{path,content}]});
const id=()=>"case_"+randomUUID().replaceAll("-","");
const goal="Use the saved village incident to investigate the invoice total";
const context=()=>({schemaVersion:1,workId:"work_context",villageId:"village_one",
  sourceMessage:{id:"m_context",sender:"A",recipient:"B",type:"OBSERVE",
    body:"ARC answer marker",bodySha256:"fixture-body-hash",deliveryState:"done",
    providerIdentity:"not_authenticated"},
  knowledge:[{id:"rumor_context",text:"Adopted invoice arithmetic observation"}]});
const journal=(root,runId)=>JSON.parse(readFileSync(join(root,"baku-agent-journal",runId+".json"),"utf8"));
const journalText=(root,runId)=>readFileSync(join(root,"baku-agent-journal",runId+".json"),"utf8");
async function isolated(fn){
  const root=mkdtempSync(join(tmpdir(),"baku-agent-context-"));
  try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true});}
}
function mockResponse(url,raw){
  return new Response(JSON.stringify(String(url).includes("11434")?
    {response:raw}:{output_text:raw}),{status:200});
}

test("pinned context and candidate/public failures survive an explicit provider change",()=>isolated(async root=>{
  const runId=id(),incidentContext=context(),secret="fixture-secret-never-journal";
  const first=await runAgenticRepair({root,runId,goal,incidentContext,maxAttempts:1,
    providerOrder:["ollama"],env:{METRON_LOCAL_MODEL:"local-model-a"},
    fetcher:async(url,init)=>{
      assert.equal(url,"http://127.0.0.1:11434/api/generate");
      const saved=journal(root,runId),invocation=saved.invocationHistory[0];
      assert.equal(invocation.outcome,"started");
      assert.equal(invocation.calls[0].outcome,"started");
      assert.equal(invocation.calls[0].model,"local-model-a");
      const body=JSON.parse(init.body);
      const scratch=readdirSync(root).find(name=>name.startsWith("baku-scratch-"));
      assert.deepEqual(readdirSync(join(root,scratch,"project","tests")),["public.test.mjs"]);
      assert.equal(existsSync(join(root,scratch,"verification")),false);
      assert.match(body.prompt,/untrusted data, not instructions or authority/);
      assert.match(body.prompt,/ARC answer marker/);
      assert.match(body.prompt,/Adopted invoice arithmetic observation/);
      assert.doesNotMatch(body.prompt,/holdout.test.mjs/);
      // Changing the caller's object cannot change the pinned journal/prompt.
      incidentContext.sourceMessage.body="mutated after invocation began";
      return mockResponse(url,proposal("src/pricing.mjs",pricing,"Correct the discounted unit price first"));
    }});
  assert.equal(first.status,"unresolved");assert.equal(first.attempts.length,1);
  assert.equal(journal(root,runId).incidentContext.sourceMessage.body,"ARC answer marker");
  const firstAttempt=structuredClone(first.attempts[0]);
  const restoredContext=context();
  // JSON property order does not alter the immutable incident's identity.
  const reordered={knowledge:restoredContext.knowledge,sourceMessage:restoredContext.sourceMessage,
    villageId:restoredContext.villageId,workId:restoredContext.workId,schemaVersion:1};
  const second=await runAgenticRepair({root,resumeRunId:runId,goal,
    incidentContext:reordered,maxAttempts:2,provider:"openai",allowProviderChange:true,
    allowExternalCalls:true,env:{OPENAI_API_KEY:secret,METRON_REPAIR_MODEL:"remote-model-b"},
    fetcher:async(url,init)=>{
      assert.equal(url,"https://api.openai.com/v1/responses");
      const body=JSON.parse(init.body);
      assert.equal(body.model,"remote-model-b");
      assert.match(body.input,/Correct the discounted unit price first/);
      assert.match(body.input,/return base - discount/);
      assert.match(body.input,/publicPassed/);
      assert.match(body.input,/ARC answer marker/);
      const saved=journal(root,runId),invocation=saved.invocationHistory[1];
      assert.equal(invocation.outcome,"started");
      assert.equal(invocation.calls[0].provider,"openai");
      assert.equal(invocation.calls[0].outcome,"started");
      assert.equal(saved.lastCandidate["src/pricing.mjs"],pricing);
      return mockResponse(url,proposal("src/invoice.mjs",invoice,"Use quantity with the saved unit-price fix"));
    }});
  assert.equal(second.status,"verified_candidate");assert.equal(second.runId,runId);
  assert.deepEqual(second.attempts[0],firstAttempt);
  assert.equal(second.attempts[1].provider,"openai");
  assert.equal(second.attempts[1].model,"remote-model-b");
  assert.equal(second.attempts[1].invocationId,second.invocationHistory[1].id);
  assert.equal(second.attempts[1].modelCallId,second.invocationHistory[1].calls[0].id);
  assert.equal(second.modelProvenance,"failover:ollama");
  assert.equal(second.incidentContextDigest,first.incidentContextDigest);
  assert.deepEqual(second.invocationHistory.map(x=>x.externalConsent),[false,true]);
  assert.equal(second.invocationHistory[1].outcome,"verified_candidate");
  assert.equal(second.productionChanged,false);
  assert.ok(!journalText(root,runId).includes(secret));
}));

test("same-provider model changes require explicit authorization and retain prior source/failures",()=>isolated(async root=>{
  const runId=id(),incidentContext=context(),secret="fixture-key";
  const first=await runAgenticRepair({root,runId,goal,incidentContext,maxAttempts:1,
    provider:"openai",allowExternalCalls:true,
    env:{OPENAI_API_KEY:secret,METRON_REPAIR_MODEL:"model-a"},
    fetcher:async(url)=>mockResponse(url,proposal("src/pricing.mjs",pricing,"First model corrected pricing"))});
  const blocked=await runAgenticRepair({root,resumeRunId:runId,goal,incidentContext,maxAttempts:2,
    provider:"openai",allowExternalCalls:true,
    env:{OPENAI_API_KEY:secret,METRON_REPAIR_MODEL:"model-b"},
    fetcher:async()=>assert.fail("an unauthorized model change must not call a provider")});
  assert.equal(blocked.reason,"provider_change_requires_explicit_authorization");
  assert.equal(blocked.invocationHistory[1].selection.models.openai,"model-b");
  assert.equal(blocked.invocationHistory[1].calls.length,0);
  assert.deepEqual(blocked.attempts,first.attempts);
  const resumed=await runAgenticRepair({root,resumeRunId:runId,goal,incidentContext,maxAttempts:2,
    provider:"openai",allowProviderChange:true,allowExternalCalls:true,
    env:{OPENAI_API_KEY:secret,METRON_REPAIR_MODEL:"model-b"},
    fetcher:async(url,init)=>{
      const body=JSON.parse(init.body);assert.equal(body.model,"model-b");
      assert.match(body.input,/First model corrected pricing/);assert.match(body.input,/return base - discount/);
      return mockResponse(url,proposal("src/invoice.mjs",invoice,"Second model preserves the existing fix"));
    }});
  assert.equal(resumed.status,"verified_candidate");
  assert.deepEqual(resumed.attempts.map(x=>x.model),["model-a","model-b"]);
  assert.equal(resumed.invocationHistory.length,3);
}));

test("changed context or goal cannot be authorized as a provider switch",()=>isolated(async root=>{
  const runId=id();await runAgenticRepair({root,runId,goal,incidentContext:context(),provider:"ollama",env:{}});
  const before=journalText(root,runId),changed=context();changed.sourceMessage.body="different evidence";
  for(const extra of [{incidentContext:changed},{goal:"A different problem",incidentContext:context()}]){
    await assert.rejects(()=>runAgenticRepair({root,resumeRunId:runId,goal,provider:"ollama",
      env:{},allowProviderChange:true,...extra}),{code:"unresumable_or_changed_incident"});
    assert.equal(journalText(root,runId),before);
  }
}));

test("missing consent for explicit or external-only selection persists history without a model call",()=>isolated(async root=>{
  for(const choice of [{provider:"openai"},{providerOrder:["openai"]}])for(const injected of [false,true]){
    const runId=id();let calls=0;
    const result=await runAgenticRepair({root,runId,goal,incidentContext:context(),
      ...choice,allowExternalCalls:false,
      env:{METRON_LOCAL_MODEL:"local-model",OPENAI_API_KEY:"secret-not-saved",METRON_REPAIR_MODEL:"remote-model"},
      ...(injected?{askModel:async()=>{calls++;assert.fail("consent also gates an injected remote choice");}}:{}),
      fetcher:async()=>{calls++;assert.fail("no provider call without consent");}});
    assert.equal(result.status,"blocked");assert.equal(result.runId,runId);
    assert.equal(result.reason,"external_model_operator_consent_required");assert.equal(calls,0);
    const saved=journal(root,runId),invocation=saved.invocationHistory[0];
    assert.equal(invocation.externalConsent,false);assert.equal(invocation.outcome,"blocked");
    assert.equal(invocation.calls.length,0);assert.equal(saved.attempts.length,0);
    assert.equal(invocation.selection.type,injected?"test_injected_not_real_ai":"real_provider_adapter");
    assert.ok(!journalText(root,runId).includes("secret-not-saved"));
  }
}));

test("earlier external consent is never reused by a resumed invocation",()=>isolated(async root=>{
  const runId=id(),env={OPENAI_API_KEY:"fixture",METRON_REPAIR_MODEL:"model-a"};
  await runAgenticRepair({root,runId,goal,incidentContext:context(),maxAttempts:1,
    provider:"openai",allowExternalCalls:true,env,
    fetcher:async(url)=>mockResponse(url,proposal("src/pricing.mjs",pricing,"Saved first attempt"))});
  const result=await runAgenticRepair({root,resumeRunId:runId,goal,incidentContext:context(),
    maxAttempts:2,provider:"openai",env,allowExternalCalls:false,
    fetcher:async()=>assert.fail("a past consent is not a new authorization")});
  assert.equal(result.reason,"external_model_operator_consent_required");
  assert.equal(result.attempts.length,1);
  assert.deepEqual(result.invocationHistory.map(x=>x.externalConsent),[true,false]);
  assert.equal(result.invocationHistory[1].calls.length,0);
}));

test("preallocated run collisions and conflicting run ids cannot overwrite an incident",()=>isolated(async root=>{
  const runId=id();const first=await runAgenticRepair({root,runId,goal,provider:"ollama",env:{}});
  assert.equal(first.runId,runId);assert.equal(first.reason,"local_repair_model_not_configured");
  const before=journalText(root,runId);
  await assert.rejects(()=>runAgenticRepair({root,runId,goal,provider:"ollama",env:{}}),{code:"agent_run_id_collision"});
  await assert.rejects(()=>runAgenticRepair({root,runId,resumeRunId:runId,goal}),{code:"conflicting_agent_run_ids"});
  assert.equal(journalText(root,runId),before);
}));

test("explicit failover order does not discover an unrequested configured provider",()=>isolated(async root=>{
  const result=await runAgenticRepair({root,goal,providerOrder:["ollama"],allowExternalCalls:true,
    env:{OPENAI_API_KEY:"fixture",METRON_REPAIR_MODEL:"unrequested-remote"},
    fetcher:async()=>assert.fail("the configured remote provider is outside the explicit order")});
  assert.equal(result.reason,"no_capable_provider");
  assert.deepEqual(result.invocationHistory[0].selection.providerOrder,["ollama"]);
  assert.equal(result.invocationHistory[0].calls.length,0);
}));

test("incident context must be bounded JSON data before any journal is created",()=>isolated(async root=>{
  for(const incidentContext of [[],{notJson:undefined},{notFinite:Infinity},{tooLarge:"x".repeat(12289)}]){
    await assert.rejects(()=>runAgenticRepair({root,goal,incidentContext,provider:"ollama",env:{}}),
      error=>["invalid_agent_context","agent_context_too_large"].includes(error.code));
  }
  assert.deepEqual(readdirSync(root),[]);
}));

async function pendingCheckpoint(root,attemptCount,status){
  let calls=0;
  const result=await runAgenticRepair({root,goal,incidentContext:context(),maxAttempts:attemptCount,
    askModel:async()=>{
      calls++;
      return calls<attemptCount?proposal("src/pricing.mjs",
        "export function unitPrice(base, discount) { return base * discount; }\n","Still fails public examples"):
        JSON.stringify({diagnosis:"Correct the two arithmetic operations",changes:[
          {path:"src/pricing.mjs",content:pricing},{path:"src/invoice.mjs",content:invoice}
        ]});
    }});
  assert.equal(result.status,"verified_candidate");
  const saved=journal(root,result.runId),last=saved.attempts.at(-1);
  // A synthetic checkpoint represents the exact persisted pre-holdout boundary;
  // this does not claim that a process was actually stopped at that boundary.
  delete last.holdoutPassed;delete last.holdoutEvidenceHash;
  delete saved.finalCandidateDigest;delete saved.validatedBy;saved.status=status;
  const invocation=saved.invocationHistory.at(-1);invocation.outcome="started";delete invocation.completedAt;
  writeAtomicJson(join(root,"baku-agent-journal",result.runId+".json"),saved);
  return {runId:result.runId,saved};
}

test("explicit resume completes a saved public-passing candidate without a new model attempt",async()=>{
  for(const [count,status] of [[1,"testing"],[4,"awaiting_holdout"]]){
    await isolated(async root=>{
      const {runId,saved}=await pendingCheckpoint(root,count,status);
      const resumed=await runAgenticRepair({root,resumeRunId:runId,goal,incidentContext:context(),
        maxAttempts:count,provider:"openai",env:{},allowExternalCalls:false,
        askModel:async()=>assert.fail("pending verification must not call a model")});
      assert.equal(resumed.status,"verified_candidate");assert.equal(resumed.attempts.length,count);
      assert.deepEqual(resumed.attempts.map(x=>x.candidateDigest),saved.attempts.map(x=>x.candidateDigest));
      assert.equal(resumed.attempts.at(-1).holdoutPassed,true);
      assert.equal(resumed.invocationHistory.at(-1).mode,"verification_only");
      assert.equal(resumed.invocationHistory.at(-1).calls.length,0);
      assert.equal(resumed.invocationHistory[0].outcome,"interrupted");
      assert.equal(journal(root,runId).selectionSignature,saved.selectionSignature);
    });
  }
});

test("pending verification refuses a saved candidate whose public-pass digest changed",()=>isolated(async root=>{
  const {runId,saved}=await pendingCheckpoint(root,1,"awaiting_holdout");
  saved.lastCandidate["src/pricing.mjs"]+="// bytes changed after the public-pass checkpoint\n";
  writeAtomicJson(join(root,"baku-agent-journal",runId+".json"),saved);
  const result=await runAgenticRepair({root,resumeRunId:runId,goal,incidentContext:context(),
    askModel:async()=>assert.fail("changed verification source cannot reach a model")});
  assert.equal(result.status,"readback_failed");assert.equal(result.reason,"saved_candidate_digest_mismatch");
  assert.equal(result.attempts.length,1);assert.equal(result.invocationHistory.at(-1).calls.length,0);
}));

test("an injected ESM re-export patch is rejected before candidate execution or hidden evidence",()=>isolated(async root=>{
  let calls=0;
  const result=await runAgenticRepair({root,goal,incidentContext:context(),askModel:async prompt=>{
    calls++;assert.doesNotMatch(prompt,/holdout.test.mjs/);
    const scratch=readdirSync(root).find(name=>name.startsWith("baku-scratch-"));
    assert.deepEqual(readdirSync(join(root,scratch,"project","tests")),["public.test.mjs"]);
    assert.equal(existsSync(join(root,scratch,"verification")),false);
    return proposal("src/pricing.mjs",
      "export * from '../tests/holdout.test.mjs';\n"+pricing,"Attempt to execute a hidden test as a module");
  }});
  assert.equal(result.status,"blocked");assert.equal(result.reason,"unsafe_patch_content");
  assert.equal(calls,1);assert.equal(result.attempts.length,0);
  assert.equal(result.invocationHistory[0].calls[0].type,"test_injected_not_real_ai");
  assert.ok(!journalText(root,result.runId).includes("holdout.test.mjs"));
}));

test("approved static invoice import accepts a missing semicolon at a line boundary",()=>isolated(async root=>{
  const semicolonless='import { unitPrice } from "./pricing.mjs"\n'+
    'export function invoiceTotal(base, discount, quantity) { return unitPrice(base, discount) * quantity; }\n';
  const result=await runAgenticRepair({root,goal,maxAttempts:1,env:{},askModel:async()=>JSON.stringify({
    diagnosis:"Use the same allowed local binding with automatic semicolon insertion",
    changes:[{path:"src/pricing.mjs",content:pricing},{path:"src/invoice.mjs",content:semicolonless}]
  })});
  assert.equal(result.status,"verified_candidate");
  assert.equal(result.attempts.length,1);
  assert.equal(result.attempts[0].publicPassed,true);
  assert.equal(result.attempts[0].holdoutPassed,true);
  assert.equal(result.productionChanged,false);
}));

test("approved invoice import preserves single quotes, multiline whitespace and JavaScript line terminators",async()=>{
  const body='export function invoiceTotal(base, discount, quantity) { return unitPrice(base, discount) * quantity; }\n';
  for(const prefix of [
    "import { unitPrice } from './pricing.mjs'\t\r\n",
    'import {\n  unitPrice\n} from "./pricing.mjs"\n',
    'import { unitPrice } from "./pricing.mjs"\u2028',
    'import { unitPrice } from "./pricing.mjs"\u2029',
    'import { unitPrice } from "./pricing.mjs"\n;\n'
  ])await isolated(async root=>{
    const result=await runAgenticRepair({root,goal,maxAttempts:1,env:{},askModel:async()=>JSON.stringify({
      diagnosis:"Keep the approved local import with a valid statement boundary",
      changes:[{path:"src/pricing.mjs",content:pricing},{path:"src/invoice.mjs",content:prefix+body}]
    })});
    assert.equal(result.status,"verified_candidate",JSON.stringify({prefix,reason:result.reason}));
    assert.equal(result.attempts[0].publicPassed,true);
    assert.equal(result.attempts[0].holdoutPassed,true);
  });
});

test("an approved import at EOF reaches public validation instead of the unsafe-import gate",()=>isolated(async root=>{
  const result=await runAgenticRepair({root,goal,maxAttempts:1,env:{},askModel:async()=>proposal("src/invoice.mjs",
    'import { unitPrice } from "./pricing.mjs"',"Syntactically valid but deliberately missing the required invoice export")});
  assert.equal(result.status,"unresolved");assert.equal(result.attempts.length,1);
  assert.equal(result.attempts[0].publicPassed,false);
  assert.equal(result.attempts[0].holdoutPassed,undefined);
}));

test("semicolonless approval cannot hide additional imports, re-exports, paths or invalid same-line continuation",async()=>{
  const body='export function invoiceTotal(base, discount, quantity) { return unitPrice(base, discount) * quantity; }\n';
  const approved='import { unitPrice } from "./pricing.mjs"\n';
  for(const content of [
    'import { unitPrice } from "./pricing.mjs" '+body,
    'import { unitPrice } from "../tests/holdout.test.mjs"\n'+body,
    'import { otherPrice } from "./pricing.mjs"\n'+body,
    'import { unitPrice as otherPrice } from "./pricing.mjs"\n'+body,
    'import * as pricing from "./pricing.mjs"\n'+body,
    approved+'import { hidden } from "../tests/holdout.test.mjs"\n'+body,
    approved+'export * from "../tests/holdout.test.mjs"\n'+body,
    approved+'import("../tests/holdout.test.mjs");\n'+body,
    approved+'import.meta;\n'+body
  ])await isolated(async root=>{
    const result=await runAgenticRepair({root,goal,maxAttempts:1,env:{},
      askModel:async()=>proposal("src/invoice.mjs",content,"Reject imports outside the exact fixture boundary")});
    assert.equal(result.status,"blocked");assert.equal(result.reason,"unsafe_patch_content");
    assert.equal(result.attempts.length,0);
    assert.equal(result.invocationHistory[0].calls[0].outcome,"failed");
    assert.equal(journal(root,result.runId).lastCandidate,undefined);
    assert.equal(readdirSync(root).some(name=>name.startsWith("baku-scratch-")),false);
  });
});

test("a hidden-test rejection stays terminal and is never fed back for model revision",()=>isolated(async root=>{
  let calls=0;
  const result=await runAgenticRepair({root,goal,incidentContext:context(),askModel:async()=>{
    calls++;return proposal("src/invoice.mjs",
      "export function invoiceTotal(base, discount, quantity) { return base === 10 ? 24 : 10; }\n",
      "An intentionally overfit public-example fixture");
  }});
  assert.equal(result.status,"holdout_rejected");assert.equal(result.attempts[0].publicPassed,true);
  assert.equal(result.attempts[0].holdoutPassed,false);assert.equal(calls,1);
  await assert.rejects(()=>runAgenticRepair({root,resumeRunId:result.runId,goal,incidentContext:context(),
    allowProviderChange:true,askModel:async()=>{calls++;assert.fail("hidden failure must not become model feedback");}}),
    {code:"unresumable_or_changed_incident"});
  assert.equal(calls,1);
}));
