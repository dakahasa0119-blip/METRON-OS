import test from "node:test";
import assert from "node:assert/strict";
import {selectProvider,executeWithFailover} from "../../mini/ai-failover.mjs";
import {optionalFinalDecision} from "../../mini/ai-consensus.mjs";

test("no local model still selects an external capable AI with consent",()=>{
 const x=selectProvider({available:{openai:true,gemini:true},
   preferred:["ollama","gemini","openai"],allowExternalCalls:true});
 assert.equal(x.provider,"gemini");
 assert.equal(x.localLlmRequired,false);
});
test("without external consent, no external provider is invoked",async()=>{
 let count=0;
 const x=await executeWithFailover({available:{openai:true,gemini:true},
   invoke:async()=>{count++;return "answer";}});
 assert.equal(x.status,"blocked");assert.equal(count,0);
 assert.equal(x.reason,"external_model_consent_required");
});
test("failed preferred AI is replaced with next eligible one",async()=>{
 const x=await executeWithFailover({capability:"repair",
   available:{openai:true,ollama:true,gemini:true},
   preferred:["openai","gemini","ollama"],allowExternalCalls:true,
   invoke:async p=>{if(p==="openai")throw Error("offline");return p+" result";}});
 assert.equal(x.provider,"ollama");
 assert.deepEqual(x.attempts.map(y=>y.status),["failed","succeeded"]);
 assert.equal(x.humanApprovalRequiredForDeployment,true);
});
test("AI without repair capability is not substituted into coding repair",()=>{
 const x=selectProvider({requestedCapability:"repair",
   preferred:["gemini","claude"],available:{gemini:true,claude:true},
   allowExternalCalls:true});
 assert.equal(x.status,"blocked");assert.equal(x.reason,"no_capable_provider");
});
test("all AI offline means safe blocked state, not invented answer",async()=>{
 const x=await executeWithFailover({available:{ollama:true,openai:true},
   allowExternalCalls:true,invoke:async()=>{throw Error("offline");}});
 assert.equal(x.status,"blocked");assert.equal(x.result,null);
 assert.equal(x.attempts.length,2);
});
test("final judgment may come from an external AI if local is absent",async()=>{
 const consultation={readyForLocalDecision:true};
 const x=await optionalFinalDecision("Check the evidence",consultation,{
   available:{gemini:true},preferred:["ollama","gemini"],
   allowExternalCalls:true,invoke:async p=>"verified response from "+p
 });
 assert.equal(x.status,"final_judgment_recorded");
 assert.equal(x.provider,"gemini");assert.equal(x.authorizedToApply,false);
});
test("incomplete consultation cannot be turned into a fake final verdict",async()=>{
 const x=await optionalFinalDecision("Check evidence",{
   readyForLocalDecision:false
 },{available:{openai:true},allowExternalCalls:true,
   invoke:async()=>{throw Error("must not invoke");}});
 assert.equal(x.status,"blocked");assert.equal(x.finalDecision,null);
});
