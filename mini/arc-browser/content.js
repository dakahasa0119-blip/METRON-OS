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
   const kind=state.selected.length===0?"input":state.selected.length===1?"send":"response";
   const el=kind==="send"?e.target.closest('button,[role="button"],input[type="submit"]'):
     kind==="input"?e.target.closest('textarea,input,[contenteditable="true"],[role="textbox"]'):e.target;
   if(!el){status.textContent="用途に合う要素を選択してください。";return;}
   const selectedSelector=selector(el);
   let matches;
   try{matches=document.querySelectorAll(selectedSelector);}catch{matches=[];}
   if(matches.length!==1||matches[0]!==el){status.textContent="対象を一意に特定できません。別の要素を選択してください。";return;}
   const tag=el.tagName.toLowerCase();
   const role=el.getAttribute("role")||"";
   const type=el.getAttribute("type")||"";
   const entry={kind,
     selector:selectedSelector,tag,role,type};
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
 const portLabel=document.createElement("label");portLabel.textContent="Miniのポート ";
 const port=document.createElement("input");port.type="number";port.min="1";port.max="65535";port.value="8766";
 portLabel.append(port);
 const reselect=document.createElement("button");reselect.textContent="UIを選び直す";
 session.append(prompt,send,capture,portLabel,forward,result,reselect);
 let lastCaptured=null;
 let forwarding=false;
 const submittedCaptures=new Set();
 const picked=kind=>state.selected.find(x=>x.kind===kind);
 const locate=kind=>{
   const p=picked(kind);
   if(!p)return null;
   try{const matches=document.querySelectorAll(p.selector);return matches.length===1?matches[0]:null;}catch{return null;}
 };
 const isSensitive=el=>!el||root.contains(el)||
   el.closest('input[type="password"],[autocomplete="current-password"],[autocomplete="one-time-code"]');
 function enableSession(){
   root.append(session);
   status.textContent="選択完了。送信と回答取得はそれぞれ利用者がボタンで実行します。";
 }
 send.addEventListener("click",()=>{
   lastCaptured=null;
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
   lastCaptured=null;
   const response=locate("response");
   if(isSensitive(response)){result.textContent="回答欄を再選択してください";return;}
   const text=(response.innerText||response.textContent||"").trim();
   if(text.length>5000){result.textContent="回答が長すぎます。短い回答欄を選択してください。";return;}
   lastCaptured=text||null;
   result.textContent=text||"回答はまだ取得できません";
 });
 forward.addEventListener("click",()=>{
   if(forwarding)return;
   if(!lastCaptured){result.textContent="先に回答を取得してください";return;}
   if(submittedCaptures.has(lastCaptured)){result.textContent="この回答は配送済み・待機中・結果未確認です。Miniで確認してください。";return;}
   const gatewayPort=Number(port.value);
   if(!Number.isInteger(gatewayPort)||gatewayPort<1||gatewayPort>65535){result.textContent="Miniのポートは1〜65535で指定してください";return;}
   if(lastCaptured.length>950){
     result.textContent="回答が長すぎます。UIを選び直し、950文字以内の回答要素を選択してください。";
     return;
   }
   const captured=lastCaptured;
   forwarding=true;forward.disabled=true;
   chrome.runtime.sendMessage({type:"arc_gateway_handoff",text:captured,port:gatewayPort},reply=>{
     forwarding=false;forward.disabled=false;
     if(chrome.runtime.lastError){
       submittedCaptures.add(captured);
       result.textContent="Gateway結果未確認。再送せずMiniで確認してください: "+chrome.runtime.lastError.message;return;
     }
     if(reply?.submitted||reply?.accepted||reply?.uncertain)submittedCaptures.add(captured);
     result.textContent=reply?.accepted?
       "Gateway配送済み: "+reply.messageId:
       reply?.submitted?"Gateway受付済み・配送待ち: "+reply.messageId:
       reply?.uncertain?"Gateway結果未確認。再送せずMiniで確認してください。":
       "Gateway配送拒否: "+(reply?.error||"unknown");
     if(reply?.permissionWarning)result.textContent+=" localhost権限を解除できませんでした。拡張機能設定で解除してください。";
   });
 });
 reselect.addEventListener("click",()=>{
   lastCaptured=null;state.selected=[];session.remove();output.textContent="";
   status.textContent="入力欄・送信ボタン・回答欄を選び直してください。";
   document.addEventListener("click",onClick,true);
 });
 const cleanup=()=>{document.removeEventListener("click",onClick,true);root.remove();delete window.__metronArcPickerActive;};
 stop.addEventListener("click",cleanup);
 document.addEventListener("click",onClick,true);
})();
