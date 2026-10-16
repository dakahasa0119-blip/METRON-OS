/** Explicit host-approved local worktree preparation; no model or test execution. */
import {spawn,spawnSync} from "node:child_process";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {existsSync,mkdirSync,readdirSync,lstatSync,writeFileSync,openSync,closeSync} from "node:fs";
import {join,resolve,dirname,basename,isAbsolute} from "node:path";
import {homedir} from "node:os";
import {writeAtomicJson} from "../reusable/gateway-jobs/checkpoint.mjs";
import {createRegisteredProjectPlan} from "./project-tools.mjs";
import {validateProjectSetupSlots,setupDirectory,setupReadFile,setupRootsOverlap,setupRelativePath} from "./project-setup-config.mjs";

const fail=code=>Object.assign(new Error(code),{code});
const sha=value=>createHash("sha256").update(value).digest("hex");
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=value=>sha(stable(value));
const MAX_FILE=2*1024*1024,MAX_BYTES=32*1024*1024;
const clone=value=>structuredClone(value);
const markerName=".metron-project-setup-owner.json";
const safeReason=error=>/^project_[a-z0-9_]+$/.test(error?.code||"")?error.code:"project_setup_failed";
function environment(temp){
  const env={GIT_TERMINAL_PROMPT:"0",GIT_OPTIONAL_LOCKS:"0",GIT_NO_LAZY_FETCH:"1",GIT_ATTR_NOSYSTEM:"1"};
  for(const key of ["PATH","SystemRoot","WINDIR","COMSPEC"])if(typeof process.env[key]==="string")env[key]=process.env[key];
  if(temp){env.TEMP=temp;env.TMP=temp;}
  return env;
}
function gitArguments(root,args){
  return ["--no-pager","--no-replace-objects","-c","core.fsmonitor=false","-c","core.longpaths=true","-c","color.ui=false",
    "-c","protocol.allow=never","-c","core.attributesFile=","-c","core.hooksPath="+join(root,".git","disabled-setup-hooks-"+randomUUID()),...args];
}
function gitRead(root,args,{binary=false,allowMissing=false}={}){
  const result=spawnSync("git",gitArguments(root,args),{cwd:root,shell:false,windowsHide:true,env:environment(),
    encoding:binary?undefined:"utf8",timeout:15000,maxBuffer:MAX_BYTES+1024*1024});
  if(result.error||result.signal||(result.status!==0&&!(allowMissing&&result.status===1))){
    const error=fail("project_setup_git_failed");error.terminationUnconfirmed=!!result.signal||result.error?.code==="ETIMEDOUT";throw error;
  }
  return result.stdout;
}
function inventory(root,expectedPaths){
  const files=[];let total=0,visited=0;
  const visit=(directory,prefix="")=>{
    for(const name of readdirSync(directory).sort()){
      if(!prefix&&name===".git")continue;
      if(++visited>4096)throw fail("project_setup_tree_limit");
      const path=setupRelativePath(prefix?prefix+"/"+name:name),full=join(directory,name),stat=lstatSync(full);
      if(stat.isSymbolicLink())throw fail("project_setup_source_alias");
      if(stat.isDirectory())visit(full,path);
      else if(stat.isFile()&&stat.size<=MAX_FILE){total+=stat.size;files.push({path,full});}
      else throw fail("project_setup_tree_limit");
      if(files.length>1024||total>MAX_BYTES)throw fail("project_setup_tree_limit");
    }
  };
  visit(root);files.sort((a,b)=>a.path.localeCompare(b.path));
  if(expectedPaths&&stable(files.map(e=>e.path).sort())!==stable([...expectedPaths].sort()))throw fail("project_setup_source_not_clean");
  // Extra/ignored files are rejected by name before reading any of their bytes.
  return files.map(({path,full})=>({path,sha256:sha(setupReadFile(full))}));
}
const acceptanceManifest=slot=>slot.acceptanceTests.map(path=>({path,sha256:sha(setupReadFile(join(slot.acceptanceRoot,...path.split("/"))))}));
function sourcePreflight(slot){
  const root=setupDirectory(slot.repositoryRoot);
  if(resolve(gitRead(root,["rev-parse","--show-toplevel"]).trim()).toLowerCase()!==root.toLowerCase())throw fail("project_setup_repository_root_required");
  const common=setupDirectory(resolve(root,gitRead(root,["rev-parse","--git-common-dir"]).trim()));
  if(setupRootsOverlap(slot.allocationRoot,common)||setupRootsOverlap(slot.acceptanceRoot,common))throw fail("project_setup_roots_overlap");
  // Built-in config reads do not execute configured hooks, filters or monitors.
  const attributes=gitRead(root,["config","--null","--get-regexp","^(core\\.attributesfile|extensions\\.worktreeconfig|extensions\\.partialclone|extensions\\.objectformat|remote\\..*\\.promisor|remote\\..*\\.partialclonefilter)$"],{allowMissing:true});
  // --get-regexp returns every matching value, including our empty command
  // override. Ignore only empty attributesFile values; substantive host config
  // remains refused and is never copied to the browser or evidence messages.
  if(attributes.split("\0").filter(Boolean).some(entry=>{
    const newline=entry.indexOf("\n");return newline<0||entry.slice(0,newline).toLowerCase()!=="core.attributesfile"||entry.slice(newline+1)!=="";
  }))throw fail("project_setup_external_git_configuration");
  for(const file of [join(common,"objects","info","alternates"),join(common,"objects","info","http-alternates")])
    if(existsSync(file))throw fail("project_setup_external_git_configuration");
  for(const file of [join(common,"info","attributes"),join(homedir(),".config","git","attributes")]){
    if(existsSync(file)&&(lstatSync(file).isSymbolicLink()||lstatSync(file).size!==0))throw fail("project_setup_git_attributes_forbidden");
  }
  const tree=gitRead(root,["ls-tree","-rz","--full-tree",slot.baseCommit]).split("\0").filter(Boolean);
  if(!tree.length||tree.length>1024)throw fail("project_setup_tree_limit");
  let bytes=0;const paths=[],seen=new Set();
  for(const entry of tree){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if(!match)throw fail("project_setup_non_regular_tree");
    const path=setupRelativePath(match[3]),fold=path.toLowerCase();
    if(seen.has(fold))throw fail("project_setup_case_collision");seen.add(fold);paths.push(path);
    if(basename(path).toLowerCase()===".gitattributes")throw fail("project_setup_git_attributes_forbidden");
    const content=gitRead(root,["cat-file","blob",match[2]],{binary:true});bytes+=content.length;
    if(content.length>MAX_FILE||bytes>MAX_BYTES)throw fail("project_setup_tree_limit");
  }
  if([...slot.publicTests,...slot.postApplyTests].some(path=>!paths.includes(path))||
    slot.postApplyTests.some(path=>slot.allowedEdits.some(e=>e.path===path))||
    slot.acceptanceTests.some(path=>paths.includes(path)||slot.allowedEdits.some(e=>e.path===path)))throw fail("project_setup_tests_not_pinned");
  const head=gitRead(root,["rev-parse","HEAD"]).trim();
  if(!/^[a-f0-9]{40}$/.test(head))throw fail("project_setup_source_not_clean");
  const headEntries=gitRead(root,["ls-tree","-rz","--full-tree",head]).split("\0").filter(Boolean);
  if(headEntries.length>1024)throw fail("project_setup_tree_limit");
  const sourcePaths=headEntries.map(entry=>{
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);if(!match)throw fail("project_setup_non_regular_tree");
    const path=setupRelativePath(match[3]);if(basename(path).toLowerCase()===".gitattributes")throw fail("project_setup_git_attributes_forbidden");return path;
  });
  const files=inventory(root,sourcePaths);
  if(gitRead(root,["status","--porcelain=v1","--untracked-files=all"]).trim())throw fail("project_setup_source_not_clean");
  return {head,sourceManifestDigest:digest(files),sourcePaths,acceptanceManifest:acceptanceManifest(slot),commonRoot:common};
}
function unchanged(slot,before){
  if(gitRead(slot.repositoryRoot,["rev-parse","HEAD"]).trim()!==before.head||digest(inventory(slot.repositoryRoot,before.sourcePaths))!==before.sourceManifestDigest||
    stable(acceptanceManifest(slot))!==stable(before.acceptanceManifest))throw fail("project_setup_inputs_changed");
}
function configFor(slot){
  const {allocationRoot,...rest}=slot;
  return {...rest,baselineRoot:join(allocationRoot,"b"),candidateRoot:join(allocationRoot,"c"),applyRoot:join(allocationRoot,"a"),
    evidenceRoot:join(allocationRoot,"e"),tempRoot:join(allocationRoot,"t")};
}
function publicJob(record){
  if(!record)return null;
  const fields=["id","slotId","requestId","status","reason","createdAt","updatedAt","terminationUnconfirmed","planDigest"];
  return Object.fromEntries(fields.filter(k=>Object.hasOwn(record.job,k)).map(k=>[k,record.job[k]]));
}
/** One durable attempt per slot. Failed/uncertain allocations require host reconciliation. */
export class ProjectSetup{
  constructor({root,slots=[],onPrepared}={}){
    if(typeof root!=="string"||!root||!isAbsolute(root))
      throw fail("project_setup_invalid_root");
    this.slots=validateProjectSetupSlots(slots);this.records=new Map();this.plans=new Map();this.pending=new Set();this.children=new Set();this.closed=false;
    this.onPrepared=onPrepared;this.root=resolve(root,"project-setup");
    const commonRoots=this.slots.map(slot=>setupDirectory(resolve(slot.repositoryRoot,gitRead(slot.repositoryRoot,["rev-parse","--git-common-dir"]).trim())));
    for(const [index,slot] of this.slots.entries()){
      const common=commonRoots[index];
      for(const path of [slot.repositoryRoot,slot.acceptanceRoot,slot.allocationRoot,common])
        if(setupRootsOverlap(this.root,path))throw fail("project_setup_roots_overlap");
      if(setupRootsOverlap(slot.allocationRoot,common)||setupRootsOverlap(slot.acceptanceRoot,common))throw fail("project_setup_roots_overlap");
    }
    for(const slot of this.slots)for(const common of commonRoots)
      if(setupRootsOverlap(slot.allocationRoot,common)||setupRootsOverlap(slot.acceptanceRoot,common))throw fail("project_setup_roots_overlap");
    // Runtime root is owner supplied; verify all existing ancestors before creation.
    let existing=this.root;while(!existsSync(existing))existing=dirname(existing);setupDirectory(existing);
    mkdirSync(this.root,{recursive:true,mode:0o700});setupDirectory(this.root);
    this.definitions=new Map(this.slots.map(slot=>[slot.id,{slot,setupDigest:digest({slot,acceptanceManifest:acceptanceManifest(slot)})}]));
    for(const slot of this.slots){
      const file=this.file(slot.id);if(!existsSync(file))continue;
      let record;try{record=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(setupReadFile(file,65536)));}catch{throw fail("project_setup_ledger_invalid");}
      if(record.schemaVersion!==1||record.slotId!==slot.id||record.setupDigest!==this.definitions.get(slot.id).setupDigest||
        record.allocationRoot!==slot.allocationRoot||!record.job||record.job.slotId!==slot.id||
        !/^setup_job_[a-f0-9]{32}$/.test(record.job.id)||!/^setup_[a-f0-9]{32}$/.test(record.job.requestId)||
        !["queued","preparing","ready","requires_owner_reconciliation"].includes(record.job.status))throw fail("project_setup_ledger_invalid");
      if(["queued","preparing"].includes(record.job.status)){
        record.job.status="requires_owner_reconciliation";record.job.reason="project_setup_interrupted";record.job.terminationUnconfirmed=true;
        record.job.updatedAt=new Date().toISOString();writeAtomicJson(file,record);
      }
      this.records.set(slot.id,record);
    }
  }
  file(id){return join(this.root,id+".json");}
  setOnPrepared(callback){if(callback!==undefined&&typeof callback!=="function")throw fail("project_setup_callback_required");this.onPrepared=callback;}
  slotPublic(slot){
    const record=this.records.get(slot.id);
    return {id:slot.id,label:slot.label,setupDigest:this.definitions.get(slot.id).setupDigest,status:record?.job.status||"unprepared",
      publicScope:{baseCommit:slot.baseCommit,allowedEdits:clone(slot.allowedEdits),publicTests:[...slot.publicTests],
        postApplyTests:[...slot.postApplyTests],acceptanceTestCount:slot.acceptanceTests.length},job:publicJob(record)};
  }
  catalog(){return {slots:this.slots.map(s=>this.slotPublic(s)),activeJobs:[...this.records.values()].filter(r=>["queued","preparing"].includes(r.job.status)).map(publicJob)};}
  state(input){
    if(!input||Object.keys(input).length!==1||!Object.hasOwn(input,"slotId")||!this.definitions.has(input.slotId))throw fail("project_setup_slot_required");
    return {slot:this.slotPublic(this.definitions.get(input.slotId).slot),job:publicJob(this.records.get(input.slotId))};
  }
  save(record){setupDirectory(this.root);record.job.updatedAt=new Date().toISOString();writeAtomicJson(this.file(record.slotId),record);}
  verifyMarker(slot,record){
    setupDirectory(slot.allocationRoot);let marker;
    for(const name of readdirSync(slot.allocationRoot)){
      if(![markerName,"a","b","c","e","t"].includes(name))throw fail("project_setup_allocation_not_owned");
      if(name!==markerName)setupDirectory(join(slot.allocationRoot,name));
    }
    try{marker=JSON.parse(setupReadFile(join(slot.allocationRoot,markerName),4096));}catch{throw fail("project_setup_allocation_not_owned");}
    if(stable(marker)!==stable({schemaVersion:1,slotId:slot.id,setupDigest:record.setupDigest,jobId:record.job.id,ownerNonce:record.ownerNonce,
      runtimeRoot:this.root}))throw fail("project_setup_allocation_not_owned");
  }
  preparedPlans(){
    const plans=[];
    for(const slot of this.slots){
      const record=this.records.get(slot.id);if(record?.job.status!=="ready")continue;
      sourcePreflight(slot);this.verifyMarker(slot,record);unchanged(slot,record.source);
      const plan=createRegisteredProjectPlan(configFor(slot));
      if(plan.planDigest!==record.job.planDigest)throw fail("project_setup_prepared_plan_changed");
      this.plans.set(slot.id,plan);plans.push(plan);
    }
    return plans;
  }
  prepare(input){
    const fields=["slotId","setupDigest","requestId","allowPrepare"];
    if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==fields.length||fields.some(k=>!Object.hasOwn(input,k))||
      input.allowPrepare!==true||typeof input.requestId!=="string"||!/^setup_[a-f0-9]{32}$/.test(input.requestId))throw fail("project_setup_explicit_prepare_required");
    const definition=this.definitions.get(input.slotId);if(!definition)throw fail("project_setup_slot_required");
    if(input.setupDigest!==definition.setupDigest)throw fail("project_setup_digest_mismatch");
    const previous=this.records.get(input.slotId);
    if(previous){
      if(previous.job.requestId===input.requestId)return {job:publicJob(previous),duplicate:true};
      throw fail("project_setup_slot_already_attempted");
    }
    if(this.closed)throw fail("project_setup_closed");
    if([...this.records.values()].some(r=>r.job.requestId===input.requestId))throw fail("project_setup_request_id_reused");
    const now=new Date().toISOString(),record={schemaVersion:1,slotId:input.slotId,setupDigest:input.setupDigest,allocationRoot:definition.slot.allocationRoot,
      ownerNonce:randomBytes(32).toString("hex"),job:{id:"setup_job_"+randomBytes(16).toString("hex"),slotId:input.slotId,requestId:input.requestId,
        status:"queued",reason:null,createdAt:now,updatedAt:now,terminationUnconfirmed:false}};
    // Exclusive intent creation prevents a second process from redispatching this slot.
    setupDirectory(this.root);
    const fd=openSync(this.file(input.slotId),"wx",0o600);try{writeFileSync(fd,JSON.stringify(record));}finally{closeSync(fd);}
    this.records.set(input.slotId,record);
    const pending=new Promise(resolve=>setImmediate(resolve)).then(()=>this.run(definition.slot,record));
    this.pending.add(pending);pending.then(()=>this.pending.delete(pending),()=>this.pending.delete(pending));
    return {job:publicJob(record),duplicate:false};
  }
  assertActive(record){
    if(this.closed)throw fail("project_setup_cancelled");
    const persisted=JSON.parse(setupReadFile(this.file(record.slotId),65536));
    if(persisted.job.id!==record.job.id||!["queued","preparing"].includes(persisted.job.status))throw fail("project_setup_job_not_active");
  }
  async gitWrite(slot,args,record,temp){
    this.assertActive(record);
    return await new Promise((resolvePromise,reject)=>{
      const child=spawn("git",gitArguments(temp,args),{cwd:slot.repositoryRoot,shell:false,windowsHide:true,env:environment(temp),stdio:["ignore","pipe","pipe"]});
      this.children.add(child);let size=0,settled=false,forced=false,killTimer;
      const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(killTimer);this.children.delete(child);error?reject(error):resolvePromise();};
      const stop=()=>{forced=true;child.kill();killTimer=setTimeout(()=>{const e=fail("project_setup_git_termination_unconfirmed");e.terminationUnconfirmed=true;finish(e);},3000);};
      const timer=setTimeout(stop,15000);
      for(const stream of [child.stdout,child.stderr])stream.on("data",bytes=>{size+=bytes.length;if(size>2*1024*1024&&!forced)stop();});
      child.once("error",()=>finish(fail("project_setup_git_failed")));
      child.once("close",(code,signal)=>{
        if(forced||signal||code!==0||this.closed){const e=fail(this.closed?"project_setup_cancelled":"project_setup_git_failed");e.terminationUnconfirmed=forced||!!signal;finish(e);}
        else finish();
      });
    });
  }
  async run(slot,record){
    try{
      this.assertActive(record);const before=sourcePreflight(slot);
      if(stable(before.acceptanceManifest)!==stable(acceptanceManifest(slot))||
        digest({slot,acceptanceManifest:before.acceptanceManifest})!==record.setupDigest)throw fail("project_setup_inputs_changed");
      setupDirectory(dirname(slot.allocationRoot));
      if(existsSync(slot.allocationRoot)){
        setupDirectory(slot.allocationRoot);if(readdirSync(slot.allocationRoot).length)throw fail("project_setup_allocation_not_empty");
      }else mkdirSync(slot.allocationRoot,{mode:0o700});
      const marker={schemaVersion:1,slotId:slot.id,setupDigest:record.setupDigest,jobId:record.job.id,ownerNonce:record.ownerNonce,runtimeRoot:this.root};
      const fd=openSync(join(slot.allocationRoot,markerName),"wx",0o600);try{writeFileSync(fd,JSON.stringify(marker));}finally{closeSync(fd);}
      record.source=before;record.job.status="preparing";this.save(record);this.verifyMarker(slot,record);
      const config=configFor(slot);
      for(const key of ["evidenceRoot","tempRoot"]){if(existsSync(config[key]))throw fail("project_setup_allocation_not_empty");mkdirSync(config[key],{mode:0o700});}
      for(const key of ["baselineRoot","candidateRoot","applyRoot"]){
        this.assertActive(record);this.verifyMarker(slot,record);unchanged(slot,before);
        if(existsSync(config[key]))throw fail("project_setup_allocation_not_empty");
        await this.gitWrite(slot,["worktree","add","--detach",config[key],slot.baseCommit],record,config.tempRoot);
      }
      this.assertActive(record);this.verifyMarker(slot,record);unchanged(slot,before);
      // Issuance uses the existing registration checks; it runs no test program.
      const plan=createRegisteredProjectPlan(config);this.assertActive(record);unchanged(slot,before);
      record.job.status="ready";record.job.planDigest=plan.planDigest;record.job.reason=null;this.save(record);
      // Activation must never expose a plan whose durable ready save failed.
      // A crash before this callback is recovered by preparedPlans(), without execution.
      if(this.closed)throw fail("project_setup_cancelled");
      if(this.onPrepared)await this.onPrepared(plan);
      this.plans.set(slot.id,plan);
    }catch(error){
      record.job.status="requires_owner_reconciliation";record.job.reason=safeReason(error);
      delete record.job.planDigest;record.job.terminationUnconfirmed=!!error?.terminationUnconfirmed;this.save(record);
    }
  }
  async waitForIdle(){await Promise.all([...this.pending]);}
  async close(){
    this.closed=true;
    for(const child of this.children)child.kill();
    await Promise.race([this.waitForIdle(),new Promise(resolve=>{const timer=setTimeout(resolve,4000);timer.unref?.();})]);
  }
}
