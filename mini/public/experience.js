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
  syncWorkControls();
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
    if(action==="review")await refreshWorkState({announce:false});
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
    syncWorkControls();
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
      " / これらは実際のモデル応答の成功保証ではありません。";
  }catch(e){$("agent-health").textContent="接続状態不明: "+e.message;}
}
// A saved village work is the context for BAKU. Reads never start a model.
const workStageLabels={
  ready:"実行前",running:"実行中",blocked:"実行できず・未完了",
  interrupted:"中断・明示再開待ち",unresolved:"未解決・次の候補待ち",
  candidate_verified:"候補の確認テストに合格",candidate_rejected:"確認テストで候補を拒否",
  not_reproduced:"不具合を再現できず",readback_failed:"読み戻し確認に失敗",
  attempt_budget_exhausted:"候補4回の上限に到達"
};
const workNextLabels={
  select_ai_and_run:"AIを選び、次の候補1回を実行",
  select_ai_and_explicitly_resume:"AIを選び、保存した仕事を明示的に再開",
  verify_saved_candidate:"保存した候補の確認検査を再開（AIの新規呼び出しなし）",
  inspect_candidate_and_prepare_share:"結果を確認し、共有候補を編集",
  inspect_rejected_candidate:"拒否された候補と確認テストを調査",
  investigate_reproducer:"再現条件を調査",
  inspect_readback_failure:"読み戻し失敗の証拠を調査",
  review_attempt_budget:"候補の上限と履歴を確認"
};
const terminalWorkStages=new Set([
  "candidate_verified","candidate_rejected","not_reproduced",
  "readback_failed","attempt_budget_exhausted"
]);
let villageWorkState={villageId:"village-1",sources:[],knowledge:[],works:[],work:null};
let workLoading=false,workMutating=false,workLoadVersion=0,workRefreshPending=false;
let workKnowledgeInputs=[],sharingDirty=false,sharingWorkId=null;
const workNotice=(message,failed=false)=>{
  $("work-notice").textContent=message;
  $("work-notice").classList.toggle("error",failed);
};
const workAttemptCount=work=>Array.isArray(work?.attempts)?work.attempts.length:
  Number(work?.attemptsCount)||0;
const canVerifySavedCandidate=work=>work?.verificationPending===true&&
  work.stage!=="running"&&(!terminalWorkStages.has(work.stage)||work.stage==="attempt_budget_exhausted");
const cannotRunWork=work=>!work||work.stage==="running"||
  (terminalWorkStages.has(work.stage)&&!canVerifySavedCandidate(work))||
  (workAttemptCount(work)>=4&&!canVerifySavedCandidate(work));
const selectedWorkMatches=work=>work?.villageId===$("work-village").value&&
  work.id===$("work-saved").value;
const canPrepareWorkShare=work=>work?.stage==="candidate_verified"&&
  work.result?.status==="verified_candidate";
