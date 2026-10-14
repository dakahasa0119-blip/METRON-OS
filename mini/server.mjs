/**
 * Local-only HTTP UI for the METRON Mini reference.
 * Fixed-route static serving, no filesystem browsing, no provider/API access.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MetronMiniRuntime } from "./runtime.mjs";
import { CivilizationExperienceV3 } from "./civilization-v3.mjs";
import { PoUCLedger, performUsefulComputation } from "./pouc.mjs";
import { runIsolatedRecoveryCycle } from "./isolated-repair.mjs";
import { repairDisposableSource } from "./behavioral-repair.mjs";
import {runAgenticRepair} from "./agentic-runner.mjs";
import {join} from "node:path";
import {mkdirSync} from "node:fs";
import { modelAvailability,consultAndJudge } from "./ai-consensus.mjs";

const UI=new Map([
  ["/",["./public/index.html","text/html; charset=utf-8"]],
  ["/experience",["./public/experience.html","text/html; charset=utf-8"]],
  ["/experience.js",["./public/experience.js","text/javascript; charset=utf-8"]],
  ["/experience.css",["./public/experience.css","text/css; charset=utf-8"]],
  ["/client.js",["./public/client.js","text/javascript; charset=utf-8"]],
  ["/style.css",["./public/style.css","text/css; charset=utf-8"]],
  ["/arc-kit.mjs",["../reusable/arc-dom/selector-kit.mjs","text/javascript; charset=utf-8"]]
]);
const pathFor=p=>fileURLToPath(new URL(p,import.meta.url));
const STATIC=new Map([...UI].map(([route,[path,type]])=>[
  route,{body:readFileSync(pathFor(path)),type}
]));
const hostAllowed=(host,port)=>host==="127.0.0.1:"+port||host==="localhost:"+port;
const csp="default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
function send(response,status,data){
  const body=JSON.stringify(data);
  response.writeHead(status,{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    "Content-Security-Policy":csp,
    "Content-Length":Buffer.byteLength(body)
  });
  response.end(body);
}
async function readJson(req){
  let size=0;const parts=[];
  for await(const b of req){
    size+=b.length;
    if(size>16_384)throw Object.assign(new Error("request too large"),{code:"payload_too_large"});
    parts.push(b);
  }
  try{return JSON.parse(Buffer.concat(parts).toString("utf8"));}
  catch{throw Object.assign(new Error("invalid JSON"),{code:"invalid_json"});}
}
/** Start only on loopback. Caller must enforce single writer for the data root. */
export async function createMiniServer({root,port=8766}={}){
  if(!Number.isInteger(port)||port<0||port>65535)
    throw new Error("port must be 0-65535");
  const runtime=new MetronMiniRuntime(root);
  const civilization=new CivilizationExperienceV3(runtime.root,runtime);
  const pouc=new PoUCLedger(runtime.root);
  const server=createServer(async(req,res)=>{
    const currentPort=server.address()?.port||port;
    if(!hostAllowed(req.headers.host,currentPort))
      return send(res,403,{error:"invalid_host"});
    const url=req.url?.split("?")[0]||"";
    if(req.method==="GET"&&STATIC.has(url)){
      const item=STATIC.get(url);
      res.writeHead(200,{"Content-Type":item.type,
        "Content-Security-Policy":csp,
        "X-Content-Type-Options":"nosniff","Cache-Control":"no-store"});
      return res.end(item.body);
    }
    if(req.method==="GET"&&url==="/api/agent/status")
      return send(res,200,{
        status:"real_model_needed_for_agentic_repair",
        configured:{
          ollama:!!process.env.METRON_LOCAL_MODEL,
          openai:!!(process.env.OPENAI_API_KEY&&process.env.METRON_REPAIR_MODEL)
        },
        scope:"first_party_disposable_multifile_fixture_only",
        testExecution:"Node_permission_constrained_child_process",
        productionChanges:false
      });
    if(req.method==="GET"&&url==="/api/advanced/status")
      return send(res,200,{providers:modelAvailability(),
        localLlm:"requires_installed_local_Ollama_and_Metron_model",
        mining:pouc.status(),repair:"isolated_known_good_recovery_and_bounded_unknown_behavioral_patch",
        externalCalls:"require_per_request_consent"});
    if(req.method==="GET"&&url==="/api/civilization/state")
      return send(res,200,civilization.state());
    if(req.method==="GET"&&url==="/api/state")
      return send(res,200,runtime.state());
    if(req.method==="GET"&&url==="/api/health")
      return send(res,200,{status:"ok",mode:"local-only"});
    if(req.method==="POST"&&["/api/mission","/api/drain","/api/civilization/action","/api/advanced/action","/api/agent/run"].includes(url)){
      if(req.headers["x-metron-mini"]!=="1")
        return send(res,403,{error:"explicit_local_request_header_required"});
      const origin=req.headers.origin;
      if(origin && !["http://127.0.0.1:"+currentPort,"http://localhost:"+currentPort].includes(origin))
        return send(res,403,{error:"invalid_origin"});
      if(!String(req.headers["content-type"]||"").startsWith("application/json"))
        return send(res,415,{error:"json_required"});
      try{
        const body=await readJson(req);
        if(url==="/api/agent/run"){
          if(!body||typeof body!=="object"||Array.isArray(body))
            return send(res,400,{error:"invalid_agent_request"});
          if(!["ollama","openai"].includes(body.provider)&&
             !(body.provider==="auto"&&Array.isArray(body.providerOrder)))
            return send(res,400,{error:"explicit_model_choice_required"});
          if((body.provider==="openai"||
             (body.provider==="auto"&&body.providerOrder.includes("openai")))&&
             body.allowExternalCalls!==true)
            return send(res,403,{error:"remote_ai_requires_explicit_consent"});
          const agentRoot=join(runtime.root,"agentic-baku");
          mkdirSync(agentRoot,{recursive:true});
          const result=await runAgenticRepair({
            root:agentRoot,provider:body.provider==="auto"?undefined:body.provider,
            providerOrder:body.provider==="auto"?body.providerOrder:null,
            goal:body.goal,maxAttempts:3,
            allowExternalCalls:body.allowExternalCalls===true,
            resumeRunId:body.resumeRunId??null
          });
          return send(res,200,result);
        }
        if(url==="/api/advanced/action"){
          if(!body||typeof body!=="object"||Array.isArray(body))
            return send(res,400,{error:"invalid_advanced_action"});
          if(body.action==="consult"){
            if(body.allowExternalCalls!==true)
              return send(res,403,{error:"explicit_external_ai_consent_required"});
            // Never invent multi-model output when auth/model setup is absent.
            const result=await consultAndJudge(body.question);
            return send(res,200,result);
          }
          if(body.action==="pouc"){
            const source={baseline:body.baseline,candidate:body.candidate};
            const claimed=performUsefulComputation(source);
            const result=pouc.contribute(source,claimed);
            return send(res,200,{contribution:result,proof:claimed,
              credits:pouc.status(),note:"No tokens or payments minted"});
          }
          if(body.action==="repair"){
            const proof=runIsolatedRecoveryCycle();
            return send(res,200,{proof,appliedToProduction:false});
          }
          if(body.action==="discover-repair"){
            const result=repairDisposableSource({
              source:body.source,developmentTests:body.developmentTests,
              holdoutTests:body.holdoutTests
            });
            return send(res,200,{result,
              productionSourceUpdated:false,
              testsGrounding:"caller_supplied_not_independently_authenticated"});
          }
          return send(res,400,{error:"unknown_advanced_action"});
        }
        if(url==="/api/civilization/action") {
          if(!body||typeof body!=="object"||Array.isArray(body))
            return send(res,400,{error:"invalid_concept_action"});
          const result=body.action==="publish"?civilization.publish(body):
            body.action==="receive"?civilization.receive(body):
            body.action==="review"?civilization.review(body):
            body.action==="filter"?civilization.setFilter(body):
            body.action==="salvage"?civilization.salvage(body):
            body.action==="recovery"?civilization.recoveryDemo():null;
          if(!result)return send(res,400,{error:"unknown_concept_action"});
          return send(res,200,result);
        }
        if(url==="/api/mission")
          return send(res,200,runtime.submit(body));
        return send(res,200,{processed:runtime.drain(),state:runtime.state()});
      }catch(err){
        return send(res,400,{error:err.code||"operation_rejected",message:err.message});
      }
    }
    return send(res,404,{error:"not_found"});
  });
  server.on("clientError",(_,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(port,"127.0.0.1",resolve);
  });
  // Process only locally persisted jobs. Recovery never calls external APIs.
  const interval=setInterval(()=>{
    try{runtime.drain();}
    catch(err){console.error("METRON Mini local drain:",err.code||"failed");}
  },1000);
  interval.unref();
  const close=async()=>{
    clearInterval(interval);
    await new Promise(resolve=>server.close(resolve));
  };
  return {server,runtime,civilization,pouc,url:"http://127.0.0.1:"+server.address().port,close};
}
