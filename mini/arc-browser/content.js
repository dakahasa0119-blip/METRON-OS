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
   if(state.selected.length>=3)document.removeEventListener("click",onClick,true);
 };
 const cleanup=()=>{document.removeEventListener("click",onClick,true);root.remove();delete window.__metronArcPickerActive;};
 stop.addEventListener("click",cleanup);
 document.addEventListener("click",onClick,true);
})();
