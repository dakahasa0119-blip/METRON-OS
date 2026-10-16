/** Local project-session transport for an existing approved coding worker.
 * This client never launches a model, coding CLI, shell, install or repair tool.
 * Serve creates a new product-scoped operator capability, never a user credential.
 */
import {request} from "node:http";
import {randomBytes} from "node:crypto";
import {readFileSync,writeFileSync,lstatSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const INPUT_LIMIT=32768,RESPONSE_LIMIT=1048576,REQUEST_TIMEOUT=15000,OPERATION_TIMEOUT=120000;
const fail=code=>Object.assign(new Error(code),{code});
const confirmation={start:"allowStart",revise:"allowRevision",validate:"allowValidation",resume:"allowResume",apply:"allowApply",rollback:"allowRollback"};
const workerActions=new Set(["claim","heartbeat","report","ack-stop"]);
const actionFields={
  start:["villageId","workId","projectId","symptom","evidence"],
  revise:["villageId","workId","previousSessionId","reviewedPreviousCandidate","projectId","requirements","symptom","evidence"],
  claim:["sessionId","dispatchToken","workerId","claimId"],
  heartbeat:["sessionId","leaseToken"],
  report:["sessionId","leaseToken","report"],
  review:["sessionId"],validate:["sessionId","reviewedDiffSha256","verifier"],
  cancel:["sessionId","reason"],"ack-stop":["sessionId","leaseToken"],resume:["sessionId"],
  apply:["sessionId","candidateCommit","diffSha256","verificationId","expectedHead","reviewer"],
  rollback:["sessionId","expectedHead","reviewer"]
};
function options(args){
  const parsed={};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(typeof key!=="string"||!/^--[a-z-]+$/.test(key)||Object.hasOwn(parsed,key))throw fail("invalid_project_cli_arguments");
    if(key==="--confirm")parsed[key]=true;
    else{
      const value=args[++i];
      if(typeof value!=="string"||!value||value.startsWith("--"))throw fail("invalid_project_cli_arguments");
      parsed[key]=value;
    }
  }
  return parsed;
}
function allowedOptions(options,keys,required=[]){
  if(Object.keys(options).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(options,key)))
    throw fail("invalid_project_cli_arguments");
}
function readBoundedFile(path,limit,code){
  if(typeof path!=="string"||!path)throw fail(code);
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw fail(code);
  const bytes=readFileSync(path);if(bytes.length>limit)throw fail(code);
  return bytes;
}
function packet(path){
  const bytes=readBoundedFile(path,INPUT_LIMIT,"invalid_project_input_file");
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes).replace(/^\uFEFF/,""));}
  catch{throw fail("invalid_project_input_json");}
}
function token(path){
  const value=readBoundedFile(path,256,"invalid_project_token_file").toString("utf8").replace(/\r?\n$/,"");
  if(!/^[a-f0-9]{64}$/.test(value))throw fail("invalid_project_token_file");
  return value;
}
function exact(value,keys){
  if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))
    throw fail("invalid_project_action_input");
}
function actionInput(action,path){
  const input=packet(path);exact(input,actionFields[action]);
  if(workerActions.has(action)){
    const value=input[action==="claim"?"dispatchToken":"leaseToken"];
    if(typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value))throw fail("invalid_project_worker_capability");
  }
  if(action==="report")exact(input.report,["reportId","candidateCommit","diagnosis","operations","unresolved"]);
  return input;
}
function endpoint(value){
  const match=typeof value==="string"&&/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(value);
  if(!match||Number(match[1])>65535)throw fail("project_loopback_url_required");
  return {origin:value,port:Number(match[1])};
}
function outputTarget(path){
  if(path===undefined)return;
  try{lstatSync(path);throw fail("project_output_file_exists");}
  catch(error){if(error.code!=="ENOENT")throw error;}
}
function output(value,path,stdout){
  const text=JSON.stringify(value,null,2)+"\n";
  if(path)writeFileSync(path,text,{flag:"wx",mode:0o600});else stdout(text);
}
function transport({origin,port},path,{method="GET",body,headers={},timeoutMs=REQUEST_TIMEOUT}={}){
  const encoded=body===undefined?null:Buffer.from(JSON.stringify(body),"utf8");
  if(encoded&&encoded.length>INPUT_LIMIT)throw fail("project_request_too_large");
  return new Promise((resolveRequest,rejectRequest)=>{
    let settled=false,response,timer;
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      if(error)rejectRequest(error);else resolveRequest(value);
    };
    // Native http.request connects directly to this literal loopback address.
    // HTTP_PROXY, HTTPS_PROXY and NODE_USE_ENV_PROXY cannot redirect capabilities.
    const req=request({protocol:"http:",hostname:"127.0.0.1",port,path,method,agent:false,
      headers:{"X-Metron-Mini":"1",Origin:origin,...headers,
        ...(encoded?{"Content-Type":"application/json","Content-Length":encoded.length}:{})}},res=>{
      response=res;
      if(res.statusCode>=300&&res.statusCode<400)return stop("project_redirect_refused");
      if(Number(res.headers["content-length"]||0)>RESPONSE_LIMIT)return stop("project_response_too_large");
      const chunks=[];let size=0;
      res.on("data",chunk=>{
        size+=chunk.length;if(size>RESPONSE_LIMIT)return stop("project_response_too_large");chunks.push(chunk);
      });
      res.on("aborted",()=>finish(fail("project_response_interrupted")));
      res.on("error",()=>finish(fail("project_response_failed")));
      res.on("end",()=>{
        if(settled)return;
        if(res.statusCode<200||res.statusCode>=300)return finish(fail("project_request_rejected"));
        try{
          const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
          if(!value||typeof value!=="object"||Array.isArray(value))throw Error();
          finish(null,value);
        }catch{finish(fail("invalid_project_response_json"));}
      });
    });
    function stop(code){finish(fail(code));response?.destroy();req.destroy();}
    req.on("error",()=>finish(fail("project_request_failed")));
    timer=setTimeout(()=>stop("project_request_timeout"),timeoutMs);
    req.end(encoded);
  });
}
/** Worker-only loopback client. It has no operator validation/apply methods. */
export function createProjectWorkerClient({url,timeoutMs=REQUEST_TIMEOUT}={}){
  const target=endpoint(url);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>REQUEST_TIMEOUT)throw fail("invalid_project_cli_arguments");
  const post=(action,input)=>transport(target,"/api/project/action",{method:"POST",body:{...input,action},timeoutMs});
  return Object.freeze({
    claim:input=>post("claim",input),heartbeat:input=>post("heartbeat",input),
    report:input=>post("report",input),acknowledgeStop:input=>post("ack-stop",input),
    state:({sessionId,dispatchToken})=>{
      if(!/^agent_[a-f0-9]{32}$/.test(sessionId||"")||!/^[a-f0-9]{64}$/.test(dispatchToken||""))
        throw fail("project_worker_capability_required");
      return transport(target,"/api/project/state?sessionId="+encodeURIComponent(sessionId),{
        headers:{"X-Metron-Project-Worker":dispatchToken},timeoutMs});
    }
  });
}
async function serve(options,{stdout,serveDependencies}){
  allowedOptions(options,["--registry","--data-root","--port","--operator-token-file","--output"],
    ["--registry","--data-root","--operator-token-file"]);
  const registry=packet(options["--registry"]),portText=options["--port"]??"8766";
  if(!Array.isArray(registry)||registry.length<1||registry.length>8||
    !/^\d{1,5}$/.test(portText)||Number(portText)>65535)throw fail("invalid_project_registry_or_port");
  const dependencies=serveDependencies||{
    ...await import("./project-tools.mjs"),...await import("./server.mjs")
  };
  const projectPlans=registry.map(config=>dependencies.createRegisteredProjectPlan(config));
  const operatorTokenFile=resolve(options["--operator-token-file"]),operatorToken=randomBytes(32).toString("hex");
  try{writeFileSync(operatorTokenFile,operatorToken+"\n",{flag:"wx",mode:0o600});}
  catch(error){if(error.code==="EEXIST")throw fail("project_operator_token_file_exists");throw error;}
  const app=await dependencies.createMiniServer({root:resolve(options["--data-root"]),port:Number(portText),
    workOptions:{projectPlans},projectOperatorToken:operatorToken});
  try{output({url:app.url,projectIds:projectPlans.map(plan=>plan.id),operatorTokenFile},options["--output"],stdout);}
  catch(error){await app.close();throw error;}
  let stopping;
  const close=()=>stopping??=(async()=>{
    process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop);await app.close();
  })();
  const stop=()=>{close().catch(()=>{process.stderr.write("project_server_stop_failed\n");process.exitCode=1;});};
  process.once("SIGINT",stop);process.once("SIGTERM",stop);
  return {...app,close};
}
/** Dependency hooks are in-process test seams; they are not CLI/body options. */
export async function projectWorkerCli(argv,{stdout=text=>process.stdout.write(text),
  timeoutMs,serveDependencies}={}){
  if(!Array.isArray(argv)||(timeoutMs!==undefined&&(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>OPERATION_TIMEOUT)))
    throw fail("invalid_project_cli_arguments");
  const [action,...args]=argv,optionsValue=options(args);
  const requestTimeout=timeoutMs??(["start","revise","validate","apply"].includes(action)?OPERATION_TIMEOUT:REQUEST_TIMEOUT);
  if(action!=="serve"&&action!=="state"&&!Object.hasOwn(actionFields,action))throw fail("invalid_project_cli_arguments");
  outputTarget(optionsValue["--output"]);
  if(action==="serve")return serve(optionsValue,{stdout,serveDependencies});
  if(action==="state"){
    allowedOptions(optionsValue,["--url","--session-id","--operator-token-file","--worker-token-file","--output"],["--url","--session-id"]);
    const operator=Object.hasOwn(optionsValue,"--operator-token-file"),worker=Object.hasOwn(optionsValue,"--worker-token-file");
    if(operator===worker||!/^[-A-Za-z0-9_]{1,128}$/.test(optionsValue["--session-id"]))throw fail("project_state_capability_required");
    const headers=operator?{"X-Metron-Project-Operator":token(optionsValue["--operator-token-file"])}:
      {"X-Metron-Project-Worker":token(optionsValue["--worker-token-file"])};
    const result=await transport(endpoint(optionsValue["--url"]),"/api/project/state?sessionId="+
      encodeURIComponent(optionsValue["--session-id"]),{headers,timeoutMs:requestTimeout});
    output(result,optionsValue["--output"],stdout);return result;
  }
  const worker=workerActions.has(action),confirmField=confirmation[action];
  allowedOptions(optionsValue,["--url","--input","--output",...(worker?[]:["--operator-token-file"]),...(confirmField?["--confirm"]:[])],
    ["--url","--input",...(worker?[]:["--operator-token-file"])]);
  const target=endpoint(optionsValue["--url"]),input=actionInput(action,optionsValue["--input"]);
  if(confirmField&&optionsValue["--confirm"]!==true)throw fail("explicit_project_confirmation_required");
  const body={action,...input,...(confirmField?{[confirmField]:true}:{})};
  const headers=worker?{}:{"X-Metron-Project-Operator":token(optionsValue["--operator-token-file"])};
  const result=await transport(target,"/api/project/action",{method:"POST",body,headers,timeoutMs:requestTimeout});
  output(result,optionsValue["--output"],stdout);return result;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  projectWorkerCli(process.argv.slice(2)).catch(error=>{
    process.stderr.write((error.code||"project_cli_failed")+"\n");process.exitCode=1;
  });
