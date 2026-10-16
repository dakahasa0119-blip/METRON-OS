/** Bounded ARC V2 text artifacts. One trusted local writer owns the data root. */
import {Buffer} from "node:buffer";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {lstatSync,mkdirSync,realpathSync} from "node:fs";
import {createChunkedArtifact,verifyChunkedArtifact} from "../reusable/gateway-jobs/chunk-envelope.mjs";
import {readCheckpoint,writeAtomicJson} from "../reusable/gateway-jobs/checkpoint.mjs";

export const ARC_MAX_BYTES=256*1024;
const LIMITS={maxBytes:ARC_MAX_BYTES,maxChunks:64};
const fail=code=>Object.assign(new Error(code),{code});
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
export function assertArcMessageId(messageId){
  if(typeof messageId!=="string"||!/^arc_[a-f0-9]{32}$/.test(messageId))
    throw fail("invalid_arc_message_id");
  return messageId;
}
function captured({messageId,text,sha256,totalBytes}={}){
  assertArcMessageId(messageId);
  if(typeof text!=="string"||!text.trim())throw fail("invalid_arc_reply");
  const bytes=Buffer.from(text,"utf8");
  if(bytes.toString("utf8")!==text)throw fail("invalid_arc_unicode");
  if(bytes.length>ARC_MAX_BYTES)throw fail("arc_reply_too_large");
  if(!Number.isSafeInteger(totalBytes)||totalBytes!==bytes.length)
    throw fail("arc_byte_length_mismatch");
  if(typeof sha256!=="string"||!/^[a-f0-9]{64}$/.test(sha256)||hash(bytes)!==sha256)
    throw fail("arc_content_hash_mismatch");
  return {messageId,text,sha256,totalBytes};
}
export function createArcArtifact(input){
  const value=captured(input);
  const transfer=createChunkedArtifact(value.text,{returnId:value.messageId,
    chunkSizeBytes:4096,...LIMITS});
  return {schemaVersion:1,messageId:value.messageId,sha256:value.sha256,
    totalBytes:value.totalBytes,manifest:transfer.manifest,chunks:[...transfer.chunks]};
}
export function verifyArcArtifact(value){
  if(!value||value.schemaVersion!==1||!Array.isArray(value.chunks)||
     value.chunks.length<1||value.chunks.length>64)throw fail("arc_artifact_invalid");
  assertArcMessageId(value.messageId);
  const chunks=new Map();
  for(const entry of value.chunks){
    if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=="string"||
       typeof entry[1]!=="string"||entry[1].length>5464||chunks.has(entry[0])||
       Buffer.from(entry[1],"base64").length>4096)throw fail("arc_artifact_invalid");
    chunks.set(entry[0],entry[1]);
  }
  if(value.manifest?.returnId!==value.messageId||value.manifest?.sha256!==value.sha256||
     value.manifest?.totalBytes!==value.totalBytes||
     value.manifest?.chunkKeys?.length!==chunks.size)throw fail("arc_artifact_invalid");
  const checked=verifyChunkedArtifact(value.manifest,chunks,LIMITS);
  if(checked.status!=="ok")throw fail("arc_artifact_invalid");
  return captured({messageId:value.messageId,text:checked.artifact,
    sha256:checked.sha256,totalBytes:checked.bytes});
}
function stat(file){try{return lstatSync(file);}catch(error){if(error.code==="ENOENT")return null;throw error;}}
function ownedFile(root,messageId,create=false){
  assertArcMessageId(messageId);
  let directory=realpathSync(root);
  const names=["arc-artifacts","B"];
  for(let i=0;i<names.length;i++){
    directory=join(directory,names[i]);
    let info=stat(directory);
    if(!info){
      if(!create)return join(directory,...names.slice(i+1),messageId+".json");
      mkdirSync(directory);info=stat(directory);
    }
    if(info.isSymbolicLink()||!info.isDirectory())throw fail("unsafe_arc_artifact_path");
  }
  const file=join(directory,messageId+".json"),info=stat(file);
  if(info&&(info.isSymbolicLink()||!info.isFile()))throw fail("unsafe_arc_artifact_path");
  return file;
}
export function readArcStoredArtifact(root,messageId){
  const record=readCheckpoint(ownedFile(root,messageId));
  if(record===null)return null;
  if(record.schemaVersion!==1||record.kind!=="arc-response"||record.messageId!==messageId)
    throw fail("arc_stored_artifact_invalid");
  return {schemaVersion:1,kind:"arc-response",...captured(record)};
}
export function persistArcStoredArtifact(root,artifact){
  const value=verifyArcArtifact(artifact),prior=readArcStoredArtifact(root,value.messageId);
  if(prior){
    if(prior.sha256!==value.sha256||prior.totalBytes!==value.totalBytes||prior.text!==value.text)
      throw fail("message_id_conflict");
    return prior;
  }
  const record={schemaVersion:1,kind:"arc-response",...value};
  writeAtomicJson(ownedFile(root,value.messageId,true),record);
  const saved=readArcStoredArtifact(root,value.messageId);
  if(!saved||saved.text!==value.text||saved.sha256!==value.sha256||saved.totalBytes!==value.totalBytes)
    throw fail("arc_artifact_readback_failed");
  return saved;
}
export const arcReference=value=>"[ARC artifact] "+JSON.stringify({version:2,
  messageId:value.messageId,sha256:value.sha256,totalBytes:value.totalBytes});
export const arcAcknowledgement=value=>JSON.stringify({version:2,type:"ARC_DELIVERY_ACK",
  messageId:value.messageId,sha256:value.sha256,totalBytes:value.totalBytes});
