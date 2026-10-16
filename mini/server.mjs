/**
 * Loopback HTTP UI and explicitly requested repair/provider routes.
 * Fixed-route static serving; no arbitrary filesystem browsing.
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
import {ArcHandoff} from "./arc-handoff.mjs";
import {VillageWorkflows} from "./village-work.mjs";
import {timingSafeEqual} from "node:crypto";
import {ProjectDesk} from "./project-desk.mjs";
import {VillageBootstrap} from "./village-bootstrap.mjs";
import {ProjectSetup} from "./project-setup.mjs";
import {validateProjectSetupCompatibility} from "./project-setup-config.mjs";

const UI=new Map([
  ["/",["./public/index.html","text/html; charset=utf-8"]],
  ["/experience",["./public/experience.html","text/html; charset=utf-8"]],
  ["/experience.js",["./public/experience.js","text/javascript; charset=utf-8"]],
  ["/project-ui.js",["./public/project-ui.js","text/javascript; charset=utf-8"]],
  ["/village-ui.js",["./public/village-ui.js","text/javascript; charset=utf-8"]],
  ["/setup-ui.js",["./public/setup-ui.js","text/javascript; charset=utf-8"]],
  ["/project-guide",["./public/project-guide.html","text/html; charset=utf-8"]],
  ["/project-guide.css",["./public/project-guide.css","text/css; charset=utf-8"]],
  ["/project-guide.js",["./public/project-guide.js","text/javascript; charset=utf-8"]],
  ["/project-guide-source",["../docs/METRON_MINI_PROJECT_USER_FLOW_2026-10-15.md","text/plain; charset=utf-8"]],
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
async function readJson(req,limit=16_384){
  let size=0;const parts=[];
  for await(const b of req){
    size+=b.length;
    if(size>limit)throw Object.assign(new Error("request too large"),{code:"payload_too_large"});
    parts.push(b);
  }
  try{return JSON.parse(Buffer.concat(parts).toString("utf8"));}
  catch{throw Object.assign(new Error("invalid JSON"),{code:"invalid_json"});}
}
/** Start only on loopback. Caller must enforce single writer for the data root. */
export async function createMiniServer({root,port=8766,workOptions={},projectOperatorToken=null,projectCodexOptions=null,
  villageBootstrapOptions=null,projectSetupSlots=[]}={}){
  if(!Number.isInteger(port)||port<0||port>65535)
    throw new Error("port must be 0-65535");
  if(!Array.isArray(projectSetupSlots)||!Array.isArray(workOptions.projectPlans||[])||
     villageBootstrapOptions!==null&&(!villageBootstrapOptions||typeof villageBootstrapOptions!=="object"||Array.isArray(villageBootstrapOptions)))
    throw Object.assign(new Error("invalid management configuration"),{code:"invalid_management_configuration"});
  const configuredIds=[...(workOptions.projectPlans||[]),...projectSetupSlots].map(plan=>String(plan.id).toLowerCase());
  if(configuredIds.length>8||new Set(configuredIds).size!==configuredIds.length)
    throw Object.assign(new Error("project setup conflicts with registry"),{code:"project_setup_registry_conflict"});
  if((workOptions.projectPlans?.length||projectOperatorToken!==null||projectCodexOptions!==null||villageBootstrapOptions!==null||projectSetupSlots.length)&&
     !/^[a-f0-9]{64}$/.test(projectOperatorToken||""))
    throw Object.assign(new Error("project operator capability required"),{code:"project_operator_capability_required"});
  const isProjectOperator=req=>typeof req.headers["x-metron-project-operator"]==="string"&&
    /^[a-f0-9]{64}$/.test(req.headers["x-metron-project-operator"])&&typeof projectOperatorToken==="string"&&
    timingSafeEqual(Buffer.from(req.headers["x-metron-project-operator"]),Buffer.from(projectOperatorToken));
  const validatedSetupSlots=validateProjectSetupCompatibility(projectSetupSlots,workOptions.projectPlans||[]);
  const runtime=new MetronMiniRuntime(root);
  const civilization=new CivilizationExperienceV3(runtime.root,runtime);
  const pouc=new PoUCLedger(runtime.root);
  const arcHandoff=new ArcHandoff(runtime);
  const projectSetup=new ProjectSetup({root:runtime.root,slots:validatedSetupSlots});
  const preparedPlans=projectSetup.preparedPlans();
  const initialPlans=[...(workOptions.projectPlans||[]),...preparedPlans];
  if(initialPlans.length>8||new Set(initialPlans.map(plan=>plan.id.toLowerCase())).size!==initialPlans.length)
    throw Object.assign(new Error("project setup conflicts with registry"),{code:"project_setup_registry_conflict"});
  const work=new VillageWorkflows(civilization,{...workOptions,projectPlans:initialPlans});
  projectSetup.setOnPrepared(plan=>{
    const prior=[...work.projectSessions.plans.values()].find(item=>item.id.toLowerCase()===plan.id.toLowerCase());
    if(prior&&(prior.id!==plan.id||prior.planDigest!==plan.planDigest)||!prior&&work.projectSessions.plans.size>=8)
      throw Object.assign(new Error("project setup conflicts with registry"),{code:"project_setup_registry_conflict"});
    work.projectSessions.plans.set(plan.id,plan);
  });
  const projectDesk=new ProjectDesk({root:runtime.root,work,projectCodexOptions});
  const villageBootstrap=villageBootstrapOptions===null?null:new VillageBootstrap({
    ...villageBootstrapOptions,root:join(runtime.root,"village-bootstrap"),
    beforeStop:id=>work.assertCanStop(id),
    sourceProvider:input=>work.inheritanceSource({villageId:input.villageId,workId:input.workId??null})
  });
  const syncParticipants=()=>{
    for(const participant of villageBootstrap?.participants()||[]){
      civilization.registerVillage(participant);work.registerVillage(participant.id);
    }
  };
  try{syncParticipants();}
  catch(error){await villageBootstrap?.close();await projectDesk.close();throw error;}
  let closing=false;
  const server=createServer(async(req,res)=>{
    const currentPort=server.address()?.port||port;
    if(!hostAllowed(req.headers.host,currentPort))
      return send(res,403,{error:"invalid_host"});
    const url=req.url?.split("?")[0]||"";
    if(closing)return send(res,503,{error:"mini_server_closing"});
    if(req.method==="GET"&&["/api/village/catalog","/api/village/state","/api/project/setup","/api/project/setup/state"].includes(url)){
      if(!isProjectOperator(req))return send(res,403,{error:"project_operator_capability_required"});
      try{
        const query=new URL(req.url,"http://127.0.0.1").searchParams;
        const accepted=url==="/api/village/catalog"?["sourceVillageId","sourceWorkId"]:
          url==="/api/village/state"?["newVillageId"]:url==="/api/project/setup/state"?["slotId"]:[];
        if([...query.keys()].some(key=>!accepted.includes(key)||query.getAll(key).length!==1))
          throw Object.assign(new Error("invalid management query"),{code:"invalid_management_query"});
        if(url==="/api/project/setup")return send(res,200,projectSetup.catalog());
        if(url==="/api/project/setup/state")return send(res,200,projectSetup.state({slotId:query.get("slotId")}));
        if(!villageBootstrap)return send(res,409,{error:"village_bootstrap_not_configured"});
        return send(res,200,url==="/api/village/state"?villageBootstrap.state({newVillageId:query.get("newVillageId")}):
          villageBootstrap.catalog({sourceVillageId:query.get("sourceVillageId")||"village-1",sourceWorkId:query.get("sourceWorkId")||null}));
      }catch(error){return send(res,400,{error:error.code||"management_state_failed"});}
    }
    if(req.method==="GET"&&url==="/api/project/availability")return send(res,200,projectDesk.availability());
    if(req.method==="GET"&&["/api/project/catalog","/api/project/jobs"].includes(url)){
      if(!isProjectOperator(req))return send(res,403,{error:"project_operator_capability_required"});
      try{
        const query=new URL(req.url,"http://127.0.0.1").searchParams;
        return send(res,200,url==="/api/project/catalog"?projectDesk.catalog():projectDesk.jobs({sessionId:query.get("sessionId")}));
      }catch(error){return send(res,400,{error:error.code||"project_desk_state_failed"});}
    }
    if(req.method==="GET"&&url==="/api/project/state"){
      try{
        const query=new URL(req.url,"http://127.0.0.1").searchParams;
        return send(res,200,work.projectState({sessionId:query.get("sessionId"),
          dispatchToken:req.headers["x-metron-project-worker"],operator:isProjectOperator(req)}));
      }catch(e){return send(res,400,{error:e.code||"project_state_failed"});}
    }
    if(req.method==="GET"&&url==="/api/work/state"){
      try{
        const query=new URL(req.url,"http://127.0.0.1").searchParams;
        return send(res,200,work.state({villageId:query.get("villageId"),workId:query.get("workId")}));
      }catch(e){return send(res,400,{error:e.code||"work_state_failed"});}
    }
    if(req.method==="GET"&&STATIC.has(url)){
      const item=STATIC.get(url);
      res.writeHead(200,{"Content-Type":item.type,
        "Content-Security-Policy":csp,
        "X-Content-Type-Options":"nosniff","Cache-Control":"no-store"});
      return res.end(item.body);
    }
    if(req.method==="POST"&&url==="/api/arc/handoff"){
      if(req.headers["x-metron-mini"]!=="1")
        return send(res,403,{error:"explicit_local_request_header_required"});
      const origin=req.headers.origin;
      if(origin&&!["http://127.0.0.1:"+currentPort,
        "http://localhost:"+currentPort].includes(origin)&&
        !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))
        return send(res,403,{error:"invalid_origin"});
      if(!String(req.headers["content-type"]||"").startsWith("application/json"))
        return send(res,415,{error:"json_required"});
      try{
        const body=await readJson(req,2*1024*1024);
        if(body?.action==="start")return send(res,200,arcHandoff.start());
        if(body?.action==="deliver")return send(res,200,arcHandoff.deliver(body));
        if(body?.action==="status")return send(res,200,arcHandoff.status(body));
        return send(res,400,{error:"invalid_arc_handoff_action"});
      }catch(e){return send(res,400,{error:e.code||"arc_handoff_failed"});}
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
    if(req.method==="GET"&&url==="/api/civilization/state"){
      try{return send(res,200,civilization.state());}
      catch(e){return send(res,400,{error:e.code||"civilization_state_failed"});}
    }
    if(req.method==="GET"&&url==="/api/state")
      return send(res,200,runtime.state());
    if(req.method==="GET"&&url==="/api/health")
      return send(res,200,{status:"ok",mode:"local-only"});
    if(req.method==="POST"&&["/api/mission","/api/drain","/api/civilization/action","/api/advanced/action","/api/agent/run","/api/work/action","/api/project/action","/api/project/dispatch",
      "/api/village/preview","/api/village/action","/api/project/setup/prepare"].includes(url)){
      if(req.headers["x-metron-mini"]!=="1")
        return send(res,403,{error:"explicit_local_request_header_required"});
      const origin=req.headers.origin;
      if(origin && !["http://127.0.0.1:"+currentPort,"http://localhost:"+currentPort].includes(origin))
        return send(res,403,{error:"invalid_origin"});
      if(!String(req.headers["content-type"]||"").startsWith("application/json"))
        return send(res,415,{error:"json_required"});
      try{
        const body=await readJson(req,["/api/project/action","/api/village/preview","/api/village/action"].includes(url)?32_768:16_384);
        if(["/api/village/preview","/api/village/action","/api/project/setup/prepare"].includes(url)){
          if(!isProjectOperator(req))return send(res,403,{error:"project_operator_capability_required"});
          if(url==="/api/project/setup/prepare")return send(res,202,projectSetup.prepare(body));
          if(!villageBootstrap)return send(res,409,{error:"village_bootstrap_not_configured"});
          if(url==="/api/village/preview")return send(res,200,villageBootstrap.preview(body));
          const result=await villageBootstrap.action(body);
          const workStop=body.action==="stop"&&!result.duplicate?await projectDesk.cancelVillage(body.newVillageId):null;
          syncParticipants();
          return send(res,200,{...result,...(workStop?{workStop}:{})});
        }
        if(url==="/api/project/dispatch"){
          if(!isProjectOperator(req))return send(res,403,{error:"project_operator_capability_required"});
          return send(res,202,projectDesk.dispatch(body,{url:"http://127.0.0.1:"+currentPort}));
        }
        if(url==="/api/project/action"){
          const workerActions=new Set(["claim","heartbeat","report","ack-stop"]);
          const operator=isProjectOperator(req);
          if(!workerActions.has(body?.action)&&!operator)
            return send(res,403,{error:"project_operator_capability_required"});
          const result=await work.projectAction(body,{operator});
          if(body.action==="cancel")projectDesk.cancelSession(body.sessionId);
          return send(res,200,result);
        }
        if(url==="/api/work/action"){
          if(civilization.isDynamic(body?.villageId)&&!isProjectOperator(req))
            return send(res,403,{error:"project_operator_capability_required"});
          if(body?.action==="create")return send(res,200,work.create(body));
          if(body?.action==="prepare-share")return send(res,200,work.prepareShare(body,{operator:isProjectOperator(req)}));
          if(body?.action==="publish-share")return send(res,200,await work.publishShare(body,{operator:isProjectOperator(req)}));
          if(body?.action==="worker-export")return send(res,200,work.exportWorker(body));
          if(body?.action==="worker-import")return send(res,200,work.importWorker(body));
          if(body?.action==="worker-review")return send(res,200,work.reviewWorker(body));
          if(body?.action==="worker-verify")return send(res,200,await work.verifyWorker(body));
          return send(res,400,{error:"invalid_work_action"});
        }
        if(url==="/api/agent/run"){
          if(!body||typeof body!=="object"||Array.isArray(body))
            return send(res,400,{error:"invalid_agent_request"});
          if(civilization.isDynamic(body.villageId)&&!isProjectOperator(req))
            return send(res,403,{error:"project_operator_capability_required"});
          if(Object.hasOwn(body,"workId")||Object.hasOwn(body,"villageId"))
            return send(res,200,await work.run(body));
          if(!["ollama","openai"].includes(body.provider)&&
             !(body.provider==="auto"&&Array.isArray(body.providerOrder)))
            return send(res,400,{error:"explicit_model_choice_required"});
          if(body.provider==="openai"&&body.allowExternalCalls!==true)
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
          if((civilization.isDynamic(body.from)||civilization.isDynamic(body.villageId))&&!isProjectOperator(req))
            return send(res,403,{error:"project_operator_capability_required"});
          const result=body.action==="publish"?civilization.publish(body):
            body.action==="receive"?civilization.receive(body):
            body.action==="review"?civilization.review(body):
            body.action==="filter"?civilization.setFilter(body):
            body.action==="salvage"?civilization.salvage(body):
            body.action==="recovery"?civilization.recoveryDemo():null;
          if(!result)return send(res,400,{error:"unknown_concept_action"});
          return send(res,200,await result);
        }
        if(url==="/api/mission")
          return send(res,200,runtime.submit(body));
        return send(res,200,{processed:runtime.drain(),state:runtime.state()});
      }catch(err){
        if(url==="/api/project/dispatch")return send(res,400,{error:err.code||"project_desk_dispatch_failed"});
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
  let closingPromise;
  const close=()=>closingPromise??=(async()=>{
    closing=true;
    clearInterval(interval);
    await villageBootstrap?.close();
    await projectSetup.close();
    await projectDesk.close();
    await new Promise(resolve=>server.close(resolve));
    await work.waitForIdle();
  })();
  return {server,runtime,civilization,pouc,work,projectDesk,projectSetup,villageBootstrap,url:"http://127.0.0.1:"+server.address().port,close};
}
