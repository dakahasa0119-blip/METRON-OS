// ARC manual DOM picker. Installed only after the user clicks the extension.
// Never accesses credentials, browser storage, or prior conversation content.
(()=>{
 if(window.__metronArcPickerActive)return;
 window.__metronArcPickerActive=true;
 const state={selected:[]};
 const root=document.createElement("div");
 root.id="metron-arc-picker";
 root.style.cssText="position:fixed;z-index:2147483647;right:14px;top:14px;max-width:320px;padding:12px;background:#172a32;color:white;border:1px solid #65b99a;border-radius:12px;font:13px system-ui;box-shadow:0 8px 24px #0007";
 const heading=document.createElement("strong");heading.textContent="METRON ARC — UIを選択";
 const status=document.createElement("p");status.textContent="入力欄・送信ボタン・回答欄をクリックして指定。送信やログインは実行しません。";
 const output=document.createElement("pre");output.style.cssText="white-space:pre-wrap;word-break:break-all;max-height:150px;overflow:auto;font-size:11px";
 const stop=document.createElement("button");stop.textContent="終了";
 stop.style.cssText="padding:6px 10px;cursor:pointer";
 root.append(heading,status,output,stop);
 document.documentElement.append(root);
 const escapeValue=s=>typeof CSS!=="undefined"&&CSS.escape?CSS.escape(s):s.replace(/[^a-zA-Z0-9_-]/g,"\\$&");
 const selector=el=>{
   if(el.id&&el.id.length<100)return "#"+escapeValue(el.id);
   const parts=[];let node=el;
   while(node&&node!==document.body&&parts.length<5){
     let part=node.tagName.toLowerCase();
     if(node.getAttribute("data-testid"))part+='[data-testid="'+node.getAttribute("data-testid").replace(/["\\]/g,"")+'"]';
     else if(node.parentElement){
       const peers=[...node.parentElement.children].filter(e=>e.tagName===node.tagName);
       if(peers.length>1)part+=":nth-of-type("+([...node.parentElement.children].filter(e=>e.tagName===node.tagName).indexOf(node)+1)+")";
     }
     parts.unshift(part);node=node.parentElement;
   }
   return parts.join(" > ");
 };
 const onClick=e=>{
   if(root.contains(e.target))return;
   if(e.target.closest('input[type="password"],[autocomplete="current-password"],[autocomplete="one-time-code"]'))return;
   e.preventDefault();e.stopImmediatePropagation();
   const el=e.target;
   const tag=el.tagName.toLowerCase();
   const role=el.getAttribute("role")||"";
   const type=el.getAttribute("type")||"";
   const entry={kind:state.selected.length===0?"input":state.selected.length===1?"send":"response",
     selector:selector(el),tag,role,type};
   state.selected.push(entry);
   output.textContent=JSON.stringify(state.selected,null,2);
   status.textContent="選択 "+state.selected.length+"/3。表示内容はブラウザ内だけです。";
   if(state.selected.length>=3){
     document.removeEventListener("click",onClick,true);
     enableSession();
   }
 };
 const session=document.createElement("div");
 const prompt=document.createElement("textarea");
 prompt.placeholder="ARCから送る文章（利用者の明示操作で送信）";
 prompt.maxLength=1500;prompt.rows=3;
 prompt.style.cssText="display:block;width:98%;margin:7px 0";
 const send=document.createElement("button");send.textContent="この文章を送信";
 const capture=document.createElement("button");capture.textContent="最後の回答を取得";
 const forward=document.createElement("button");forward.textContent="選択した回答をGatewayへ渡す";
 const result=document.createElement("pre");
 result.style.cssText="white-space:pre-wrap;max-height:160px;overflow:auto;font-size:11px";
 session.append(prompt,send,capture,forward,result);
 let lastCaptured=null;
 const picked=kind=>state.selected.find(x=>x.kind===kind);
 const locate=kind=>{
   const p=picked(kind);
   if(!p)return null;
   try{return document.querySelector(p.selector);}catch{return null;}
 };
 const isSensitive=el=>!el||root.contains(el)||
   el.closest('input[type="password"],[autocomplete="current-password"],[autocomplete="one-time-code"]');
 function enableSession(){
   root.append(session);
   status.textContent="選択完了。送信と回答取得はそれぞれ利用者がボタンで実行します。";
 }
 send.addEventListener("click",()=>{
   const field=locate("input"),button=locate("send");
   if(isSensitive(field)||isSensitive(button)||!prompt.value.trim()||
      prompt.value.length>1500){result.textContent="対象欄・内容を確認してください";return;}
   if(!field.isContentEditable&&field.tagName!=="TEXTAREA"&&field.tagName!=="INPUT"){
     result.textContent="編集可能な入力欄を選択してください";return;
   }
   if(field.isContentEditable){
     field.focus();
     field.textContent=prompt.value;
     field.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:prompt.value}));
   }else{
     const proto=field.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
     const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
     if(!setter){result.textContent="入力に失敗しました";return;}
     setter.call(field,prompt.value);
     field.dispatchEvent(new Event("input",{bubbles:true}));
   }
   if(button instanceof HTMLElement&&!button.hasAttribute("disabled")){
     button.click();
     result.textContent="送信操作を実行。回答が表示されたら取得してください。";
   }else result.textContent="送信ボタンが使用できません。";
 });
 capture.addEventListener("click",()=>{
   const response=locate("response");
   if(isSensitive(response)){result.textContent="回答欄を再選択してください";return;}
   const text=(response.innerText||response.textContent||"").trim().slice(0,5000);
   lastCaptured=text||null;
   result.textContent=text||"回答はまだ取得できません";
 });
 forward.addEventListener("click",()=>{
   if(!lastCaptured){result.textContent="先に回答を取得してください";return;}
   if(lastCaptured.length>950){
     result.textContent="回答が長すぎます。950文字以内の部分を選択してください。";
     return;
   }
   forward.disabled=true;
   chrome.runtime.sendMessage({type:"arc_gateway_handoff",text:lastCaptured},reply=>{
     forward.disabled=false;
     if(chrome.runtime.lastError){
       result.textContent="Gateway通信失敗: "+chrome.runtime.lastError.message;return;
     }
     result.textContent=reply?.accepted?
       "Gateway配送済み: "+reply.messageId:
       "Gateway配送拒否: "+(reply?.error||"unknown");
   });
 });
 const cleanup=()=>{document.removeEventListener("click",onClick,true);root.remove();delete window.__metronArcPickerActive;};
 stop.addEventListener("click",cleanup);
 document.addEventListener("click",onClick,true);
})();
