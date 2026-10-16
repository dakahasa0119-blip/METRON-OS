// Reworked from app/src/main/assets/arc_core.js:78,260-290 (baseline,
// generating markers and repeated observations), alongside the explicit picker
// contract in reusable/arc-dom/selector-kit.mjs. No auto-send, history or storage.
// A quiet interval alone is never proof that the provider completed its reply.
(()=>{
 const MAX_REPLY_BYTES=256*1024,ID=/^arc_[a-f0-9]{32}$/;
 const fail=code=>Object.assign(new Error(code),{code});
 function encodeText(text){
  if(typeof text!=="string"||!text.trim()||text.length>MAX_REPLY_BYTES)throw fail("invalid_arc_reply");
  for(let i=0;i<text.length;i++){
   const n=text.charCodeAt(i);
   if(n>=0xd800&&n<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw fail("invalid_arc_unicode");}
   else if(n>=0xdc00&&n<=0xdfff)throw fail("invalid_arc_unicode");
  }
  const bytes=new TextEncoder().encode(text);
  if(bytes.length>MAX_REPLY_BYTES)throw fail("arc_reply_too_large");
  return bytes;
 }
 const readText=node=>node?(typeof node.innerText==="string"?node.innerText:node.textContent||""):"";
 const GENERATING='[aria-label*="停止" i], [aria-label*="Stop" i], button[data-testid*="stop" i], [data-is-streaming="true"], .result-streaming, .generating';
 function observe({document,getResponse,getSend,ignore=()=>false,onInvalidated=()=>{},onState=()=>{},
   now=()=>Date.now(),setInterval:repeat=globalThis.setInterval,clearInterval:cancel=globalThis.clearInterval,
   MutationObserver:Observer=globalThis.MutationObserver}={}){
  let stopped=false,timer=null,observer=null,node=null,text="",changedAt=now(),observations=0;
  let baseline=null,sawBusy=false,wasBusy=false,manual=null,epoch=0,completionEpoch=null;
  const visible=el=>!!el&&!ignore(el)&&el.isConnected!==false&&!el.hidden&&el.getAttribute?.("aria-hidden")!=="true"&&
   (typeof el.getClientRects!=="function"||el.getClientRects().length>0);
  const generating=()=>{
   try{return [...document.querySelectorAll(GENERATING)].some(visible)||
    !!getResponse()?.closest?.('[aria-busy="true"],[data-is-streaming="true"]')||
    [...(getResponse()?.querySelectorAll?.('[aria-busy="true"],[data-is-streaming="true"]')||[])].some(visible);}catch{return true;}
  };
  const invalidate=()=>{manual=null;onInvalidated();};
  const mutated=()=>{invalidate();epoch++;completionEpoch=null;changedAt=now();observations=0;};
  function sample(){
   if(stopped)return {stopped:true,ready:false,generating:false,manual:false,text:"",node:null};
   if(observer?.takeRecords?.()?.length)mutated();
   const current=getResponse(),value=readText(current),busy=generating();
   if(current!==node||value!==text){
    mutated();node=current;text=value;observations=1;
    observer?.disconnect();observer=null;
    if(node&&Observer){observer=new Observer(()=>{if(stopped)return;mutated();sample();});observer.observe(node,{subtree:true,childList:true,characterData:true,attributes:true});}
   }else observations++;
   if(busy){if(!wasBusy)invalidate();sawBusy=true;completionEpoch=null;}
   else if(wasBusy)completionEpoch=epoch;
   wasBusy=busy;
   const stale=!!baseline&&node===baseline.node&&text===baseline.text;
   const send=getSend(),sendReady=!!send&&!send.hasAttribute("disabled")&&send.getAttribute("aria-disabled")!=="true";
   const usable=!!node&&!!text.trim()&&!stale;
   const manualReady=!!manual&&manual.node===node&&manual.text===text;
   const observed=!!baseline&&sawBusy&&completionEpoch===epoch&&sendReady&&observations>=2&&now()-changedAt>=600;
   const state={node,text,generating:busy,stale,manual:manualReady,observed:usable&&!busy&&observed,
    ready:usable&&!busy&&(observed||manualReady)};
   onState(state);return state;
  }
  function selectionChanged(){mutated();observer?.disconnect();observer=null;node=null;text="";return sample();}
  return {
   start(){if(stopped||timer!==null)return;sample();if(typeof repeat==="function")timer=repeat(sample,250);},
   sample,selectionChanged,
   beginSend(value){baseline=value;sawBusy=false;completionEpoch=null;wasBusy=false;return selectionChanged();},
   confirmManual(checked){const current=sample();manual=checked&&!current.generating&&!current.stale&&current.node&&current.text.trim()?
    {node:current.node,text:current.text}:null;return sample();},
   dispose(){if(stopped)return;stopped=true;if(timer!==null)cancel?.(timer);timer=null;observer?.disconnect();observer=null;manual=null;node=null;text="";}
  };
 }
 globalThis.MetronArcReplyState=Object.freeze({MAX_REPLY_BYTES,validId:value=>typeof value==="string"&&ID.test(value),encodeText,readText,observe});
})();
