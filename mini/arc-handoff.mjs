/**
 * ARC-to-Gateway is a separate opt-in localhost relay.
 * Browser extension permission is temporary and explicit, not a broad host
 * permission. The bridge token is random, one-time and expires quickly.
 */
import {randomBytes,createHash} from "node:crypto";
const fail=code=>Object.assign(new Error(code),{code});
const sha=s=>createHash("sha256").update(s).digest("hex");
export class ArcHandoff {
  constructor(runtime,{now=()=>Date.now()}={}){
    this.runtime=runtime;this.now=now;this.sessions=new Map();
  }
  start(){
    const token=randomBytes(24).toString("hex");
    const id="arc_"+randomBytes(12).toString("hex");
    const expiresAt=this.now()+120000;
    this.sessions.set(id,{hash:sha(token),expiresAt,used:false});
    return {id,token,expiresAt};
  }
  deliver({id,token,text}={}){
    if(typeof id!=="string"||!/^arc_[a-f0-9]{24}$/.test(id)||
       typeof token!=="string"||!/^[a-f0-9]{48}$/.test(token))
      throw fail("invalid_arc_session");
    const session=this.sessions.get(id);
    if(!session||session.used||session.expiresAt<=this.now()||
       sha(token)!==session.hash)
      throw fail("arc_session_expired_or_used");
    if(typeof text!=="string"||!text.trim()||text.length>5000)
      throw fail("invalid_arc_reply");
    // Gateway's OBSERVE envelope is bounded to 1024 characters.
    // No silent truncation: long replies require explicit smaller selection.
    if(("[ARC external UI response] "+text).length>1024)
      throw fail("arc_reply_exceeds_gateway_limit");
    session.used=true;
    const result=this.runtime.submit({
      from:"A",to:"B",messageId:"m_"+randomBytes(16).toString("hex"),
      message:"[ARC external UI response] "+text,code:"",
      arc:{selectorsChecked:true}
    });
    return {accepted:result.job?.state==="done",messageId:result.messageId,
      jobState:result.job?.state,receiptHash:sha(text)};
  }
}