function syncWorkControls(){
  const work=villageWorkState.work;
  const locked=busy||workLoading||workMutating;
  for(const id of ["work-village","work-saved","refresh-work"])
    $(id).disabled=locked;
  $("work-source").disabled=locked||Boolean(work);
  $("agent-goal").disabled=locked||Boolean(work);
  for(const input of workKnowledgeInputs)input.disabled=locked||Boolean(work);
  const goal=$("agent-goal").value.trim();
  $("create-work").disabled=locked||Boolean(work)||!$("work-source").value||
    !goal||goal.length>500;
  $("agent-model").disabled=locked||!work;
  $("agent-cloud-consent").disabled=locked||!work||canVerifySavedCandidate(work);
  $("try-agentic-repair").disabled=locked||cannotRunWork(work)||!selectedWorkMatches(work);
  const shareReady=canPrepareWorkShare(work)&&selectedWorkMatches(work);
  $("work-share-body").disabled=locked||!shareReady;
  const shareBody=$("work-share-body").value.trim();
  $("save-work-share").disabled=locked||!shareReady||!shareBody||shareBody.length>320;
}
function renderWorkSource(){
  const source=villageWorkState.sources.find(x=>x.id===$("work-source").value);
  $("work-source-preview").textContent=source?
    "受信本文ID: "+source.id+"\nSHA-256: "+source.bodySha256+"\n\n"+source.body:
    villageWorkState.sources.length?"受信本文を選択してください。":
      "この村には選択できるGateway受信本文がありません。本文を配送してから保存状態を読み直してください。";
}
function renderSavedWork(){
  const work=villageWorkState.work;
  $("work-create-fields").hidden=Boolean(work);
  $("work-selected").hidden=!work;
  $("work-history-section").hidden=!work;
  $("work-share-section").hidden=!work;
  $("agent-resume-id").value=work?.runId||"";
  if(!work){
    $("work-readback").textContent="";
    $("agentic-repair-result").textContent="仕事を保存するか、保存済みの仕事を選択してください。";
    $("work-history").textContent="";
    $("work-share-body").value="";
    sharingWorkId=null;sharingDirty=false;
    syncWorkControls();return;
  }
  const source=work.sourceMessage||{};
  const knowledge=(work.knowledge||[]).map(x=>
    x.id+" / "+(x.sourceVillage||"この村")+"\n"+x.text).join("\n\n");
  $("work-readback").textContent=[
    "仕事ID: "+work.id+" / 保存先: "+work.villageId,
    "保存状態: "+(workStageLabels[work.stage]||work.stage),
    "次の操作: "+(workNextLabels[work.nextAction]||work.nextAction||"保存結果を確認"),
    "候補回数: "+workAttemptCount(work)+" / 4",
    "保存した目的:\n"+work.goal,
    "元のGateway本文ID: "+source.id+"\nSHA-256: "+source.bodySha256+"\n"+source.body,
    "作成時に固定保存した採用済み知識:\n"+(knowledge||"選択なし")
  ].join("\n\n");
  $("try-agentic-repair").textContent=canVerifySavedCandidate(work)?
    "保存した候補の確認検査を再開":["blocked","interrupted","unresolved"].includes(work.stage)?
    "保存した仕事を再開（次の候補1回）":"保存した仕事の次の候補1回を実行";
  if(canVerifySavedCandidate(work))$("agent-cloud-consent").checked=false;
  $("agentic-repair-result").textContent=work.result?
    "保存した実行結果（本体への自動適用は行いません）\n\n"+JSON.stringify(work.result,null,2):
    canVerifySavedCandidate(work)?"保存した候補の確認検査が未完了です。AIを呼び出さず、この候補の確認検査だけを明示的に再開できます。":
      "この仕事の実行結果はまだありません。AIを選んで明示的に実行してください。";
  $("work-history").textContent=JSON.stringify({
    attempts:work.attempts||[],executions:work.executions||[],
    invocationHistory:work.invocationHistory||[]
  },null,2);
  const candidate=work.sharingCandidate;
  if(sharingWorkId!==work.id||!sharingDirty)
    $("work-share-body").value=candidate?.body||"";
  sharingWorkId=work.id;
  $("work-share-status").textContent=canPrepareWorkShare(work)?
    "手元の共有候補です。人による内容確認が必要です。編集後は保存してください。":
    "確認テストに合格した候補が得られると、結果を元に共有候補を確認・編集できます。";
  $("work-share-evidence").textContent=candidate?JSON.stringify({
    status:candidate.status,workId:candidate.workId,runId:candidate.runId,
    evidence:candidate.evidence,rumor:candidate.rumor
  },null,2):"共有候補はまだありません。";
  syncWorkControls();
}
function renderWorkState(info,work){
  const sameVillage=info.villageId===villageWorkState.villageId;
  const sourceId=sameVillage?$("work-source").value:"";
  const selectedKnowledge=new Set(sameVillage?
    workKnowledgeInputs.filter(x=>x.checked).map(x=>x.value):[]);
  villageWorkState={...info,sources:info.sources||[],knowledge:info.knowledge||[],works:info.works||[],work};
  const saved=$("work-saved");
  saved.replaceChildren(el("option","","新しい仕事を作る"));
  saved.children[0].value="";
  const summaries=villageWorkState.works.slice();
  if(work&&!summaries.some(x=>x.id===work.id))summaries.unshift(work);
  for(const item of summaries){
    const option=el("option","",item.goal+" · "+(workStageLabels[item.stage]||item.stage));
    option.value=item.id;saved.append(option);
  }
  saved.value=work?.id||"";
  const sources=$("work-source");
  sources.replaceChildren(el("option","","受信本文を選択してください"));
  sources.children[0].value="";
  for(const source of villageWorkState.sources){
    const option=el("option","",source.id+" · "+String(source.body).replace(/\s+/g," ").slice(0,64));
    option.value=source.id;sources.append(option);
  }
  sources.value=villageWorkState.sources.some(x=>x.id===sourceId)?sourceId:"";
  const knowledge=$("work-knowledge");knowledge.replaceChildren();workKnowledgeInputs=[];
  for(const item of villageWorkState.knowledge){
    const row=el("label","work-knowledge-option");
    const input=document.createElement("input");
    input.type="checkbox";input.value=item.id;input.checked=selectedKnowledge.has(item.id);
    row.append(input,el("span","",item.text+"\n"+item.id+" / "+(item.sourceVillage||"この村")));
    knowledge.append(row);workKnowledgeInputs.push(input);
  }
  if(!workKnowledgeInputs.length)
    knowledge.append(el("p","hint","この村に採用済み知識はありません。知識を選ばずに仕事を作ることもできます。"));
  renderWorkSource();renderSavedWork();
}
async function refreshWorkState({workId=$("work-saved").value,preferLatest=false,announce=true}={}){
  if(workMutating){workRefreshPending=true;return;}
  const version=++workLoadVersion;
  const villageId=$("work-village").value;
  workLoading=true;syncWorkControls();
  if(announce)workNotice("保存した本文・知識・仕事を読み込んでいます…");
  try{
    const query=new URLSearchParams({villageId});
    if(workId)query.set("workId",workId);
    const response=await fetch("/api/work/state?"+query,{cache:"no-store"});
    const info=await response.json();
    if(!response.ok)throw Error(info.message||info.error||"仕事の読み込みに失敗しました");
    if(version!==workLoadVersion)return;
    if(info.villageId!==villageId)throw Error("保存先の村が一致しません");
    const work=preferLatest?info.work:workId?info.work:null;
    if(work&&work.villageId!==villageId)throw Error("仕事の保存先が一致しません");
    renderWorkState(info,work);
    if(announce)workNotice("保存状態を読み込みました。AIは実行していません。");
  }catch(error){
    if(version===workLoadVersion){
      $("work-saved").value=villageWorkState.work?.id||"";
      workNotice("保存状態を読み込めません: "+error.message,true);
    }
  }finally{
    if(version===workLoadVersion){workLoading=false;syncWorkControls();}
  }
}
function acceptSavedWork(work){
  if(!work||work.villageId!==$("work-village").value)
    throw Error("保存された仕事の村が一致しません");
  const works=villageWorkState.works.filter(x=>x.id!==work.id);
  works.unshift(work);
  renderWorkState({...villageWorkState,works},work);
}
function ensureSelectedWork(work){
  if(selectedWorkMatches(work))return true;
  const villageId=$("work-village").value;
  const workId=work?.villageId===villageId?$("work-saved").value:"";
  sharingDirty=false;$("agent-cloud-consent").checked=false;
  renderWorkState({villageId,sources:[],knowledge:[],works:[]},null);
  refreshWorkState({workId,preferLatest:!workId,announce:false});
  workNotice("村・仕事の選択と表示が一致しないため実行しません。保存状態を読み直します。表示された選択を確認してから操作してください。",true);
  return false;
}
function finishWorkMutation(){
  workMutating=false;syncWorkControls();
  if(workRefreshPending){
    workRefreshPending=false;refreshWorkState({announce:false});
  }
}
async function saveWorkAction(action,payload){
  if(busy||workLoading||workMutating)return;
  workMutating=true;++workLoadVersion;syncWorkControls();
  workNotice(action==="create"?"仕事の内容を保存しています…":"共有候補を手元に保存しています…");
  try{
    const response=await fetch("/api/work/action",{
      method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
      body:JSON.stringify({action,...payload})
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.message||result.error||"仕事を保存できませんでした");
    sharingDirty=false;acceptSavedWork(result.work);
    workNotice(action==="create"?"仕事を保存しました。AIの実行は次の明示操作です。":
      "人の確認が必要な共有候補を手元に保存しました。公開・受信・採用は行っていません。");
  }catch(error){workNotice(error.message,true);}
  finally{finishWorkMutation();}
}
$("work-village").addEventListener("change",()=>{
  if(workLoading||workMutating||busy)return;
  sharingDirty=false;$("agent-cloud-consent").checked=false;
  $("agent-goal").value="";
  renderWorkState({villageId:$("work-village").value,sources:[],knowledge:[],works:[]},null);
  refreshWorkState({preferLatest:true});
});
$("work-saved").addEventListener("change",()=>{
  if(workLoading||workMutating||busy)return;
  sharingDirty=false;$("agent-cloud-consent").checked=false;
  if(!$("work-saved").value){renderWorkState(villageWorkState,null);return;}
  refreshWorkState();
});
$("refresh-work").addEventListener("click",()=>{
  if(!workMutating&&!busy)refreshWorkState();
});
$("work-source").addEventListener("change",()=>{renderWorkSource();syncWorkControls();});
$("agent-goal").addEventListener("input",syncWorkControls);
$("work-share-body").addEventListener("input",()=>{sharingDirty=true;syncWorkControls();});
$("create-work").addEventListener("click",()=>{
  const goal=$("agent-goal").value.trim(),sourceMessageId=$("work-source").value;
  if(!sourceMessageId||!goal||goal.length>500)
    return workNotice("元の受信本文と500文字以内の目的を指定してください。",true);
  const knowledgeIds=workKnowledgeInputs.filter(x=>x.checked).map(x=>x.value);
  if(knowledgeIds.length>5)
    return workNotice("この仕事へ取り込む採用済み知識は5件まで選択してください。",true);
  saveWorkAction("create",{villageId:$("work-village").value,goal,sourceMessageId,knowledgeIds});
});
$("save-work-share").addEventListener("click",()=>{
  const work=villageWorkState.work,body=$("work-share-body").value.trim();
  if(busy||workLoading||workMutating)return;
  if(!ensureSelectedWork(work))return;
  if(!canPrepareWorkShare(work)||!body||body.length>320)
    return workNotice("確認テスト合格後、320文字以内の共有候補を入力してください。",true);
  saveWorkAction("prepare-share",{villageId:work.villageId,workId:work.id,body});
});
$("try-agentic-repair").addEventListener("click",async()=>{
  const work=villageWorkState.work;
  if(busy||workLoading||workMutating||cannotRunWork(work))return;
  if(!ensureSelectedWork(work))return;
  const verificationOnly=canVerifySavedCandidate(work);
  const provider=$("agent-model").value;
  const allowExternalCalls=verificationOnly?false:$("agent-cloud-consent").checked;
  if(!verificationOnly&&provider==="openai"&&!allowExternalCalls)
    return workNotice("この1回のOpenAI外部送信と課金可能性への許可が必要です。",true);
  $("agent-cloud-consent").checked=false;
  workMutating=true;++workLoadVersion;syncWorkControls();
  workNotice(verificationOnly?
    "保存した候補の確認検査だけを再開しています。AIへの新規送信・呼び出しは行いません…":
    "保存した仕事から、修正候補を1回だけ実行しています…");
  try{
    const response=await fetch("/api/agent/run",{
      method:"POST",headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
      body:JSON.stringify({villageId:work.villageId,workId:work.id,provider,allowExternalCalls})
    });
    const payload=await response.json();
    if(payload.work){sharingDirty=false;acceptSavedWork(payload.work);}
    if(!response.ok)throw Error(payload.message||payload.error||"AI修復の実行が拒否されました");
    if(!payload.work)throw Error("保存した仕事の実行結果が返りませんでした。状態を読み直してください。");
    workNotice(verificationOnly?
      "保存した候補の確認結果を保存しました。AIの新規呼び出しは行っていません。結果と証拠を確認してください。":
      "1回の実行結果を保存しました。次の操作と証拠を確認してください。自動再試行はしません。");
  }catch(error){
    workNotice("修復完了とは扱えません: "+error.message+" 保存状態を読み直して確認してください。",true);
  }finally{finishWorkMutation();}
});
refreshWorkState({preferLatest:true});
updateAgentHealth();
