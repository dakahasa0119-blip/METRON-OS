/** Durable, project-bound sessions for an existing authorized coding worker.
 * This transports real work; it does not invent a model or launch a CLI.
 * Worker reports are claims. Fixed checks on immutable commits establish
 * candidate verification. Operator capabilities protect validation/application.
 */
import {mkdirSync,readdirSync,openSync,closeSync,writeFileSync,unlinkSync} from "node:fs";
import {join} from "node:path";
import {randomBytes,randomUUID,createHash,timingSafeEqual} from "node:crypto";
import {readCheckpoint,writeAtomicJson} from "../reusable/gateway-jobs/checkpoint.mjs";
import {projectPlanPublic,createRegisteredAttempt,inspectRegisteredCandidate,runRegisteredChecks,
  applyRegisteredCandidate,rollbackRegisteredCandidate,inspectRegisteredApply,inspectRegisteredProjectRevision} from "./project-tools.mjs";
import {ProjectPoUCLedger} from "./project-pouc.mjs";

const sha=s=>createHash("sha256").update(s).digest("hex");
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=x=>sha(stable(x));
const clone=x=>structuredClone(x);
const fail=code=>Object.assign(new Error(code),{code});
const id=(prefix)=>prefix+randomUUID().replaceAll("-","");
const hash=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const commit=x=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x);
const label=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const bounded=(s,n)=>typeof s==="string"&&s.trim().length>0&&s.length<=n;
const equal=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.length===b.length&&
  timingSafeEqual(Buffer.from(a),Buffer.from(b));
const exact=(v,keys)=>{if(!v||typeof v!=="object"||Array.isArray(v)||
  Object.keys(v).some(k=>!keys.includes(k)))throw fail("invalid_project_session_request");};
const TERMINAL=new Set(["not_reproduced","candidate_rejected","attempt_budget_exhausted","applied_verified","rolled_back"]);
const MAX_ATTEMPTS=3;
const registrationDigest=p=>digest([p.repositoryRoot,p.commonRoot,p.baselineRoot,p.candidateRoot,
  p.applyRoot,p.evidenceRoot,p.tempRoot,p.acceptanceRoot]);
const reproducedBaseline=baseline=>baseline?.checks?.length>0&&
  baseline.checks.some(c=>c.exitCode===1&&c.testSummary?.fail>0)&&
  baseline.checks.every(c=>!c.error&&!c.timedOut&&c.terminationConfirmed&&
    c.testSummary?.cancelled===0&&c.testSummary?.skipped===0)&&!baseline.terminationUnconfirmed;
const binding=s=>digest([s.villageId,s.workId,s.runId,s.workIdentityDigest,s.projectId,s.planDigest,
  s.goal,s.incidentContext,s.symptom,s.evidence,...(s.revision?[s.revision]:[])]);
const verificationDigest=(s,a,v)=>{
  const proof=clone(v);delete proof.evidenceDigest;
  return digest({verification:proof,baseline:s.baseline,publicResult:a.publicResult,acceptanceResult:a.acceptanceResult??null});
};
const poucSubject=s=>({projectId:s.projectId,planDigest:s.planDigest,
  candidateCommit:s.verification.candidateCommit,diffSha256:s.verification.diffSha256});
const poucBinding=(s,p)=>digest({session:binding(s),verificationId:s.verification.id,
  verificationDigest:s.verification.evidenceDigest,computationDigest:p.computationDigest,proofDigest:p.proofDigest});
const feedbackFor=value=>value?{passed:value.passed,checks:(value.checks||[]).map(c=>({
  id:c.id,exitCode:c.exitCode,error:c.error,timedOut:c.timedOut,terminationConfirmed:c.terminationConfirmed,
  outputSha256:c.outputSha256,testSummary:clone(c.testSummary??null),
  output:String(c.output||"").slice(-16000)}))}:null;

