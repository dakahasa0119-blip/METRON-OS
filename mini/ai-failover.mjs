/**
 * METRON model failover: local LLM is OPTIONAL.
 * A provider can substitute only when it can do the requested job.
 * No silent cost escalation, fabricated consensus or model self-approval.
 */
const blocked=(code)=>Object.assign(new Error(code),{code});
export const CAPABILITIES=Object.freeze({
  "ollama":Object.freeze(["reason","repair","final"]),
  "openai":Object.freeze(["reason","repair","final"]),
  "gemini":Object.freeze(["reason","final"]),
  "claude":Object.freeze(["reason","final"]),
  "claude-cli":Object.freeze(["reason","repair","final"])
});
export function selectProvider({
  requestedCapability="final",preferred=[],available={},allowExternalCalls=false
}={}){
  if(!["reason","repair","final"].includes(requestedCapability))
    throw blocked("invalid_capability");
  if(!Array.isArray(preferred)||preferred.some(x=>typeof x!=="string"))
    throw blocked("invalid_preference");
  const order=[...new Set([...preferred,"ollama","openai","gemini","claude","claude-cli"])];
  const eligible=order.filter(name=>
    CAPABILITIES[name]?.includes(requestedCapability)&&available[name]===true);
  const selected=eligible.find(name=>
    name==="ollama"||allowExternalCalls===true);
  return {
    status:selected?"selected":"blocked",
    provider:selected??null,
    reason:selected?null:eligible.length?
      "external_model_consent_required":"no_capable_provider",
    eligible,capability:requestedCapability,
    localLlmRequired:false,
    humanApprovalRequiredForDeployment:true
  };
}
export async function executeWithFailover({
  capability="final",preferred=[],available={},allowExternalCalls=false,
  invoke,allowRetryOnError=true
}={}){
  if(typeof invoke!=="function")throw blocked("provider_invoker_required");
  const selection=selectProvider({
    requestedCapability:capability,preferred,available,allowExternalCalls
  });
  if(selection.status!=="selected")
    return {...selection,attempts:[],result:null};
  const attempts=[];
  for(const provider of selection.eligible){
    if(provider!=="ollama"&&!allowExternalCalls)continue;
    try{
      const result=await invoke(provider);
      if(result===undefined||result===null)
        throw blocked("empty_provider_result");
      attempts.push({provider,status:"succeeded"});
      return {status:"completed",provider,capability,
        attempts,result,localLlmRequired:false,
        humanApprovalRequiredForDeployment:true};
    }catch(e){
      attempts.push({provider,status:"failed",
        reason:typeof e?.code==="string"?e.code:"provider_failed"});
      if(!allowRetryOnError)break;
    }
  }
  return {status:"blocked",provider:null,capability,
    reason:"all_eligible_providers_failed",attempts,result:null,
    localLlmRequired:false,humanApprovalRequiredForDeployment:true};
}
