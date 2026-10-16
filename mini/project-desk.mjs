/** Owner-triggered job transport for the existing registered-project worker.
 * No automatic retry, validation, application or model call on state/restart. */
import {mkdirSync,readdirSync,lstatSync,readFileSync} from "node:fs";
import {join,isAbsolute,basename} from "node:path";
import {createHash} from "node:crypto";
import {readCheckpoint,writeAtomicJson} from "../reusable/gateway-jobs/checkpoint.mjs";
import {projectPlanPublic} from "./project-tools.mjs";
import {runCodexProjectAttempt} from "./project-codex-worker.mjs";
import {createProjectWorkerClient} from "./project-worker-cli.mjs";

const fail=code=>Object.assign(new Error(code),{code});
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
const sha=value=>createHash("sha256").update(value).digest("hex");
const digest=value=>sha(stable(value));
const sessionId=value=>typeof value==="string"&&/^agent_[a-f0-9]{32}$/.test(value);
const hash=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const commit=value=>typeof value==="string"&&/^[a-f0-9]{40}$/.test(value);
const statusSet=new Set(["queued","running","reported_awaiting_independent_review","failed_requires_owner_reconciliation","requires_owner_reconciliation"]);
const publicKeys=["id","sessionId","projectId","planDigest","workId","villageId","status","mode","modelLaunchIntent",
  "modelProcessStarted","terminationUnconfirmed","attemptId","candidateCommit","diffSha256","exitCode","reason","createdAt","updatedAt","completedAt"];
const safeCode=(value,fallback)=>typeof value==="string"&&/^project_[a-z0-9_]{1,88}$/.test(value)?value:fallback;
const bool=value=>typeof value==="boolean"?value:null;
const active=job=>["queued","running"].includes(job.status);
function exact(value,keys){
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))
    throw fail("project_desk_invalid_request");
}
function receiptFields(value){
  return {modelLaunchIntent:bool(value?.modelLaunchIntent),modelProcessStarted:bool(value?.modelProcessStarted),
    terminationUnconfirmed:value?.terminationUnconfirmed!==false,
    attemptId:/^attempt_[a-f0-9]{32}$/.test(value?.attemptId||"")?value.attemptId:null,
    candidateCommit:commit(value?.candidateCommit)?value.candidateCommit:null,
    diffSha256:hash(value?.diffSha256)?value.diffSha256:null,
    exitCode:Number.isInteger(value?.process?.exitCode)&&Math.abs(value.process.exitCode)<=255?value.process.exitCode:null};
}