export class RegisteredProjectSessions {
  constructor({root,plans=[],now=Date.now,isVillage=id=>["village-1","village-2"].includes(id)}={}){
    this.root=root;this.now=now;this.isVillage=isVillage;this.plans=new Map(plans.map(p=>[p.id,p]));
    if(typeof root!=="string"||!root||typeof isVillage!=="function"||plans.length>8||this.plans.size!==plans.length)
      throw fail("invalid_project_session_registry");
    mkdirSync(root,{recursive:true});this.active=new Map();this.tasks=new Set();this.poucLedger=null;
    // Starting ordinary Mini without a registry must preserve this ledger. Its
    // project operations remain unavailable until the owner restores the plan.
    for(const sessionId of (plans.length?this.#ids():[])){
      const s=this.#read(sessionId);
      if(s.status==="worker_active"){
        s.status="worker_outcome_unknown";
        s.attempts.at(-1).status="worker_outcome_unknown";
        this.#event(s,"restart_requires_explicit_worker_resume");this.#save(s);
      }else if(["baseline_running","validating","pouc_running"].includes(s.status)){
        if(s.status==="pouc_running")s.pouc={...s.pouc,status:"interrupted",completedAt:this.now(),reason:"restart_requires_validator_reconciliation"};
        s.interruptedOperation=s.status;s.status="validation_interrupted";
        s.terminationUnconfirmed=true;this.#event(s,"restart_quarantines_unconfirmed_validator");this.#save(s);
      }else if(["applying","rolling_back"].includes(s.status)){
        const p=this.#plan(s);let observed;
        try{observed=inspectRegisteredApply(p);}catch{observed={head:null,clean:false};}
        s.application??={};s.application.observedAfterRestart=observed;
        s.status=observed.clean&&observed.head===s.verification?.candidateCommit?"applied_unverified":"application_unresolved";
        s.terminationUnconfirmed=true;
        this.#event(s,"restart_never_applies_or_rolls_back");this.#save(s);
      }
    }
  }
  #ids(){
    const files=readdirSync(this.root).filter(x=>/^agent_[a-f0-9]{32}\.json$/.test(x));
    if(files.length>100)throw fail("project_session_capacity_reached");
    return files.map(x=>x.slice(0,-5));
  }
  #path(sessionId){if(!/^agent_[a-f0-9]{32}$/.test(sessionId||""))throw fail("invalid_project_session_id");return join(this.root,sessionId+".json");}
  #read(sessionId,seen=new Set()){
    if(seen.has(sessionId)||seen.size>2)throw fail("project_revision_lineage_invalid");
    seen=new Set(seen);seen.add(sessionId);
    const s=readCheckpoint(this.#path(sessionId));
    if(!s||s.schemaVersion!==1||s.id!==sessionId||!hash(s.dispatchToken)||!hash(s.planDigest)||
       !Array.isArray(s.attempts)||s.attempts.length>MAX_ATTEMPTS||!Array.isArray(s.history)||s.history.length>256||
       s.bindingDigest!==binding(s))
      throw fail("invalid_project_session_checkpoint");
    const p=this.#plan(s);
    if(new Set(s.attempts.map(a=>a.id)).size!==s.attempts.length||s.attempts.some((a,i)=>
       !/^attempt_[a-f0-9]{32}$/.test(a.id||"")||a.number!==i+1||!commit(a.parentCommit)||
       (a.report&&a.reportDigest!==digest(a.report))||
       (a.verification?.evidenceDigest&&a.verification.evidenceDigest!==verificationDigest(s,a,a.verification))))
      throw fail("invalid_project_session_attempt_proof");
    if(s.verification){
      const v=s.verification,a=s.attempts.find(x=>x.id===v.attemptId);
      if(!a||!reproducedBaseline(s.baseline)||v.status!=="verified"||v.planDigest!==p.planDigest||
         v.candidateCommit!==a.report?.candidateCommit||v.diffSha256!==a.observed?.diffSha256||
         !a.publicResult?.passed||!a.acceptanceResult?.passed||
         stable(v)!==stable(a.verification)||v.evidenceDigest!==verificationDigest(s,a,v))
        throw fail("invalid_project_session_verification_proof");
    }
    if(["candidate_verified","applying","applied_verified","applied_unverified","rolling_back","rolled_back"].includes(s.status)&&!s.verification)
      throw fail("project_session_verification_missing");
    if(s.pouc){
      const p=s.pouc;
      exact(p,["schemaVersion","status","attempts","verificationId","previousStatus","reviewer","startedAt","completedAt",
        "reason","computationDigest","proofDigest","bindingDigest","deduplicated"]);
      if(p.schemaVersion!==1||!["running","verified","rejected","cancelled","interrupted"].includes(p.status)||
         !Number.isInteger(p.attempts)||p.attempts<1||p.attempts>3||!s.verification||
         p.verificationId!==s.verification.id||!["candidate_verified","applied_verified","rolled_back"].includes(p.previousStatus)||
         !bounded(p.reviewer,120)||!Number.isSafeInteger(p.startedAt)||
         (p.status==="running"?s.status!=="pouc_running":!Number.isSafeInteger(p.completedAt)))
        throw fail("invalid_project_pouc_checkpoint");
      if(p.status==="verified")this.#poucReceipt(s);
      else if(p.proofDigest!==undefined||p.computationDigest!==undefined||p.bindingDigest!==undefined)
        throw fail("invalid_project_pouc_checkpoint");
    }
    if(s.status==="pouc_running"&&s.pouc?.status!=="running")throw fail("invalid_project_pouc_checkpoint");
    if(s.revision){
      const r=s.revision;
      exact(r,["scenario","previousSessionId","previousCandidateCommit","previousVerificationId",
        "previousVerificationDigest","requirements","requirementDiffSha256","depth"]);
      if(r.scenario!=="requirements_added"||!bounded(r.requirements,2000)||r.requirements!==r.requirements.trim()||
         !commit(r.previousCandidateCommit)||!hash(r.previousVerificationDigest)||!hash(r.requirementDiffSha256)||
         !Number.isInteger(r.depth)||r.depth<1||r.depth>2)throw fail("project_revision_lineage_invalid");
      const previous=this.#read(r.previousSessionId,seen),v=previous.verification;
      if(!v||previous.terminationUnconfirmed||!["candidate_verified","applied_verified","rolled_back"].includes(previous.status)||
         r.previousCandidateCommit!==v.candidateCommit||r.previousVerificationId!==v.id||
         r.previousVerificationDigest!==v.evidenceDigest||r.depth!==(previous.revision?.depth??0)+1||
         stable([s.villageId,s.workId,s.runId,s.workIdentityDigest,s.goal,s.incidentContext])!==
         stable([previous.villageId,previous.workId,previous.runId,previous.workIdentityDigest,previous.goal,previous.incidentContext]))
        throw fail("project_revision_lineage_invalid");
      const proof=inspectRegisteredProjectRevision(this.#plan(previous),p,{previousCandidateCommit:r.previousCandidateCommit});
      if(proof.requirementDiffSha256!==r.requirementDiffSha256)throw fail("project_revision_lineage_invalid");
    }
    if(this.#successors(s.id).length>1)throw fail("project_revision_fork_conflict");
    if(this.#attemptCount(s)>MAX_ATTEMPTS)throw fail("project_attempt_budget_exhausted");
    return s;
  }
  #successors(sessionId){return this.#ids().filter(value=>readCheckpoint(this.#path(value))?.revision?.previousSessionId===sessionId);}
  #lineage(s){
    const records=[s];let current=s;
    while(current.revision){current=this.#read(current.revision.previousSessionId);records.push(current);}
    return records;
  }
  #attemptCount(s){
    // #read already validates ancestor depth/cycles before reaching this helper.
    let count=s.attempts.length,current=s;
    for(let depth=0;current.revision&&depth<2;depth++){
      current=readCheckpoint(this.#path(current.revision.previousSessionId));
      if(!current||!Array.isArray(current.attempts))throw fail("project_revision_lineage_invalid");
      count+=current.attempts.length;
    }
    return count;
  }
  #assertCurrent(s){if(this.#successors(s.id).length)throw fail("project_session_superseded");}
  #plan(s){
    const p=this.plans.get(s.projectId);
    if(!p||p.planDigest!==s.planDigest||s.registrationDigest!==registrationDigest(p))
      throw fail("registered_project_plan_missing_or_changed");
    return p;
  }
  #save(s){s.updatedAt=this.now();writeAtomicJson(this.#path(s.id),s);}
  #event(s,action,details={}){
    if(s.history.length>=256)throw fail("project_session_history_capacity_reached");
    s.history.push({action,at:this.now(),...details});
  }
  #poucLedger(){return this.poucLedger??=new ProjectPoUCLedger(this.root);}
  #poucReceipt(s){
    const p=s.pouc;
    if(!hash(p?.proofDigest)||!hash(p.computationDigest)||p.bindingDigest!==poucBinding(s,p))
      throw fail("project_pouc_binding_changed");
    const receipt=this.#poucLedger().lookup({computationDigest:p.computationDigest,proofDigest:p.proofDigest});
    if(stable(receipt.subject)!==stable(poucSubject(s)))throw fail("project_pouc_binding_changed");
    const attempt=s.attempts.find(a=>a.id===s.verification.attemptId);
    for(const [kind,result] of [["public",attempt.publicResult],["acceptance",attempt.acceptanceResult]]){
      if(receipt.original[kind].inputProof!==result.inputProofBefore||
         stable(receipt.original[kind].checks.map(c=>c.testSummary))!==stable(result.checks.map(c=>c.testSummary)))
        throw fail("project_pouc_binding_changed");
    }
    return receipt;
  }
  #operatorView(s){
    const value=clone(s);delete value.dispatchToken;
    delete value.registrationDigest;
    value.workAttemptCount=this.#attemptCount(s);
    for(const a of value.attempts)if(a.lease)delete a.lease.token;
    if(s.pouc?.status==="verified")value.pouc.receipt=this.#poucReceipt(s);
    return value;
  }
  #workerView(s){
    const a=s.attempts.at(-1);
    return {schemaVersion:1,sessionId:s.id,projectId:s.projectId,planDigest:s.planDigest,
      status:s.status,goal:s.goal,incidentContext:clone(s.incidentContext),
      symptom:s.symptom,evidence:clone(s.evidence),budget:{used:this.#attemptCount(s),max:MAX_ATTEMPTS},
      ...(s.revision?{revision:clone(s.revision)}:{}),
      attempt:a?{id:a.id,number:a.number,workAttemptNumber:this.#attemptCount(s),status:a.status,workerId:a.workerId,
        parentCommit:a.parentCommit,workspaceRoot:a.workspaceRoot,
        leaseExpiresAt:a.lease?.expiresAt??null,
        feedback:clone(a.feedback),candidateCommit:a.report?.candidateCommit??null}:null,
      scope:projectPlanPublic(this.#plan(s)),automaticAgentLaunch:false,
      acceptanceDisclosure:"terminal_status_only_no_hidden_tests_or_output",
      identity:"existing_worker_claim_not_model_authentication_attestation"};
  }
  state({sessionId,dispatchToken,operator=false}={}){
    const s=this.#read(sessionId);
    if(operator)return this.#operatorView(s);
    if(!equal(dispatchToken,s.dispatchToken))throw fail("project_worker_capability_required");
    return this.#workerView(s);
  }
  // Host controller only. Never expose this capability through an HTTP view.
  dispatchCapability({sessionId,operator=false}={}){
    if(operator!==true)throw fail("project_operator_capability_required");
    const s=this.#read(sessionId);this.#assertCurrent(s);
    return {dispatchToken:s.dispatchToken};
  }
  #assertIdle(s){
    this.#assertCurrent(s);
    if(this.active.has(s.id))throw fail("project_operation_already_active");
    if(s.terminationUnconfirmed)throw fail("project_execution_termination_unconfirmed");
  }
  #lease(s,token,{allowClosed=false}={}){
    const a=s.attempts.find(x=>equal(token,x.lease?.token));
    if(!a)throw fail("project_worker_lease_required");
    if(allowClosed)return a;
    if(a!==s.attempts.at(-1)||s.status!=="worker_active"||a.status!=="worker_active"||a.lease.status!=="active")
      throw fail("project_worker_lease_revoked");
    if(a.lease.expiresAt<=this.now()){
      a.status="worker_outcome_unknown";a.lease.status="expired";s.status="worker_outcome_unknown";
      this.#event(s,"worker_lease_expired_no_automatic_redispatch");this.#save(s);
      throw fail("project_worker_lease_expired");
    }
    return a;
  }
  async #task(s,operation){
    const controller=new AbortController();this.active.set(s.id,{controller,record:s});
    const task=operation(controller.signal);this.tasks.add(task);
    try{return await task;}finally{this.active.delete(s.id);this.tasks.delete(task);}
  }
  async start(input){
    exact(input,["villageId","workId","runId","workIdentityDigest","goal","incidentContext","projectId","symptom","evidence","allowStart"]);
    return this.#start(input);
  }
  async startRevision(input){
    exact(input,["previousSessionId","reviewedPreviousCandidate","projectId","requirements","symptom","evidence","allowRevision"]);
    if(input.allowRevision!==true)throw fail("explicit_project_requirements_revision_required");
    if(!bounded(input.requirements,2000)||input.requirements!==input.requirements.trim())throw fail("invalid_project_revision_requirements");
    const previous=this.#read(input.previousSessionId),p=this.plans.get(input.projectId),v=previous.verification;
    if(!p||!v||input.reviewedPreviousCandidate!==v.candidateCommit||
       !["candidate_verified","applied_verified","rolled_back"].includes(previous.status))throw fail("verified_project_predecessor_required");
    if(this.active.has(previous.id)||previous.terminationUnconfirmed)throw fail("project_execution_termination_unconfirmed");
    const depth=(previous.revision?.depth??0)+1;
    if(depth>2)throw fail("project_revision_depth_exhausted");
    const proof=inspectRegisteredProjectRevision(this.#plan(previous),p,{previousCandidateCommit:v.candidateCommit});
    const revision={scenario:"requirements_added",previousSessionId:previous.id,previousCandidateCommit:v.candidateCommit,
      previousVerificationId:v.id,previousVerificationDigest:v.evidenceDigest,requirements:input.requirements,
      requirementDiffSha256:proof.requirementDiffSha256,depth};
    return this.#start({villageId:previous.villageId,workId:previous.workId,runId:previous.runId,
      workIdentityDigest:previous.workIdentityDigest,goal:previous.goal,incidentContext:clone(previous.incidentContext),
      projectId:p.id,symptom:input.symptom,evidence:input.evidence,allowStart:true},revision);
  }
  async #start(input,revision=null){
    if(input.allowStart!==true)throw fail("explicit_registered_project_start_required");
    const p=this.plans.get(input.projectId);
    if(!p||!this.isVillage(input.villageId)||!/^work_[a-f0-9]{32}$/.test(input.workId||"")||
       !/^case_[a-f0-9]{32}$/.test(input.runId||"")||!hash(input.workIdentityDigest)||!bounded(input.goal,500)||
       !bounded(input.symptom,2000)||!Array.isArray(input.evidence)||input.evidence.length>10||
       input.evidence.some(x=>!bounded(x,1000))||!input.incidentContext||
       Buffer.byteLength(stable(input.incidentContext),"utf8")>12288)throw fail("invalid_registered_project_start");
    const predecessors=revision?new Set(this.#lineage(this.#read(revision.previousSessionId)).map(s=>s.id)):new Set();
    for(const oldId of this.#ids()){
      const old=this.#read(oldId);
      if(old.workId===input.workId&&old.villageId===input.villageId){
        if(predecessors.has(old.id))continue;
        if(old.projectId!==p.id||old.workIdentityDigest!==input.workIdentityDigest||old.runId!==input.runId||
           old.goal!==input.goal||stable(old.incidentContext)!==stable(input.incidentContext)||
           old.symptom!==input.symptom||stable(old.evidence)!==stable(input.evidence)||stable(old.revision??null)!==stable(revision))
          throw fail("project_work_binding_conflict");
        if(this.#successors(old.id).length)throw fail("project_session_superseded");
        return {session:this.#operatorView(old),dispatchToken:old.dispatchToken,duplicate:true};
      }
      if(old.projectId===p.id&&!TERMINAL.has(old.status)&&old.status!=="cancelled")
        throw fail("registered_project_has_an_open_incident");
    }
    if(revision&&this.#attemptCount(this.#read(revision.previousSessionId))>=MAX_ATTEMPTS)throw fail("project_attempt_budget_exhausted");
    if(this.#ids().length>=100)throw fail("project_session_capacity_reached");
    const s={schemaVersion:1,id:id("agent_"),projectId:p.id,planDigest:p.planDigest,registrationDigest:registrationDigest(p),
      villageId:input.villageId,workId:input.workId,runId:input.runId,workIdentityDigest:input.workIdentityDigest,
      goal:input.goal,incidentContext:clone(input.incidentContext),symptom:input.symptom,evidence:clone(input.evidence),
      dispatchToken:randomBytes(32).toString("hex"),status:"baseline_running",
      baseline:null,attempts:[],history:[],verification:null,application:null,createdAt:this.now(),updatedAt:this.now()};
    if(revision)s.revision=clone(revision);
    s.bindingDigest=binding(s);
    this.#event(s,revision?"explicit_requirements_revision":"explicit_project_start");this.#save(s);
    return this.#task(s,async signal=>{
      try{
      const baseline=await runRegisteredChecks(p,{kind:"baseline",commit:p.baseCommit,attemptId:s.id,signal});
      s.baseline=baseline;
      const reproduced=reproducedBaseline(baseline);
      if(baseline.terminationUnconfirmed){s.terminationUnconfirmed=true;s.status="validation_interrupted";}
      else if(s.cancelRequested)s.status="cancelled";
      else s.status=reproduced?"ready_worker":baseline.passed?"not_reproduced":"baseline_unconfirmed";
      this.#event(s,"baseline_finished",{reproduced});this.#save(s);
      }catch(error){
        s.status="validation_interrupted";s.terminationUnconfirmed=true;
        this.#event(s,"baseline_execution_unconfirmed",{reason:error.code||"baseline_failed"});this.#save(s);
      }
      return {session:this.#operatorView(s),dispatchToken:s.dispatchToken,duplicate:false};
    });
  }
  claim(input){
    exact(input,["sessionId","dispatchToken","workerId","claimId"]);
    const s=this.#read(input.sessionId);this.#assertIdle(s);
    if(!equal(input.dispatchToken,s.dispatchToken)||!label(input.workerId)||!label(input.claimId))
      throw fail("project_worker_claim_invalid");
    const prior=s.attempts.find(a=>a.claimId===input.claimId&&a.workerId===input.workerId);
    if(prior){
      this.#lease(s,prior.lease?.token);
      return {...this.#workerView(s),leaseToken:prior.lease.token,duplicate:true};
    }
    if(!["ready_worker","revision_ready"].includes(s.status))throw fail("project_not_ready_for_worker");
    if(!reproducedBaseline(s.baseline))throw fail("project_baseline_reproduction_required");
    if(this.#attemptCount(s)>=MAX_ATTEMPTS)throw fail("project_attempt_budget_exhausted");
    const p=this.#plan(s),last=s.attempts.at(-1);
    const a={id:id("attempt_"),number:s.attempts.length+1,status:"preparing_workspace",claimId:input.claimId,
      workerId:input.workerId,parentCommit:last?.report?.candidateCommit??p.baseCommit,workspaceRoot:null,
      lease:null,report:null,observed:null,feedback:feedbackFor(last?.publicResult??s.baseline)};
    s.attempts.push(a);s.status="preparing_workspace";this.#event(s,"attempt_workspace_intent",{attemptId:a.id});this.#save(s);
    try{
      const workspace=createRegisteredAttempt(p,{sessionId:s.id,attemptId:a.id,parentCommit:a.parentCommit});
      a.workspaceRoot=workspace.root;
      a.lease={token:randomBytes(32).toString("hex"),status:"active",issuedAt:this.now(),expiresAt:this.now()+300000};
      a.status="worker_active";s.status="worker_active";this.#event(s,"worker_claimed",{attemptId:a.id,workerId:a.workerId});
      this.#save(s);return {...this.#workerView(s),leaseToken:a.lease.token,duplicate:false};
    }catch(error){
      a.status="workspace_setup_interrupted";s.status="workspace_setup_interrupted";
      this.#event(s,"workspace_setup_failed",{reason:error.code||"workspace_setup_failed"});this.#save(s);throw error;
    }
  }
  heartbeat(input){
    exact(input,["sessionId","leaseToken"]);const s=this.#read(input.sessionId),a=this.#lease(s,input.leaseToken);
    this.#assertCurrent(s);
    a.lease.expiresAt=Math.min(this.now()+300000,a.lease.issuedAt+1800000);
    this.#save(s);return this.#workerView(s);
  }
  report(input){
    exact(input,["sessionId","leaseToken","report"]);const s=this.#read(input.sessionId);
    const r=input.report;exact(r,["reportId","candidateCommit","diagnosis","operations","unresolved"]);
    if(!label(r.reportId)||!commit(r.candidateCommit)||!bounded(r.diagnosis,2000)||
       !Array.isArray(r.operations)||r.operations.length>40||r.operations.some(x=>!bounded(x,1000))||
       !Array.isArray(r.unresolved)||r.unresolved.length>20||r.unresolved.some(x=>!bounded(x,1000)))
      throw fail("invalid_project_worker_report");
    const a=this.#lease(s,input.leaseToken,{allowClosed:true}),reportDigest=digest(r);
    if(a.report){
      if(a.reportDigest!==reportDigest)throw fail("project_report_id_conflict");
      return {session:this.#workerView(s),duplicate:true};
    }
    this.#lease(s,input.leaseToken);this.#assertIdle(s);
    const observed=inspectRegisteredCandidate(this.#plan(s),r.candidateCommit,{workerRoot:a.workspaceRoot});
    a.report=clone(r);a.reportDigest=reportDigest;a.observed=observed;
    a.lease.status="reported";a.status="awaiting_review";s.status="awaiting_review";
    this.#event(s,"candidate_reported_not_verified",{attemptId:a.id,candidateCommit:r.candidateCommit});this.#save(s);
    return {session:this.#workerView(s),duplicate:false};
  }
  review(input){
    exact(input,["sessionId"]);const s=this.#read(input.sessionId),a=s.attempts.at(-1);
    this.#assertIdle(s);
    if(!a?.report||s.status!=="awaiting_review")throw fail("project_candidate_review_required");
    const actual=inspectRegisteredCandidate(this.#plan(s),a.report.candidateCommit,{workerRoot:a.workspaceRoot});
    if(actual.diffSha256!==a.observed.diffSha256)throw fail("project_candidate_changed");
    return {...actual,sessionId:s.id,attemptId:a.id,plan:projectPlanPublic(this.#plan(s))};
  }
  async validate(input){
    exact(input,["sessionId","reviewedDiffSha256","verifier","allowValidation"]);
    const s=this.#read(input.sessionId);this.#assertIdle(s);
    if(!reproducedBaseline(s.baseline))throw fail("project_baseline_reproduction_required");
    if(input.allowValidation!==true||!hash(input.reviewedDiffSha256)||!bounded(input.verifier,120))
      throw fail("explicit_project_independent_validation_required");
    const reviewed=this.review({sessionId:s.id}),a=s.attempts.at(-1),p=this.#plan(s);
    if(reviewed.diffSha256!==input.reviewedDiffSha256)throw fail("project_reviewed_diff_changed");
    const v={id:id("verification_"),candidateCommit:a.report.candidateCommit,diffSha256:reviewed.diffSha256,
      planDigest:p.planDigest,attemptId:a.id,verifier:input.verifier,status:"running",startedAt:this.now()};
    a.verification=v;s.status="validating";this.#event(s,"independent_validation_intent",{verificationId:v.id});this.#save(s);
    return this.#task(s,async signal=>{
      try{
        const publicResult=await runRegisteredChecks(p,{kind:"public",commit:v.candidateCommit,attemptId:a.id,workerRoot:a.workspaceRoot,signal});
        a.publicResult=publicResult;
        if(publicResult.terminationUnconfirmed){s.terminationUnconfirmed=true;throw fail("project_validator_termination_unconfirmed");}
        if(s.cancelRequested)throw fail("project_cancelled");
        if(!publicResult.passed){
          v.status="public_failed";s.status=this.#attemptCount(s)>=MAX_ATTEMPTS?"attempt_budget_exhausted":"revision_ready";
          a.status="public_failed";this.#event(s,"real_public_failure_available_for_revision",{attemptId:a.id});
        }else{
          const acceptance=await runRegisteredChecks(p,{kind:"acceptance",commit:v.candidateCommit,attemptId:a.id,workerRoot:a.workspaceRoot,signal});
          a.acceptanceResult=acceptance;
          if(acceptance.terminationUnconfirmed){s.terminationUnconfirmed=true;throw fail("project_validator_termination_unconfirmed");}
          if(s.cancelRequested)throw fail("project_cancelled");
          if(!acceptance.passed){v.status="acceptance_rejected";a.status="acceptance_rejected";s.status="candidate_rejected";}
          else{v.status="verified";a.status="verified";s.status="candidate_verified";}
          this.#event(s,"sealed_acceptance_terminal",{accepted:acceptance.passed});
        }
      }catch(error){v.status="interrupted";v.reason=error.code||"project_validation_failed";
        s.status=s.cancelRequested?"cancelled":"validation_interrupted";}
      v.completedAt=this.now();
      v.evidenceDigest=verificationDigest(s,a,v);
      if(v.status==="verified")s.verification=clone(v);
      this.#save(s);return {session:this.#operatorView(s),verification:clone(v)};
    });
  }
  async reverifyUsefulWork(input){
    exact(input,["sessionId","candidateCommit","diffSha256","verificationId","reviewer","allowPoUC"]);
    const s=this.#read(input.sessionId);this.#assertIdle(s);const v=s.verification,p=this.#plan(s);
    if(input.allowPoUC!==true||!bounded(input.reviewer,120)||!v||
       !["candidate_verified","applied_verified","rolled_back"].includes(s.status)||
       input.candidateCommit!==v.candidateCommit||input.diffSha256!==v.diffSha256||input.verificationId!==v.id)
      throw fail("exact_project_pouc_confirmation_required");
    if(s.pouc?.status==="verified")return {session:this.#operatorView(s),
      contribution:{deduplicated:true,receipt:this.#poucReceipt(s)}};
    if((s.pouc?.attempts??0)>=3)throw fail("project_pouc_attempt_budget_exhausted");
    const ledger=this.#poucLedger(),a=s.attempts.find(item=>item.id===v.attemptId),previousStatus=s.status;
    const observed=inspectRegisteredCandidate(p,v.candidateCommit,{workerRoot:a.workspaceRoot});
    if(observed.diffSha256!==v.diffSha256)throw fail("project_candidate_changed");
    s.pouc={schemaVersion:1,status:"running",attempts:(s.pouc?.attempts??0)+1,verificationId:v.id,
      previousStatus,reviewer:input.reviewer,startedAt:this.now()};
    s.status="pouc_running";this.#event(s,"explicit_pouc_recomputation_intent");this.#save(s);
    return this.#task(s,async signal=>{
      let contribution=null;
      try{
        const recomputed={};
        for(const kind of ["public","acceptance"]){
          const result=await runRegisteredChecks(p,{kind,commit:v.candidateCommit,attemptId:a.id,workerRoot:a.workspaceRoot,signal});
          if(result.terminationUnconfirmed)s.terminationUnconfirmed=true;
          if(!result.passed||s.cancelRequested)throw fail("project_pouc_recomputation_not_passed");
          recomputed[kind]=result;
        }
        contribution=ledger.record({subject:poucSubject(s),original:{public:a.publicResult,acceptance:a.acceptanceResult},recomputed});
        Object.assign(s.pouc,{status:"verified",computationDigest:contribution.receipt.computationDigest,
          proofDigest:contribution.receipt.proofDigest,deduplicated:contribution.deduplicated});
        s.pouc.bindingDigest=poucBinding(s,s.pouc);
      }catch(error){s.pouc.status=s.cancelRequested?"cancelled":s.terminationUnconfirmed?"interrupted":"rejected";
        s.pouc.reason=error.code||"project_pouc_recomputation_failed";}
      s.status=previousStatus;s.cancelRequested=false;s.pouc.completedAt=this.now();
      this.#event(s,"pouc_recomputation_finished",{outcome:s.pouc.status});this.#save(s);
      return {session:this.#operatorView(s),contribution};
    });
  }
  cancel(input){
    exact(input,["sessionId","reason"]);
    const s=this.active.get(input.sessionId)?.record??this.#read(input.sessionId);
    this.#assertCurrent(s);
    if(!bounded(input.reason,500))throw fail("project_cancel_reason_required");
    if(TERMINAL.has(s.status)||["application_unresolved","applied_unverified"].includes(s.status))
      throw fail("project_session_not_cancellable");
    s.cancelRequested=true;
    for(const a of s.attempts)if(a.lease&&a.lease.status==="active"){a.lease.status="revoked";a.status="cancel_requested";}
    if(!this.active.has(s.id))s.status="cancelled";
    this.#event(s,"operator_cancel_fences_all_worker_leases",{reason:input.reason});this.#save(s);
    this.active.get(s.id)?.controller.abort();
    return this.#operatorView(s);
  }
  acknowledgeStop(input){
    exact(input,["sessionId","leaseToken"]);const s=this.#read(input.sessionId),a=this.#lease(s,input.leaseToken,{allowClosed:true});
    this.#assertCurrent(s);
    if(!["revoked","expired","reported"].includes(a.lease.status))throw fail("project_stop_not_requested");
    a.workerStoppedAcknowledgedAt=this.now();this.#event(s,"worker_stop_acknowledged",{attemptId:a.id});this.#save(s);
    return this.#workerView(s);
  }
  resume(input){
    exact(input,["sessionId","allowResume"]);const s=this.#read(input.sessionId);this.#assertIdle(s);
    if(input.allowResume!==true)throw fail("explicit_project_resume_required");
    if(!reproducedBaseline(s.baseline))throw fail("project_baseline_reproduction_required");
    if(!["worker_outcome_unknown","workspace_setup_interrupted","cancelled","preparing_workspace"].includes(s.status))
      throw fail("project_resume_requires_worker_outcome_review");
    if(this.#attemptCount(s)>=MAX_ATTEMPTS)throw fail("project_attempt_budget_exhausted");
    for(const a of s.attempts)if(a.lease){a.lease.status="revoked";if(a.status==="worker_outcome_unknown")a.status="quarantined";}
    s.cancelRequested=false;s.status="revision_ready";
    this.#event(s,"explicit_resume_allocates_a_new_attempt_root");this.#save(s);
    return {session:this.#operatorView(s),dispatchToken:s.dispatchToken};
  }
  #targetLock(s){
    const p=this.#plan(s),lockRoot=join(p.commonRoot,"metron-project-apply-locks");
    const path=join(lockRoot,sha(p.applyRoot)+".json");
    // Common Git metadata gives cooperating servers one lock location even
    // when their data/evidence directories differ. It is outside every worktree.
    mkdirSync(lockRoot,{recursive:true});let fd;
    try{fd=openSync(path,"wx",0o600);writeFileSync(fd,JSON.stringify({sessionId:s.id,planDigest:p.planDigest,pid:process.pid}));}
    catch{if(fd!==undefined)closeSync(fd);throw fail("project_apply_root_owned_or_unresolved");}
    return ({keep=false}={})=>{closeSync(fd);if(!keep)unlinkSync(path);};
  }
  async apply(input){
    exact(input,["sessionId","candidateCommit","diffSha256","verificationId","expectedHead","reviewer","allowApply"]);
    const s=this.#read(input.sessionId);this.#assertIdle(s);const v=s.verification,p=this.#plan(s);
    if(input.allowApply!==true||!bounded(input.reviewer,120)||!v||
       input.candidateCommit!==v?.candidateCommit||input.diffSha256!==v.diffSha256||
       input.verificationId!==v.id||input.expectedHead!==p.baseCommit)throw fail("exact_project_application_approval_required");
    if(s.application&&s.status==="applied_verified"){
      const readback=inspectRegisteredApply(p);
      if(s.application.reviewer!==input.reviewer||readback.head!==v.candidateCommit||!readback.clean||
         stable(readback.sourceProof)!==stable(s.application.readback.sourceProof))
        throw fail("project_application_duplicate_readback_changed");
      return {session:this.#operatorView(s),application:clone(s.application),duplicate:true};
    }
    if(s.status!=="candidate_verified")throw fail("exact_project_application_approval_required");
    const verifiedAttempt=s.attempts.find(a=>a.id===v.attemptId);
    const candidate=inspectRegisteredCandidate(p,v.candidateCommit,{workerRoot:verifiedAttempt.workspaceRoot});
    if(candidate.diffSha256!==v.diffSha256)throw fail("project_verified_candidate_changed");
    const release=this.#targetLock(s);
    try{
    s.application={id:id("application_"),status:"intent",candidateCommit:v.candidateCommit,diffSha256:v.diffSha256,
      verificationId:v.id,expectedHead:input.expectedHead,reviewer:input.reviewer,startedAt:this.now()};
    s.status="applying";this.#event(s,"exact_application_intent");this.#save(s);
    return await this.#task(s,async signal=>{
      try{
        s.application.readback=applyRegisteredCandidate(p,{expectedHead:input.expectedHead,candidateCommit:v.candidateCommit});
        this.#save(s);
        const post=await runRegisteredChecks(p,{kind:"post_apply",commit:v.candidateCommit,attemptId:s.application.id,signal});
        s.application.postApply=post;
        if(post.terminationUnconfirmed)s.terminationUnconfirmed=true;
        s.status=post.passed&&!s.cancelRequested?"applied_verified":"application_unresolved";
        s.application.status=s.status;s.application.completedAt=this.now();
      }catch(error){s.status="application_unresolved";s.application.status=s.status;s.application.reason=error.code||"application_failed";
        if(error.terminationUnconfirmed)s.terminationUnconfirmed=true;}
      this.#event(s,"application_readback_and_postcheck_finished",{status:s.status});this.#save(s);
      return {session:this.#operatorView(s),application:clone(s.application)};
    });}finally{release({keep:s.terminationUnconfirmed===true});}
  }
  rollback(input){
    exact(input,["sessionId","expectedHead","reviewer","allowRollback"]);const s=this.#read(input.sessionId);this.#assertIdle(s);
    if(input.allowRollback!==true||!bounded(input.reviewer,120)||!s.application||
       input.expectedHead!==s.verification?.candidateCommit||!["applied_verified","application_unresolved"].includes(s.status))
      throw fail("exact_project_rollback_approval_required");
    const release=this.#targetLock(s);
    try{
      s.status="rolling_back";s.rollback={status:"intent",expectedHead:input.expectedHead,reviewer:input.reviewer,startedAt:this.now()};
      this.#event(s,"explicit_rollback_intent");this.#save(s);
      s.rollback.readback=rollbackRegisteredCandidate(this.#plan(s),{expectedHead:input.expectedHead});
      s.rollback.status="rolled_back";s.rollback.completedAt=this.now();s.status="rolled_back";this.#save(s);
      return this.#operatorView(s);
    }catch(error){
      s.status="application_unresolved";
      s.rollback={...s.rollback,status:"rollback_unresolved",reason:error.code||"rollback_failed",completedAt:this.now()};
      if(error.terminationUnconfirmed)s.terminationUnconfirmed=true;
      this.#event(s,"rollback_requires_explicit_reconciliation",{reason:s.rollback.reason});this.#save(s);
      throw error;
    }finally{release({keep:s.terminationUnconfirmed===true});}
  }
  async waitForIdle(){await Promise.allSettled([...this.tasks]);}
}
