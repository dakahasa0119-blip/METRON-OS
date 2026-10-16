/** Explicit external-inference entry point for one registered Codex attempt.
 * The existing project-worker CLI remains transport-only. This entry point has
 * no operator capability and never writes the server's session ledger itself.
 */
import {openSync,closeSync,readFileSync,writeFileSync,lstatSync,fstatSync,constants} from "node:fs";
import {resolve,isAbsolute,basename,dirname,parse,relative,sep,join} from "node:path";
import {fileURLToPath} from "node:url";
import {createRegisteredProjectPlan} from "./project-tools.mjs";
import {createProjectWorkerClient} from "./project-worker-cli.mjs";
import {runCodexProjectAttempt} from "./project-codex-worker.mjs";

const REGISTRY_LIMIT=32768,MODEL_TIMEOUT=600000,REQUEST_TIMEOUT=15000;
const fail=code=>Object.assign(new Error(code),{code});
const required=["--registry","--project-id","--url","--session-id","--worker-token-file",
  "--codex-executable","--worker-id","--claim-id"];
const allowed=new Set([...required,"--confirm-external-codex","--output"]);
const label=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const safeCode=error=>typeof error?.code==="string"&&/^[A-Za-z0-9_]{1,100}$/.test(error.code)?
  error.code:"project_codex_cli_failed";

function options(argv){
  if(!Array.isArray(argv))throw fail("invalid_project_codex_cli_arguments");
  const result={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(!allowed.has(key)||Object.hasOwn(result,key))throw fail("invalid_project_codex_cli_arguments");
    if(key==="--confirm-external-codex")result[key]=true;
    else{
      const value=argv[++i];
      if(typeof value!=="string"||!value||value.startsWith("--"))throw fail("invalid_project_codex_cli_arguments");
      result[key]=value;
    }
  }
  // Confirmation precedes registry loading, transport creation, claim or model.
  if(result["--confirm-external-codex"]!==true)throw fail("explicit_external_codex_confirmation_required");
  if(required.some(key=>!Object.hasOwn(result,key))||!label(result["--project-id"])||
     !label(result["--worker-id"])||!label(result["--claim-id"])||
     !/^agent_[a-f0-9]{32}$/.test(result["--session-id"]))throw fail("invalid_project_codex_cli_arguments");
  const endpoint=/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(result["--url"]);
  if(!endpoint||Number(endpoint[1])>65535)throw fail("project_loopback_url_required");
  if(!isAbsolute(result["--codex-executable"])||!/^codex(?:\.exe)?$/i.test(basename(result["--codex-executable"])))
    throw fail("project_codex_official_executable_required");
  return result;
}
function noLinkedAncestors(path){
  const absolute=resolve(path),root=parse(absolute).root;
  let current=root;
  for(const part of relative(root,absolute).split(sep).filter(Boolean)){
    current=join(current,part);
    if(lstatSync(current).isSymbolicLink())throw fail("project_codex_cli_symlink_rejected");
  }
  return absolute;
}
function boundedFile(path,limit,code){
  let fd;
  try{
    const absolute=noLinkedAncestors(path),before=lstatSync(absolute);
    if(!before.isFile()||before.size>limit)throw fail(code);
    fd=openSync(absolute,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    const opened=fstatSync(fd);
    if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size>limit)throw fail(code);
    const bytes=readFileSync(fd),after=fstatSync(fd);
    if(bytes.length>limit||bytes.length!==opened.size||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)
      throw fail(code);
    return bytes;
  }catch(error){
    if(error.code==="project_codex_cli_symlink_rejected")throw error;
    throw fail(code);
  }finally{if(fd!==undefined)closeSync(fd);}
}
function registry(path,projectId){
  const bytes=boundedFile(path,REGISTRY_LIMIT,"invalid_project_codex_registry_file");
  let value;
  try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes).replace(/^\uFEFF/,""));}
  catch{throw fail("invalid_project_codex_registry_json");}
  if(!Array.isArray(value)||!value.length||value.length>8||
     value.some(config=>!config||typeof config!=="object"||Array.isArray(config)||!label(config.id))||
     new Set(value.map(config=>config.id)).size!==value.length)throw fail("invalid_project_codex_registry");
  const selected=value.find(config=>config.id===projectId);
  if(!selected)throw fail("registered_project_not_found");
  return selected;
}
function workerToken(path){
  const bytes=boundedFile(path,256,"invalid_project_codex_worker_token_file");
  const value=bytes.toString("utf8").replace(/\r?\n$/,"");
  if(!/^[a-f0-9]{64}$/.test(value))throw fail("invalid_project_codex_worker_token_file");
  return value;
}
function reserveOutput(path){
  if(path===undefined)return null;
  const absolute=resolve(path);noLinkedAncestors(dirname(absolute));
  try{return {path:absolute,fd:openSync(absolute,"wx",0o600)};}
  catch(error){throw fail(error.code==="EEXIST"?"project_codex_output_file_exists":"project_codex_output_file_failed");}
}
function saveOutput(target,value){
  if(target)writeFileSync(target.fd,JSON.stringify(value,null,2)+"\n","utf8");
}
function compact(result,outputPath,plan){
  let receiptPath=outputPath??null;
  if(!receiptPath&&typeof result.evidenceDirectory==="string"&&isAbsolute(result.evidenceDirectory)){
    const rel=relative(plan.evidenceRoot,result.evidenceDirectory);
    if(rel&&!isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+sep))receiptPath=join(result.evidenceDirectory,"receipt.json");
  }
  return {status:result.status,receiptPath,modelProcessStarted:result.modelProcessStarted===true,
    terminationUnconfirmed:result.terminationUnconfirmed===true,duplicate:result.duplicate===true};
}

