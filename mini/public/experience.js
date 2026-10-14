/**
 * METRON mini: faithful protocol UI; each village owns MotherShip A/B.
 * Rumor is actual JSON exchanged via a shared folder, not AI cognition.
 */
const $=id=>document.getElementById(id);
let latest=null,busy=false;
const notify=(message,failed=false)=>{
  $("concept-notice").textContent=message;
  $("concept-notice").classList.toggle("error",failed);
};
function el(tag,cls,content){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(content!==undefined)node.textContent=String(content);
  return node;
}
function button(text,fn,secondary=false){
  const b=el("button",secondary?"subtle":"",text);
  b.type="button"; b.addEventListener("click",fn);
  return b;
}
function renderVillage(v){
  const section=el("section");
  section.append(el("strong","",v.name+" · 母艦A/B"));
  const list=el("ul");
  for(const item of v.knowledge.slice(-5))list.append(el("li","",item.text));
  section.append(list);
  return section;
}
function rumorBox(r,received){
  const card=el("div","proposal");
  const title=el("div","title-line");
  title.append(el("span","",r.originVillage+" / 母艦"+r.originCore));
  title.append(el("span","","Rumor JSON · "+r.id.slice(0,14)));
  card.append(title);
  card.append(el("p","",r.body));
  card.append(el("small","",r.sha256.slice(0,16)+"… SHA-256 / 改ざん検査用であり認証ではありません"));
  const actions=el("div","proposal-actions");
  if(r.originVillage==="village-1"){
    if(received){
      card.append(el("small","","第二の村: "+(received.status==="pending"?"受信・審査待ち":
        received.status==="adopted"?"採用済み":"隔離済み")));
    }else{
      actions.append(button("第二の村のGatewayで受信",()=>act("receive",{
        villageId:"village-2",rumorId:r.id
      })));
    }
  }
  if(actions.childElementCount)card.append(actions);
  return card;
}
function incomingCard(entry,state){
  const root=el("div","proposal status-"+entry.status);
  const rumor=state.square.find(x=>x.id===entry.rumorId);
  root.append(el("div","title-line",entry.sourceVillage+" → 第二の村 / "+
    (entry.status==="pending"?"審査待ち":entry.status==="adopted"?"採用済み":"隔離済み")));
  root.append(el("p","",rumor?.body??"[Rumorが見つかりません]"));
  if(entry.noiseFlags?.length){
    root.append(el("small","","Gatewayノイズ注意候補: "+entry.noiseFlags.join(", ")));
  }
  if(entry.status==="pending"){
    const actions=el("div","proposal-actions");
    actions.append(button("採用して村の記憶に入れる",()=>act("review",{
      villageId:"village-2",rumorId:entry.rumorId,decision:"adopt"
    })));
    actions.append(button("隔離する",()=>act("review",{
      villageId:"village-2",rumorId:entry.rumorId,decision:"quarantine"
    }),true));
    root.append(actions);
  }
  return root;
}
function render(state){
  latest=state;
  const one=state.villages["village-1"];
  const two=state.villages["village-2"];
  $("memory-a-count").textContent="村内知識 "+one.knowledge.length+
    " · A/B保存 "+(one.transport.motherAInbox+one.transport.motherBInbox);
  $("memory-b-count").textContent="村内知識 "+two.knowledge.length+
    " · A/B保存 "+(two.transport.motherAInbox+two.transport.motherBInbox);
  $("village-memories").replaceChildren(renderVillage(one),renderVillage(two));
  $("stat-ideas").textContent=state.square.length;
  $("stat-accepted").textContent=two.incoming.filter(x=>x.status==="adopted").length;
  $("stat-deliveries").textContent=state.transport?.gatewayJobs ??
    one.transport.gatewayJobs+two.transport.gatewayJobs;
  $("stat-salvages").textContent=4;
  const square=$("square-proposals");
  square.replaceChildren();
  const shown=state.square.slice().reverse().slice(0,12);
  if(!shown.length)square.append(el("p","hint","まだRumorはありません。上で公開してください。"));
  for(const rumor of shown)square.append(rumorBox(rumor,
    two.incoming.find(x=>x.rumorId===rumor.id)));
  const received=$("village-incoming");
  received.replaceChildren();
  if(!two.incoming.length)received.append(el("p","hint",
    "公開されたRumorを「第二の村のGatewayで受信」すると、ここへ届きます。"));
  for(const item of two.incoming.slice().reverse().slice(0,12))
    received.append(incomingCard(item,state));
  $("filter-level").value=String(two.gatewayFilterLevel);
  const log=$("concept-timeline");
  log.replaceChildren();
  const events=[
    ...one.events.map(x=>({...x,village:"第一の村"})),
    ...two.events.map(x=>({...x,village:"第二の村"}))
  ];
  if(!events.length)log.append(el("p","empty","イベントはまだありません。"));
  for(const entry of events.slice(-18).reverse()){
    const row=el("div","feed-row");
    row.append(el("strong","",entry.village+" · "+entry.kind));
    row.append(el("span","",entry.detail));
    log.append(row);
  }
}
async function refresh(){
  const res=await fetch("/api/civilization/state",{cache:"no-store"});
  if(!res.ok)throw Error("状態の取得に失敗");
  render(await res.json());
}
async function act(action,payload={}){
  if(busy)return;
  busy=true;
  const controls=document.querySelectorAll("button");
  controls.forEach(b=>b.disabled=true);
  notify("保存ファイルとGatewayを更新しています…");
  try{
    const response=await fetch("/api/civilization/action",{
      method:"POST",headers:{
        "Content-Type":"application/json","X-Metron-Mini":"1"
      },body:JSON.stringify({action,...payload})
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.message||result.error||"処理できませんでした");
    render(result.state);
    if(action==="salvage"){
      $("recovery-details").textContent="BAKU: "+
        result.artifact.cards.map(x=>x.name+" ["+x.flags.join(", ")+"]").join(" · ")+
        " / sourceStored=false / executed=false";
    }
    if(action==="recovery"){
      $("recovery-details").textContent="村内母艦A/B Gateway復旧: "+
        result.check.result+" / 重複抑止="+result.check.duplicateAfterCrash;
    }
    const messages={
      publish:"Rumor JSONをVillage Squareのフォルダーに公開しました。",
      receive:"第二の村のGatewayがJSONを受信。採用はまだ行っていません。",
      review:"利用者の判断を第二の村の独立した記憶に保存しました。",
      filter:"第二の村のGatewayのノイズ検査強度を保存しました。",
      salvage:"BAKUがコード断片を静的検査しました。コードは実行していません。",
      recovery:"一つの村の母艦A/B間で障害復旧を検証しました。"
    };
    notify(messages[action]||"処理完了");
  }catch(e){notify(e.message,true);}
  finally{
    busy=false;controls.forEach(b=>b.disabled=false);
  }
}
$("share-knowledge").addEventListener("click",()=>{
  const text=$("rumor-text").value.trim();
  if(!text||text.length>320)return notify("320文字以内のRumorを入力してください",true);
  act("publish",{from:"village-1",text});
});
$("save-filter").addEventListener("click",()=>
  act("filter",{villageId:"village-2",level:Number($("filter-level").value)}));
$("try-salvage").addEventListener("click",()=>
  act("salvage",{code:$("salvage-code").value}));
$("try-recovery").addEventListener("click",()=>act("recovery"));
refresh().then(()=>notify(
  "確認完了。まず第一の村の母艦A/BからRumor JSONを公開してください。"
)).catch(e=>notify(e.message,true));
