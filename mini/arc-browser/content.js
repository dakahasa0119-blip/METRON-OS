// ARC manual DOM picker. Invoked only by the extension toolbar gesture.
// Selectors, response previews and delivery IDs remain ephemeral in this page.
(()=>{
 const replies=globalThis.MetronArcReplyState;
 if(!replies||window.__metronArcPickerActive)return;
 window.__metronArcPickerActive=true;
 const state={selected:[]};
 let disposed=false,lastCaptured=null,currentRecord=null,forwarding=false,observation;
 const root=document.createElement("div");root.id="metron-arc-picker";
 root.style.cssText="position:fixed;z-index:2147483647;right:14px;top:14px;max-width:360px;max-height:calc(100vh - 54px);overflow:auto;padding:12px;background:#172a32;color:white;border:1px solid #65b99a;border-radius:12px;font:13px system-ui;box-shadow:0 8px 24px #0007";
 const heading=document.createElement("strong");heading.textContent="METRON ARC — UIを選択";
 const status=document.createElement("p");status.textContent="入力欄・送信ボタン・回答欄をクリックして指定。送信やログインは実行しません。";
 const output=document.createElement("pre");output.style.cssText="white-space:pre-wrap;word-break:break-all;max-height:110px;overflow:auto;font-size:11px";
 const stop=document.createElement("button");stop.id="metron-arc-stop";stop.textContent="終了";
 root.append(heading,status,output,stop);document.documentElement.append(root);
 const make=(tag,id,text)=>{const node=document.createElement(tag);node.id="metron-arc-"+id;if(text!==undefined)node.textContent=text;return node;};
 const session=document.createElement("div");
 const prompt=make("textarea","prompt");prompt.placeholder="ARCから送る文章（この送信操作で新しい配送IDを作成）";prompt.maxLength=1500;prompt.rows=3;
 prompt.style.cssText="display:block;width:98%;margin:7px 0";
 const send=make("button","send","この文章を送信");
 const newRecord=make("button","new-record","新しい配送記録を作る");
 const recordLabel=document.createElement("p");recordLabel.textContent="配送ID（Mini側の記録を再開するため控えてください）";
 const messageId=make("code","message-id","未選択");recordLabel.append(messageId);
 const recovery=make("input","recovery-id");recovery.type="text";recovery.maxLength=36;recovery.placeholder="arc_ と32桁の小文字16進数";
 const resume=make("button","resume","この配送IDで再開");
 const completionLabel=document.createElement("label"),completion=make("input","completion-reviewed");completion.type="checkbox";
 completionLabel.append(completion,document.createTextNode("選択した回答の生成完了を目視確認した"));
 const completionState=make("p","completion-state");
 const capture=make("button","capture","選択した回答を取得");
 const portLabel=document.createElement("label");portLabel.textContent="Miniのポート ";
 const port=make("input","port");port.type="number";port.min="1";port.max="65535";port.value="8766";portLabel.append(port);
 const forward=make("button","forward","選択した回答をGatewayへ渡す");
 const checkStatus=make("button","status","この配送IDの状態を確認");
 const retry=make("button","retry","同じ配送IDで明示再送");
 const preview=make("pre","preview");preview.style.cssText="white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;font-size:11px";
 const result=make("pre","result");result.style.cssText="white-space:pre-wrap;word-break:break-word;max-height:120px;overflow:auto;font-size:11px";
 const reselect=make("button","reselect","UIを選び直す");
 session.append(prompt,send,newRecord,recordLabel,recovery,resume,completionLabel,completionState,capture,portLabel,forward,checkStatus,retry,preview,result,reselect);
 const escapeValue=s=>typeof CSS!=="undefined"&&CSS.escape?CSS.escape(s):s.replace(/[^a-zA-Z0-9_-]/g,"\\$&");
 const selector=el=>{
  if(el.id&&el.id.length<100)return "#"+escapeValue(el.id);
  const parts=[];let node=el;
  while(node&&node!==document.body&&parts.length<5){
   let part=node.tagName.toLowerCase();
   if(node.getAttribute("data-testid"))part+='[data-testid="'+node.getAttribute("data-testid").replace(/["\\]/g,"")+'"]';
   else if(node.parentElement){const peers=[...node.parentElement.children].filter(e=>e.tagName===node.tagName);
    if(peers.length>1)part+=":nth-of-type("+([...node.parentElement.children].filter(e=>e.tagName===node.tagName).indexOf(node)+1)+")";}
   parts.unshift(part);node=node.parentElement;
  }
  return parts.join(" > ");
 };
 const picked=kind=>state.selected.find(x=>x.kind===kind);
 const locate=kind=>{const p=picked(kind);if(!p)return null;try{const matches=document.querySelectorAll(p.selector);return matches.length===1?matches[0]:null;}catch{return null;}};
 const isSensitive=el=>!el||root.contains(el)||el.contains?.(root)||el.closest('input[type="password"],[autocomplete="current-password"],[autocomplete="one-time-code"]');
 function clearCapture(){lastCaptured=null;preview.textContent="";completion.checked=false;}
 function showState(value){
  completion.checked=value.manual===true;completion.disabled=disposed||value.generating||!value.node||value.stale;
  completionState.textContent=value.generating?"生成中の表示を検出。目視確認でも取得・転送できません。":
   value.stale?"送信前と同じ回答欄です。新しい質問への回答欄を選択してください。":
   value.observed?"完了候補: 生成状態の変化・送信可能状態・本文の安定を観測（実サービスでは未検証）。":
   value.manual?"利用者が生成完了を目視確認しました。プロバイダーによる自動確定ではありません。":
   "生成完了は未確認です。回答を目視確認して確認欄を選んでください。";
  capture.disabled=disposed||!value.ready;
  forward.disabled=disposed||forwarding||!currentRecord||!lastCaptured||!value.ready||["submitted","uncertain","accepted","failed"].includes(currentRecord.state);
  retry.disabled=disposed||forwarding||!currentRecord||!lastCaptured||!value.ready||!["resumed","submitted","uncertain","not_found"].includes(currentRecord.state);
  checkStatus.disabled=disposed||forwarding||!currentRecord;
 }
 observation=replies.observe({document,getResponse:()=>{const el=locate("response");return isSensitive(el)?null:el;},getSend:()=>locate("send"),ignore:el=>root.contains(el),
  onInvalidated:clearCapture,onState:showState});
 const refreshControls=()=>observation.sample();
 function chooseRecord(id,recordState){clearCapture();observation.confirmManual(false);currentRecord={id,state:recordState};messageId.textContent=id;refreshControls();}
 function createRecord(){
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  chooseRecord("arc_"+[...bytes].map(x=>x.toString(16).padStart(2,"0")).join(""),"new");
 }
 const onClick=e=>{
  if(e.isTrusted!==true||disposed||root.contains(e.target))return;
  if(e.target.closest('input[type="password"],[autocomplete="current-password"],[autocomplete="one-time-code"]'))return;
  e.preventDefault();e.stopImmediatePropagation();
  const kind=state.selected.length===0?"input":state.selected.length===1?"send":"response";
  const el=kind==="send"?e.target.closest('button,[role="button"],input[type="submit"]'):
   kind==="input"?e.target.closest('textarea,input,[contenteditable="true"],[role="textbox"]'):e.target;
  if(!el){status.textContent="用途に合う要素を選択してください。";return;}
  const selectedSelector=selector(el);let matches;
  try{matches=document.querySelectorAll(selectedSelector);}catch{matches=[];}
  if(matches.length!==1||matches[0]!==el){status.textContent="対象を一意に特定できません。別の要素を選択してください。";return;}
  state.selected.push({kind,selector:selectedSelector,tag:el.tagName.toLowerCase(),role:el.getAttribute("role")||"",type:el.getAttribute("type")||""});
  output.textContent=JSON.stringify(state.selected,null,2);status.textContent="選択 "+state.selected.length+"/3。表示内容はブラウザ内だけです。";
  observation.selectionChanged();
  if(state.selected.length===3){document.removeEventListener("click",onClick,true);root.append(session);status.textContent="配送記録を新規作成するか、Miniの配送IDで明示再開してください。送信・取得・状態確認・転送は各ボタンで実行します。";}
 };
 newRecord.addEventListener("click",e=>{if(e.isTrusted!==true||disposed)return;createRecord();result.textContent="新しい配送IDを作りました。回答の生成完了を確認して取得してください。";});
 resume.addEventListener("click",e=>{
  if(e.isTrusted!==true||disposed)return;if(!replies.validId(recovery.value)){result.textContent="配送IDの形式を確認してください。";return;}
  chooseRecord(recovery.value,"resumed");result.textContent="この配送IDを選びました。状態確認・同じIDでの再送は別の明示操作です。";
 });
 completion.addEventListener("click",e=>{if(e.isTrusted!==true){e.preventDefault();return;}if(disposed)return;const requested=completion.checked;clearCapture();
  const value=observation.confirmManual(requested);if(requested&&!value.manual)result.textContent="生成中・回答未選択・送信前と同じ回答は確認できません。";});
 send.addEventListener("click",e=>{
  if(e.isTrusted!==true||disposed)return;clearCapture();observation.confirmManual(false);
  const field=locate("input"),button=locate("send"),response=locate("response");
  if(isSensitive(field)||isSensitive(button)||!prompt.value.trim()||prompt.value.length>1500){result.textContent="対象欄・内容を確認してください";return;}
  if(!field.isContentEditable&&field.tagName!=="TEXTAREA"&&field.tagName!=="INPUT"){result.textContent="編集可能な入力欄を選択してください";return;}
  if(isSensitive(response)){result.textContent="次の送信の前に「UIを選び直す」で回答欄を選択してください。";return;}
  if(!(button instanceof HTMLElement)||button.hasAttribute("disabled")||button.getAttribute("aria-disabled")==="true"){result.textContent="送信ボタンが使用できません。";return;}
  const beforeSend={node:response,text:replies.readText(response)};
  if(field.isContentEditable){field.focus();field.textContent=prompt.value;field.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:prompt.value}));}
  else{const proto=field.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
   const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;if(!setter){result.textContent="入力に失敗しました";return;}
   setter.call(field,prompt.value);field.dispatchEvent(new Event("input",{bubbles:true}));}
  createRecord();state.selected=state.selected.filter(x=>x.kind!=="response");output.textContent=JSON.stringify(state.selected,null,2);
  observation.beginSend(beforeSend);button.click();refreshControls();
  result.textContent="送信操作を実行し新しい配送IDを作成。新しい回答を「UIを選び直す」で選択してください。";
 });
 capture.addEventListener("click",e=>{
  if(e.isTrusted!==true||disposed)return;lastCaptured=null;preview.textContent="";
  const response=locate("response");if(isSensitive(response)){result.textContent="回答欄を再選択してください";return;}
  const value=observation.sample();
  if(value.stale){result.textContent="送信前と同じ回答欄です。新しい質問への回答欄を選択してください。";return;}
  if(!value.ready){result.textContent=value.generating?"生成中は回答を取得できません。":"先に生成完了を目視確認してください。";return;}
  try{replies.encodeText(value.text);}catch(error){result.textContent="回答を取得できません: "+error.code;return;}
  lastCaptured={node:response,text:value.text,recordId:currentRecord?.id??null};preview.textContent=value.text;result.textContent=value.text;refreshControls();
 });
 function transfer(event,action,isRetry=false){
  if(event.isTrusted!==true||disposed||forwarding)return;
  const record=currentRecord;if(!record){result.textContent="新しい配送記録を作るか、配送IDで再開してください。";return;}
  const gatewayPort=Number(port.value);if(!Number.isInteger(gatewayPort)||gatewayPort<1||gatewayPort>65535){result.textContent="Miniのポートは1〜65535で指定してください";return;}
  const value=observation.sample();let captured;
  if(action==="deliver"){
   captured=lastCaptured;
   if(!captured||captured.recordId!==record.id||captured.node!==value.node||captured.text!==value.text||!value.ready){clearCapture();result.textContent="回答が変化したか生成完了が未確認です。再確認して取得してください。";return;}
   if(record.state==="failed"){result.textContent="配送は失敗で停止しています: "+record.id+"。Mini側の修復が必要です。配送IDの状態を確認してください。";return;}
   if(record.state==="accepted"||!isRetry&&["submitted","uncertain"].includes(record.state)){result.textContent="同じ配送IDの状態を確認してください。自動では再送しません。";return;}
   if(isRetry&&!["resumed","submitted","uncertain","not_found"].includes(record.state)){result.textContent="先に配送するか、Miniの配送IDを明示指定してください。";return;}
  }
  const message={type:"arc_gateway_handoff",action,version:2,messageId:record.id,port:gatewayPort};
  if(captured)message.text=captured.text;
  forwarding=true;refreshControls();
  chrome.runtime.sendMessage(message,reply=>{
   forwarding=false;
   if(disposed)return;
   const lastError=chrome.runtime.lastError;
   if(lastError){if(action==="deliver")record.state="uncertain";result.textContent="Gateway結果未確認: "+record.id+"。同じIDで確認してください。";refreshControls();return;}
   if(reply?.messageId!==record.id){if(action==="deliver")record.state="uncertain";result.textContent="配送IDの一致を確認できません。Miniで確認してください: "+record.id;refreshControls();return;}
   const safeError=typeof reply.error==="string"&&/^[a-z][a-z0-9_]{0,79}$/.test(reply.error)?reply.error:"";
   const failed=reply.submitted===true&&reply.accepted!==true&&(reply.deliveryState==="failed"||reply.ackState==="failed"||reply.jobState==="dead");
   const failureStage=reply.deliveryState==="failed"?"母艦Bへの配送":reply.ackState==="failed"?"AのACK永続化":"Gatewayジョブ";
   if(reply.accepted)record.state="accepted";else if(failed)record.state="failed";else if(reply.submitted)record.state="submitted";else if(reply.uncertain)record.state="uncertain";else if(action==="status"&&!reply.error)record.state="not_found";
   result.textContent=reply.accepted?"母艦Bの全文とAのACKを永続照合済み: "+record.id:
    failed?"配送は失敗で停止しています: "+record.id+"。失敗段階: "+failureStage+"。Mini側の修復が必要です。配送IDの状態を確認してください。":
    reply.submitted?"Gateway受付済み・配送確認待ち: "+record.id:
    reply.uncertain?"Gateway結果未確認: "+record.id+"。同じIDで状態確認または明示再送してください。"+(safeError?" 拒否理由: "+safeError:""):
    reply.error?"Gateway操作拒否: "+reply.error+" ("+record.id+")":"この配送IDの記録は未確認です。必要なら同じIDで明示再送してください: "+record.id;
   if(currentRecord!==record)result.textContent+=" 現在選択中の新しい配送IDとは別の結果です。";
   if(reply.permissionWarning)result.textContent+=" localhost権限を解除できませんでした。拡張機能設定で解除してください。";
   refreshControls();
  });
 }
 forward.addEventListener("click",e=>transfer(e,"deliver"));
 retry.addEventListener("click",e=>transfer(e,"deliver",true));
 checkStatus.addEventListener("click",e=>transfer(e,"status"));
 reselect.addEventListener("click",e=>{
  if(e.isTrusted!==true||disposed)return;clearCapture();state.selected=[];observation.selectionChanged();session.remove();output.textContent="";
  status.textContent="入力欄・送信ボタン・回答欄を選び直してください。配送IDはこのページ内に保持します。";
  document.addEventListener("click",onClick,true);
 });
 const cleanup=e=>{
  if(e.isTrusted!==true||disposed)return;disposed=true;observation.dispose();document.removeEventListener("click",onClick,true);
  lastCaptured=null;currentRecord=null;state.selected=[];root.remove();delete window.__metronArcPickerActive;
 };
 stop.addEventListener("click",cleanup);document.addEventListener("click",onClick,true);observation.start();
})();
