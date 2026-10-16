/** Local receipts for redoing the owner's fixed registered-project checks.
 * A receipt proves matching bounded check observations, not production repair,
 * authenticated execution or distributed trust. No source, TAP output or paths
 * are copied into this ledger. The caller separately binds work/session context.
 */
import {createHash} from "node:crypto";
import {join} from "node:path";
import {readCheckpoint,writeAtomicJson} from "../reusable/gateway-jobs/checkpoint.mjs";

const MAX_ENTRIES=1000;
const WORK_TYPE="registered_project_fixed_check_recomputation";
const KINDS=["public","acceptance"];
const SUMMARY_KEYS=["tests","pass","fail","cancelled","skipped","todo"];
const fail=code=>Object.assign(new Error(code),{code});
const clone=value=>structuredClone(value);
const sha=value=>createHash("sha256").update(value,"utf8").digest("hex");
const stable=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==="object"&&!Array.isArray(entry)?
  Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
const digest=value=>sha(stable(value));
const hash=(value,length=64)=>typeof value==="string"&&new RegExp("^[a-f0-9]{"+length+"}$").test(value);
function exact(value,keys,code){
  if(!value||typeof value!=="object"||Array.isArray(value)||
     Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw fail(code);
}
function validateSubject(subject){
  const code="invalid_project_pouc_subject";
  exact(subject,["projectId","planDigest","candidateCommit","diffSha256"],code);
  if(typeof subject.projectId!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(subject.projectId)||
     !hash(subject.planDigest)||!hash(subject.candidateCommit,40)||!hash(subject.diffSha256))throw fail(code);
  return clone(subject);
}
function validateSummary(summary,code){
  exact(summary,SUMMARY_KEYS,code);
  if(SUMMARY_KEYS.some(key=>!Number.isSafeInteger(summary[key])||summary[key]<0)||summary.tests<1||
     summary.pass!==summary.tests||summary.fail!==0||summary.cancelled!==0||summary.skipped!==0||summary.todo!==0)
    throw fail(code);
  return clone(summary);
}
function sanitizeResult(result,kind){
  const code="invalid_project_pouc_check_result";
  exact(result,["passed","checks","inputProofBefore","inputProofAfter","terminationUnconfirmed"],code);
  if(result.passed!==true||result.terminationUnconfirmed!==false||!hash(result.inputProofBefore)||
     result.inputProofAfter!==result.inputProofBefore||!Array.isArray(result.checks)||result.checks.length!==1)
    throw fail(code);
  const check=result.checks[0];
  exact(check,["id","exitCode","timedOut","error","terminationConfirmed","outputSha256","logFile","output","testSummary"],code);
  if(check.id!==kind||check.exitCode!==0||check.timedOut!==false||check.error!==null||
     check.terminationConfirmed!==true||!hash(check.outputSha256)||typeof check.output!=="string"||
     check.outputSha256!==sha(check.output)||typeof check.logFile!=="string")throw fail(code);
  return {passed:true,inputProof:result.inputProofBefore,checks:[{
    id:kind,outputSha256:check.outputSha256,testSummary:validateSummary(check.testSummary,code)
  }]};
}
function sanitizeRun(run){
  exact(run,KINDS,"invalid_project_pouc_check_result");
  return Object.fromEntries(KINDS.map(kind=>[kind,sanitizeResult(run[kind],kind)]));
}
function validateSavedRun(run){
  const code="invalid_project_pouc_checkpoint";
  exact(run,KINDS,code);
  for(const kind of KINDS){
    const result=run[kind];
    exact(result,["passed","inputProof","checks"],code);
    if(result.passed!==true||!hash(result.inputProof)||!Array.isArray(result.checks)||result.checks.length!==1)
      throw fail(code);
    const check=result.checks[0];
    exact(check,["id","outputSha256","testSummary"],code);
    if(check.id!==kind||!hash(check.outputSha256))throw fail(code);
    validateSummary(check.testSummary,code);
  }
}
const normalized=run=>Object.fromEntries(KINDS.map(kind=>[kind,{
  inputProof:run[kind].inputProof,testSummary:run[kind].checks[0].testSummary
}]));
function compareRuns(original,recomputed,code){
  if(stable(normalized(original))!==stable(normalized(recomputed)))throw fail(code);
}
const computationDigestFor=(subject,original)=>digest({subject,checks:normalized(original)});
function proofBody(receipt){
  const {computationDigest,proofDigest,...body}=receipt;
  return body;
}
function validateReceipt(receipt){
  const code="invalid_project_pouc_checkpoint";
  exact(receipt,["schemaVersion","workType","subject","original","recomputed","computationDigest","proofDigest",
    "productionRepairVerified","distributedTrust"],code);
  if(receipt.schemaVersion!==1||receipt.workType!==WORK_TYPE||receipt.productionRepairVerified!==false||
     receipt.distributedTrust!==false||!hash(receipt.computationDigest)||!hash(receipt.proofDigest))throw fail(code);
  try{validateSubject(receipt.subject);}catch{throw fail(code);}
  validateSavedRun(receipt.original);validateSavedRun(receipt.recomputed);
  compareRuns(receipt.original,receipt.recomputed,code);
  if(receipt.computationDigest!==computationDigestFor(receipt.subject,receipt.original)||
     receipt.proofDigest!==digest(proofBody(receipt)))throw fail(code);
}

export class ProjectPoUCLedger {
  #file;
  constructor(root){
    this.#file=join(root,"project-pouc-ledger.json");
    if(readCheckpoint(this.#file)===null)writeAtomicJson(this.#file,{schemaVersion:1,entries:[]});
    this.#read();
  }
  #read(){
    const saved=readCheckpoint(this.#file),code="invalid_project_pouc_checkpoint";
    exact(saved,["schemaVersion","entries"],code);
    if(saved.schemaVersion!==1||!Array.isArray(saved.entries)||saved.entries.length>MAX_ENTRIES)throw fail(code);
    const computations=new Set();
    for(const receipt of saved.entries){
      validateReceipt(receipt);
      if(computations.has(receipt.computationDigest))throw fail(code);
      computations.add(receipt.computationDigest);
    }
    return saved;
  }
  record(input){
    exact(input,["subject","original","recomputed"],"invalid_project_pouc_record");
    const subject=validateSubject(input.subject),original=sanitizeRun(input.original),recomputed=sanitizeRun(input.recomputed);
    compareRuns(original,recomputed,"project_pouc_recomputation_mismatch");
    const computationDigest=computationDigestFor(subject,original);
    const body={schemaVersion:1,workType:WORK_TYPE,subject,original,recomputed,
      productionRepairVerified:false,distributedTrust:false};
    const receipt={...body,computationDigest,proofDigest:digest(body)};
    const saved=this.#read(),existing=saved.entries.find(entry=>entry.computationDigest===computationDigest);
    if(existing)return {deduplicated:true,receipt:clone(existing)};
    if(saved.entries.length>=MAX_ENTRIES)throw fail("project_pouc_ledger_full");
    writeAtomicJson(this.#file,{schemaVersion:1,entries:[...saved.entries,receipt]});
    return {deduplicated:false,receipt:clone(receipt)};
  }
  lookup(input){
    exact(input,["computationDigest","proofDigest"],"invalid_project_pouc_lookup");
    if(!hash(input.computationDigest)||!hash(input.proofDigest))throw fail("invalid_project_pouc_lookup");
    const receipt=this.#read().entries.find(entry=>entry.computationDigest===input.computationDigest&&entry.proofDigest===input.proofDigest);
    if(!receipt)throw fail("project_pouc_receipt_not_found");
    return clone(receipt);
  }
}
