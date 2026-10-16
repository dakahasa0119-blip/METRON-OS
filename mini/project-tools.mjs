/** Owner-registered, trusted first-party development primitives.
 * These are not a hostile-JavaScript sandbox. The caller owns durable intent,
 * worker quarantine and an exclusive apply-root lock across apply/check/recovery.
 * No model commands, remote operations, installs, hooks or forced checkouts.
 */
import {spawnSync,spawn} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,lstatSync,readdirSync,realpathSync,existsSync,rmSync} from "node:fs";
import {join,resolve,isAbsolute,relative,sep,parse,dirname} from "node:path";

const MAX_FILES=1024,MAX_FILE=2*1024*1024,MAX_BYTES=32*1024*1024,MAX_OUTPUT=2*1024*1024;
const fail=code=>Object.assign(new Error(code),{code});
const sha=value=>createHash("sha256").update(value).digest("hex");
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=value=>sha(stable(value));
const fullSha=value=>typeof value==="string"&&/^[a-f0-9]{40}$/.test(value);
const identifier=value=>typeof value==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
const freeze=value=>{if(value&&typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const registeredPlans=new WeakSet(),revisionProofs=new WeakMap();
function safePath(value){
  if(typeof value!=="string"||!value||value.length>180||isAbsolute(value)||/[\\:\x00-\x1f\x7f]/.test(value)||
     value.split("/").some(p=>!p||p==="."||p===".."||/[. ]$/.test(p)||
       /^(?:\.git|node_modules)$/i.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(p)))
    throw fail("project_unsafe_relative_path");
  return value;
}
const contained=(parent,path)=>{const rel=relative(parent,path);return !!rel&&!isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+sep);};
function regularAncestors(path,includeFile=false){
  const absolute=resolve(path),parts=relative(parse(absolute).root,absolute).split(sep);let current=parse(absolute).root;
  for(let i=0;i<parts.length-(includeFile?0:1);i++){
    current=join(current,parts[i]);const stat=lstatSync(current);
    if(stat.isSymbolicLink()||(!stat.isDirectory()&&i<parts.length-1))throw fail("project_symlink_or_non_directory");
  }
}
function rootDirectory(value){
  if(typeof value!=="string"||!isAbsolute(value))throw fail("project_absolute_root_required");
  regularAncestors(value,true);const stat=lstatSync(value);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw fail("project_directory_required");
  return realpathSync(value);
}
function environment(temp){
  const env={};for(const key of ["PATH","SystemRoot","WINDIR","COMSPEC"])
    if(typeof process.env[key]==="string")env[key]=process.env[key];
  if(temp){env.TEMP=temp;env.TMP=temp;}
  return env;
}
function git(root,args,{binary=false,hooksRoot}={}){
  const options=["--no-replace-objects","-c","core.fsmonitor=false","-c","core.longpaths=true","-c","color.ui=false",
    "-c","core.attributesFile=",
    "-c","core.hooksPath="+(hooksRoot||join(root,".git","disabled-project-hooks-"+randomUUID()))];
  const result=spawnSync("git",[...options,...args],{cwd:root,shell:false,windowsHide:true,
    env:{...environment(),GIT_TERMINAL_PROMPT:"0",GIT_ATTR_NOSYSTEM:"1",GIT_NO_LAZY_FETCH:"1"},encoding:binary?undefined:"utf8",timeout:15000,maxBuffer:MAX_BYTES+1024*1024});
  if(result.error||result.status!==0){
    const error=fail("project_git_failed");
    error.terminationUnconfirmed=result.error?.code==="ETIMEDOUT"||!!result.signal;
    throw error;
  }
  return result.stdout;
}
const blob=(plan,commit,path)=>git(plan.repositoryRoot,["show",commit+":"+safePath(path)],{binary:true});
function commitTree(plan,commit){
  if(!fullSha(commit))throw fail("project_full_commit_required");
  const entries=git(plan.repositoryRoot,["ls-tree","-rz","--full-tree",commit]).split("\0").filter(Boolean);
  if(!entries.length||entries.length>MAX_FILES)throw fail("project_tree_size_limit");
  let size=0;
  return entries.map(entry=>{
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if(!match)throw fail("project_non_regular_tree_entry");
    const path=safePath(match[3]),bytes=blob(plan,commit,path);size+=bytes.length;
    if(bytes.length>MAX_FILE||size>MAX_BYTES)throw fail("project_tree_size_limit");
    return {path,mode:match[1],object:match[2],size:bytes.length};
  });
}
function inventory(root){
  const files=[];let visited=0;
  const visit=(directory,prefix="")=>{
    for(const name of readdirSync(directory).sort()){
      if(!prefix&&name===".git")continue;
      if(++visited>MAX_FILES*4)throw fail("project_checkout_size_limit");
      const path=prefix?prefix+"/"+name:name;safePath(path);
      const stat=lstatSync(join(directory,name));
      if(stat.isSymbolicLink())throw fail("project_symlink_or_non_directory");
      if(stat.isDirectory())visit(join(directory,name),path);
      else if(stat.isFile()&&stat.size<=MAX_FILE)files.push(path);
      else throw fail("project_non_regular_checkout_file");
    }
  };
  visit(root);return files.sort();
}
function readRegular(root,path){
  const full=join(root,...safePath(path).split("/"));regularAncestors(full);
  const stat=lstatSync(full);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE)throw fail("project_non_regular_checkout_file");
  return readFileSync(full);
}
const gitObject=bytes=>createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
function checkoutProof(plan,root,commit){
  root=rootDirectory(root);
  if(resolve(git(root,["rev-parse","--show-toplevel"]).trim())!==resolve(root)||
     resolve(root,git(root,["rev-parse","--git-common-dir"]).trim())!==plan.commonRoot||
     git(root,["rev-parse","HEAD"]).trim()!==commit)throw fail("project_checkout_identity_changed");
  if(git(root,["status","--porcelain=v1","--untracked-files=all"]).trim())throw fail("project_checkout_not_clean");
  const entries=commitTree(plan,commit),paths=entries.map(e=>e.path).sort();
  if(stable(paths)!==stable(inventory(root)))throw fail("project_untracked_execution_input");
  return digest(entries.map(entry=>{
    const bytes=readRegular(root,entry.path),normalized=Buffer.from(bytes.toString("utf8").replace(/\r\n/g,"\n"));
    if(gitObject(bytes)!==entry.object&&(bytes.includes(0)||gitObject(normalized)!==entry.object))
      throw fail("project_tracked_bytes_changed");
    return [entry.path,sha(bytes)];
  }));
}
function tests(value){
  if(!Array.isArray(value)||value.length<1||value.length>8||new Set(value).size!==value.length)
    throw fail("project_fixed_tests_required");
  return Array.from(value,path=>{safePath(path);if(!path.endsWith(".test.mjs"))throw fail("project_node_test_path_required");return path;});
}
const publicKeys=["schemaVersion","id","label","baseCommit","allowedEdits","publicTests","postApplyTests",
  "acceptanceTestCount","acceptanceManifestDigest","baselineManifestDigest"];
