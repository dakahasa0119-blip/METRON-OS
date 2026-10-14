/**
 * Guided METRON civilization mode: real Village Square state + local Gateway.
 * Every adoption is an explicit human click. Derivation is a fixed scenario,
 * never an autonomous AI conclusion.
 */
const $ = id => document.getElementById(id);
let latest = null;
let busy = false;
const notify = (message,failed=false) => {
  const box = $("concept-notice");
  box.textContent=message;
  box.classList.toggle("error",failed);
};
function node(tag,cls,body) {
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(body!==undefined)n.textContent=String(body);
  return n;
}
function replaceContents(parent, children) {
  parent.replaceChildren(...children);
}
function memoryPanel(ship, data) {
  const section=node("section");
  section.append(node("strong","",data.name));
  const list=node("ul");
  for(const knowledge of data.knowledge.slice(-5))
    list.append(node("li","",knowledge.text));
  section.append(list);
  return section;
}
function renderSquare(state) {
  const root=$("square-proposals"),proposals=state.square.slice().reverse();
  root.replaceChildren();
  if(!proposals.length) {
    root.append(node("p","hint","まだ提案はありません。上のボタンからAの知識を共有してみましょう。"));
    return;
  }
  for(const rumor of proposals) {
    const card=node("div","proposal status-"+rumor.status);
    const top=node("div","title-line");
    top.append(node("span","",rumor.from+" → "+rumor.to));
    const status=rumor.status==="awaiting_review"?"審査待ち":
      rumor.status==="adopted"?"知識に採用済み":"隔離済み";
    top.append(node("span","",status));
    card.append(top,node("p","",rumor.text));
    const origin=rumor.parentId
      ?"継承元: "+rumor.parentId.slice(0,22)
      :"元のアイデア: 利用者の入力";
    card.append(node("small","",origin));
    if(rumor.status==="awaiting_review") {
      const actions=node("div","proposal-actions");
      const adopted=node("button","","この知識を採用する");
      adopted.type="button";
      adopted.addEventListener("click",()=>act("review",{rumorId:rumor.id,decision:"adopt"}));
      const quarantine=node("button","subtle","保留・隔離する");
      quarantine.type="button";
      quarantine.addEventListener("click",()=>act("review",{rumorId:rumor.id,decision:"quarantine"}));
      actions.append(adopted,quarantine);
      card.append(actions);
    }
    root.append(card);
  }
}
function renderEvents(events) {
  const root=$("concept-timeline");
  root.replaceChildren();
  if(!events.length){
    root.append(node("p","empty","まだ共有イベントはありません。"));
    return;
  }
  for(const item of events.slice().reverse().slice(0,15)) {
    const row=node("div","feed-row");
    row.append(node("strong","",item.kind?.toUpperCase()||"EVENT"));
    row.append(node("span","",item.detail));
    root.append(row);
  }
}
function render(state) {
  latest=state;
  $("village-a-purpose").textContent=state.villages.A.value;
  $("village-b-purpose").textContent=state.villages.B.value;
  $("memory-a-count").textContent="記憶 "+state.villages.A.knowledge.length;
  $("memory-b-count").textContent="記憶 "+state.villages.B.knowledge.length;
  $("stat-ideas").textContent=state.square.length;
  $("stat-accepted").textContent=state.square.filter(x=>x.status==="adopted").length;
  $("stat-deliveries").textContent=state.transport.gatewayJobs;
  $("stat-salvages").textContent=state.salvage.length;
  replaceContents($("village-memories"),[
    memoryPanel("A",state.villages.A),memoryPanel("B",state.villages.B)
  ]);
  renderSquare(state);
  renderEvents(state.events);
  const available=state.square.some(x=>
    x.from==="A"&&x.to==="B"&&x.status==="adopted"&&
    !state.square.some(y=>y.parentId===x.id));
  $("derive-knowledge").disabled=!available||busy;
}
async function refresh(){
  const response=await fetch("/api/civilization/state",{cache:"no-store"});
  if(!response.ok)throw Error("state request failed");
  render(await response.json());
}
async function act(action,payload={}) {
  if(busy)return;
  busy=true;
  document.querySelectorAll("button").forEach(b=>b.disabled=true);
  notify("ローカルGatewayと文明の記録を更新しています…");
  try {
    const response=await fetch("/api/civilization/action",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
      body:JSON.stringify({action,...payload})
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.message||result.error||"operation rejected");
    render(result.state);
    const messages={
      publish:"Aの知識がVillage Squareに届きました。Bはまだ採用していません。",
      review:"採用・隔離の判断を、それぞれの村の記憶と履歴に反映しました。",
      derive:"Bのルールによる継承案をAへ届けました。A側で採用を決められます。",
      salvage:"BAKUが架空の失敗コードのDNAを回収し、危険な断片を隔離しました。",
      recovery:"Gatewayの障害復旧をローカル隔離環境で実証しました。"
    };
    notify(messages[action]||"操作を完了しました。");
    if(action==="recovery"){
      const details=$("recovery-details");
      const check=result.check;
      details.textContent="ローカル検証: "+check.result+
        " / 再送回数 "+check.deliveryAttempts+
        " / 重複除外 "+check.duplicateAfterCrash+
        " / 正常保存 "+check.acceptedUniqueMessages+"件";
    }
    if(action==="salvage"){
      const artifact=result.artifact;
      $("recovery-details").textContent="BAKU DNA: "+
        artifact.cards.map(c=>c.name+" ["+c.flags.join(",")+"]").join(" / ")+
        " → QUARANTINE (コード実行なし)";
    }
  }catch(error){
    notify(error.message,true);
  }finally{
    busy=false;
    document.querySelectorAll("button").forEach(b=>b.disabled=false);
    if(latest)render(latest);
  }
}
$("share-knowledge").addEventListener("click",()=>{
  const text=$("rumor-text").value.trim();
  if(text.length===0||text.length>320)return notify("320文字以内の知識を入力してください。",true);
  act("publish",{from:"A",text});
});
$("derive-knowledge").addEventListener("click",()=>{
  const src=latest?.square.slice().reverse().find(x=>
    x.from==="A"&&x.to==="B"&&x.status==="adopted"&&
    !latest.square.some(y=>y.parentId===x.id));
  if(src)act("derive",{rumorId:src.id});
});
$("try-salvage").addEventListener("click",()=>act("salvage"));
$("try-recovery").addEventListener("click",()=>act("recovery"));
refresh().then(()=>notify(
  "文明の状態を読み込みました。まず二つの村の違いを見てから、知識の共有を試してください。"
)).catch(error=>notify("起動状態を取得できません: "+error.message,true));
