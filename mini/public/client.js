/**
 * METRON Mini browser adapter:
 * ARC selector discovery and manual picking on THIS local test page only.
 * No remote pages, login, credentials or synthetic "AI success" claims.
 */
import { findDeep, startPicker, SelectorMemory } from "/arc-kit.mjs";

const $ = id => document.getElementById(id);
const arcMemory=new SelectorMemory({confirmations:1});
const probes={
  input:"#message-text",
  send:"#submit-mission",
  resp:"#ship-b-messages"
};
const status=$("notice");
const selectors={};
function showNotice(message,isError=false){
  status.textContent=message;
  status.classList.toggle("error",isError);
}
function arcCheck(){
  const found=Object.entries(probes).filter(([,selector])=>
    !!findDeep(document,selector,{operableOnly:false}));
  $("arc-ready").textContent=found.length+" / 3";
  $("arc-health").textContent=found.length===3
    ? "ローカルDOM探索に成功":"DOM探索は一部未完了";
  return found.length===3;
}
function textNode(tag,className,text){
  const el=document.createElement(tag);
  if(className)el.className=className;
  el.textContent=String(text??"");
  return el;
}
function renderInbox(root,messages){
  root.replaceChildren();
  if(!messages?.length){
    root.append(textNode("p","empty","まだ記録はありません。"));return;
  }
  for(const message of messages.slice().reverse()){
    const card=textNode("div","message-card","");
    card.append(textNode("div","message-meta",
      message.sender+" → "+message.recipient+" · "+message.type+" · "+message.id.slice(0,16)));
    card.append(textNode("div","message-body",message.body));
    root.append(card);
  }
}
function renderJobs(root,jobs){
  root.replaceChildren();
  if(!jobs?.length){
    root.append(textNode("p","empty","配送イベントがありません。"));return;
  }
  for(const job of jobs.slice().reverse()){
    const row=textNode("div","log-row","");
    row.append(textNode("div","log-route",job.from+" → "+job.to));
    const inspect=job.meta?.baku?.cards||[];
    const desc=job.type==="ACK"?"ACK/配達確認":
      "OBSERVE / "+(job.meta?.workClass||"dispatch")+
      (inspect.length?" · BAKU "+inspect.length+" cards":"");
    row.append(textNode("div","log-details",desc));
    row.append(textNode("div","log-state",job.state));
    root.append(row);
  }
}
function renderState(state){
  $("health").textContent="RUNNING";
  $("metric-jobs").textContent=state.gateway.jobs;
  $("metric-delivered").textContent=
    state.ships.A.count+state.ships.B.count;
  const scanned=state.gateway.recent.filter(job=>job.meta?.baku?.inspected);
  $("metric-baku").textContent=scanned.at(-1)?.meta?.baku?.cards?.length??0;
  renderInbox($("ship-a-messages"),state.ships.A.messages);
  renderInbox($("ship-b-messages"),state.ships.B.messages);
  renderJobs($("gateway-log"),state.gateway.recent);
}
async function refresh(){
  const res=await fetch("/api/state",{cache:"no-store"});
  if(!res.ok)throw Error("state read failed");
  renderState(await res.json());
}
function syncTarget(changed){
  if($("from-ship").value===$("to-ship").value){
    if(changed==="from")$("to-ship").value=
      $("from-ship").value==="A"?"B":"A";
    else $("from-ship").value=$("to-ship").value==="A"?"B":"A";
  }
}
$("from-ship").addEventListener("change",()=>syncTarget("from"));
$("to-ship").addEventListener("change",()=>syncTarget("to"));
$("refresh").addEventListener("click",async()=>{
  try{await refresh();showNotice("保存された母艦とGatewayの状態を再取得しました。");}
  catch(error){showNotice(error.message,true);}
});
$("mission-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const btn=$("submit-mission");
  btn.disabled=true;
  showNotice("Gatewayへ送信し、母艦B/Aへの到達とACKを確認しています…");
  try{
    const mission={
      messageId:"m_"+crypto.randomUUID().replaceAll("-",""),
      from:$("from-ship").value,to:$("to-ship").value,
      message:$("message-text").value,code:$("code-excerpt").value,
      arc:{selectorsChecked:arcCheck()}
    };
    const response=await fetch("/api/mission",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
      body:JSON.stringify(mission)
    });
    const payload=await response.json();
    if(!response.ok)throw Error(payload.message||payload.error||"mission rejected");
    renderState(payload.state);
    const baku=payload.job?.result?.meta?.baku;
    const count=baku?.cards?.length||0;
    const risks=(baku?.cards||[]).flatMap(card=>card.flags||[]);
    showNotice("配送とACKを記録しました。BAKU: "+
      count+"個のコードカードを静的検査。"+
      (risks.length?" 注意候補 "+[...new Set(risks)].join(", "):" コードは実行していません。"));
  }catch(error){
    showNotice("処理を完了できませんでした: "+error.message,true);
  }finally{btn.disabled=false;}
});
for(const button of document.querySelectorAll("[data-picker]")){
  button.addEventListener("click",()=>{
    const role=button.dataset.picker;
    showNotice("ARC 手動選択: 対象の要素をクリックしてください。Escで取り消せます。");
    $("selector-output").textContent="ARC PICKER ACTIVE · role="+role;
    startPicker(document,{
      role,
      onPick({selector}){
        arcMemory.setManual("metron-mini",role,selector);
        selectors[role]=selector;
        $("selector-output").textContent=
          "ARC "+role+" → "+selector+" · 手動選択を保存（このブラウザの一時記憶）";
        showNotice("ARCが画面内の対象を選択しました。外部ページ操作はありません。");
      },
      onCancel(){
        $("selector-output").textContent="ARC: ピッカーをキャンセルしました。";
        showNotice("手動選択をキャンセルしました。");
      }
    });
  });
}
arcCheck();
refresh().then(()=>showNotice("起動完了。母艦A/Bへのメッセージ配送を試せます。"))
  .catch(error=>showNotice("起動状態を取得できません: "+error.message,true));
