/** Human-reviewed handoff to an already approved local coding worker.
 * No model/CLI launch, patch application, checkout, install, push or merge.
 * Trusted plans name frozen public-code worktrees and fixed validation commands.
 * This is ordinary development with review, not a sandbox for hostile projects.
 */
import {spawnSync,spawn} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,lstatSync,existsSync} from "node:fs";
import {join,resolve,isAbsolute} from "node:path";

const BASE="d25d351504b07753cc923e998ae9967034bb8616";
const SOURCE="mini/arc-browser/content.js";
const REPRO="reusable/tests/mini-arc-extension-behavior.test.mjs";
const TEST="consecutive sends cannot forward the first reply as the second prompt's response";
const fail=code=>Object.assign(new Error(code),{code});
const sha=value=>createHash("sha256").update(value).digest("hex");
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=value=>sha(stable(value));
const fullSha=x=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x);
const hash=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const clone=x=>structuredClone(x);
const bounded=(s,n)=>typeof s==="string"&&s.trim().length>0&&s.length<=n;
export function summarizeWorkerTestOutput(output){
  const clean=output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"");
  const value=name=>{
    const matches=[...clean.matchAll(new RegExp("^(?:#|ℹ)\\s+"+name+" (\\d+)\\r?$","gm"))];
    return matches.length?Number(matches.at(-1)[1]):null;
  };
  const result=Object.fromEntries(["tests","pass","fail","cancelled","skipped"].map(k=>[k,value(k)]));
  return Object.values(result).every(Number.isSafeInteger)&&result.tests>0?result:null;
}
function exact(value,keys){
  if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).some(k=>!keys.includes(k)))throw fail("invalid_worker_request");
}
function envFor(temp){
  // Explicit OS/runtime paths only. No provider keys, NODE_OPTIONS or NODE_PATH.
  const env={};
  for(const key of ["PATH","SystemRoot","WINDIR","COMSPEC","LOCALAPPDATA","ProgramFiles","ProgramFiles(x86)"])
    if(typeof process.env[key]==="string")env[key]=process.env[key];
  if(temp){env.TEMP=temp;env.TMP=temp;}
  return env;
}
function git(root,args,{binary=false}={}){
  const r=spawnSync("git",["--no-replace-objects","-c","core.fsmonitor=false","-c","color.ui=false",...args],{
    cwd:root,shell:false,windowsHide:true,env:{...envFor(),GIT_TERMINAL_PROMPT:"0"},
    encoding:binary?undefined:"utf8",timeout:15000,maxBuffer:8*1024*1024});
  if(r.error||r.status!==0)throw fail("worker_git_check_failed");
  return r.stdout;
}
const blob=(root,commit,path)=>git(root,["show",commit+":"+path],{binary:true});
const textBytes=bytes=>Buffer.from(bytes.toString("utf8").replace(/\r\n/g,"\n"),"utf8");
function assertRoot(root){
  if(typeof root!=="string"||!isAbsolute(root)||!lstatSync(root).isDirectory())
    throw fail("approved_worker_root_required");
  return resolve(root);
}
function fileMatches(root,path,expectedObject){
  try{
  const file=join(root,...path.split("/")),st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>33554432)throw fail("worker_input_changed");
  const bytes=readFileSync(file);
  const objectId=b=>createHash("sha1").update(Buffer.from("blob "+b.length+"\0")).update(b).digest("hex");
  if(objectId(bytes)!==expectedObject&&(bytes.includes(0)||objectId(textBytes(bytes))!==expectedObject))
    throw fail("worker_input_changed");
  return sha(bytes);
  }catch(error){if(error.code==="worker_input_changed")throw error;throw fail("worker_input_unavailable");}
}
function checkoutProof(plan,root,commit){
  if(git(root,["rev-parse","HEAD"]).trim()!==commit)throw fail("worker_checkout_head_mismatch");
  if(git(root,["status","--porcelain=v1","--untracked-files=all"]).trim())
    throw fail("worker_checkout_not_clean");
  for(const p of ["node_modules","mini/node_modules","reusable/node_modules"])
    if(existsSync(join(root,p)))throw fail("worker_unapproved_execution_input");
  // Recollect the tracked public execution inputs; status flags alone do not
  // establish bytes (e.g. assume-unchanged). CRLF is allowed for text checkouts;
  // the separate raw digest below must remain identical throughout validation.
  const entries=git(plan.repositoryRoot,["ls-tree","-rz","--full-tree",commit]).split("\0").filter(Boolean);
  const observed=entries.map(entry=>{
    const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if(!m)throw fail("worker_non_regular_tree_entry");
    return [m[3],fileMatches(root,m[3],m[2])];
  });
  return digest(observed);
}
export function createArcWorkerPlan({repositoryRoot,baselineRoot,candidateRoot,reproductionCommit,
  artifactRoot,tempRoot}={}){
  if(!fullSha(reproductionCommit))throw fail("worker_reproducer_commit_required");
  repositoryRoot=assertRoot(repositoryRoot);baselineRoot=assertRoot(baselineRoot);candidateRoot=assertRoot(candidateRoot);
  if(baselineRoot===candidateRoot)throw fail("worker_roots_must_differ");
  if(!isAbsolute(artifactRoot||"")||!isAbsolute(tempRoot||""))throw fail("worker_evidence_root_required");
  const changed=git(repositoryRoot,["diff","--no-ext-diff","--no-textconv","--name-only",BASE,reproductionCommit]).trim();
  if(changed!==REPRO||git(repositoryRoot,["rev-parse",reproductionCommit+"^"]).trim()!==BASE)
    throw fail("worker_reproducer_must_only_add_regression");
  const publicPlan={id:"arc-consecutive-send-v1",repository:"dakahasa0119-blip/METRON-OS",
    baseCommit:BASE,reproductionCommit,reproducer:{path:REPRO,sha256:sha(blob(repositoryRoot,reproductionCommit,REPRO)),testName:TEST},
    allowedFiles:[{path:SOURCE,operation:"edit"},{path:REPRO,operation:"pinned_reproducer_only"}],
    allowedOperations:["inspect_public_code","edit_allowed_source","run_listed_checks","create_local_candidate_commit"],
    prohibitedOperations:["model_or_cli_launch","install","credentials","push","merge","original_checkout_writeback"],
    validation:[{id:"reproduction",command:"node",args:["--test",REPRO]},
      {id:"regression",command:"node",args:["--test","--test-concurrency=1","reusable/tests/*.test.mjs"]}]};
  return Object.freeze({...publicPlan,planDigest:digest(publicPlan),repositoryRoot,baselineRoot,candidateRoot,
    artifactRoot:resolve(artifactRoot),tempRoot:resolve(tempRoot)});
}
function publicPlan(plan){
  const {repositoryRoot,baselineRoot,candidateRoot,artifactRoot,tempRoot,...visible}=plan;
  return clone(visible);
}
export function validateExternalRecord(w){
  const t=w.externalRepair;if(!t)return;
  const r=t.request,{requestDigest,...body}=r||{};
  if(t.schemaVersion!==1||requestDigest!==digest(body)||body.workIdentityDigest!==w.identityDigest||
     body.workId!==w.id||body.runId!==w.runId||body.villageId!==w.villageId||
     !Array.isArray(t.imports)||t.imports.length>8||!Array.isArray(t.verifications)||t.verifications.length>16||
     !Array.isArray(t.history)||t.history.length>100)throw fail("invalid_external_work_checkpoint");
  for(const c of t.imports)if(c.reportDigest!==digest(c.report))throw fail("invalid_external_candidate_checkpoint");
  if(t.status==="verified"){
    const v=t.verifications.at(-1),{evidenceDigest,...evidence}=v||{};
    const c=t.imports.find(x=>x.reportDigest===t.selectedReportDigest);
    if(v?.status!=="verified"||evidenceDigest!==digest(evidence)||v.requestDigest!==requestDigest||
       v.reportDigest!==t.selectedReportDigest||v.checks?.length!==3||
       v.checks[0].expectedFailureReproduced!==true||v.checks.some(x=>x.terminationConfirmed!==true||x.error||x.timedOut)||
       v.checks.slice(1).some(x=>x.exitCode!==0)||
       !c||v.baseCommit!==r.plan.baseCommit||v.planDigest!==r.plan.planDigest||
       v.candidateCommit!==c.report.candidateCommit||v.diffSha256!==c.observed.diffSha256||
       w.result?.verificationId!==v.id||w.result?.candidateCommit!==v.candidateCommit||
       w.result?.diffSha256!==v.diffSha256||w.result?.runId!==w.runId||
       w.result?.status!=="verified_candidate"||w.result?.scope!=="human_reviewed_external_worker")
      throw fail("invalid_external_verification_checkpoint");
  }else if(w.stage==="candidate_verified")throw fail("unverified_external_candidate_checkpoint");
}
export function recoverExternalRecord(w){
  validateExternalRecord(w);const t=w.externalRepair;if(!t)return false;
  if(t.status!=="verifying")return false;
  const last=t.verifications.at(-1);
  if(last){last.status="interrupted";last.reason="restart_requires_explicit_independent_verification";}
  // A server crash cannot establish that its old validator/descendants stopped.
  // Preserve the unfinished work, but do not launch another validator on top.
  t.terminationUnconfirmed=true;
  t.status="verification_interrupted";w.stage="unresolved";
  w.nextAction="inspect_interrupted_validator_termination";return true;
}
function inspect(plan,commit){
  if(!fullSha(commit)||commit===plan.baseCommit)throw fail("invalid_worker_candidate_commit");
  git(plan.repositoryRoot,["merge-base","--is-ancestor",plan.reproductionCommit,commit]);
  const raw=git(plan.repositoryRoot,["diff","--no-ext-diff","--no-textconv","--raw","-z","--no-renames",plan.baseCommit,commit]);
  const fields=raw.split("\0");const changes=[];
  for(let i=0;i<fields.length&&fields[i];i+=2){
    const record=/^:(\d{6}) (\d{6}) [a-f0-9]+ [a-f0-9]+ ([A-Z])$/.exec(fields[i]);
    const path=fields[i+1];
    if(!record||record[1]!=="100644"||record[2]!=="100644"||record[3]!=="M"||
       !plan.allowedFiles.some(f=>f.path===path))throw fail("worker_candidate_out_of_scope");
    changes.push(path);
  }
  if(!changes.includes(SOURCE)||!changes.includes(REPRO)||changes.length!==2)
    throw fail("worker_candidate_scope_incomplete");
  if(sha(blob(plan.repositoryRoot,commit,REPRO))!==plan.reproducer.sha256)
    throw fail("worker_reproducer_changed");
  const diff=git(plan.repositoryRoot,["diff","--no-ext-diff","--no-textconv","--binary",plan.baseCommit,commit,"--",SOURCE,REPRO]);
  if(Buffer.byteLength(diff)>262144)throw fail("worker_diff_too_large");
  return {candidateCommit:commit,changedPaths:changes.sort(),diffSha256:sha(diff),diff};
}
function boundReport(report){
  exact(report,["schemaVersion","requestId","requestDigest","villageId","workId","runId","baseCommit",
    "candidateCommit","changedPaths","worker","summary","operations","unresolved"]);
  if(report.schemaVersion!==1||!fullSha(report.candidateCommit)||!bounded(report.worker,120)||
    !bounded(report.summary,2000)||!Array.isArray(report.changedPaths)||report.changedPaths.length>8||
    report.changedPaths.some(p=>!bounded(p,160))||!Array.isArray(report.operations)||report.operations.length>30||
    report.operations.some(x=>!bounded(x,1000))||!Array.isArray(report.unresolved)||
    report.unresolved.length>20||report.unresolved.some(x=>!bounded(x,1000)))throw fail("invalid_worker_report");
  return clone(report);
}
function command(plan,root,entry,logName){
  return new Promise(resolveCommand=>{
    let child,settled=false,timedOut=false,size=0,stopReason=null,graceTimer;const chunks=[];
    const startedAt=Date.now();mkdirSync(plan.artifactRoot,{recursive:true});mkdirSync(plan.tempRoot,{recursive:true});
    const finish=(exitCode,signal,terminationConfirmed=true)=>{
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(graceTimer);
      const output=Buffer.concat(chunks).toString("utf8").replaceAll(root,"<approved-checkout>")
        .replaceAll(root.replaceAll("\\","/"),"<approved-checkout>");
      let logFile=logName+".tap",error=stopReason;
      try{writeFileSync(join(plan.artifactRoot,logFile),output);}
      catch{error="worker_evidence_write_failed";logFile=null;}
      resolveCommand({commandId:entry.id,exitCode,signal:signal||null,timedOut,
        terminationConfirmed,error,outputSha256:sha(output),logFile,durationMs:Date.now()-startedAt,output});
    };
    const stop=reason=>{
      if(settled||stopReason)return;stopReason=reason;
      graceTimer=setTimeout(()=>finish(null,"termination_unconfirmed",false),5000);
      try{child?.kill("SIGKILL");}catch{ /* A request is not an exit confirmation. */ }
    };
    const collect=chunk=>{if(settled||stopReason)return;size+=chunk.length;
      if(size>2*1024*1024){stop("worker_validation_output_limit");return;}chunks.push(chunk);};
    const timer=setTimeout(()=>{timedOut=true;stop("worker_validation_timeout");},180000);
    try{
      child=spawn(process.execPath,entry.args,{cwd:root,shell:false,windowsHide:true,env:envFor(plan.tempRoot),stdio:["ignore","pipe","pipe"]});
      child.stdout.on("data",collect);child.stderr.on("data",collect);
      child.stdout.on("error",()=>stop("worker_validation_stream_failed"));
      child.stderr.on("error",()=>stop("worker_validation_stream_failed"));
      child.once("error",()=>{if(!child.pid)finish(null,"spawn_failed");else stop("worker_validation_process_failed");});
      child.once("close",(code,signal)=>finish(code,signal));
    }catch{finish(null,"spawn_failed");}
  });
}

