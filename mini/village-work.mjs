/** Persistent, explicitly driven work within ONE village. Gateway done means
 * delivery, never completion of the work. Reference text cannot grant authority.
 * Single writer, local JSON; no model calls during construction or state reads. */
import {mkdirSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {readCheckpoint,writeAtomicJson} from "../reusable/gateway-jobs/checkpoint.mjs";
import {runAgenticRepair} from "./agentic-runner.mjs";
import {createRumor,verifyRumor} from "./rumor-protocol.mjs";

const VILLAGES=["village-1","village-2"];
const STAGES=new Set(["ready","running","blocked","interrupted","unresolved",
  "candidate_verified","candidate_rejected","not_reproduced","readback_failed","attempt_budget_exhausted"]);
const TERMINAL=new Set(["candidate_verified","candidate_rejected","not_reproduced","readback_failed","attempt_budget_exhausted"]);
const SRC=["src/pricing.mjs","src/invoice.mjs"];
const sha=s=>createHash("sha256").update(s,"utf8").digest("hex");
const clone=x=>structuredClone(x);
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fail=code=>Object.assign(new Error(code),{code});
const idValid=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const workValid=x=>typeof x==="string"&&/^work_[a-f0-9]{32}$/.test(x);
const caseValid=x=>typeof x==="string"&&/^case_[a-f0-9]{32}$/.test(x);
const digestContext=w=>sha(JSON.stringify([w.id,w.villageId,w.goal,w.runId,w.incidentContext]));
function fields(value,allowed){
  if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).some(k=>!allowed.includes(k)))throw fail("invalid_work_request");
}
function validateWork(w,villageId,id){
  if(!w||w.schemaVersion!==1||w.villageId!==villageId||w.id!==id||
     !workValid(w.id)||!caseValid(w.runId)||!STAGES.has(w.stage)||
     typeof w.goal!=="string"||!w.goal.trim()||w.goal.length>500||
     !Array.isArray(w.attempts)||w.attempts.length>4||
     !Array.isArray(w.executions)||w.executions.length>64||
     w.incidentContext?.workId!==id||w.incidentContext?.villageId!==villageId||
     w.identityDigest!==digestContext(w)||
     JSON.stringify(w.sourceMessage)!==JSON.stringify(w.incidentContext.sourceMessage)||
     JSON.stringify(w.knowledge)!==JSON.stringify(w.incidentContext.knowledge))
    throw fail("invalid_work_checkpoint");
  if(w.sharingCandidate){
    const c=w.sharingCandidate;
    if(c.workId!==id||c.runId!==w.runId||c.status!=="human_review_required"||
      c.body!==c.rumor?.body||c.rumor?.originVillage!==villageId)
      throw fail("invalid_work_sharing_candidate");
    verifyRumor(c.rumor);
  }
  return w;
}
const outcomeStage=status=>({verified_candidate:"candidate_verified",holdout_rejected:"candidate_rejected",
  readback_failed:"readback_failed",not_reproduced:"not_reproduced",unresolved:"unresolved",blocked:"blocked"}[status]||"interrupted");
const nextFor=stage=>({ready:"select_ai_and_run",running:"wait_for_current_explicit_run",
  blocked:"select_ai_and_explicitly_resume",interrupted:"select_ai_and_explicitly_resume",
  unresolved:"select_ai_and_explicitly_resume",candidate_verified:"inspect_candidate_and_prepare_share",
  candidate_rejected:"inspect_rejected_candidate",not_reproduced:"investigate_reproducer",
  readback_failed:"inspect_readback_failure",attempt_budget_exhausted:"review_attempt_budget"}[stage]);