export class ProjectDesk {
  constructor({root,work,projectCodexOptions=null,now=Date.now}={}){
    this.root=join(root,"project-desk-jobs");this.work=work;this.now=now;this.active=new Map();this.tasks=new Set();this.closed=false;
    const options=projectCodexOptions??{};
    if(!options||typeof options!=="object"||Array.isArray(options)||Object.keys(options).some(key=>!["executable","runAttempt","label"].includes(key))||
       (options.runAttempt!==undefined&&typeof options.runAttempt!=="function")||
       (options.executable!==undefined&&(typeof options.executable!=="string"||!isAbsolute(options.executable)||!/^codex(?:\.exe)?$/i.test(basename(options.executable))))||
       (options.label!==undefined&&(typeof options.label!=="string"||!options.label.trim()||options.label!==options.label.trim()||
         options.label.length>80||/[\\/:\x00-\x1f\x7f]/.test(options.label))))throw fail("project_desk_invalid_host_configuration");
    this.options=options;this.runAttempt=options.runAttempt??runCodexProjectAttempt;
    this.mode=options.runAttempt?"injected_worker_test":options.executable?"official_codex_cli":"unavailable";
    mkdirSync(this.root,{recursive:true});
    for(const id of this.#ids()){
      const job=this.#read(id);
      if(active(job)){
        const wasRunning=job.status==="running";
        job.status="requires_owner_reconciliation";job.reason="project_desk_restart_requires_reconciliation";
        job.terminationUnconfirmed=job.modelProcessStarted!==false||wasRunning;
        // An unfinished invocation may have started after the last checkpoint.
        if(job.modelLaunchIntent===null||job.modelProcessStarted===null)job.terminationUnconfirmed=true;
        job.completedAt=this.now();this.#save(job);
      }
    }
  }
  #ids(){
    const ids=readdirSync(this.root).filter(name=>/^job_[a-f0-9]{32}\.json$/.test(name)).map(name=>name.slice(0,-5));
    if(ids.length>100)throw fail("project_desk_job_capacity_reached");return ids;
  }
  #path(id){if(!/^job_[a-f0-9]{32}$/.test(id||""))throw fail("project_desk_invalid_job");return join(this.root,id+".json");}
  #read(id){
    const file=this.#path(id),stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw fail("project_desk_invalid_job");
    const job=readCheckpoint(file),{digest:saved,...body}=job??{};
    if(job?.schemaVersion!==1||job.id!==id||!sessionId(job.sessionId)||!hash(job.planDigest)||!statusSet.has(job.status)||
       !["injected_worker_test","official_codex_cli"].includes(job.mode)||saved!==digest(body)||
       Object.keys(body).some(key=>![...publicKeys,"schemaVersion","requestId","bindingDigest","historyLength"].includes(key))||
       !Number.isInteger(job.historyLength)||job.historyLength<0||job.historyLength>256||
       !/^request_[a-f0-9]{32}$/.test(job.requestId||"")||id!=="job_"+job.requestId.slice(8))throw fail("project_desk_invalid_job");
    return job;
  }
  #save(job){job.updatedAt=this.now();delete job.digest;job.digest=digest(job);writeAtomicJson(this.#path(job.id),job);}
  #public(job){return Object.fromEntries(publicKeys.map(key=>[key,structuredClone(job[key])]));}
  availability(){return {registeredProjectsConfigured:this.work.projectSessions.plans.size>0,workerConfigured:this.mode!=="unavailable",mode:this.mode};}
  catalog(){return {projects:[...this.work.projectSessions.plans.values()].map(projectPlanPublic),worker:{
    available:this.mode!=="unavailable",mode:this.mode,label:this.options.label??(this.mode==="injected_worker_test"?"Injected worker (test only)":"Official Codex CLI"),
    status:this.mode==="unavailable"?"not_configured":"configured_not_preflighted"},
    activeJobs:this.#ids().map(id=>this.#read(id)).filter(active).map(job=>this.#view(job))};}
  #progress(job){
    const plan=this.work.projectSessions.plans.get(job.projectId);if(!plan||plan.planDigest!==job.planDigest)return null;
    const workerId="mini_project_desk",claimId="desk_"+job.id.slice(4);
    const directory=join(plan.evidenceRoot,"codex-"+job.sessionId+"-"+digest([workerId,claimId]).slice(0,32)),file=join(directory,"progress.json");
    try{
      const parent=lstatSync(directory),stat=lstatSync(file);
      if(!parent.isDirectory()||parent.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||stat.size>131072)return null;
      const value=JSON.parse(readFileSync(file,"utf8"));
      if(value.sessionId!==job.sessionId||value.projectId!==job.projectId||value.planDigest!==job.planDigest||
         value.workerId!==workerId||value.claimId!==claimId)return null;
      return receiptFields(value);
    }catch{return null;}
  }
  #view(job){return this.#public(this.active.has(job.id)?{...job,...(this.#progress(job)??{})}:job);}
  #dispatchBlocker(jobs,session){
    if(jobs.some(job=>job.terminationUnconfirmed))return "project_desk_termination_unconfirmed";
    if(jobs.some(active))return "project_desk_job_active";
    for(const job of jobs){
      if(!["failed_requires_owner_reconciliation","requires_owner_reconciliation"].includes(job.status))continue;
      const history=(session?.history||[]).slice(job.historyLength).map(event=>event.action);
      if(!(history.includes("operator_cancel_fences_all_worker_leases")&&history.includes("explicit_resume_allocates_a_new_attempt_root")))
        return "project_desk_owner_cancel_resume_required";
    }
    return null;
  }
  jobs({sessionId:requested}={}){
    if(!sessionId(requested))throw fail("project_desk_invalid_session");
    const jobs=this.#ids().map(id=>this.#read(id)).filter(job=>job.sessionId===requested);
    let session=null;
    if(jobs.some(job=>["failed_requires_owner_reconciliation","requires_owner_reconciliation"].includes(job.status))){
      try{session=this.work.projectSessions.state({sessionId:requested,operator:true});}catch{ /* Missing registration fails closed below. */ }
    }
    const dispatchBlockedReason=this.#dispatchBlocker(jobs,session);
    return {jobs:jobs.map(job=>this.#view(job)).sort((a,b)=>a.createdAt-b.createdAt),
      dispatchBlocked:dispatchBlockedReason!==null,dispatchBlockedReason};
  }
  #bound(input){
    const session=this.work.projectState({sessionId:input.sessionId,operator:true}),plan=this.work.projectSessions.plans.get(input.projectId);
    if(!plan||session.projectId!==plan.id||session.planDigest!==input.planDigest||plan.planDigest!==input.planDigest||
       session.work?.projectRepair?.sessionId!==session.id||session.work.projectRepair.planDigest!==plan.planDigest)
      throw fail("project_desk_work_binding_changed");
    return {session,plan,bindingDigest:digest([session.id,session.projectId,session.planDigest,session.villageId,session.workId,
      session.runId,session.workIdentityDigest,session.bindingDigest])};
  }
  dispatch(input,{url}={}){
    exact(input,["sessionId","projectId","planDigest","requestId","allowExternalCodex"]);
    if(input.allowExternalCodex!==true)throw fail("project_desk_explicit_codex_consent_required");
    if(!sessionId(input.sessionId)||!hash(input.planDigest)||!/^request_[a-f0-9]{32}$/.test(input.requestId||""))throw fail("project_desk_invalid_request");
    if(this.closed)throw fail("project_desk_closed");
    if(this.mode==="unavailable")throw fail("project_desk_worker_not_configured");
    const bound=this.#bound(input),id="job_"+input.requestId.slice(8);
    this.work.requireActive?.(bound.session.villageId);
    if(this.#ids().includes(id)){
      const job=this.#read(id);
      if(job.sessionId!==input.sessionId||job.projectId!==input.projectId||job.planDigest!==input.planDigest||job.bindingDigest!==bound.bindingDigest)
        throw fail("project_desk_request_conflict");
      return {job:this.#view(job),duplicate:true};
    }
    if(!["ready_worker","revision_ready"].includes(bound.session.status)||bound.session.terminationUnconfirmed||bound.session.workAttemptCount>=3)
      throw fail("project_desk_session_not_ready");
    const jobs=this.#ids().map(value=>this.#read(value));
    if(this.#dispatchBlocker(jobs.filter(job=>job.sessionId===input.sessionId),bound.session))
      throw fail("project_desk_session_requires_reconciliation");
    if(this.active.size>=2)throw fail("project_desk_worker_capacity_reached");
    if(jobs.length>=100)throw fail("project_desk_job_capacity_reached");
    const job={schemaVersion:1,id,requestId:input.requestId,sessionId:input.sessionId,projectId:input.projectId,planDigest:input.planDigest,
      bindingDigest:bound.bindingDigest,historyLength:bound.session.history.length,workId:bound.session.workId,villageId:bound.session.villageId,status:"queued",mode:this.mode,
      modelLaunchIntent:false,modelProcessStarted:false,terminationUnconfirmed:false,attemptId:null,candidateCommit:null,diffSha256:null,
      exitCode:null,reason:null,createdAt:this.now(),updatedAt:this.now(),completedAt:null};
    this.#save(job);
    const controller=new AbortController();this.active.set(job.id,{controller,job});
    const task=new Promise(resolveTask=>setImmediate(resolveTask)).then(()=>this.#run(job,input,url,controller.signal));
    this.tasks.add(task);task.finally(()=>{this.active.delete(job.id);this.tasks.delete(task);}).catch(()=>{});
    return {job:this.#public(job),duplicate:false};
  }
  async #run(job,input,url,signal){
    try{
      if(signal.aborted||this.closed)throw fail("project_desk_cancelled_before_invocation");
      const {session,plan,bindingDigest}=this.#bound(input);
      this.work.requireActive?.(session.villageId);
      if(bindingDigest!==job.bindingDigest||!["ready_worker","revision_ready"].includes(session.status))throw fail("project_desk_work_binding_changed");
      const {dispatchToken}=this.work.projectSessions.dispatchCapability({sessionId:job.sessionId,operator:true});
      job.status="running";job.modelLaunchIntent=null;job.modelProcessStarted=null;this.#save(job);
      const receipt=await this.runAttempt({sessions:createProjectWorkerClient({url}),plan,sessionId:job.sessionId,dispatchToken,
        workerId:"mini_project_desk",claimId:"desk_"+job.id.slice(4),executable:this.options.executable,evidenceRoot:plan.evidenceRoot,signal});
      Object.assign(job,receiptFields(receipt));
      if((receipt?.sessionId&&receipt.sessionId!==job.sessionId)||(receipt?.projectId&&receipt.projectId!==job.projectId)||
         (receipt?.planDigest&&receipt.planDigest!==job.planDigest))throw fail("project_desk_receipt_binding_invalid");
      if(receipt?.status==="reported_awaiting_independent_review"){
        const actual=this.#bound(input).session,a=actual.attempts.at(-1);
        if(actual.status!=="awaiting_review"||a?.report?.candidateCommit!==job.candidateCommit||
           a?.observed?.diffSha256!==job.diffSha256||a?.id!==job.attemptId)throw fail("project_desk_receipt_binding_invalid");
        job.status="reported_awaiting_independent_review";job.reason=null;
      }else{job.status="failed_requires_owner_reconciliation";job.reason=safeCode(receipt?.reason,"project_desk_worker_failed");}
    }catch(error){
      job.status="failed_requires_owner_reconciliation";job.reason=safeCode(error?.code,"project_desk_worker_failed");
      if(job.modelProcessStarted!==false)job.terminationUnconfirmed=true;
    }finally{
      if(this.closed){job.status="requires_owner_reconciliation";job.reason="project_desk_closed_requires_reconciliation";}
      job.completedAt=this.now();this.#save(job);
    }
  }
  cancelSession(id){for(const {controller,job} of this.active.values())if(job.sessionId===id)controller.abort();}
  async cancelVillage(villageId){
    const ids=[...new Set([...this.active.values()].filter(({job})=>job.villageId===villageId&&active(job)).map(({job})=>job.sessionId))];
    const results=await Promise.allSettled(ids.map(async sessionId=>{
      this.cancelSession(sessionId);
      await this.work.projectAction({action:"cancel",sessionId,reason:"Owner stopped the village"},{operator:true});
      return sessionId;
    }));
    return {requested:ids.length,sessions:results.map((r,i)=>({sessionId:ids[i],status:r.status,
      ...(r.status==="rejected"?{error:safeCode(r.reason?.code,"village_work_stop_requires_reconciliation")}:{} )}))};
  }
  async waitForIdle(){await Promise.allSettled([...this.tasks]);}
  async close(){
    this.closed=true;
    for(const {controller,job} of this.active.values()){
      controller.abort();Object.assign(job,this.#progress(job)??{});job.status="requires_owner_reconciliation";
      job.reason="project_desk_closed_requires_reconciliation";job.terminationUnconfirmed=job.modelProcessStarted!==false;
      job.completedAt=this.now();this.#save(job);
    }
    let timer;await Promise.race([this.waitForIdle(),new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);clearTimeout(timer);
  }
}
