// User gesture only. No background polling or credential access.
const BASE="http://127.0.0.1:8766";
const ORIGIN="http://127.0.0.1/*";
chrome.action.onClicked.addListener(async tab=>{
 if(!tab?.id||!/^https:\/\/chatgpt\.com\//.test(tab.url||""))return;
 await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content.js"]});
});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg?.type!=="arc_gateway_handoff")return false;
 (async()=>{
  if(!sender.tab?.id||!/^https:\/\/chatgpt\.com\//.test(sender.tab.url||""))
   throw Error("unauthorized_tab");
  if(typeof msg.text!=="string"||!msg.text.trim()||msg.text.length>950)
   throw Error("invalid_reply_size");
  // This permission is requested ONLY after the user explicitly presses
  // "Gatewayへ渡す" inside the already active ARC overlay.
  const granted=await chrome.permissions.request({origins:[ORIGIN]});
  if(!granted)throw Error("local_gateway_permission_denied");
  async function post(body){
   const r=await fetch(BASE+"/api/arc/handoff",{
    method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
    body:JSON.stringify(body)
   });
   const x=await r.json();
   if(!r.ok)throw Error(x.error||"gateway_rejected");
   return x;
  }
  const session=await post({action:"start"});
  const result=await post({action:"deliver",id:session.id,
    token:session.token,text:msg.text});
  if(!result.accepted)throw Error("gateway_delivery_not_confirmed");
  return {accepted:true,messageId:result.messageId,
    receiptHash:result.receiptHash};
 })().then(respond,e=>respond({accepted:false,error:e.message}));
 return true;
});
