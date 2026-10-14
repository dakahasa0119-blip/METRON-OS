// User gesture only. No background polling or credential access.
const ORIGIN="http://127.0.0.1/*";
let handoffActive=false;
chrome.action.onClicked.addListener(async tab=>{
 if(!tab?.id||!/^https:\/\/chatgpt\.com\//.test(tab.url||""))return;
 await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content.js"]});
});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg?.type!=="arc_gateway_handoff")return false;
 (async()=>{
  if(!sender.tab?.id||sender.frameId!==0||
     !/^https:\/\/chatgpt\.com\//.test(sender.url||""))
   throw Error("unauthorized_tab");
  if(typeof msg.text!=="string"||!msg.text.trim()||msg.text.length>950)
   throw Error("invalid_reply_size");
  const port=msg.port??8766;
  if(!Number.isInteger(port)||port<1||port>65535)throw Error("invalid_gateway_port");
  // Serialize permission lifetime across tabs, so one transfer cannot revoke
  // another transfer's access. No durable localhost grant is retained.
  if(handoffActive)throw Error("gateway_handoff_busy");
  handoffActive=true;
  let granted=false,result,deliveryStarted=false;
  try{
   granted=await chrome.permissions.request({origins:[ORIGIN]});
   if(!granted)throw Error("local_gateway_permission_denied");
   async function post(body){
    const r=await fetch("http://127.0.0.1:"+port+"/api/arc/handoff",{
     method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
     body:JSON.stringify(body)
    });
    const x=await r.json();
    if(!r.ok)throw Error(x.error||"gateway_rejected");
    return x;
   }
   const session=await post({action:"start"});
   deliveryStarted=true;
   const receipt=await post({action:"deliver",id:session.id,
     token:session.token,text:msg.text});
   result={accepted:receipt.accepted===true,submitted:receipt.submitted===true||receipt.accepted===true,
     messageId:receipt.messageId,jobState:receipt.jobState,receiptHash:receipt.receiptHash};
   if(!result.submitted)result.error="gateway_delivery_not_confirmed";
  }catch(e){
   // A lost HTTP response may follow a durable enqueue. Never invite a new
   // transfer of the same capture while the first outcome is unknown.
   result={accepted:false,uncertain:deliveryStarted,error:e.message};
  }finally{
   try{
    if(granted&&!(await chrome.permissions.remove({origins:[ORIGIN]})))
     result.permissionWarning="local_gateway_permission_not_removed";
   }catch{result.permissionWarning="local_gateway_permission_not_removed";}
   handoffActive=false;
  }
  return result;
 })().then(respond,e=>respond({accepted:false,error:e.message}));
 return true;
});
