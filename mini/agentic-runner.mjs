/**
 * A real (when authenticated) BAKU coding-agent repair loop on ONE first-party
 * disposable multi-file repository. Model inspects code and actual failures,
 * proposes full-file edits; a separate OS process runs real tests.
 *
 * No canned mutation, no correct patch provided, no writes to user's source,
 * no model-proposed commands. Model/test evidence is separately labelled.
 */
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readCheckpoint,writeAtomicJson} from "../reusable/gateway-jobs/checkpoint.mjs";
import {claudeCliReasoner} from "./claude-cli.mjs";

const execAsync=promisify(execFile);
const sha=s=>createHash("sha256").update(s,"utf8").digest("hex");
const refused=code=>Object.assign(new Error(code),{code});
const SRC=["src/pricing.mjs","src/invoice.mjs"];
const TESTS=["tests/public.test.mjs","tests/holdout.test.mjs"];
const FIXTURE=new URL("./fixtures/pricing/",import.meta.url);
const basename=path=>new URL(path,FIXTURE);
const allowedModel=new Set(["ollama","openai","claude-cli"]);
const trim=x=>typeof x==="string"?x.trim():"";
const truncated=(s,n=1200)=>String(s??"").slice(-n);
const jsonFrom=x=>{
  if(typeof x!=="string"||x.length>12000)throw refused("invalid_agent_response");
  // Never eval or extract hypothetical code fences from a model response.
  try{return JSON.parse(x);}catch{throw refused("invalid_agent_json");}
};
function pinnedFixture(){
  const files=Object.fromEntries([...SRC,...TESTS].map(p=>[p,
    readFileSync(basename(p),"utf8")]));
  for(const t of Object.values(files))
    if(t.length>6000)throw refused("fixture_too_large");
  const digest=sha(JSON.stringify(Object.entries(files).sort()));
  return {files,digest};
}
function modelProposal(response){
  const value=jsonFrom(response);
  if(!value||typeof value!=="object"||Array.isArray(value)||
     !Array.isArray(value.changes)||value.changes.length<1||
     value.changes.length>SRC.length||
     typeof value.diagnosis!=="string"||value.diagnosis.length>1200)
    throw refused("invalid_agent_patch");
  const seen=new Set();
  for(const p of value.changes){
    if(!p||!SRC.includes(p.path)||seen.has(p.path)||
       typeof p.content!=="string"||p.content.length>5000||
       p.content.length<15)throw refused("out_of_scope_patch");
    seen.add(p.path);
    // Deny added external imports/network/host access. The fixtures need
    // exactly one static local import in invoice.mjs.
    const noSideEffects=/\b(?:process|require|eval|Function|globalThis|fetch|import\s*\(|child_process|fs|net|http|https|worker_threads)\b/;
    if(noSideEffects.test(p.content)||/import\s+(?!\{\s*unitPrice\s*\}\s+from\s+["']\.\/pricing\.mjs["'])/.test(p.content))
      throw refused("unsafe_patch_content");
  }
  return {diagnosis:value.diagnosis,changes:value.changes.map(p=>({
    path:p.path,content:p.content
  }))};
}
async function runTest(root,testPath){
  const args=[
    "--permission","--allow-fs-read="+resolve(root),
    join(root,...testPath.split("/"))
  ];
  try {
    const {stdout,stderr}=await execAsync(process.execPath,args,{
      cwd:root,timeout:12000,maxBuffer:48000,
      windowsHide:true,env:{
        PATH:process.env.PATH||"",
        SystemRoot:process.env.SystemRoot||"",
        // Only a disposable fixture, no provider credentials or tokens.
        LANG:"C.UTF-8",HOME:"",USERPROFILE:"",NODE_OPTIONS:""
      }
    });
    return {passed:true,output:truncated(stdout+"\n"+stderr,1800)};
  }catch(e){
    return {passed:false,output:truncated((e.stdout||"")+"\n"+(e.stderr||"")+
      "\n"+(e.code?"exit="+e.code:""),1800)};
  }
}
function persistJournal(root,runId,value){
  const dir=join(root,"baku-agent-journal");
  mkdirSync(dir,{recursive:true});
  const file=join(dir,runId+".json");
  writeAtomicJson(file,{schemaVersion:1,...value});
}
function publicFiles(files){
  return [
    ...SRC.map(path=>({path,content:files[path]})),
    {path:"tests/public.test.mjs",content:files["tests/public.test.mjs"]}
  ];
}
function promptForModel({goal,files,baselineOutput,previousAttempts}){
  return [
    "You are BAKU, a real coding repair agent. Investigate the following",
    "actual small multi-file project. There is NO supplied correct patch.",
    "Produce only JSON: {\"diagnosis\":\"...\",\"changes\":[{\"path\":\"src/pricing.mjs\",\"content\":\"FULL FILE\"},...]}.",
    "You may change ONLY src/pricing.mjs and src/invoice.mjs; no commands;",
    "no access to a shell or hidden tests; never claim deployment.",
    "Fix the root cause rather than editing tests. Consider both files.",
    "Problem report: "+goal,
    "Public test failure output: "+baselineOutput,
    "Previously rejected attempts and real test failures: "+JSON.stringify(previousAttempts),
    "Visible source and public tests: "+JSON.stringify(publicFiles(files))
  ].join("\n\n");
}
async function jsonApi(url,init,{fetcher=fetch}={}){
  const signal=AbortSignal.timeout(30000);
  const r=await fetcher(url,{...init,signal});
  if(!r?.ok)throw refused("agent_provider_request_failed");
  const len=Number(r.headers?.get?.("content-length")||0);
  if(len>20000)throw refused("agent_provider_response_too_large");
  const text=await r.text();
  if(text.length>20000)throw refused("agent_provider_response_too_large");
  try{return JSON.parse(text);}catch{throw refused("agent_provider_invalid_json");}
}
/** Actual providers, no fixed/pretend model answers. */
export async function realRepairReasoner(prompt,{
  provider=process.env.METRON_REPAIR_PROVIDER||"ollama",
  env=process.env,fetcher=fetch
}={}){
  if(!allowedModel.has(provider))throw refused("unsupported_repair_provider");
  if(provider==="claude-cli"){
    return claudeCliReasoner(prompt,{env});
  }
  if(provider==="ollama"){
    const model=trim(env.METRON_LOCAL_MODEL);
    if(!model)throw refused("local_repair_model_not_configured");
    const data=await jsonApi("http://127.0.0.1:11434/api/generate",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model,prompt,stream:false,
        format:"json",options:{num_predict:1800}})
    },{fetcher});
    if(!trim(data.response))throw refused("empty_local_model_reply");
    return data.response;
  }
  if(!trim(env.OPENAI_API_KEY)||!trim(env.METRON_REPAIR_MODEL))
    throw refused("openai_repair_model_not_configured");
  const data=await jsonApi("https://api.openai.com/v1/responses",{
    method:"POST",headers:{
      "Content-Type":"application/json",
      Authorization:"Bearer "+env.OPENAI_API_KEY
    },
    body:JSON.stringify({
      model:env.METRON_REPAIR_MODEL,
      input:prompt,max_output_tokens:1800
    })
  },{fetcher});
  const parts=data.output?.flatMap(x=>x.content||[])
    .filter(x=>x.type==="output_text").map(x=>x.text);
  const text=data.output_text||parts?.join("\n");
  if(!trim(text))throw refused("empty_openai_model_reply");
  return text;
}
/**
 * askModel is a test injection point; when omitted the REAL configured LLM
 * is required. A fixture function passing tests is NOT an AI validation.
 */
export async function runAgenticRepair({
  root,goal="The invoice total is incorrect when a discounted unit is multiplied by quantity",
  maxAttempts=3,askModel,provider,env=process.env,fetcher,
  allowExternalCalls=false,resumeRunId=null
}={}){
  if(typeof root!=="string"||!root||
     typeof goal!=="string"||!goal.trim()||goal.length>500||
     !Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>4)
    throw refused("invalid_agent_incident");
  if(Number(process.versions.node.split(".")[0])<22)
    return {status:"blocked",reason:"node_22_required_for_permission_constrained_tests"};
  // Deny implicit cost: authenticated remote model needs caller confirmation.
  if(!askModel && ["openai","claude-cli"].includes(
    provider||env.METRON_REPAIR_PROVIDER) && allowExternalCalls!==true)
    return {status:"blocked",reason:"external_model_operator_consent_required"};
  const fixture=pinnedFixture();
  if(resumeRunId!==null && (typeof resumeRunId!=="string"||
     !/^case_[a-f0-9]{32}$/.test(resumeRunId)))
    throw refused("invalid_resume_run_id");
  const runId=resumeRunId??("case_"+randomUUID().replaceAll("-",""));
  const modelProvenance=askModel?"test_injected_not_real_ai":
    provider||env.METRON_REPAIR_PROVIDER||"ollama";
  const prior=resumeRunId?
    readCheckpoint(join(root,"baku-agent-journal",runId+".json")):null;
  if(resumeRunId){
    if(!prior||prior.schemaVersion!==1||prior.id!==runId||
       prior.fixtureDigest!==fixture.digest||prior.goal!==goal||
       prior.modelProvenance!==modelProvenance||
       !Array.isArray(prior.attempts)||prior.attempts.length>4||
       (prior.attempts.length>0&&!prior.lastCandidate)||
       (prior.lastCandidate!==undefined&&
         (typeof prior.lastCandidate!=="object"||!prior.lastCandidate||
          Object.keys(prior.lastCandidate).some(p=>!SRC.includes(p)||
            typeof prior.lastCandidate[p]!=="string"||
            prior.lastCandidate[p].length>5000)))||
       ["verified_candidate","holdout_rejected","readback_failed","not_reproduced"].includes(prior.status))
      throw refused("unresumable_or_changed_incident");
  }
  const scratch=mkdtempSync(join(root,"baku-scratch-"));
  const stage=join(scratch,"project");
  let files={...fixture.files};
  const attempts=prior?structuredClone(prior.attempts):[];
  const journal=prior?{...prior,attempts}:{
    id:runId,goal,fixtureDigest:fixture.digest,modelProvenance,
    status:"started",attempts
  };
  try{
    mkdirSync(join(stage,"src"),{recursive:true});
    mkdirSync(join(stage,"tests"),{recursive:true});
    const syncFiles=()=>{
      for(const [p,c] of Object.entries(files))
        writeFileSync(join(stage,...p.split("/")),c,"utf8");
    };
    syncFiles();
    const before=await runTest(stage,TESTS[0]);
    journal.initialReproducerPassed=before.passed;
    if(before.passed){
      journal.status="not_reproduced";
      persistJournal(root,runId,journal);
      return {status:"not_reproduced",runId,attempts,productionChanged:false};
    }
    if(prior?.lastCandidate){
      files={...fixture.files,...prior.lastCandidate};
      syncFiles();
    }
    journal.status="ready_for_agent";
    persistJournal(root,runId,journal);
    for(let n=attempts.length+1;n<=maxAttempts;n++){
      const prompt=promptForModel({
        goal,files,baselineOutput:before.output,previousAttempts:attempts
      });
      let proposed;
      try{
        const raw=await (askModel||((p)=>realRepairReasoner(p,{
          provider,env,fetcher
        })))(prompt);
        proposed=modelProposal(raw);
      }catch(e){
        journal.status="blocked";
        journal.reason=e.code||"model_proposal_rejected";
        persistJournal(root,runId,journal);
        return {status:"blocked",reason:journal.reason,runId,
          attempts,productionChanged:false};
      }
      const updated={...files};
      for(const p of proposed.changes)updated[p.path]=p.content;
      files=updated; syncFiles();
      const publicCheck=await runTest(stage,TESTS[0]);
      const entry={
        attempt:n,diagnosis:proposed.diagnosis,
        changed:proposed.changes.map(p=>({path:p.path,
          sha256:sha(p.content)})),
        publicPassed:publicCheck.passed,
        publicEvidence:publicCheck.output,
        candidateDigest:sha(JSON.stringify(SRC.map(p=>[p,files[p]])))
      };
      attempts.push(entry);
      journal.lastCandidate=Object.fromEntries(SRC.map(p=>[p,files[p]]));
      journal.status="testing";persistJournal(root,runId,journal);
      if(!publicCheck.passed)continue;
      // Hidden tests are used ONLY once, after the candidate clears public tests.
      // They are never provided to the model and their failures never used to
      // request a revised patch.
      const holdout=await runTest(stage,TESTS[1]);
      entry.holdoutPassed=holdout.passed;
      entry.holdoutEvidenceHash=sha(holdout.output);
      if(!holdout.passed){
        journal.status="holdout_rejected";
        persistJournal(root,runId,journal);
        return {status:"holdout_rejected",runId,attempts,
          productionChanged:false,approved:false};
      }
      const roundtrip=SRC.every(p=>
        readFileSync(join(stage,...p.split("/")),"utf8")===files[p]);
      journal.status=roundtrip?"verified_candidate":"readback_failed";
      journal.finalCandidateDigest=entry.candidateDigest;
      journal.validatedBy="separate_node_process_public_and_holdout";
      persistJournal(root,runId,journal);
      return {status:journal.status,runId,attempts,
        candidateFiles:roundtrip?SRC.map(path=>({path,content:files[path]})):[],
        baselineDigest:fixture.digest,
        readbackVerified:roundtrip,approved:false,
        productionChanged:false,modelProvenance:journal.modelProvenance};
    }
    journal.status="unresolved";persistJournal(root,runId,journal);
    return {status:"unresolved",runId,attempts,
      productionChanged:false,approved:false};
  }finally{
    rmSync(scratch,{recursive:true,force:true});
  }
}
