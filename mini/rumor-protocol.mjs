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
const idValid=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const villageValid=value=>value==="village-1"||value==="village-2";
const blocked=reason=>Object.assign(new Error(reason),{code:reason});
function payload(e){
  return JSON.stringify([
    e.schemaVersion,e.id,e.originVillage,e.originCore,
    e.kind,e.body,e.createdAt,e.parentRumorId
  ]);
}
function digest(e){return createHash("sha256").update("METRON_RUMOR_V1\n"+payload(e)).digest("hex");}
export function createRumor({originVillage,originCore="A",body,
  parentRumorId=null,createdAt=Date.now()}={}){
  if(!villageValid(originVillage)||!["A","B"].includes(originCore)||
     typeof body!=="string"||!body.trim()||body.length>320||
     !Number.isSafeInteger(createdAt)||createdAt<0||
     (parentRumorId!==null&&!idValid(parentRumorId)))
    throw blocked("invalid_rumor_input");
  const entry={
    schemaVersion:RUMOR_VERSION,id:"r_"+randomUUID().replaceAll("-",""),
    originVillage,originCore,kind:"KNOWLEDGE",body:body.trim(),
    createdAt,parentRumorId
  };
  return {...entry,sha256:digest(entry)};
}
export function verifyRumor(e){
  if(!e||typeof e!=="object"||Array.isArray(e)||
     Object.keys(e).length!==9||
     !["schemaVersion","id","originVillage","originCore",
       "kind","body","createdAt","parentRumorId","sha256"].every(k=>Object.hasOwn(e,k))||
     e.schemaVersion!==RUMOR_VERSION||!idValid(e.id)||
     !villageValid(e.originVillage)||!["A","B"].includes(e.originCore)||
     e.kind!=="KNOWLEDGE"||typeof e.body!=="string"||
     !e.body.trim()||e.body.length>320||
     e.body!==e.body.trim()||!Number.isSafeInteger(e.createdAt)||e.createdAt<0||
     (e.parentRumorId!==null&&!idValid(e.parentRumorId))||
     typeof e.sha256!=="string"||e.sha256!==digest(e))
    throw blocked("invalid_or_modified_rumor");
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