export function projectPlanPublic(plan){
  const visible=Object.fromEntries(publicKeys.map(key=>[key,plan[key]]));
  return structuredClone({...visible,planDigest:plan.planDigest});
}
export function createRegisteredProjectPlan(input){
  const keys=["id","label","repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot",
    "acceptanceRoot","baseCommit","allowedEdits","publicTests","acceptanceTests","postApplyTests"];
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==keys.length||
     keys.some(key=>!Object.hasOwn(input,key))||!identifier(input.id)||typeof input.label!=="string"||
     !input.label.trim()||input.label!==input.label.trim()||input.label.length>120||!fullSha(input.baseCommit))
    throw fail("project_invalid_registration");
  const roots=Object.fromEntries(keys.filter(key=>key.endsWith("Root")).map(key=>[key,rootDirectory(input[key])]));
  const values=Object.values(roots);
  for(let i=0;i<values.length;i++)for(let j=0;j<i;j++)
    if(values[i]===values[j]||contained(values[i],values[j])||contained(values[j],values[i]))throw fail("project_roots_overlap");
  const plan={schemaVersion:1,id:input.id,label:input.label,baseCommit:input.baseCommit,...roots};
  plan.commonRoot=resolve(plan.repositoryRoot,git(plan.repositoryRoot,["rev-parse","--git-common-dir"]).trim());
  if(!Array.isArray(input.allowedEdits)||!input.allowedEdits.length||input.allowedEdits.length>64)
    throw fail("project_edit_allowlist_required");
  const seen=new Set();
  plan.allowedEdits=Array.from(input.allowedEdits,entry=>{
    if(!entry||Object.keys(entry).length!==2||!Object.hasOwn(entry,"path")||!Object.hasOwn(entry,"operations")||
       !Array.isArray(entry.operations)||!entry.operations.length||entry.operations.length>3||
       new Set(entry.operations).size!==entry.operations.length||
       Array.from(entry.operations).some(op=>!["edit","add","delete"].includes(op)))throw fail("project_invalid_edit_allowlist");
    const path=safePath(entry.path);if(seen.has(path))throw fail("project_invalid_edit_allowlist");seen.add(path);
    return {path,operations:[...entry.operations]};
  });
  plan.publicTests=tests(input.publicTests);plan.acceptanceTests=tests(input.acceptanceTests);plan.postApplyTests=tests(input.postApplyTests);
  const baseEntries=commitTree(plan,plan.baseCommit),basePaths=new Set(baseEntries.map(e=>e.path));
  if([...plan.publicTests,...plan.postApplyTests].some(path=>!basePaths.has(path))||
     plan.postApplyTests.some(path=>seen.has(path)))throw fail("project_tests_not_pinned");
  if(plan.acceptanceTests.some(path=>basePaths.has(path)||seen.has(path)))throw fail("project_acceptance_visible_to_worker");
  plan.acceptanceManifest=plan.acceptanceTests.map(path=>({path,sha256:sha(readRegular(plan.acceptanceRoot,path))}));
  plan.acceptanceTestCount=plan.acceptanceTests.length;plan.acceptanceManifestDigest=digest(plan.acceptanceManifest);
  plan.baselineManifestDigest=digest(baseEntries);
  checkoutProof(plan,plan.baselineRoot,plan.baseCommit);
  // Registration may observe a previously applied scoped descendant for durable
  // recovery. It never switches that checkout or declares it verified.
  const applyHead=git(plan.applyRoot,["rev-parse","HEAD"]).trim();
  candidateDiff(plan,applyHead);checkoutProof(plan,plan.applyRoot,applyHead);
  const candidateHead=git(plan.candidateRoot,["rev-parse","HEAD"]).trim();
  git(plan.repositoryRoot,["merge-base","--is-ancestor",plan.baseCommit,candidateHead]);checkoutProof(plan,plan.candidateRoot,candidateHead);
  plan.hooksRoot=mkdtempSync(join(plan.tempRoot,"disabled-project-hooks-"));
  plan.planDigest=digest(Object.fromEntries(publicKeys.map(key=>[key,plan[key]])));
  registeredPlans.add(plan);
  return freeze(plan);
}
function workerRootFor(plan,root=plan.candidateRoot){
  const actual=rootDirectory(root);
  if(actual!==plan.candidateRoot&&!contained(join(plan.tempRoot,"worker-attempts"),actual))throw fail("project_worker_root_not_registered");
  return actual;
}
function candidateDiff(plan,commit){
  if(!fullSha(commit))throw fail("project_full_commit_required");
  git(plan.repositoryRoot,["merge-base","--is-ancestor",plan.baseCommit,commit]);
  const entries=commitTree(plan,commit);
  if(entries.some(entry=>plan.acceptanceTests.includes(entry.path)))throw fail("project_acceptance_visible_to_worker");
  for(const path of plan.postApplyTests){
    if(sha(blob(plan,commit,path))!==sha(blob(plan,plan.baseCommit,path)))throw fail("project_post_apply_test_changed");
  }
  const fields=git(plan.repositoryRoot,["diff","--no-ext-diff","--no-textconv","--raw","--no-abbrev","-z","--no-renames",plan.baseCommit,commit]).split("\0");
  const changedPaths=[];
  for(let index=0;fields[index];index+=2){
    const match=/^:(\d{6}) (\d{6}) [a-f0-9]{40} [a-f0-9]{40} ([AMD])$/.exec(fields[index]);
    const path=safePath(fields[index+1]),allowed=plan.allowedEdits.find(entry=>entry.path===path);
    const operation=match&&({A:"add",M:"edit",D:"delete"})[match[3]];
    if(!match||!allowed?.operations.includes(operation)||
       (match[3]==="M"&&match[1]!==match[2]))throw fail("project_candidate_out_of_scope");
    changedPaths.push(path);
  }
  const diff=git(plan.repositoryRoot,["diff","--no-ext-diff","--no-textconv","--binary","--no-renames",plan.baseCommit,commit]);
  if(Buffer.byteLength(diff)>1024*1024)throw fail("project_diff_size_limit");
  return {candidateCommit:commit,changedPaths:changedPaths.sort(),diffSha256:sha(diff),diff};
}
export function registeredAttemptRoot(plan,{sessionId,attemptId}={}){
  if(!identifier(sessionId)||!identifier(attemptId))throw fail("project_attempt_identity_required");
  // Git for Windows still bounds $GIT_DIR even with core.longpaths. Keep the
  // physical directory names short; full IDs remain bound in the ledger. A
  // collision fails closed because createRegisteredAttempt never reuses roots.
  return join(plan.tempRoot,"worker-attempts",sha(sessionId).slice(0,16),sha(attemptId).slice(0,16));
}
export function createRegisteredAttempt(plan,{sessionId,attemptId,parentCommit}={}){
  const root=registeredAttemptRoot(plan,{sessionId,attemptId});
  candidateDiff(plan,parentCommit);
  let parent=rootDirectory(plan.tempRoot);
  for(const part of ["worker-attempts",sha(sessionId).slice(0,16)]){
    const child=join(parent,part);if(!existsSync(child))mkdirSync(child);
    parent=rootDirectory(child);
  }
  regularAncestors(root);
  if(existsSync(root))throw fail("project_attempt_root_already_exists");
  git(plan.repositoryRoot,["worktree","add","--detach",root,parentCommit],{hooksRoot:plan.hooksRoot});
  checkoutProof(plan,root,parentCommit);return {root,commit:parentCommit};
}
export function inspectRegisteredCandidate(plan,commit,{workerRoot}={}){
  return {...candidateDiff(plan,commit),sourceProof:checkoutProof(plan,workerRootFor(plan,workerRoot),commit)};
}
export function inspectRegisteredProjectRevision(previousPlan,newPlan,{previousCandidateCommit}={}){
  const scope=plan=>plan.allowedEdits.map(entry=>({path:entry.path,operations:[...entry.operations].sort()}))
    .sort((a,b)=>a.path.localeCompare(b.path));
  if(previousPlan.id===newPlan.id||previousPlan.commonRoot!==newPlan.commonRoot||
     stable(scope(previousPlan))!==stable(scope(newPlan)))throw fail("project_revision_registration_mismatch");
  const repositories=[];
  for(const plan of [previousPlan,newPlan]){
    const root=rootDirectory(plan.repositoryRoot);
    if(resolve(root,git(root,["rev-parse","--git-common-dir"]).trim())!==plan.commonRoot)
      throw fail("project_revision_registration_mismatch");
    // Keep live directory checks even when reusing an immutable-object proof.
    repositories.push(...[rootDirectory(plan.commonRoot),rootDirectory(join(plan.commonRoot,"objects"))].map(path=>{
      const stat=lstatSync(path,{bigint:true});return [path,String(stat.dev),String(stat.ino),String(stat.birthtimeNs)];
    }));
  }
  const identity=digest(repositories),cacheable=registeredPlans.has(previousPlan)&&registeredPlans.has(newPlan);
  let cache;
  if(cacheable){
    let next=revisionProofs.get(previousPlan);if(!next){next=new WeakMap();revisionProofs.set(previousPlan,next);}
    cache=next.get(newPlan);if(!cache){cache=new Map();next.set(newPlan,cache);}
    const saved=cache.get(previousCandidateCommit);
    if(saved?.identity===identity)return structuredClone(saved.proof);
  }
  candidateDiff(previousPlan,previousCandidateCommit);
  git(newPlan.repositoryRoot,["merge-base","--is-ancestor",previousCandidateCommit,newPlan.baseCommit]);
  const before=new Map(commitTree(previousPlan,previousCandidateCommit).map(entry=>[entry.path,entry]));
  const after=new Map(commitTree(newPlan,newPlan.baseCommit).map(entry=>[entry.path,entry]));
  if(previousPlan.acceptanceTests.some(path=>after.has(path)))throw fail("project_revision_acceptance_visible");
  const requirements=new Set([...previousPlan.publicTests,...previousPlan.postApplyTests,
    ...newPlan.publicTests,...newPlan.postApplyTests,"README.md"]);
  const source=new Set(newPlan.allowedEdits.map(entry=>entry.path)),changedRequirementPaths=[];
  for(const path of new Set([...before.keys(),...after.keys()])){
    const a=before.get(path),b=after.get(path);
    if(a?.object===b?.object&&a?.mode===b?.mode)continue;
    if(source.has(path)||!requirements.has(path))throw fail("project_revision_source_changed");
    changedRequirementPaths.push(path);
  }
  if(!changedRequirementPaths.length)throw fail("project_revision_requirements_unchanged");
  const diff=git(newPlan.repositoryRoot,["diff","--no-ext-diff","--no-textconv","--binary","--no-renames",previousCandidateCommit,newPlan.baseCommit]);
  if(Buffer.byteLength(diff)>1024*1024)throw fail("project_diff_size_limit");
  const proof={previousCandidateCommit,newBaseCommit:newPlan.baseCommit,sourceUnchanged:true,
    requirementDiffSha256:sha(diff),changedRequirementPaths:changedRequirementPaths.sort()};
  // Git content-addressed objects are immutable in ordinary development. Cache
  // only successful source proofs for these exact registered frozen objects;
  // session/checkout state stays live, and restart/new registration proves again.
  if(cache){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(previousCandidateCommit,{identity,proof:freeze(structuredClone(proof))});}
  return proof;
}
function workingFiles(plan,root){
  const head=git(root,["rev-parse","HEAD"]).trim();candidateDiff(plan,head);
  const original=new Map(commitTree(plan,head).map(entry=>[entry.path,entry]));
  const actual=new Map(inventory(root).map(path=>[path,readRegular(root,path)]));
  if([...actual.values()].reduce((size,bytes)=>size+bytes.length,0)>MAX_BYTES)throw fail("project_tree_size_limit");
  const changed=new Set();
  for(const path of new Set([...original.keys(),...actual.keys()])){
    const entry=original.get(path),bytes=actual.get(path);
    const operation=!entry?"add":!bytes?"delete":
      gitObject(bytes)!==entry.object&&gitObject(Buffer.from(bytes.toString("utf8").replace(/\r\n/g,"\n")))!==entry.object?"edit":null;
    if(operation){
      if(!plan.allowedEdits.find(allowed=>allowed.path===path)?.operations.includes(operation))throw fail("project_candidate_out_of_scope");
      changed.add(path);
    }
  }
  // Reject unresolved stages, symlinks and submodules already placed in the
  // index, including content that the actual working file no longer shows.
  for(const entry of git(root,["ls-files","--stage","-z"]).split("\0").filter(Boolean)){
    const match=/^(100644|100755) [a-f0-9]{40} 0\t(.+)$/.exec(entry);
    if(!match)throw fail("project_non_regular_index_entry");safePath(match[2]);
  }
  for(const indexOnly of [false,true]){
    const staged=git(root,["diff",...(indexOnly?["--cached"]:[]),"--no-ext-diff","--no-textconv","--raw","--no-abbrev","-z","--no-renames",...(indexOnly?["HEAD"]:[])]).split("\0");
    for(let index=0;staged[index];index+=2){
      const match=/^:(\d{6}) (\d{6}) [a-f0-9]{40} [a-f0-9]{40} ([AMD])$/.exec(staged[index]);
      const path=safePath(staged[index+1]),operation=match&&({A:"add",M:"edit",D:"delete"})[match[3]];
      if(!match||!plan.allowedEdits.find(allowed=>allowed.path===path)?.operations.includes(operation)||
         (match[3]==="M"&&match[1]!==match[2]))throw fail("project_candidate_out_of_scope");
      changed.add(path);
    }
  }
  return {head,changed:[...changed].sort(),proof:digest([...actual].sort(([a],[b])=>a.localeCompare(b)).map(([path,bytes])=>[path,sha(bytes)]))};
}
export function commitRegisteredWorkspace(plan,{workerRoot,message}={}){
  if(typeof message!=="string"||!message.trim()||message.length>500||message.includes("\0"))throw fail("project_commit_message_required");
  const root=workerRootFor(plan,workerRoot),before=workingFiles(plan,root);
  if(!before.changed.length)throw fail("project_no_candidate_changes");
  git(root,["add","-A","--",...before.changed],{hooksRoot:plan.hooksRoot});
  // The identity and signing settings apply only to this one local commit.
  git(root,["-c","user.name=Codex","-c","user.email=codex@local.invalid","-c","commit.gpgsign=false",
    "commit","--no-gpg-sign","-m",message],{hooksRoot:plan.hooksRoot});
  const commit=git(root,["rev-parse","HEAD"]).trim(),result=inspectRegisteredCandidate(plan,commit,{workerRoot:root});
  if(workingFiles(plan,root).proof!==before.proof)throw fail("project_commit_input_changed");
  return result;
}
function materialize(plan,commit,kind){
  const root=mkdtempSync(join(plan.tempRoot,"project-verification-")),expected=new Map();
  const put=(path,bytes)=>{const target=join(root,...path.split("/"));mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);expected.set(path,sha(bytes));};
  for(const entry of commitTree(plan,commit))put(entry.path,blob(plan,commit,entry.path));
  // Candidate edits to a public test cannot redefine the owner's reproducer.
  for(const path of plan.publicTests)put(path,blob(plan,plan.baseCommit,path));
  if(kind==="acceptance")for(const entry of plan.acceptanceManifest){
    const bytes=readRegular(plan.acceptanceRoot,entry.path);
    if(sha(bytes)!==entry.sha256)throw fail("project_acceptance_input_changed");put(entry.path,bytes);
  }
  return {root,expected};
}
function copyProof(root,expected){
  const paths=[...expected.keys()].sort();if(stable(paths)!==stable(inventory(root)))throw fail("project_validation_input_changed");
  const actual=paths.map(path=>[path,sha(readRegular(root,path))]);
  if(actual.some(([path,hash])=>expected.get(path)!==hash))throw fail("project_validation_input_changed");
  return digest(actual);
}
function summary(output){
  const clean=output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"");
  const result=Object.fromEntries(["tests","pass","fail","cancelled","skipped","todo"].map(name=>{
    const matches=[...clean.matchAll(new RegExp("^#\\s+"+name+" (\\d+)\\r?$","gm"))];return [name,matches.length?Number(matches.at(-1)[1]):null];
  }));
  return Object.values(result).every(Number.isSafeInteger)?result:null;
}
function execute(plan,root,paths,kind,attemptId,signal){
  return new Promise(resolveResult=>{
    let child,settled=false,timedOut=false,forced=false,error=null,size=0,grace;const chunks=[];
    const finish=(exitCode,terminationConfirmed=true)=>{
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(grace);signal?.removeEventListener("abort",abort);
      let output=Buffer.concat(chunks).toString("utf8");
      for(const path of [root,plan.repositoryRoot,plan.baselineRoot,plan.candidateRoot,plan.applyRoot,plan.acceptanceRoot,plan.evidenceRoot,plan.tempRoot])
        output=output.replaceAll(path,"<registered-project>").replaceAll(path.replaceAll("\\","/"),"<registered-project>");
      let logFile=attemptId+"-"+kind+"-"+randomUUID()+".tap";
      try{writeFileSync(join(plan.evidenceRoot,logFile),output,{flag:"wx"});}catch{error="project_log_write_failed";logFile=null;}
      resolveResult({check:{id:kind,exitCode,timedOut,error,terminationConfirmed,outputSha256:sha(output),logFile,output,testSummary:summary(output)},uncertain:forced||!terminationConfirmed});
    };
    const stop=reason=>{
      if(settled||forced)return;forced=true;error=reason;
      grace=setTimeout(()=>finish(null,false),2000);try{child?.kill("SIGKILL");}catch{ /* Stop request is not exit confirmation. */ }
    };
    const abort=()=>stop("project_check_cancelled");
    const timer=setTimeout(()=>{timedOut=true;stop("project_check_timeout");},30000);
    if(signal?.aborted){error="project_check_cancelled";finish(null);return;}
    signal?.addEventListener("abort",abort,{once:true});
    try{
      child=spawn(process.execPath,["--permission","--allow-fs-read="+root,"--allow-fs-write="+root,
        "--test","--test-isolation=none","--test-concurrency=1","--test-reporter=tap",...paths.map(path=>"./"+path)],{
        cwd:root,shell:false,windowsHide:true,env:environment(plan.tempRoot),stdio:["ignore","pipe","pipe"]});
      const collect=chunk=>{if(settled||forced)return;const remaining=MAX_OUTPUT-size;chunks.push(chunk.subarray(0,Math.max(0,remaining)));size+=chunk.length;if(size>MAX_OUTPUT)stop("project_check_output_limit");};
      child.stdout.on("data",collect);child.stderr.on("data",collect);
      child.stdout.on("error",()=>stop("project_check_stream_failed"));child.stderr.on("error",()=>stop("project_check_stream_failed"));
      child.once("error",()=>{if(!child.pid){error="project_check_spawn_failed";finish(null);}else stop("project_check_process_failed");});
      child.once("close",code=>finish(code));
    }catch{error="project_check_spawn_failed";finish(null);}
  });
}
export async function runRegisteredChecks(plan,{kind,commit,attemptId,signal,workerRoot}={}){
  if(!["baseline","public","acceptance","post_apply"].includes(kind)||!identifier(attemptId))throw fail("project_invalid_check_request");
  if(kind==="baseline"&&commit!==plan.baseCommit)throw fail("project_baseline_commit_changed");
  rootDirectory(plan.tempRoot);rootDirectory(plan.evidenceRoot);
  const sourceRoot=kind==="baseline"?plan.baselineRoot:kind==="post_apply"?plan.applyRoot:workerRootFor(plan,workerRoot);
  if(kind!=="baseline")candidateDiff(plan,commit);
  const sourceBefore=checkoutProof(plan,sourceRoot,commit);
  const staged=kind==="post_apply"?null:materialize(plan,commit,kind),root=staged?.root||sourceRoot;
  const copyBefore=staged?copyProof(root,staged.expected):null;
  const inputProofBefore=digest({source:sourceBefore,copy:copyBefore,acceptance:kind==="acceptance"?plan.acceptanceManifestDigest:null});
  const paths=kind==="acceptance"?plan.acceptanceTests:kind==="post_apply"?plan.postApplyTests:plan.publicTests;
  const {check,uncertain}=await execute(plan,root,paths,kind,attemptId,signal);
  let inputProofAfter=null;
  try{
    if(kind==="acceptance"&&digest(plan.acceptanceManifest.map(entry=>({path:entry.path,sha256:sha(readRegular(plan.acceptanceRoot,entry.path))})))!==plan.acceptanceManifestDigest)
      throw fail("project_acceptance_input_changed");
    inputProofAfter=digest({source:checkoutProof(plan,sourceRoot,commit),copy:staged?copyProof(root,staged.expected):null,
      acceptance:kind==="acceptance"?plan.acceptanceManifestDigest:null});
    if(inputProofAfter!==inputProofBefore)throw fail("project_validation_input_changed");
  }catch(caught){check.error??=caught.code||"project_validation_input_changed";}
  const counts=check.testSummary;
  const passed=!uncertain&&!check.error&&!check.timedOut&&check.terminationConfirmed&&check.exitCode===0&&
    counts?.tests>0&&counts.pass===counts.tests&&counts.fail===0&&counts.cancelled===0&&counts.skipped===0&&counts.todo===0&&inputProofAfter===inputProofBefore;
  // Forced direct-child termination never proves every descendant stopped.
  // Preserve that verification directory for quarantine; never reuse it.
  if(staged&&!uncertain){
    if(!contained(rootDirectory(plan.tempRoot),rootDirectory(root)))throw fail("project_cleanup_root_changed");
    rmSync(root,{recursive:true,force:true});
  }
  return {passed,checks:[check],inputProofBefore,inputProofAfter,terminationUnconfirmed:uncertain};
}
export function inspectRegisteredApply(plan){
  const head=git(plan.applyRoot,["rev-parse","HEAD"]).trim();
  try{return {head,clean:true,sourceProof:checkoutProof(plan,plan.applyRoot,head)};}
  catch(caught){if(["project_checkout_not_clean","project_tracked_bytes_changed","project_untracked_execution_input"].includes(caught.code))
    return {head,clean:false,sourceProof:null};throw caught;}
}
export function applyRegisteredCandidate(plan,{expectedHead,candidateCommit}={}){
  // Caller MUST hold its apply-root lock through this switch, post-apply checks
  // and durable reconciliation. A clean/head comparison alone is not a lock.
  if(expectedHead!==plan.baseCommit)throw fail("project_apply_expected_base_required");
  checkoutProof(plan,plan.applyRoot,expectedHead);candidateDiff(plan,candidateCommit);
  git(plan.applyRoot,["switch","--detach",candidateCommit],{hooksRoot:plan.hooksRoot});
  return {head:git(plan.applyRoot,["rev-parse","HEAD"]).trim(),sourceProof:checkoutProof(plan,plan.applyRoot,candidateCommit),rollbackCommit:plan.baseCommit};
}
export function rollbackRegisteredCandidate(plan,{expectedHead}={}){
  if(!fullSha(expectedHead)||expectedHead===plan.baseCommit)throw fail("project_rollback_candidate_required");
  candidateDiff(plan,expectedHead);checkoutProof(plan,plan.applyRoot,expectedHead);
  git(plan.applyRoot,["switch","--detach",plan.baseCommit],{hooksRoot:plan.hooksRoot});
  return {head:plan.baseCommit,sourceProof:checkoutProof(plan,plan.applyRoot,plan.baseCommit),rollbackCommit:expectedHead};
}
