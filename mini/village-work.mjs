/** Persistent, explicitly driven work within ONE village. Gateway done means
 * delivery, never completion of the work. Reference text cannot grant authority.
 * Single writer, local JSON; no model calls during construction or state reads. */
import {mkdirSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {readCheckpoint,writeAtomicJson} from "../reusable/gateway-jobs/checkpoint.mjs";
import {runAgenticRepair} from "./agentic-runner.mjs";
import {createRumor,verifyRumor,validateRepairEvidence} from "./rumor-protocol.mjs";
import {ExternalWorkerHandoff,validateExternalRecord,recoverExternalRecord} from "./external-worker.mjs";
import {RegisteredProjectSessions} from "./project-session.mjs";
import {inspectRegisteredProjectRevision} from "./project-tools.mjs";

const STAGES=new Set(["ready","running","blocked","interrupted","unresolved",
  "candidate_verified","candidate_rejected","not_reproduced","readback_failed","attempt_budget_exhausted"]);
const TERMINAL=new Set(["candidate_verified","candidate_rejected","not_reproduced","readback_failed","attempt_budget_exhausted"]);
const SRC=["src/pricing.mjs","src/invoice.mjs"];
const sha=s=>createHash("sha256").update(s,"utf8").digest("hex");
const clone=x=>structuredClone(x);
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fail=code=>Object.assign(new Error(code),{code});
const hash=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const idValid=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const workValid=x=>typeof x==="string"&&/^work_[a-f0-9]{32}$/.test(x);
const caseValid=x=>typeof x==="string"&&/^case_[a-f0-9]{32}$/.test(x);
const digestContext=w=>sha(JSON.stringify([w.id,w.villageId,w.goal,w.runId,w.incidentContext]));
const projectBinding=(w,p)=>sha(stable([w.villageId,w.id,w.runId,w.identityDigest,p.projectId,p.planDigest,p.sessionId]));
const projectPoUC=session=>session.pouc?{status:session.pouc.status,attempts:session.pouc.attempts,
  verificationId:session.pouc.verificationId,computationDigest:session.pouc.computationDigest??null,
  proofDigest:session.pouc.proofDigest??null,bindingDigest:session.pouc.bindingDigest??null}:null;
const projectSnapshot=w=>clone(Object.fromEntries(["projectRepair","result","sharingCandidate","publication","scope"].map(k=>[k,w[k]??null])));
const historyDigest=(w,entry)=>sha(stable([w.id,w.villageId,w.runId,w.identityDigest,entry.version,entry.snapshot]));
const revisionRequestKeys=["previousSessionId","reviewedPreviousCandidate","projectId","requirements","symptom","evidence"];
function validRevision(r){
  fields(r,revisionRequestKeys);
  return /^agent_[a-f0-9]{32}$/.test(r.previousSessionId||"")&&/^[a-f0-9]{40}$/.test(r.reviewedPreviousCandidate||"")&&
    idValid(r.projectId)&&typeof r.requirements==="string"&&r.requirements.trim()===r.requirements&&r.requirements.length>0&&r.requirements.length<=2000&&
    typeof r.symptom==="string"&&r.symptom.trim().length>0&&r.symptom.length<=2000&&Array.isArray(r.evidence)&&r.evidence.length<=10&&
    r.evidence.every(x=>typeof x==="string"&&x.trim().length>0&&x.length<=1000);
}
function fields(value,allowed){
  if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).some(k=>!allowed.includes(k)))throw fail("invalid_work_request");
}
// The shared record contains an explicitly reviewed summary and fingerprints,
// never the source answer, private work context, candidate code or raw logs.
function repairEvidenceFor(w,summary){
  fields(summary,["diagnosis","applicability","limitations"]);
  if(w.stage!=="candidate_verified"||w.result?.status!=="verified_candidate"||
     w.result.productionChanged!==false)throw fail("work_verified_result_required_for_share");
  let proof;
  if(w.projectRepair){
    const v=w.projectRepair.verification;
    if(!v)throw fail("work_verified_project_evidence_required");
    proof={scope:"registered_project_coding_agent",candidateCommit:v.candidateCommit,candidateDigest:null,
      diffSha256:v.diffSha256,verificationDigest:v.evidenceDigest,modelProvenance:v.modelProvenance,checks:clone(v.checks)};
  }else if(w.externalRepair){
    validateExternalRecord(w);
    const v=w.externalRepair.verifications.at(-1);
    if(w.externalRepair.status!=="verified")throw fail("independent_worker_verification_required");
    proof={scope:"human_reviewed_external_worker",candidateCommit:v.candidateCommit,
      candidateDigest:null,diffSha256:v.diffSha256,verificationDigest:v.evidenceDigest,
      modelProvenance:w.result.modelProvenance,
      checks:v.checks.map((c,i)=>({id:["baseline_reproduction","candidate_reproduction","candidate_regression"][i],
        outcome:i===0?"expected_failure":"passed",outputSha256:c.outputSha256}))};
  }else{
    const a=w.attempts.at(-1);
    if(a?.publicPassed!==true||a.holdoutPassed!==true||!hash(a.candidateDigest)||
       !hash(a.holdoutEvidenceHash)||typeof a.publicEvidence!=="string"||
       w.result.readbackVerified!==true)throw fail("work_verified_evidence_required");
    const checks=[{id:"candidate_public",outcome:"passed",outputSha256:sha(a.publicEvidence)},
      {id:"candidate_holdout",outcome:"passed",outputSha256:a.holdoutEvidenceHash}];
    // The incident's first provider is historical context. Attribute this
    // candidate to its successful attempt, including a real failover choice.
    const modelProvenance=a.modelProvenance==="test_injected_not_real_ai"?
      a.modelProvenance:a.provider;
    proof={scope:"first_party_disposable_two_file_fixture_only",candidateCommit:null,
      candidateDigest:a.candidateDigest,diffSha256:null,
      verificationDigest:sha(stable({candidateDigest:a.candidateDigest,baselineDigest:w.result.baselineDigest,
        checks,readbackVerified:true,modelProvenance})),modelProvenance,checks};
  }
  return validateRepairEvidence({schemaVersion:1,...proof,...summary,productionApplied:false});
}
function validateWork(w,villageId,id,{historical=false}={}){
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
  if(w.projectRepair){
    const p=w.projectRepair;
    fields(p,["schemaVersion","sessionId","projectId","planDigest","bindingDigest","status","attemptCount","historyLength","verification","application","revision","pouc"]);
    if(p.schemaVersion!==1||!idValid(p.projectId)||!hash(p.planDigest)||
       !(p.sessionId===null||/^agent_[a-f0-9]{32}$/.test(p.sessionId))||p.bindingDigest!==projectBinding(w,p)||
       typeof p.status!=="string"||!/^[a-z][a-z0-9_]{0,63}$/.test(p.status)||
       !Number.isInteger(p.attemptCount)||p.attemptCount<0||p.attemptCount>3||
       !Number.isInteger(p.historyLength)||p.historyLength<0||p.historyLength>256||w.externalRepair)
      throw fail("invalid_work_project_binding");
    if(p.revision&&(!validRevision(p.revision)||p.revision.projectId!==p.projectId))throw fail("invalid_work_project_revision");
    if(p.verification){
      fields(p.verification,["id","candidateCommit","diffSha256","evidenceDigest","modelProvenance","checks"]);
      if(!/^verification_[a-f0-9]{32}$/.test(p.verification.id)||
         w.result?.status!=="verified_candidate"||w.result.candidateCommit!==p.verification.candidateCommit||
         w.result.diffSha256!==p.verification.diffSha256||w.result.verificationDigest!==p.verification.evidenceDigest||
         w.result.runId!==w.runId||w.result.productionChanged!==false||w.stage!=="candidate_verified")
        throw fail("invalid_work_project_verification");
      repairEvidenceFor(w,{diagnosis:"Saved project verification",applicability:"Registered project only",limitations:"Sender claim only"});
    }else if(w.result?.scope==="registered_project_coding_agent")throw fail("invalid_work_project_verification");
    if(p.pouc){
      fields(p.pouc,["status","attempts","verificationId","computationDigest","proofDigest","bindingDigest"]);
      if(!["running","verified","rejected","cancelled","interrupted"].includes(p.pouc.status)||
         !Number.isInteger(p.pouc.attempts)||p.pouc.attempts<1||p.pouc.attempts>3||
         p.pouc.verificationId!==p.verification?.id||
         [p.pouc.computationDigest,p.pouc.proofDigest,p.pouc.bindingDigest].some(value=>
           p.pouc.status==="verified"?!hash(value):value!==null))throw fail("invalid_work_project_pouc");
    }
    if(p.application){
      fields(p.application,["targetKind","status","head"]);
      if(p.application.targetKind!=="registered_isolated_apply_root"||typeof p.application.status!=="string"||
         !/^[a-z][a-z0-9_]{0,63}$/.test(p.application.status)||
         !(p.application.head===null||/^[a-f0-9]{40}$/.test(p.application.head)))
        throw fail("invalid_work_project_application");
    }
  }
  if(!historical&&w.projectHistory!==undefined){
    if(!Array.isArray(w.projectHistory)||w.projectHistory.length>2||!w.projectRepair)throw fail("invalid_work_project_history");
    for(const [index,entry] of w.projectHistory.entries()){
      fields(entry,["schemaVersion","version","snapshot","digest"]);
      fields(entry.snapshot,["projectRepair","result","sharingCandidate","publication","scope"]);
      const old=entry.snapshot,previous=w.projectHistory[index-1]?.snapshot;
      if(entry.schemaVersion!==1||entry.version!==index+1||entry.digest!==historyDigest(w,entry)||
         !old.projectRepair?.verification||old.scope!=="registered_project_coding_agent"||
         old.publication&&old.publication.status!=="published"||
         (index===0?Boolean(old.projectRepair.revision):old.projectRepair.revision?.previousSessionId!==previous.projectRepair.sessionId||
           old.projectRepair.revision?.reviewedPreviousCandidate!==previous.projectRepair.verification.candidateCommit))
        throw fail("invalid_work_project_history");
      const prior={...clone(w),...clone(old),stage:"candidate_verified"};delete prior.projectHistory;
      validateWork(prior,villageId,id,{historical:true});
    }
    const last=w.projectHistory.at(-1)?.snapshot,r=w.projectRepair.revision;
    if(last?(!r||r.previousSessionId!==last.projectRepair.sessionId||r.reviewedPreviousCandidate!==last.projectRepair.verification.candidateCommit):Boolean(r))
      throw fail("invalid_work_project_revision_lineage");
  }else if(!historical&&w.projectRepair?.revision)throw fail("invalid_work_project_revision_lineage");
  if(w.sharingCandidate){
    const c=w.sharingCandidate;
    if(c.workId!==id||c.runId!==w.runId||c.status!=="human_review_required"||
      c.body!==c.rumor?.body||c.rumor?.originVillage!==villageId)
      throw fail("invalid_work_sharing_candidate");
    verifyRumor(c.rumor);
    if(c.rumor.repairEvidence&&stable(c.rumor.repairEvidence)!==stable(repairEvidenceFor(w,{
      diagnosis:c.rumor.repairEvidence.diagnosis,applicability:c.rumor.repairEvidence.applicability,
      limitations:c.rumor.repairEvidence.limitations})))throw fail("work_sharing_evidence_changed");
  }
  if(w.publication){
    const p=w.publication;
    if(p.schemaVersion!==1||!["intent","published"].includes(p.status)||
       !w.sharingCandidate||p.rumorSha256!==w.sharingCandidate.rumor.sha256||
       stable(p.rumor)!==stable(w.sharingCandidate.rumor)||
       p.rumor?.schemaVersion!=="metron-rumor-v2"||
       !Number.isSafeInteger(p.intentAt)||p.intentAt<0||
       (p.status==="intent"?p.completedAt!==null:!Number.isSafeInteger(p.completedAt)))
      throw fail("invalid_work_publication_checkpoint");
    verifyRumor(p.rumor);
  }
  validateExternalRecord(w);
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
  constructor(civilization,{runnerOptions={},workerPlans=[],projectPlans=[]}={}){
    this.world=civilization;
    this.externalWorker=new ExternalWorkerHandoff(workerPlans);this.externalTasks=new Set();
    this.projectSessions=new RegisteredProjectSessions({root:join(civilization.root,"project-sessions"),plans:projectPlans,
      isVillage:id=>Object.hasOwn(this.world.runtimes,id)});
    // Test injection is server construction only, never an HTTP/body field.
    this.runnerOptions=Object.fromEntries(["askModel","env","fetcher"].filter(k=>k in runnerOptions).map(k=>[k,runnerOptions[k]]));
    this.active=new Set();this.initializedVillages=new Set();
    for(const villageId of Object.keys(civilization.runtimes))this.registerVillage(villageId);
  }
  /** Internal membership registration, only after the world accepts an owned bundle. */
  registerVillage(villageId){
      this.#runtime(villageId);
      if(this.initializedVillages.has(villageId))return;
      mkdirSync(this.#dir(villageId),{recursive:true});
      // Reconcile saved intent/result only. No reasoner/tests/retries here.
      for(const id of this.#ids(villageId)){
        const work=this.#read(villageId,id);
        if(work.projectRepair)continue;
        if(work.externalRepair){if(recoverExternalRecord(work))this.#save(work);continue;}
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
      this.initializedVillages.add(villageId);
  }
  #runtime(villageId){
    if(!Object.hasOwn(this.world.runtimes,villageId))throw fail("invalid_work_village");
    return this.world.runtimes[villageId];
  }
  requireActive(villageId){this.#runtime(villageId);this.world.requireActive?.(villageId);}
  assertCanStop(villageId){
    this.#runtime(villageId);
    if([...this.active].some(key=>key.startsWith(villageId+":"))||
       [...this.projectSessions.active.values()].some(entry=>entry.record?.villageId===villageId))
      throw fail("village_work_operation_active_cancel_first");
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
    validateWork(w,villageId,id);
    if(w.projectRepair){
      if([w.projectRepair,...(w.projectHistory||[]).map(e=>e.snapshot.projectRepair)].some(p=>
          this.projectSessions.plans.get(p.projectId)?.planDigest!==p.planDigest))
        return {...clone(w),projectRegistrationRequired:true,nextAction:"restore_registered_project_configuration",
          runtimeWarnings:["Historical project receipt only; restore the original owner registration before project operations or sharing"]};
      this.#checkProjectHistory(w);
      const before=stable(w),session=this.#boundProject(w);
      this.#syncProject(w,session);
      if(stable(w)!==before)this.#save(w);
    }
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
      if(k?.inheritance){
        const reference=this.world.inheritedKnowledge?.(villageId,id);
        if(!reference||stable(reference)!==stable(k))throw fail("work_inherited_reference_changed");
        // Explicitly selected reference data, never a local adoption or validation claim.
        return clone(reference);
      }
      if(!k||typeof k.text!=="string"||!k.text.trim()||k.text.length>320||
         !Object.hasOwn(this.world.runtimes,k.sourceVillage))throw fail("work_knowledge_not_adopted_here");
      let rumorSha256=null;
      if(k.parentRumorId!==null){
        const receipt=village.incoming.find(x=>x.rumorId===k.parentRumorId);
        if(receipt?.status!=="adopted"||receipt.sourceVillage!==k.sourceVillage)
          throw fail("work_knowledge_not_adopted_here");
        const rumor=this.world.square.read(k.parentRumorId);
        if(rumor.body!==k.text||rumor.originVillage!==k.sourceVillage)
          throw fail("work_knowledge_provenance_changed");
        if(stable(k.repairEvidence)!==stable(rumor.repairEvidence)||
           (rumor.repairEvidence&&k.rumorSha256!==rumor.sha256)||
           (receipt.rumorSha256&&receipt.rumorSha256!==rumor.sha256))
          throw fail("work_knowledge_provenance_changed");
        rumorSha256=rumor.sha256;
      }else if(k.sourceVillage!==villageId||id!=="origin_"+villageId){
        throw fail("work_knowledge_not_adopted_here");
      }
      let repairEvidence;
      if(k.repairEvidence){
        const rumor=this.world.square.read(k.parentRumorId);
        if(k.rumorSha256!==rumor.sha256||stable(k.repairEvidence)!==stable(rumor.repairEvidence))
          throw fail("work_knowledge_provenance_changed");
        repairEvidence=validateRepairEvidence(k.repairEvidence);
      }
      return {id:k.id,text:k.text,textSha256:sha(k.text),sourceVillage:k.sourceVillage,
        parentRumorId:k.parentRumorId,rumorSha256,adoptedIn:villageId,
        ...(repairEvidence?{repairEvidence}:{})};
    });
  }
  #checkBindings(w){
    if(JSON.stringify(this.#source(w.villageId,w.sourceMessage.id))!==JSON.stringify(w.sourceMessage))
      throw fail("work_source_changed");
    if(JSON.stringify(this.#knowledge(w.villageId,w.knowledge.map(k=>k.id)))!==JSON.stringify(w.knowledge))
      throw fail("work_adopted_knowledge_changed");
  }
  #syncJournal(w,j){
    if(w.externalRepair||w.projectRepair)return;
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
  #draft(w,body,summary){
    if(w.stage!=="candidate_verified"||w.result?.status!=="verified_candidate")
      throw fail("work_verified_result_required_for_share");
    if(w.projectRepair){
      const v=w.projectRepair.verification;
      if(!v)throw fail("work_verified_project_evidence_required");
      const rumor=createRumor({originVillage:w.villageId,
        parentRumorId:[...(w.projectHistory||[])].reverse().find(e=>e.snapshot.publication?.status==="published")?.snapshot.publication.rumor.id??
          w.knowledge.find(k=>k.parentRumorId)?.parentRumorId??null,
        body:body??"登録済みプロジェクトの検証済み修復候補。適用条件と検証根拠を確認してください。公開main未変更。",
        ...(summary?{repairEvidence:repairEvidenceFor(w,summary)}:{})});
      w.sharingCandidate={status:"human_review_required",body:rumor.body,workId:w.id,runId:w.runId,rumor,
        evidence:{scope:"registered_project_coding_agent",candidateCommit:v.candidateCommit,diffSha256:v.diffSha256,
          verificationDigest:v.evidenceDigest,productionChanged:false}};
      return;
    }
    if(w.externalRepair){
      validateExternalRecord(w);const t=w.externalRepair,v=t.verifications.at(-1);
      if(t.status!=="verified")throw fail("independent_worker_verification_required");
      const rumor=createRumor({originVillage:w.villageId,
        parentRumorId:w.knowledge.find(k=>k.parentRumorId)?.parentRumorId??null,
        ...(summary?{repairEvidence:repairEvidenceFor(w,summary)}:{}),
        body:body??`外部修復ワーカーの候補 ${v.candidateCommit.slice(0,12)}。元の再現と回帰を独立検証。元checkout未反映、共有・採用は人の確認待ち。`});
      w.sharingCandidate={status:"human_review_required",body:rumor.body,workId:w.id,runId:w.runId,rumor,
        evidence:{scope:"human_reviewed_external_worker",requestDigest:t.request.requestDigest,
          baseCommit:v.baseCommit,candidateCommit:v.candidateCommit,diffSha256:v.diffSha256,
          verificationId:v.id,evidenceDigest:v.evidenceDigest,productionChanged:false}};
      return;
    }
    const last=w.attempts.at(-1);
    const text=body??(`教材2ファイルの修復候補。`+
      `公開検査=${last?.publicPassed===true?"PASS":"未確認"}、確認検査=${last?.holdoutPassed===true?"PASS":"未確認"}。本番未適用、汎用性未検証。`);
    const rumor=createRumor({originVillage:w.villageId,body:text,
      ...(summary?{repairEvidence:repairEvidenceFor(w,summary)}:{}),
      parentRumorId:w.knowledge.find(k=>k.parentRumorId)?.parentRumorId??null});
    w.sharingCandidate={status:"human_review_required",body:rumor.body,workId:w.id,runId:w.runId,rumor,
      evidence:{sourceMessageId:w.sourceMessage.id,sourceBodySha256:w.sourceMessage.bodySha256,
        knowledgeIds:w.knowledge.map(k=>k.id),attemptCount:w.attempts.length,
        candidateDigest:last?.candidateDigest??null,productionChanged:false,
        scope:"first_party_disposable_two_file_fixture_only"}};
  }
  /** Read-only seed projection: never syncs project state back into old work. */
  inheritanceSource({villageId,workId=null}={}){
    this.#runtime(villageId);
    const read=id=>{
      const saved=readCheckpoint(this.#path(villageId,id));
      if(!saved)throw fail("work_not_found_in_village");
      return clone(validateWork(saved,villageId,id));
    };
    const works=this.#ids(villageId).map(read).sort((a,b)=>b.createdAt-a.createdAt);
    const knowledge=this.world.villages[villageId].knowledge.slice(-30).flatMap(item=>this.#knowledge(villageId,[item.id]));
    return {villageId,works:works.map(item=>({id:item.id,goal:item.goal,stage:item.stage})),
      work:workId===null?null:read(workId),knowledge};
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
      nextAction:w.nextAction,runId:w.runId,attemptsCount:w.projectRepair?.attemptCount??w.attempts.length})),
      work:workId?this.#read(villageId,workId):works[0]??null,
      limits:{fixtureOnly:this.projectSessions.plans.size===0,registeredProjects:this.projectSessions.plans.size>0,
        automaticResume:false,gatewayDoneMeans:"delivery_only",sourceAuthentication:false}};
  }
  create(input){
    fields(input,["action","villageId","goal","sourceMessageId","knowledgeIds"]);
    const {villageId,goal,sourceMessageId,knowledgeIds=[]}=input;
    this.requireActive(villageId);
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
    // Match the runner's UTF-8 context budget before saving an unusable work.
    // Retain complete selected evidence; never silently truncate its provenance.
    if(Buffer.byteLength(stable(w.incidentContext),"utf8")>12288)
      throw fail("work_context_too_large_choose_fewer_knowledge");
    w.identityDigest=digestContext(w);
    this.#save(w);
    return {work:clone(w)};
  }
  prepareShare(input,{operator=false}={}){
    fields(input,["action","villageId","workId","body","repairSummary"]);
    this.requireActive(input.villageId);
    const w=this.#read(input.villageId,input.workId);
    if(w.projectRepair&&operator!==true)throw fail("project_operator_capability_required");
    this.#checkBindings(w);
    if(w.publication)throw fail("work_publication_draft_frozen");
    if(typeof input.body!=="string"||!input.body.trim()||input.body.length>320)
      throw fail("invalid_work_sharing_body");
    this.#refreshVerifiedEvidence(w);
    this.#draft(w,input.body,input.repairSummary);
    this.#save(w);
    return {work:clone(w),candidate:clone(w.sharingCandidate)};
  }
  #refreshVerifiedEvidence(w){
    if(w.projectRepair){
      const session=this.#boundProject(w);
      if(session?.status==="pouc_running")throw fail("project_pouc_operation_active");
      this.#syncProject(w,session);return;
    }
    if(w.externalRepair){validateExternalRecord(w);return;}
    const journal=readCheckpoint(this.#journalPath(w));
    if(!journal||journal.status!=="verified_candidate")throw fail("work_verified_journal_required");
    this.#syncJournal(w,journal);
  }
  publishShare(input,{operator=false}={}){
    fields(input,["action","villageId","workId","reviewedRumorSha256","allowPublish"]);
    this.requireActive(input.villageId);
    if(input.allowPublish!==true||!hash(input.reviewedRumorSha256))
      throw fail("explicit_work_publication_review_required");
    const w=this.#read(input.villageId,input.workId);
    if(w.projectRepair&&operator!==true)throw fail("project_operator_capability_required");
    this.#checkBindings(w);this.#refreshVerifiedEvidence(w);
    // Revalidate the binding after journal reconciliation, before any shared write.
    validateWork(w,w.villageId,w.id);
    const r=w.sharingCandidate?.rumor;
    if(r?.schemaVersion!=="metron-rumor-v2"||r.sha256!==input.reviewedRumorSha256)
      throw fail("reviewed_work_rumor_changed_or_missing");
    if(w.publication?.status==="published"){
      const saved=this.world.square.read(r.id);
      if(stable(saved)!==stable(r))throw fail("published_work_rumor_changed");
      return {work:clone(w),rumor:saved,state:this.world.state(),duplicate:true};
    }
    // Durable exact-payload intent precedes publication. Restart only reads it;
    // an uncertain outcome needs this same explicitly reviewed request again.
    if(!w.publication){
      w.publication={schemaVersion:1,status:"intent",rumor:clone(r),rumorSha256:r.sha256,
        intentAt:Date.now(),completedAt:null};
      this.#save(w);
    }
    const finish=result=>{
      // Other permitted project operations may complete while child IPC is pending.
      const current=this.#read(w.villageId,w.id);
      if(!current.publication||current.publication.rumorSha256!==r.sha256||
         stable(current.publication.rumor)!==stable(r)||current.sharingCandidate?.rumor?.sha256!==r.sha256)
        throw fail("work_publication_intent_changed");
      if(current.publication.status!=="published"){
        current.publication.status="published";current.publication.completedAt=Date.now();this.#save(current);
      }
      return {work:clone(current),...result};
    };
    const result=this.world.publishPreparedRumor(r);
    return result&&typeof result.then==="function"?result.then(finish):finish(result);
  }
  async run(input){
    fields(input,["action","villageId","workId","provider","allowExternalCalls"]);
    this.requireActive(input.villageId);
    const w=this.#read(input.villageId,input.workId),key=w.villageId+":"+w.id;
    if(w.projectRepair)throw fail("registered_project_explicit_workflow_required");
    if(w.externalRepair)throw fail("external_worker_explicit_workflow_required");
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
  #workerWork(input,allowed){
    fields(input,["action","villageId","workId",...allowed]);
    if(input.action!=="worker-review")this.requireActive(input.villageId);
    const w=this.#read(input.villageId,input.workId);
    if(w.projectRepair)throw fail("registered_project_explicit_workflow_required");
    if(this.active.has(w.villageId+":"+w.id)||w.stage==="running")throw fail("work_run_already_active");
    this.#checkBindings(w);return w;
  }
  exportWorker(input){
    const w=this.#workerWork(input,["planId","allowWorker","symptom","reproduction","evidence"]);
    if(TERMINAL.has(w.stage)&&!w.externalRepair)throw fail("work_result_requires_review_not_rerun");
    const {action,...body}=input,request=this.externalWorker.export(w,body);
    if(!w.executions.some(x=>x.workerRequestId===request.requestId))w.executions.push({
      id:"exec_"+randomUUID().replaceAll("-",""),requestedProvider:"external-worker",
      workerRequestId:request.requestId,workerConsent:true,externalConsent:false,
      status:"exported",authority:"explicit_local_operator_request",startedAt:Date.now()});
    w.scope="human_reviewed_external_worker";this.#save(w);return {work:clone(w),request};
  }
  importWorker(input){
    const w=this.#workerWork(input,["report"]);
    try{
      const imported=this.externalWorker.import(w,input.report);this.#save(w);
      return {work:clone(w),...imported};
    }catch(error){
      if(w.externalRepair&&w.externalRepair.history.length<100){
        w.externalRepair.history.push({action:"import_rejected",reason:error.code||"invalid_worker_report",at:Date.now()});this.#save(w);
      }
      throw error;
    }
  }
  reviewWorker(input){
    const w=this.#workerWork(input,[]);return this.externalWorker.review(w);
  }
  async verifyWorker(input){
    const w=this.#workerWork(input,["reviewedDiffSha256","allowValidation","verifier"]),key=w.villageId+":"+w.id;
    this.active.add(key);
    const task=this.externalWorker.verify(w,input,()=>this.#save(w));this.externalTasks.add(task);
    try{
      const verification=await task;
      if(verification.status==="verified"&&!w.sharingCandidate)this.#draft(w);
      this.#save(w);return {work:clone(w),verification};
    }finally{this.active.delete(key);this.externalTasks.delete(task);}
  }
  #projectProof(session,verification=session.verification){
    if(!verification||verification.status!=="verified")return null;
    const attempt=session.attempts.find(item=>item.verification?.id===verification.id);
    if(!attempt||attempt.report?.candidateCommit!==verification.candidateCommit||
       !attempt.publicResult?.passed||!attempt.acceptanceResult?.passed||!hash(verification.evidenceDigest))
      throw fail("work_verified_project_evidence_required");
    const checks=[];
    for(const [name,result] of [["baseline",session.baseline],["public",attempt.publicResult],["acceptance",attempt.acceptanceResult]])
      for(const [index,check] of (result?.checks||[]).entries())checks.push({id:name+"_"+index,
        outcome:name==="baseline"?"expected_failure":"passed",outputSha256:check.outputSha256});
    return {id:verification.id,candidateCommit:verification.candidateCommit,diffSha256:verification.diffSha256,
      evidenceDigest:verification.evidenceDigest,modelProvenance:"existing_registered_coding_worker",checks};
  }
  #checkProjectHistory(w){
    for(const entry of w.projectHistory||[]){
      const prior={...clone(w),...clone(entry.snapshot),stage:"candidate_verified"};delete prior.projectHistory;
      const before=stable(projectSnapshot(prior)),session=this.#boundProject(prior);
      if(!session)throw fail("work_project_history_session_missing");
      this.#syncProject(prior,session);
      if(stable(projectSnapshot(prior))!==before)throw fail("work_project_history_changed");
      if(prior.publication&&stable(this.world.square.read(prior.publication.rumor.id))!==stable(prior.publication.rumor))
        throw fail("work_project_history_publication_changed");
    }
  }
  #boundProject(w){
    const p=w.projectRepair;if(!p)throw fail("work_project_binding_required");
    if(this.projectSessions.plans.get(p.projectId)?.planDigest!==p.planDigest)
      throw fail("registered_project_plan_missing_or_changed");
    let session=null;
    if(p.sessionId)session=this.projectSessions.state({sessionId:p.sessionId,operator:true});
    else{
      const files=readdirSync(this.projectSessions.root).filter(name=>/^agent_[a-f0-9]{32}\.json$/.test(name));
      if(files.length>100)throw fail("project_session_capacity_reached");
      for(const name of files){
        const value=this.projectSessions.state({sessionId:name.slice(0,-5),operator:true});
        if(value.villageId===w.villageId&&value.workId===w.id&&value.projectId===p.projectId&&value.planDigest===p.planDigest){
          if(session)throw fail("work_project_binding_conflict");session=value;
        }
      }
    }
    if(!session)return null;
    if(session.villageId!==w.villageId||session.workId!==w.id||session.runId!==w.runId||
       session.workIdentityDigest!==w.identityDigest||session.projectId!==p.projectId||session.planDigest!==p.planDigest||
       session.goal!==w.goal||stable(session.incidentContext)!==stable(w.incidentContext)||
       p.historyLength>session.history.length)throw fail("work_project_binding_changed");
    if(p.revision?session.revision?.previousSessionId!==p.revision.previousSessionId||
        session.revision.previousCandidateCommit!==p.revision.reviewedPreviousCandidate||session.revision.requirements!==p.revision.requirements||
        session.symptom!==p.revision.symptom||stable(session.evidence)!==stable(p.revision.evidence):Boolean(session.revision))
      throw fail("work_project_revision_binding_changed");
    if(p.verification){
      const saved=session.attempts.find(item=>item.verification?.id===p.verification.id)?.verification;
      if(stable(this.#projectProof(session,saved))!==stable(p.verification))throw fail("work_project_verification_changed");
    }
    if(p.pouc?.status==="verified"&&stable(p.pouc)!==stable(projectPoUC(session)))
      throw fail("work_project_pouc_changed");
    return session;
  }
  #syncProject(w,session){
    const p=w.projectRepair;
    if(!session){
      p.status="start_outcome_unknown";w.stage="interrupted";w.nextAction="inspect_project_start_before_explicit_retry";
      return;
    }
    p.sessionId=session.id;p.status=session.status;p.historyLength=session.history.length;p.attemptCount=session.workAttemptCount??session.attempts.length;
    p.bindingDigest=projectBinding(w,p);
    const last=session.attempts.at(-1),verified=session.verification?.status==="verified"&&
      last?.verification?.id===session.verification.id;
    const proof=verified?this.#projectProof(session):null;
    if(w.publication&&stable(proof)!==stable(p.verification))throw fail("work_project_published_candidate_changed");
    p.verification=proof;
    if(session.pouc)p.pouc=projectPoUC(session);
    p.application=session.application?{targetKind:"registered_isolated_apply_root",
      status:session.status,
      head:(session.status==="rolled_back"?session.rollback?.readback?.head:
        Object.hasOwn(session.application,"observedAfterRestart")?session.application.observedAfterRestart?.head:
          session.application.readback?.head)??null}:null;
    w.scope="registered_project_coding_agent";w.verificationPending=false;
    if(proof){
      w.stage="candidate_verified";w.nextAction="inspect_registered_candidate_and_prepare_share";
      w.result={status:"verified_candidate",runId:w.runId,scope:w.scope,candidateCommit:proof.candidateCommit,
        diffSha256:proof.diffSha256,verificationId:proof.id,verificationDigest:proof.evidenceDigest,
        modelProvenance:proof.modelProvenance,readbackVerified:true,productionChanged:false,approved:false,
        registeredApplication:clone(p.application)};
      if(!w.sharingCandidate)this.#draft(w);
    }else{
      if(w.publication)throw fail("work_project_published_candidate_changed");
      w.result=null;w.sharingCandidate=null;
      w.stage=({not_reproduced:"not_reproduced",candidate_rejected:"candidate_rejected",
        attempt_budget_exhausted:"attempt_budget_exhausted",worker_active:"running",baseline_running:"running",
        validating:"running",preparing_workspace:"running",cancelled:"blocked"})[session.status]||"unresolved";
      w.nextAction="project_"+session.status;
    }
  }
  projectState({sessionId,dispatchToken,operator=false}={}){
    const view=this.projectSessions.state({sessionId,dispatchToken,operator});
    const actual=operator?view:this.projectSessions.state({sessionId,operator:true});
    const w=this.#read(actual.villageId,actual.workId);
    const offline=this.world.isDynamic?.(actual.villageId)&&!this.#runtime(actual.villageId).available;
    if(!offline)this.#checkBindings(w);
    if(w.projectRepair?.sessionId!==sessionId)throw fail("work_project_binding_changed");
    return operator?{...view,work:clone(w),...(offline?{villageTransportAvailable:false,
      runtimeWarnings:["Saved session only; explicitly restart the village before advancing work"]}:{})}:view;
  }
  async projectAction(input,{operator=false}={}){
    if(!input||typeof input!=="object"||Array.isArray(input))throw fail("invalid_work_project_action");
    const workerActions=new Set(["claim","heartbeat","report","ack-stop"]);
    if(operator!==true&&!workerActions.has(input.action))throw fail("project_operator_capability_required");
    if(["start","revise"].includes(input.action))this.requireActive(input.villageId);
    if(input.action==="revise"){
      fields(input,["action","villageId","workId",...revisionRequestKeys,"allowRevision"]);
      if(input.allowRevision!==true)throw fail("explicit_project_requirements_revision_required");
      const request=Object.fromEntries(revisionRequestKeys.map(k=>[k,clone(input[k])]));
      if(!validRevision(request))throw fail("invalid_work_project_revision");
      const w=this.#read(input.villageId,input.workId),key=w.villageId+":"+w.id;
      this.#checkBindings(w);
      if(this.active.has(key)||w.externalRepair||!w.projectRepair)throw fail("work_project_revision_conflict");
      const plan=this.projectSessions.plans.get(request.projectId);
      if(!plan)throw fail("registered_project_plan_missing_or_changed");
      const retry=stable(w.projectRepair.revision)===stable(request);
      if(!retry){
        const previous=this.#boundProject(w),proof=w.projectRepair.verification;
        if(!previous||previous.id!==request.previousSessionId||!proof||proof.candidateCommit!==request.reviewedPreviousCandidate||
           !["candidate_verified","applied_verified","rolled_back"].includes(previous.status)||previous.terminationUnconfirmed||
           w.publication?.status==="intent"||w.projectRepair.projectId===plan.id)
          throw fail("work_project_revision_conflict");
        if((w.projectHistory||[]).length>=2)throw fail("work_project_revision_depth_exhausted");
        if((previous.workAttemptCount??previous.attempts.length)>=3)throw fail("project_attempt_budget_exhausted");
        // Reject invalid owner registrations before archiving or clearing the
        // current success. The session service repeats this proof at start.
        inspectRegisteredProjectRevision(this.projectSessions.plans.get(w.projectRepair.projectId),plan,
          {previousCandidateCommit:proof.candidateCommit});
        const entry={schemaVersion:1,version:(w.projectHistory||[]).length+1,snapshot:projectSnapshot(w)};
        entry.digest=historyDigest(w,entry);(w.projectHistory??=[]).push(entry);
        w.projectRepair={schemaVersion:1,sessionId:null,projectId:plan.id,planDigest:plan.planDigest,status:"start_intent",
          attemptCount:previous.workAttemptCount??previous.attempts.length,historyLength:0,verification:null,application:null,
          revision:request,bindingDigest:null};
        w.projectRepair.bindingDigest=projectBinding(w,w.projectRepair);
        w.result=null;w.sharingCandidate=null;w.publication=null;w.scope="registered_project_coding_agent";
        w.verificationPending=false;w.stage="running";w.nextAction="wait_for_project_revision_baseline";this.#save(w);
      }
      this.active.add(key);
      try{
        const result=await this.projectSessions.startRevision({...request,allowRevision:true});
        this.#syncProject(w,result.session);this.#save(w);return {...result,work:clone(w)};
      }finally{
        this.active.delete(key);this.#syncProject(w,this.#boundProject(w));this.#save(w);
      }
    }
    if(input.action==="start"){
      fields(input,["action","villageId","workId","projectId","symptom","evidence","allowStart"]);
      if(typeof input.symptom!=="string"||!input.symptom.trim()||input.symptom.length>2000||
         !Array.isArray(input.evidence)||input.evidence.length>10||
         input.evidence.some(value=>typeof value!=="string"||!value.trim()||value.length>1000))
        throw fail("invalid_registered_project_start");
      const w=this.#read(input.villageId,input.workId),key=w.villageId+":"+w.id;
      this.#checkBindings(w);
      if(w.externalRepair||this.active.has(key)||(!w.projectRepair&&(w.stage==="running"||TERMINAL.has(w.stage)||w.attempts.length)))
        throw fail("work_project_start_conflict");
      const plan=this.projectSessions.plans.get(input.projectId);
      if(!plan)throw fail("registered_project_plan_missing_or_changed");
      if(w.projectRepair&&w.projectRepair.projectId!==input.projectId)throw fail("work_project_binding_conflict");
      if(input.allowStart!==true)throw fail("explicit_registered_project_start_required");
      if(!w.projectRepair){
        w.projectRepair={schemaVersion:1,sessionId:null,projectId:plan.id,planDigest:plan.planDigest,status:"start_intent",
          attemptCount:0,historyLength:0,verification:null,application:null,bindingDigest:null};
        w.projectRepair.bindingDigest=projectBinding(w,w.projectRepair);
        w.scope="registered_project_coding_agent";w.stage="running";w.nextAction="wait_for_project_baseline";this.#save(w);
      }
      this.active.add(key);
      try{
        const result=await this.projectSessions.start({villageId:w.villageId,workId:w.id,runId:w.runId,
          workIdentityDigest:w.identityDigest,goal:w.goal,incidentContext:clone(w.incidentContext),projectId:plan.id,
          symptom:input.symptom,evidence:input.evidence,allowStart:input.allowStart});
        this.#syncProject(w,result.session);this.#save(w);return {...result,work:clone(w)};
      }finally{
        this.active.delete(key);
        this.#syncProject(w,this.#boundProject(w));this.#save(w);
      }
    }
    const routes={claim:["claim",["dispatchToken","workerId","claimId"]],heartbeat:["heartbeat",["leaseToken"]],
      report:["report",["leaseToken","report"]],"ack-stop":["acknowledgeStop",["leaseToken"]],review:["review",[]],
      validate:["validate",["reviewedDiffSha256","verifier","allowValidation"]],cancel:["cancel",["reason"]],
      resume:["resume",["allowResume"]],apply:["apply",["candidateCommit","diffSha256","verificationId","expectedHead","reviewer","allowApply"]],
      pouc:["reverifyUsefulWork",["candidateCommit","diffSha256","verificationId","reviewer","allowPoUC"]],
      rollback:["rollback",["expectedHead","reviewer","allowRollback"]]};
    const route=routes[input.action];if(!route)throw fail("invalid_work_project_action");
    fields(input,["action","sessionId",...route[1]]);
    const session=this.projectSessions.state({sessionId:input.sessionId,operator:true});
    if(!["cancel","ack-stop","report"].includes(input.action))this.requireActive(session.villageId);
    const w=this.#read(session.villageId,session.workId);
    // Cancellation and lease reconciliation must work even if transport is unavailable.
    if(!["cancel","ack-stop","report"].includes(input.action))this.#checkBindings(w);
    if(w.projectRepair?.sessionId!==session.id)throw fail("work_project_binding_changed");
    if(w.publication&&input.action==="resume")throw fail("work_publication_draft_frozen");
    if(w.publication?.status==="intent"&&input.action==="pouc")throw fail("work_publication_outcome_unconfirmed");
    const {action,...body}=input,result=await this.projectSessions[route[0]](body);
    // PoUC must not rewrite an existing shared payload or a concurrently saved work.
    const current=input.action==="pouc"?this.#read(w.villageId,w.id):w;
    this.#syncProject(current,this.#boundProject(current));this.#save(current);
    if(!operator)return result;
    return result?.session||input.action==="review"?{...result,work:clone(current)}:{session:result,work:clone(current)};
  }
  async waitForIdle(){await Promise.allSettled([...this.externalTasks,this.projectSessions.waitForIdle()]);}
}
