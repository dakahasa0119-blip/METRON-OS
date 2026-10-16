/**
 * ARC-to-Gateway is a separate opt-in localhost relay.
 * Browser extension permission is temporary and explicit, not a broad host
 * permission. The bridge token is random, one-time and expires quickly.
 */
import {randomBytes,createHash} from "node:crypto";
import {assertArcMessageId} from "./arc-artifact.mjs";
const fail=code=>Object.assign(new Error(code),{code});
const sha=s=>createHash("sha256").update(s).digest("hex");
function v2Fields(input,withText){
  const allowed=new Set(["action","version","id","token","messageId","expiresAt",
    ...(withText?["text","sha256","totalBytes"]:[])]);
  if(Object.keys(input).some(key=>!allowed.has(key)))throw fail("invalid_arc_request");
}
export class ArcHandoff {
  constructor(runtime,{now=()=>Date.now()}={}){
    this.runtime=runtime;this.now=now;this.sessions=new Map();
  }
  start(){
    if(this.sessions.size>100){
      for(const [key,value] of this.sessions)
        if(value.used||value.expiresAt<=this.now())this.sessions.delete(key);
      if(this.sessions.size>100)throw fail("arc_session_capacity_reached");
    }
    const token=randomBytes(24).toString("hex");
    const id="arc_"+randomBytes(12).toString("hex");
    const expiresAt=this.now()+120000;
    this.sessions.set(id,{hash:sha(token),expiresAt,used:false});
    return {id,token,expiresAt};
  }
  consume({id,token}={}){
    if(typeof id!=="string"||!/^arc_[a-f0-9]{24}$/.test(id)||
       typeof token!=="string"||!/^[a-f0-9]{48}$/.test(token))
      throw fail("invalid_arc_session");
    const session=this.sessions.get(id);
    if(!session||session.used||session.expiresAt<=this.now()||
       sha(token)!==session.hash)
      throw fail("arc_session_expired_or_used");
    session.used=true;
  }
  status(input={}){
    if(input.version!==2)throw fail("invalid_arc_version");
    v2Fields(input,false);
    assertArcMessageId(input.messageId);
    this.consume(input);
    return this.runtime.arcStatus(input.messageId);
  }
  deliver(input={}){
    const {id,token,text}=input;
    if(input.version===2){
      v2Fields(input,true);
      assertArcMessageId(input.messageId);
      this.consume(input);
      return this.runtime.submitArc({messageId:input.messageId,text,
        sha256:input.sha256,totalBytes:input.totalBytes});
    }
    if(input.version!==undefined&&input.version!==1)throw fail("invalid_arc_version");
    // Preserve the legacy validation/one-use behavior and its short envelope.
    if(typeof id!=="string"||!/^arc_[a-f0-9]{24}$/.test(id)||
       typeof token!=="string"||!/^[a-f0-9]{48}$/.test(token))throw fail("invalid_arc_session");
    const session=this.sessions.get(id);
    if(!session||session.used||session.expiresAt<=this.now()||sha(token)!==session.hash)
      throw fail("arc_session_expired_or_used");
    if(typeof text!=="string"||!text.trim()||text.length>5000)
      throw fail("invalid_arc_reply");
    // Gateway's OBSERVE envelope is bounded to 1024 characters.
    // No silent truncation: long replies require explicit smaller selection.
    if(("[ARC external UI response] "+text).length>1024)
      throw fail("arc_reply_exceeds_gateway_limit");
    session.used=true;
    const messageId="m_"+randomBytes(16).toString("hex");
    let job;
    try{
      const result=this.runtime.submit({
        from:"A",to:"B",messageId,
        message:"[ARC external UI response] "+text,code:"",
        arc:{selectorsChecked:true}
      });
      job=result.job;
    }catch(error){
      // submit persists before draining. A later delivery/state failure must
      // not invite a fresh handoff that would enqueue the same reply twice.
      try{job=this.runtime.gateway?.getJob(messageId);}catch{}
      if(!job)throw error;
    }
    // A bounded drain can leave this job queued. Submission consumes the
    // one-time session, but only a completed job confirms mailbox delivery.
    return {submitted:true,accepted:job?.state==="done",messageId,
      jobState:job?.state,receiptHash:sha(text)};
  }
}