export class VillageWorkflows {
  constructor(civilization,{runnerOptions={}}={}){
    this.world=civilization;
    // Test injection is server construction only, never an HTTP/body field.
    this.runnerOptions=Object.fromEntries(["askModel","env","fetcher"].filter(k=>k in runnerOptions).map(k=>[k,runnerOptions[k]]));
    this.active=new Set();
    for(const villageId of VILLAGES){
      mkdirSync(this.#dir(villageId),{recursive:true});
      // Reconcile saved intent/result only. No reasoner/tests/retries here.
      for(const id of this.#ids(villageId)){
        const work=this.#read(villageId,id);
        if(work.stage==="running"){
          const journal=readCheckpoint(this.#journalPath(work));
          this.#syncJournal(work,journal);
          if(!TERMINAL.has(work.stage))work.stage="interrupted";
          work.nextAction=work.verificationPending?"verify_saved_candidate":nextFor(work.stage);
          const last=work.executions.at(-1);
          if(last?.status==="running"){
            last.status="interrupted_outcome_unconfirmed";
            last.reason="restart_requires_explicit_resume_no_automatic_model_retry";
          }
          this.#save(work);
        }
      }
    }
  }
  #runtime(villageId){
    if(!VILLAGES.includes(villageId))throw fail("invalid_work_village");
    return this.world.runtimes[villageId];
  }
  #dir(villageId){return join(this.#runtime(villageId).root,"work-ledger");}
  #path(villageId,id){if(!workValid(id))throw fail("invalid_work_id");return join(this.#dir(villageId),id+".json");}
  #repairRoot(w){return join(this.#runtime(w.villageId).root,"work-repair",w.id);}
  #journalPath(w){return join(this.#repairRoot(w),"baku-agent-journal",w.runId+".json");}
  #ids(villageId){
    const files=readdirSync(this.#dir(villageId)).filter(x=>x.endsWith(".json"));
    if(files.length>100)throw fail("work_ledger_capacity_reached");
    return files.map(x=>x.slice(0,-5)).map(id=>{if(!workValid(id))throw fail("invalid_work_file");return id;});
  }
  #read(villageId,id){
    const w=readCheckpoint(this.#path(villageId,id));
    if(!w)throw fail("work_not_found_in_village");
    return clone(validateWork(w,villageId,id));
  }
  #save(w){
    w.updatedAt=Date.now();
    validateWork(w,w.villageId,w.id);
    writeAtomicJson(this.#path(w.villageId,w.id),w);
  }
  #source(villageId,messageId){
    if(!idValid(messageId))throw fail("invalid_work_source_message");
    const runtime=this.#runtime(villageId),job=runtime.gateway.getJob(messageId);
    const e=job?.payload?.envelope;
    if(job?.state!=="done"||e?.id!==messageId||e.type!=="OBSERVE"||
       !["A","B"].includes(e.recipient)||typeof e.body!=="string")
      throw fail("work_source_not_delivered_in_village");
    const received=runtime.mailbox(e.recipient).messages.find(x=>x.id===messageId);
    if(!received||stable(received)!==stable(e))
      throw fail("work_source_mailbox_mismatch");
    return {id:e.id,sender:e.sender,recipient:e.recipient,type:e.type,body:e.body,
      bodySha256:sha(e.body),envelopeSha256:sha(JSON.stringify(e)),
      deliveryState:"done",providerIdentity:"not_authenticated",
      arcClaim:job.payload?.meta?.arc?.selectorsChecked===true};
  }
  #knowledge(villageId,ids){
    if(!Array.isArray(ids)||ids.length>5||new Set(ids).size!==ids.length||!ids.every(idValid))
      throw fail("invalid_work_knowledge_selection");
    const village=this.world.villages[villageId];
    return ids.map(id=>{
      const k=village.knowledge.find(x=>x.id===id);
      if(!k||typeof k.text!=="string"||!k.text.trim()||k.text.length>320||
         !VILLAGES.includes(k.sourceVillage))throw fail("work_knowledge_not_adopted_here");
      let rumorSha256=null;
      if(k.parentRumorId!==null){
        const receipt=village.incoming.find(x=>x.rumorId===k.parentRumorId);
        if(receipt?.status!=="adopted"||receipt.sourceVillage!==k.sourceVillage)
          throw fail("work_knowledge_not_adopted_here");
        const rumor=this.world.square.read(k.parentRumorId);
        if(rumor.body!==k.text||rumor.originVillage!==k.sourceVillage)
          throw fail("work_knowledge_provenance_changed");
        rumorSha256=rumor.sha256;
      }else if(k.sourceVillage!==villageId||id!=="origin_"+villageId){
        throw fail("work_knowledge_not_adopted_here");
      }
      return {id:k.id,text:k.text,textSha256:sha(k.text),sourceVillage:k.sourceVillage,
        parentRumorId:k.parentRumorId,rumorSha256,adoptedIn:villageId};
    });
  }
  #checkBindings(w){
    if(JSON.stringify(this.#source(w.villageId,w.sourceMessage.id))!==JSON.stringify(w.sourceMessage))
      throw fail("work_source_changed");
    if(JSON.stringify(this.#knowledge(w.villageId,w.knowledge.map(k=>k.id)))!==JSON.stringify(w.knowledge))
      throw fail("work_adopted_knowledge_changed");
  }
  #syncJournal(w,j){
    if(!j)return;
    if(j.id!==w.runId||j.goal!==w.goal||
       stable(j.incidentContext)!==stable(w.incidentContext))
      throw fail("work_repair_journal_identity_mismatch");
    w.attempts=clone(j.attempts||[]);
    w.verificationPending=w.attempts.at(-1)?.publicPassed===true&&
      w.attempts.at(-1)?.holdoutPassed===undefined&&Boolean(j.lastCandidate)&&
      !["verified_candidate","holdout_rejected","readback_failed","not_reproduced"].includes(j.status);
    w.invocationHistory=clone(j.invocationHistory||[]);
    for(const invocation of w.invocationHistory){
      if(invocation.outcome==="started"){
        invocation.outcome="interrupted";
        for(const call of invocation.calls||[])
          if(call.outcome==="started")call.outcome="outcome_unconfirmed";
      }
    }
    if(["verified_candidate","holdout_rejected","readback_failed","not_reproduced"].includes(j.status)){
      const candidate=j.lastCandidate||{};
      if(j.status==="verified_candidate"&&
         (SRC.some(p=>typeof candidate[p]!=="string")||
          sha(JSON.stringify(SRC.map(p=>[p,candidate[p]])))!==j.finalCandidateDigest))
        throw fail("work_candidate_journal_digest_mismatch");
      w.result={status:j.status,runId:w.runId,attempts:clone(w.attempts),
        candidateFiles:j.status==="verified_candidate"?SRC.map(path=>({path,content:candidate[path]})):[],
        baselineDigest:j.fixtureDigest,readbackVerified:j.status==="verified_candidate",
        productionChanged:false,approved:false,modelProvenance:j.modelProvenance,
        recoveredFromJournal:true};
      w.stage=outcomeStage(j.status);
      if(w.stage==="candidate_verified"&&!w.sharingCandidate)this.#draft(w);
    }
  }
  #draft(w,body){
    if(w.stage!=="candidate_verified"||w.result?.status!=="verified_candidate")
      throw fail("work_verified_result_required_for_share");
    const last=w.attempts.at(-1);
    const text=body??(`教材2ファイルの修復候補。仕事 ${w.id}。${(last?.diagnosis||"").slice(0,110)} `+
      `公開検査=${last?.publicPassed===true?"PASS":"未確認"}、確認検査=${last?.holdoutPassed===true?"PASS":"未確認"}。本番未適用、汎用性未検証。`);
    const rumor=createRumor({originVillage:w.villageId,body:text,
      parentRumorId:w.knowledge.find(k=>k.parentRumorId)?.parentRumorId??null});
    w.sharingCandidate={status:"human_review_required",body:rumor.body,workId:w.id,runId:w.runId,rumor,
      evidence:{sourceMessageId:w.sourceMessage.id,sourceBodySha256:w.sourceMessage.bodySha256,
        knowledgeIds:w.knowledge.map(k=>k.id),attemptCount:w.attempts.length,
        candidateDigest:last?.candidateDigest??null,productionChanged:false,
        scope:"first_party_disposable_two_file_fixture_only"}};
  }
  state({villageId,workId=null}={}){
    const runtime=this.#runtime(villageId);
    const works=this.#ids(villageId).map(id=>this.#read(villageId,id)).sort((a,b)=>b.createdAt-a.createdAt);
    const sources=runtime.gateway.queue.snapshot().jobs.filter(j=>j.state==="done"&&j.payload?.envelope?.type==="OBSERVE")
      .slice(-30).map(j=>this.#source(villageId,j.id));
    const ids=this.world.villages[villageId].knowledge.slice(-30).map(k=>k.id);
    // Validate each selectable adopted item, preserving provenance.
    const knowledge=ids.flatMap(id=>this.#knowledge(villageId,[id]));
    return {villageId,sources,knowledge,works:works.map(w=>({id:w.id,goal:w.goal,stage:w.stage,
      nextAction:w.nextAction,runId:w.runId,attemptsCount:w.attempts.length})),
      work:workId?this.#read(villageId,workId):works[0]??null,
      limits:{fixtureOnly:true,automaticResume:false,gatewayDoneMeans:"delivery_only",sourceAuthentication:false}};
  }
  create(input){
    fields(input,["action","villageId","goal","sourceMessageId","knowledgeIds"]);
    const {villageId,goal,sourceMessageId,knowledgeIds=[]}=input;
    this.#runtime(villageId);
    if(typeof goal!=="string"||!goal.trim()||goal.length>500)throw fail("invalid_work_goal");
    if(this.#ids(villageId).length>=100)throw fail("work_ledger_capacity_reached");
    const id="work_"+randomUUID().replaceAll("-","");
    const sourceMessage=this.#source(villageId,sourceMessageId);
    const knowledge=this.#knowledge(villageId,knowledgeIds);
    const w={schemaVersion:1,id,villageId,goal:goal.trim(),
      runId:"case_"+randomUUID().replaceAll("-",""),sourceMessage,knowledge,
      stage:"ready",nextAction:nextFor("ready"),attempts:[],executions:[],invocationHistory:[],
      result:null,sharingCandidate:null,verificationPending:false,createdAt:Date.now(),updatedAt:Date.now(),
      scope:"first_party_disposable_two_file_fixture_only"};
    w.incidentContext={schemaVersion:1,workId:id,villageId,sourceMessage:clone(sourceMessage),knowledge:clone(knowledge)};
    w.identityDigest=digestContext(w);
    this.#save(w);
    return {work:clone(w)};
  }
  prepareShare(input){
    fields(input,["action","villageId","workId","body"]);
    const w=this.#read(input.villageId,input.workId);
    this.#checkBindings(w);
    if(typeof input.body!=="string"||!input.body.trim()||input.body.length>320)
      throw fail("invalid_work_sharing_body");
    this.#draft(w,input.body);
    this.#save(w);
    return {work:clone(w),candidate:clone(w.sharingCandidate)};
  }
  async run(input){
    fields(input,["action","villageId","workId","provider","allowExternalCalls"]);
    const w=this.#read(input.villageId,input.workId),key=w.villageId+":"+w.id;
    if(this.active.has(key)||w.stage==="running")throw fail("work_run_already_active");
    if(TERMINAL.has(w.stage))throw fail("work_result_requires_review_not_rerun");
    if(typeof input.provider!=="string"||!/^[-a-z0-9]{1,32}$/.test(input.provider)||
       (input.allowExternalCalls!==undefined&&typeof input.allowExternalCalls!=="boolean"))
      throw fail("explicit_work_provider_choice_required");
    this.#checkBindings(w);
    if(w.executions.length>=64)throw fail("work_execution_history_capacity_reached");
    const journal=readCheckpoint(this.#journalPath(w));
    this.#syncJournal(w,journal);
    if(TERMINAL.has(w.stage)){w.nextAction=nextFor(w.stage);this.#save(w);return {work:clone(w),result:w.result};}
    if(w.attempts.length>=4&&!w.verificationPending){
      w.stage="attempt_budget_exhausted";w.nextAction=nextFor(w.stage);this.#save(w);
      return {work:clone(w),result:{status:"blocked",reason:"work_attempt_budget_exhausted",runId:w.runId}};
    }
    const execution={id:"exec_"+randomUUID().replaceAll("-",""),requestedProvider:input.provider,
      externalConsent:input.allowExternalCalls===true,startedAt:Date.now(),status:"running",
      authority:"explicit_local_operator_request"};
    w.executions.push(execution);w.stage="running";w.nextAction=nextFor(w.stage);
    this.#save(w);this.active.add(key);
    try{
      let result;
      if(!["ollama","openai","auto"].includes(input.provider)){
        result={status:"blocked",reason:"repair_adapter_unavailable",runId:w.runId,productionChanged:false};
      }else{
        mkdirSync(this.#repairRoot(w),{recursive:true});
        result=await runAgenticRepair({...this.runnerOptions,root:this.#repairRoot(w),goal:w.goal,
          incidentContext:clone(w.incidentContext),
          ...(journal?{resumeRunId:w.runId}:{runId:w.runId}),
          provider:input.provider==="auto"?undefined:input.provider,
          providerOrder:input.provider==="auto"?["ollama","openai"]:null,
          allowProviderChange:true,allowExternalCalls:execution.externalConsent,
          maxAttempts:Math.min(4,w.attempts.length+1)});
      }
      execution.status=result.status;execution.reason=result.reason??null;execution.completedAt=Date.now();
      const savedJournal=readCheckpoint(this.#journalPath(w));
      this.#syncJournal(w,savedJournal);
      w.result=clone(result);w.attempts=clone(result.attempts||w.attempts);
      w.stage=outcomeStage(result.status);w.nextAction=nextFor(w.stage);
      if(w.stage==="unresolved"&&w.attempts.length>=4){w.stage="attempt_budget_exhausted";w.nextAction=nextFor(w.stage);}
      if(w.stage==="candidate_verified"&&!w.sharingCandidate)this.#draft(w);
      this.#save(w);
      return {work:clone(w),result:clone(result)};
    }catch(error){
      execution.status="interrupted_outcome_unconfirmed";execution.reason=error.code||"work_execution_interrupted";
      execution.completedAt=Date.now();w.stage="interrupted";w.nextAction=nextFor(w.stage);
      // Persist intent/error, never retry an uncertain model call automatically.
      this.#save(w);
      throw error;
    }finally{this.active.delete(key);}
  }
}
