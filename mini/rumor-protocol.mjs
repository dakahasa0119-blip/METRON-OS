/**
 * Village Square Rumor JSON — strict local transport format.
 *
 * Public-folder style file exchange only; the receipt is NOT trusted merely
 * because its SHA-256 checksum is valid. No external network/AI or signatures.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeAtomicJson } from "../reusable/gateway-jobs/checkpoint.mjs";

const RUMOR_VERSION="metron-rumor-v1";
const REPAIR_RUMOR_VERSION="metron-rumor-v2";
const idValid=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
// Syntax only: the owning world separately authorizes registered origins/recipients.
const villageValid=value=>typeof value==="string"&&/^[a-z][a-z0-9_-]{0,47}$/.test(value);
const blocked=reason=>Object.assign(new Error(reason),{code:reason});
const hex=(value,length)=>typeof value==="string"&&new RegExp("^[a-f0-9]{"+length+"}$").test(value);
const exact=(value,keys)=>value&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const trimmed=(value,max)=>typeof value==="string"&&value.length>0&&value.length<=max&&value===value.trim();
const canonical=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==="object"&&!Array.isArray(entry)?
  Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
// Public, bounded sender claims only. A digest establishes content integrity,
// never sender authentication or independent validation by a receiving village.
export function validateRepairEvidence(e){
  const keys=["schemaVersion","scope","diagnosis","applicability","limitations","candidateCommit",
    "candidateDigest","diffSha256","verificationDigest","modelProvenance","checks","productionApplied"];
  if(!exact(e,keys)||e.schemaVersion!==1||
     !["human_reviewed_external_worker","first_party_disposable_two_file_fixture_only","registered_project_coding_agent"].includes(e.scope)||
     ![e.diagnosis,e.applicability,e.limitations].every(value=>trimmed(value,500))||
     !(e.candidateCommit===null||hex(e.candidateCommit,40))||
     !(e.candidateDigest===null||hex(e.candidateDigest,64))||
     !(e.diffSha256===null||hex(e.diffSha256,64))||
     (e.candidateCommit===null&&e.candidateDigest===null)||
     !hex(e.verificationDigest,64)||!trimmed(e.modelProvenance,120)||
     !Array.isArray(e.checks)||e.checks.length<1||e.checks.length>8||
     Array.from(e.checks).some(check=>!exact(check,["id","outcome","outputSha256"])||
       typeof check.id!=="string"||!/^[a-z][a-z0-9_]{0,63}$/.test(check.id)||
       !["passed","expected_failure"].includes(check.outcome)||!hex(check.outputSha256,64))||
     e.productionApplied!==false)
    throw blocked("invalid_repair_evidence");
  return structuredClone(e);
}
function payload(e){
  return JSON.stringify([
    e.schemaVersion,e.id,e.originVillage,e.originCore,
    e.kind,e.body,e.createdAt,e.parentRumorId
  ]);
}
function digest(e){
  const input=e.schemaVersion===REPAIR_RUMOR_VERSION?
    "METRON_RUMOR_V2\n"+payload(e)+"\n"+canonical(e.repairEvidence):"METRON_RUMOR_V1\n"+payload(e);
  return createHash("sha256").update(input).digest("hex");
}
export function createRumor({originVillage,originCore="A",body,
  parentRumorId=null,createdAt=Date.now(),repairEvidence}={}){
  if(!villageValid(originVillage)||!["A","B"].includes(originCore)||
     typeof body!=="string"||!body.trim()||body.length>320||
     !Number.isSafeInteger(createdAt)||createdAt<0||
     (parentRumorId!==null&&!idValid(parentRumorId)))
    throw blocked("invalid_rumor_input");
  const entry={
    schemaVersion:repairEvidence===undefined?RUMOR_VERSION:REPAIR_RUMOR_VERSION,id:"r_"+randomUUID().replaceAll("-",""),
    originVillage,originCore,kind:"KNOWLEDGE",body:body.trim(),
    createdAt,parentRumorId
  };
  if(repairEvidence!==undefined)entry.repairEvidence=validateRepairEvidence(repairEvidence);
  return {...entry,sha256:digest(entry)};
}
export function verifyRumor(e){
  const repair=e?.schemaVersion===REPAIR_RUMOR_VERSION;
  const keys=["schemaVersion","id","originVillage","originCore","kind","body","createdAt","parentRumorId","sha256"];
  if(repair)keys.push("repairEvidence");
  if(!e||typeof e!=="object"||Array.isArray(e)||
     !exact(e,keys)||
     ![RUMOR_VERSION,REPAIR_RUMOR_VERSION].includes(e.schemaVersion)||!idValid(e.id)||
     !villageValid(e.originVillage)||!["A","B"].includes(e.originCore)||
     e.kind!=="KNOWLEDGE"||typeof e.body!=="string"||
     !e.body.trim()||e.body.length>320||
     e.body!==e.body.trim()||!Number.isSafeInteger(e.createdAt)||e.createdAt<0||
     (e.parentRumorId!==null&&!idValid(e.parentRumorId))||
     typeof e.sha256!=="string")
    throw blocked("invalid_or_modified_rumor");
  if(repair)validateRepairEvidence(e.repairEvidence);
  if(e.sha256!==digest(e))throw blocked("invalid_or_modified_rumor");
  return structuredClone(e);
}
export class FileVillageSquare{
  constructor(root){
    if(typeof root!=="string"||!root)throw blocked("square_root_required");
    this.dir=join(root,"village-square","rumors");
    mkdirSync(this.dir,{recursive:true});
  }
  publish(rumor){
    const e=verifyRumor(rumor);
    const path=join(this.dir,e.id+".json");
    // Refuse overwrite/replay, even if a caller forges a new object with same ID.
    try{readFileSync(path);throw blocked("rumor_id_conflict");}
    catch(err){if(err?.code!=="ENOENT")throw err;}
    writeAtomicJson(path,e);
    return e;
  }
  read(id){
    if(!idValid(id))throw blocked("invalid_rumor_id");
    let data;
    try{data=JSON.parse(readFileSync(join(this.dir,id+".json"),"utf8"));}
    catch(err){
      if(err?.code==="ENOENT")throw blocked("rumor_not_found");
      throw blocked("corrupt_rumor_file");
    }
    if(data?.id!==id)throw blocked("rumor_file_id_mismatch");
    return verifyRumor(data);
  }
  list(){
    const files=readdirSync(this.dir).filter(n=>n.endsWith(".json"));
    if(files.length>120)throw blocked("square_limit_reached");
    return files.map(name=>this.read(name.slice(0,-5)))
      .sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  }
}
