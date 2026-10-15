/** Small explicit operator client. All ledger writes stay in the existing server.
 * No model invocation or arbitrary worker commands are accepted here. */
import {readFileSync,writeFileSync,lstatSync} from "node:fs";
import {createMiniServer} from "./server.mjs";
import {createArcWorkerPlan} from "./external-worker.mjs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const fail=code=>Object.assign(new Error(code),{code});
function options(args){
  const out={};for(let i=0;i<args.length;i++){
    const k=args[i];if(!/^--[a-z-]+$/.test(k)||Object.hasOwn(out,k))throw fail("invalid_worker_cli_arguments");
    if(k==="--confirm")out[k]=true;
    else{const value=args[++i];if(typeof value!=="string"||value.startsWith("--"))throw fail("invalid_worker_cli_arguments");out[k]=value;}
  }return out;
}
function packet(path){
  if(typeof path!=="string")throw fail("worker_input_file_required");
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw fail("invalid_worker_input_file");
  return JSON.parse(readFileSync(path,"utf8").replace(/^\uFEFF/,""));
}
function output(value,path){
  const text=JSON.stringify(value,null,2)+"\n";
  if(path)writeFileSync(path,text,{flag:"wx"});else process.stdout.write(text);
}
export async function workerCli(argv){
  const [action,...args]=argv,o=options(args);
  if(action==="serve"){
    const allowed=["--data-root","--repository-root","--baseline-root","--candidate-root","--reproduction-commit","--artifacts-root","--temp-root","--port"];
    if(Object.keys(o).some(k=>!allowed.includes(k)))throw fail("invalid_worker_cli_arguments");
    const plan=createArcWorkerPlan({repositoryRoot:o["--repository-root"],baselineRoot:o["--baseline-root"],
      candidateRoot:o["--candidate-root"],reproductionCommit:o["--reproduction-commit"],
      artifactRoot:o["--artifacts-root"],tempRoot:o["--temp-root"]});
    const app=await createMiniServer({root:o["--data-root"],port:Number(o["--port"]??8766),workOptions:{workerPlans:[plan]}});
    output({url:app.url,mode:"human_reviewed_existing_worker",planId:plan.id,planDigest:plan.planDigest});
    const close=()=>app.close().then(()=>process.exit(0));
    process.once("SIGINT",close);process.once("SIGTERM",close);return app;
  }
  const allowed=["--url","--village-id","--work-id","--input","--output","--reviewed-diff","--verifier","--confirm"];
  if(Object.keys(o).some(k=>!allowed.includes(k))||!["export","import","review","verify"].includes(action))throw fail("invalid_worker_cli_arguments");
  const url=o["--url"];
  if(typeof url!=="string"||!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(url))throw fail("worker_loopback_url_required");
  let body={action:"worker-"+action,villageId:o["--village-id"],workId:o["--work-id"]};
  if(action==="export"){
    const input=packet(o["--input"]);
    if(!input||Object.keys(input).some(k=>!["symptom","reproduction","evidence"].includes(k)))throw fail("invalid_worker_export_input");
    body={...input,...body,planId:"arc-consecutive-send-v1",allowWorker:o["--confirm"]===true};
  }
  if(action==="import")body.report=packet(o["--input"]);
  if(action==="verify")body={...body,reviewedDiffSha256:o["--reviewed-diff"],verifier:o["--verifier"],allowValidation:o["--confirm"]===true};
  const response=await fetch(url+"/api/work/action",{method:"POST",redirect:"error",headers:{
    "Content-Type":"application/json","X-Metron-Mini":"1",Origin:url},body:JSON.stringify(body)});
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>1048576)throw fail("worker_response_too_large");chunks.push(chunk);}
  const result=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(!response.ok)throw fail(result.error||"worker_operation_failed");
  output(result,o["--output"]);
  if(action==="verify"&&result.verification.status!=="verified")process.exitCode=2;
  return result;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  workerCli(process.argv.slice(2)).catch(error=>{process.stderr.write((error.code||"worker_cli_failed")+"\n");process.exitCode=1;});
