// User gestures only. No receipt polling, browser storage or credential access.
if(typeof MetronArcReplyState==="undefined")importScripts("reply-state.js");
const ORIGIN="http://127.0.0.1/*";
let handoffActive=false;
chrome.action.onClicked.addListener(async tab=>{
 if(!tab?.id||!/^https:\/\/chatgpt\.com\//.test(tab.url||""))return;
 await chrome.scripting.executeScript({target:{tabId:tab.id},files:["reply-state.js","content.js"]});
});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg?.type!=="arc_gateway_handoff")return false;
 (async()=>{
  if(!sender.tab?.id||sender.frameId!==0||!/^https:\/\/chatgpt\.com\//.test(sender.url||""))throw Error("unauthorized_tab");
  const action=msg.action;
  if(msg.version!==2||!["deliver","status"].includes(action)||!MetronArcReplyState.validId(msg.messageId))throw Error("invalid_arc_request");
  const port=msg.port??8766;
  if(!Number.isInteger(port)||port<1||port>65535)throw Error("invalid_gateway_port");
  const bytes=action==="deliver"?MetronArcReplyState.encodeText(msg.text):null;
  if(bytes&&!globalThis.crypto?.subtle)throw Error("arc_crypto_unavailable");
  if(handoffActive)throw Error("gateway_handoff_busy");
  handoffActive=true;
  let granted=false,result,deliveryStarted=false;
  try{
   // Keep the permission request first in the existing explicit-gesture path.
   granted=await chrome.permissions.request({origins:[ORIGIN]});
   if(!granted)throw Error("local_gateway_permission_denied");
   const sha256=bytes?[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join(""):null;
   async function post(body){
    const response=await fetch("http://127.0.0.1:"+port+"/api/arc/handoff",{
     method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},body:JSON.stringify(body)
    });
    const value=await response.json();if(!response.ok)throw Error(value.error||"gateway_rejected");return value;
   }
   const session=await post({action:"start"});
   const body={action,version:2,id:session.id,token:session.token,messageId:msg.messageId};
   if(bytes)Object.assign(body,{text:msg.text,sha256,totalBytes:bytes.length});
   deliveryStarted=action==="deliver";
   const receipt=await post(body);
   if(receipt.version!==2||receipt.messageId!==msg.messageId||typeof receipt.accepted!=="boolean"||typeof receipt.submitted!=="boolean"||
      receipt.accepted&&!receipt.submitted)throw Error("invalid_arc_receipt");
   if(receipt.submitted&&(!/^[a-f0-9]{64}$/.test(receipt.sha256)||receipt.receiptHash!==receipt.sha256||
      !Number.isInteger(receipt.totalBytes)||receipt.totalBytes<1||receipt.totalBytes>MetronArcReplyState.MAX_REPLY_BYTES||
      bytes&&(receipt.sha256!==sha256||receipt.totalBytes!==bytes.length)))throw Error("arc_receipt_content_mismatch");
   result={version:2,messageId:msg.messageId,submitted:receipt.submitted,accepted:receipt.accepted,
    deduplicated:receipt.deduplicated===true,jobState:receipt.jobState,ackState:receipt.ackState,
    deliveryState:receipt.deliveryState,sha256:receipt.sha256,totalBytes:receipt.totalBytes,receiptHash:receipt.receiptHash};
  }catch(error){result={version:2,messageId:msg.messageId,accepted:false,submitted:false,uncertain:deliveryStarted,error:error.code||error.message};}
  finally{
   try{if(granted&&!(await chrome.permissions.remove({origins:[ORIGIN]})))result.permissionWarning="local_gateway_permission_not_removed";}
   catch{result.permissionWarning="local_gateway_permission_not_removed";}
   handoffActive=false;
  }
  return result;
 })().then(respond,error=>respond({version:2,messageId:msg.messageId,accepted:false,submitted:false,error:error.code||error.message}));
 return true;
});
