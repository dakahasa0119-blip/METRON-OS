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


/**
 * The four original-system paths are separate from the Village Square flow.
 * External model consultation requires operator confirmation per request.
 * Neither a failed remote call nor an empty local model can create verdicts.
 */
async function advancedRequest(action,payload={}){
  const response=await fetch("/api/advanced/action",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
    body:JSON.stringify({action,...payload})
  });
  const data=await response.json();
  if(!response.ok)throw Error(data.message||data.error||"操作が拒否されました");
  return data;
}
const printAdvanced=(id,value)=>{
  $(id).textContent=typeof value==="string"?value:JSON.stringify(value,null,2);
};
async function refreshAdvanced(){
  try{
    const response=await fetch("/api/advanced/status",{cache:"no-store"});
    if(!response.ok)throw Error("接続状態を取得できません");
    const info=await response.json();
    const names=["openai","gemini","claude"];
    const list=names.map(name=>
      name.toUpperCase()+": "+(info.providers?.[name]?"設定あり":"未接続"));
    $("advanced-provider-status").textContent=
      "外部AI "+list.join(" / ")+
      " · 最終判断にはローカルOllamaモデルが必要です。接続状態は推論成功を意味しません。";
  }catch(e){$("advanced-provider-status").textContent=e.message;}
}
$("try-consensus").addEventListener("click",async()=>{
  if(!$("external-consent").checked){
    return printAdvanced("consensus-result",
      "外部への質問送信に許可が必要です。");
  }
  const question=$("consensus-question").value.trim();
  printAdvanced("consensus-result","本物の3つのAIを独立して照会しています…");
  try{
    const result=await advancedRequest("consult",{
      allowExternalCalls:true,question
    });
    printAdvanced("consensus-result",result);
  }catch(e){printAdvanced("consensus-result","実行拒否: "+e.message);}
});
$("try-pouc").addEventListener("click",async()=>{
  printAdvanced("pouc-result","有用な計算と受領検証を実行中…");
  try{
    const result=await advancedRequest("pouc",{
      baseline:$("mine-before").value,candidate:$("mine-after").value
    });
    printAdvanced("pouc-result",{
      proofHash:result.proof.proofDigest,
      beforeCompiles:result.proof.baseline.compiles,
      afterCompiles:result.proof.candidate.compiles,
      compileImproved:result.proof.compileImproved,
      independentlyReverified:result.contribution.verified.verified,
      totalLocalContributions:result.credits.contributions,
      sourceExecuted:false,
      behavioralRepairVerified:false,
      rewards:"NONE (PoUC local receipt only)"
    });
  }catch(e){printAdvanced("pouc-result","検証失敗: "+e.message);}
});
$("try-auto-repair").addEventListener("click",async()=>{
  printAdvanced("repair-result","隔離した一時領域で故障と自動復旧を検証中…");
  try{
    const result=await advancedRequest("repair");
    printAdvanced("repair-result",result.proof);
  }catch(e){printAdvanced("repair-result","復旧未成立: "+e.message);}
});
refreshAdvanced();


/** Candidate mutation discovery runs only for a pure, bounded function grammar.
 * The development vectors select the patch. Holdout never guides search. */
$("try-unknown-repair").addEventListener("click",async()=>{
  const output=$("unknown-repair-result");
  output.textContent="失敗テストから修正候補を探索しています…";
  try {
    const developmentTests=JSON.parse($("unknown-dev-tests").value);
    const holdoutTests=JSON.parse($("unknown-holdout-tests").value);
    const reply=await advancedRequest("discover-repair",{
      source:$("unknown-code").value,
      developmentTests,holdoutTests
    });
    const result=reply.result;
    if(result.status==="behavioral_patch_verified") {
      output.textContent=[
        "修正候補: supplied tests に対して検証成功",
        "変更: "+result.mutation.from+" → "+result.mutation.to,
        "探索した候補数: "+result.candidatesTried,
        "開発用テスト: "+result.developmentPassed+"件合格",
        "別の確認テスト: "+result.holdoutPassed+" / "+result.holdoutTotal+"件合格",
        "読み戻し検証: "+result.diskReadbackVerified,
        "変更前 SHA-256: "+result.beforeSha256,
        "変更後 SHA-256: "+result.afterSha256,
        "提案されたソース（本体未変更）:\n"+result.candidateSource,
        "本番への自動適用: なし"
      ].join("\n");
    } else {
      output.textContent="修復成功とは判定できません: "+result.status+
        (result.reason?" / "+result.reason:"")+
        "\n元のソースは変更していません。";
    }
  }catch(error){
    output.textContent="入力・修復処理が拒否されました: "+error.message+
      "\n対応対象は純粋な短いJavaScript関数1個です。";
  }
});


// This is the genuine optional BAKU coding-model path, not the earlier
// arithmetic mutation engine or copy-backup restoration fixture.
async function updateAgentHealth() {
  try {
    const res=await fetch("/api/agent/status",{cache:"no-store"});
    if(!res.ok)throw Error("agent status request failed");
    const x=await res.json();
    $("agent-health").textContent=
      "LOCAL OLLAMA: "+(x.configured.ollama?"モデル名あり":"モデル名なし")+
      " / OPENAI API: "+(x.configured.openai?"認証設定あり":"認証設定なし")+
      " / CLAUDE CLI: アカウントのログイン確認が必要"+
      " / 設定の有無は実際のモデル応答の成功保証ではありません。";
  }catch(e){$("agent-health").textContent="接続状態不明: "+e.message;}
}
$("try-agentic-repair").addEventListener("click",async()=>{
  const button=$("try-agentic-repair");
  button.disabled=true;
  const display=$("agentic-repair-result");
  display.textContent="認証されたモデルに実ソースと失敗テストを送り、隔離環境で修復を検証しています…";
  try{
    const response=await fetch("/api/agent/run",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
      body:JSON.stringify({
        provider:$("agent-model").value,
        goal:$("agent-goal").value,
        resumeRunId:$("agent-resume-id").value.trim()||null,
        allowExternalCalls:$("agent-cloud-consent").checked
      })
    });
    const payload=await response.json();
    if(!response.ok)throw Error(payload.message||payload.error||"AI repair request blocked");
    if(payload.runId && payload.status!=="verified_candidate" &&
       payload.status!=="holdout_rejected")
      $("agent-resume-id").value=payload.runId;
    const results=[
      "実行状態: "+payload.status,
      "実行ID: "+(payload.runId??"なし"),
      "モデル出所: "+(payload.modelProvenance??"未認証"),
      "実行回数: "+(payload.attempts?.length||0),
      "本番ソース変更: "+(payload.productionChanged===true?"YES":"NO"),
      "説明: "+(payload.reason??"モデル修正候補の実テスト結果を下記に表示")
    ];
    for(const item of payload.attempts||[]){
      results.push("候補 "+item.attempt+": "+item.diagnosis);
      results.push("公開テスト: "+(item.publicPassed?"PASS":"FAIL"));
      results.push("確認テスト: "+(
        item.holdoutPassed===undefined?"未実施":item.holdoutPassed?"PASS":"FAIL"
      ));
      results.push("実際のテスト出力(抜粋): "+item.publicEvidence);
    }
    if(payload.status==="verified_candidate")
      results.push("独立した確認テストを通過しました。ただし実プロジェクトへの適用はされていません。");
    if(payload.status==="blocked")
      results.push("モデルが実行できないため、修復完了とは扱いません。");
    display.textContent=results.join("\n\n");
  }catch(err){display.textContent="モデルによる実修復は成立していません: "+err.message;}
  finally{button.disabled=false;}
});
updateAgentHealth();