/** In-process dependency seams are only for simulated tests, never CLI options. */
export async function projectCodexCli(argv,{stdout=text=>process.stdout.write(text),stderr=text=>process.stderr.write(text),
  createPlan=createRegisteredProjectPlan,createClient=createProjectWorkerClient,runAttempt=runCodexProjectAttempt,
  signalTarget=process,signal,timeoutMs=MODEL_TIMEOUT,requestTimeoutMs=REQUEST_TIMEOUT}={}){
  const o=options(argv);
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>1500000||
     !Number.isInteger(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>REQUEST_TIMEOUT)
    throw fail("invalid_project_codex_cli_arguments");
  if(signal?.aborted)throw fail("project_codex_cancelled");
  const controller=new AbortController(),abort=()=>controller.abort();
  let output,registered=false,forwarded=false;
  try{
    // Only the selected owner's complete local plan is loaded. Private roots
    // remain host metadata; the adapter constructs the bounded worker prompt.
    const config=registry(o["--registry"],o["--project-id"]);
    const dispatchToken=workerToken(o["--worker-token-file"]);
    output=reserveOutput(o["--output"]);
    const plan=createPlan(config);
    if(plan?.id!==o["--project-id"]||typeof plan.evidenceRoot!=="string"||!isAbsolute(plan.evidenceRoot))
      throw fail("project_codex_registered_plan_required");
    const sessions=createClient({url:o["--url"],timeoutMs:requestTimeoutMs});
    signalTarget.on("SIGINT",abort);signalTarget.on("SIGTERM",abort);registered=true;
    if(signal){signal.addEventListener("abort",abort,{once:true});forwarded=true;if(signal.aborted)abort();}
    stderr("Explicitly confirmed Codex attempt: registered project code, work context and public failure feedback may be sent to OpenAI using the installed login.\n");
    const result=await runAttempt({sessions,plan,sessionId:o["--session-id"],dispatchToken,
      workerId:o["--worker-id"],claimId:o["--claim-id"],executable:o["--codex-executable"],
      evidenceRoot:plan.evidenceRoot,signal:controller.signal,timeoutMs});
    if(!result||!["reported_awaiting_independent_review","failed_requires_owner_reconciliation"].includes(result.status))
      throw fail("project_codex_attempt_result_invalid");
    saveOutput(output,result);
    stdout(JSON.stringify(compact(result,output?.path,plan))+"\n");
    return result;
  }catch(error){
    if(output){
      try{saveOutput(output,{status:"failed_requires_owner_reconciliation",reason:safeCode(error),
        note:"Inspect the registered adapter receipt and session state; do not automatically repeat inference."});}
      catch{ /* Preserve the original error; the adapter owns its durable receipt. */ }
    }
    throw error;
  }finally{
    if(registered){signalTarget.removeListener("SIGINT",abort);signalTarget.removeListener("SIGTERM",abort);}
    if(forwarded)signal.removeEventListener("abort",abort);
    if(output)closeSync(output.fd);
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  projectCodexCli(process.argv.slice(2)).then(result=>{
    if(result.status!=="reported_awaiting_independent_review")process.exitCode=2;
  }).catch(error=>{
    process.stderr.write(safeCode(error)+"\n");process.exitCode=1;
  });