export class ExternalWorkerHandoff {
  #plans;
  constructor(plans=[]){
    if(!Array.isArray(plans)||plans.length>8)throw fail("invalid_worker_plans");
    const freeze=x=>{if(x&&typeof x==="object"){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
    this.#plans=new Map();
    for(const supplied of plans){
      const p=clone(supplied),{planDigest,...spec}=publicPlan(p);
      if(!bounded(p.id,64)||planDigest!==digest(spec)||this.#plans.has(p.id))throw fail("invalid_worker_plan_digest");
      this.#plans.set(p.id,freeze(p));
    }
  }
  #plan(w){
    const transfer=w.externalRepair,plan=this.#plans.get(transfer?.request.plan.id);
    if(!plan||plan.planDigest!==transfer.request.plan.planDigest)throw fail("worker_plan_unavailable_or_changed");
    if(transfer.terminationUnconfirmed||transfer.verifications.some(v=>v.checks?.some(c=>
      c.terminationConfirmed===false||c.timedOut||/^worker_validation_(?:output_limit|stream_failed|process_failed)$/.test(c.error||""))))
      throw fail("worker_validator_termination_unconfirmed");
    const {requestDigest,...body}=transfer.request;
    if(requestDigest!==digest(body)||body.workIdentityDigest!==w.identityDigest||body.workId!==w.id||
      body.runId!==w.runId||body.villageId!==w.villageId)throw fail("worker_request_binding_changed");
    return plan;
  }
  export(w,input){
    exact(input,["villageId","workId","planId","allowWorker","symptom","reproduction","evidence"]);
    if(input.allowWorker!==true)throw fail("explicit_worker_consent_required");
    if(w.externalRepair){this.#plan(w);return clone(w.externalRepair.request);}
    const plan=this.#plans.get(input.planId);
    if(!plan||!bounded(input.symptom,2000)||!bounded(input.reproduction,4000)||
      !Array.isArray(input.evidence)||input.evidence.length>10||input.evidence.some(x=>!bounded(x,1000)))
      throw fail("invalid_worker_export");
    const body={schemaVersion:1,requestId:"repair_"+randomUUID().replaceAll("-",""),villageId:w.villageId,
      workId:w.id,runId:w.runId,workIdentityDigest:w.identityDigest,goal:w.goal,
      sourceMessage:clone(w.sourceMessage),adoptedKnowledge:clone(w.knowledge),
      symptom:input.symptom,reproduction:input.reproduction,evidence:clone(input.evidence),plan:publicPlan(plan),
      consent:{approved:true,authority:"explicit_local_operator",at:Date.now()},
      mode:"human_reviewed_existing_codex_worker_not_embedded_autonomy"};
    const request={...body,requestDigest:digest(body)};
    w.externalRepair={schemaVersion:1,status:"exported",request,imports:[],verifications:[],history:[{action:"export",at:Date.now()}]};
    w.result=null;w.sharingCandidate=null;w.verificationPending=false;
    w.stage="unresolved";w.nextAction="handoff_to_approved_worker";
    return clone(request);
  }
  import(w,report){
    const plan=this.#plan(w),t=w.externalRepair;report=boundReport(report);
    for(const k of ["requestId","requestDigest","villageId","workId","runId"])
      if(report[k]!==t.request[k])throw fail("worker_report_binding_mismatch");
    if(report.baseCommit!==plan.baseCommit)throw fail("worker_report_base_mismatch");
    const reportDigest=digest(report),same=t.imports.find(x=>x.reportDigest===reportDigest);
    if(same)return {duplicate:true,candidate:clone(same)};
    if(t.status==="verified"||t.status==="verifying")throw fail("worker_result_requires_review");
    if(t.imports.length>=8)throw fail("worker_import_capacity_reached");
    const observed=inspect(plan,report.candidateCommit);
    if(stable([...report.changedPaths].sort())!==stable(observed.changedPaths))throw fail("worker_report_changes_mismatch");
    const candidate={reportDigest,report,observed:{...observed,diff:undefined},importedAt:Date.now(),status:"unverified"};
    t.imports.push(candidate);t.status="candidate_unverified";t.selectedReportDigest=reportDigest;
    t.history.push({action:"import_unverified",reportDigest,at:Date.now()});
    w.stage="unresolved";w.result=null;w.sharingCandidate=null;w.nextAction="independent_worker_verification_required";
    return {duplicate:false,candidate:clone(candidate)};
  }
  review(w){
    const plan=this.#plan(w),t=w.externalRepair,c=t.imports.find(x=>x.reportDigest===t.selectedReportDigest);
    if(!c)throw fail("worker_candidate_required");
    const observed=inspect(plan,c.report.candidateCommit);
    if(observed.diffSha256!==c.observed.diffSha256)throw fail("worker_candidate_changed");
    checkoutProof(plan,plan.candidateRoot,c.report.candidateCommit);
    return {...observed,requestId:t.request.requestId,requestDigest:t.request.requestDigest,plan:publicPlan(plan)};
  }
  async verify(w,{reviewedDiffSha256,allowValidation,verifier},save){
    const plan=this.#plan(w),t=w.externalRepair;
    if(t.status==="verified")return clone(t.verifications.at(-1));
    if(t.status==="verifying")throw fail("worker_verification_already_active");
    if(t.verifications.length>=16)throw fail("worker_verification_capacity_reached");
    if(allowValidation!==true||!hash(reviewedDiffSha256)||!bounded(verifier,120))throw fail("explicit_worker_verification_required");
    const reviewed=this.review(w);
    if(reviewed.diffSha256!==reviewedDiffSha256)throw fail("worker_review_digest_mismatch");
    const c=t.imports.find(x=>x.reportDigest===t.selectedReportDigest);
    const v={id:"verify_"+randomUUID().replaceAll("-",""),status:"running",verifier,
      authority:"trusted_local_verifier_not_worker_report",requestDigest:t.request.requestDigest,
      reportDigest:c.reportDigest,baseCommit:plan.baseCommit,candidateCommit:reviewed.candidateCommit,
      diffSha256:reviewed.diffSha256,planDigest:plan.planDigest,startedAt:Date.now(),checks:[]};
    t.verifications.push(v);t.status="verifying";w.stage="running";w.nextAction="wait_for_independent_verifier";save();
    try{
      const beforeBase=checkoutProof(plan,plan.baselineRoot,plan.reproductionCommit);
      const beforeCandidate=checkoutProof(plan,plan.candidateRoot,reviewed.candidateCommit);
      const baseline=await command(plan,plan.baselineRoot,plan.validation[0],v.id+"-baseline");
      const escaped=TEST.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      const baselineSummary=summarizeWorkerTestOutput(baseline.output);
      const reproduced=baseline.exitCode===1&&!baseline.timedOut&&!baseline.error&&baseline.terminationConfirmed&&
        new RegExp("(?:not ok \\d+ - |✖ )"+escaped).test(baseline.output)&&
        baselineSummary?.tests===20&&baselineSummary.pass===19&&baselineSummary.fail===1&&
        baselineSummary.cancelled===0&&baselineSummary.skipped===0&&
        baseline.output.includes('"providerSendClicks":2')&&
        baseline.output.includes('"forwardedTexts":["Artificial reply belonging only to the first prompt"]');
      if(!baseline.terminationConfirmed||baseline.timedOut||/^worker_validation_/.test(baseline.error||""))t.terminationUnconfirmed=true;
      v.checks.push({...baseline,output:undefined,testSummary:baselineSummary,expectedFailureReproduced:reproduced});save();
      if(!reproduced)throw fail("worker_original_reproduction_unconfirmed");
      for(const entry of plan.validation){
        const result=await command(plan,plan.candidateRoot,entry,v.id+"-candidate-"+entry.id);
        const testSummary=summarizeWorkerTestOutput(result.output);
        if(!result.terminationConfirmed||result.timedOut||/^worker_validation_/.test(result.error||""))t.terminationUnconfirmed=true;
        v.checks.push({...result,output:undefined,testSummary});save();
        if(result.exitCode!==0||result.timedOut||result.error||!result.terminationConfirmed||
           !testSummary||testSummary.fail!==0||testSummary.cancelled!==0)throw fail("worker_candidate_validation_failed");
      }
      if(beforeBase!==checkoutProof(plan,plan.baselineRoot,plan.reproductionCommit)||
         beforeCandidate!==checkoutProof(plan,plan.candidateRoot,reviewed.candidateCommit))throw fail("worker_validation_input_changed");
      v.status="verified";v.completedAt=Date.now();v.inputReadback={baseline:beforeBase,candidate:beforeCandidate};
      t.status="verified";w.stage="candidate_verified";w.nextAction="inspect_external_candidate_and_prepare_share";
      w.result={status:"verified_candidate",runId:w.runId,scope:"human_reviewed_external_worker",
        candidateCommit:reviewed.candidateCommit,diffSha256:reviewed.diffSha256,verificationId:v.id,
        productionChanged:false,approved:false,modelProvenance:"existing_approved_codex_worker"};
    }catch(error){
      v.status="failed";v.reason=error.code||"worker_verification_failed";v.completedAt=Date.now();
      t.status="verification_failed";w.stage="unresolved";w.nextAction="inspect_failure_and_request_worker_revision";
    }
    v.evidenceDigest=digest(v);
    save();return clone(v);
  }
}
