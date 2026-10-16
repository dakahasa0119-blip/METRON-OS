/** Thin owner UI over the existing project/work controllers. No model or
 * mutation is started by construction, state reads, selection or restart. */
(()=>{
  function takeOperatorFragment(){
    try{
      const params=new URLSearchParams((globalThis.location?.hash||"").slice(1));
      if(!params.has("project-operator"))return {present:false};
      // Strip before validation, requests or waiting. Ordinary panel anchors
      // remain untouched, and replaceState does not trigger hashchange again.
      globalThis.history.replaceState(null,"",globalThis.location.pathname+globalThis.location.search);
      const values=params.getAll("project-operator");
      return {present:true,value:values.length===1&&/^[a-f0-9]{64}$/.test(values[0])?values[0]:null};
    }catch{return {present:true,value:null};}
  }
  let bootstrap=takeOperatorFragment();
  let receiveOwnerFragment=null;
  // The classic script can finish before experience.js builds the controller.
  // Strip every owner link during that window; only the latest owner value
  // survives. Ordinary anchors neither replace nor consume that pending value.
  globalThis.addEventListener?.("hashchange",()=>{
    const fragment=takeOperatorFragment();if(!fragment.present)return;
    if(receiveOwnerFragment)return receiveOwnerFragment(fragment);
    bootstrap=fragment;
  });
  globalThis.createMetronProjectUi=({getWork,onWork,onControls,legacyBusy,notice,onOwnerChange=()=>{},canMutateWork=()=>true})=>{
    const $=id=>document.getElementById(id),text=(id,value)=>{$(id).textContent=String(value??"");};
    const checkIds=["project-scope-reviewed","project-codex-consent","project-diff-reviewed","project-apply-reviewed",
      "project-rollback-reviewed","project-resume-reviewed","project-revision-reviewed","project-pouc-reviewed"];
    let key="",authorized=false,catalogLoaded=false,availability=null,projects=[],worker={available:false},session=null,jobs=[],review=null;
    let busy=false,reading=false,needsRead=false,signature="",lastIdentity=null,generation=0,selectionVersion=0,timer=null,pendingDispatch=null;
    let activeMutation=null,cancelPending=false,dispatchBlocked=false;
    const identity=w=>w?w.villageId+":"+w.id:null;
    const context=()=>[identity(getWork()),getWork()?.projectRepair?.sessionId,key,generation].join("|");
    const selected=()=>projects.find(p=>p.id===$("project-plan").value);
    const pwork=()=>getWork()?.projectRepair;
    const last=()=>session?.attempts?.at(-1);
    const reviewer=()=>$("project-reviewer").value.trim();
    const readyStatuses=new Set(["ready_worker","revision_ready"]);
    const activeStatuses=new Set(["worker_active","baseline_running","validating","preparing_workspace","pouc_running"]);
    const activeJob=()=>jobs.some(j=>["queued","running"].includes(j.status));
    const localOperation=()=>busy&&["start","validate","pouc"].includes(activeMutation?.action)&&
      activeMutation.identity===identity(getWork());
    const clearChecks=()=>{for(const id of checkIds)$(id).checked=false;};
    const clearActionChecks=()=>{for(const id of checkIds)if(id!=="project-scope-reviewed")$(id).checked=false;};
    const resetProof=()=>{clearChecks();review=null;text("project-diff","差分はまだ取得していません。");};
    const stopPoll=()=>{if(timer)clearTimeout(timer);timer=null;};
    function headers(){
      if(!authorized||!key)throw Error("この起動の所有者キーを確認してください。");
      return {"Content-Type":"application/json","X-Metron-Mini":"1","X-Metron-Project-Operator":key};
    }
    async function request(path,body){
      const response=await fetch(path,{method:body?"POST":"GET",headers:headers(),cache:"no-store",
        ...(body?{body:JSON.stringify(body)}:{})});
      const result=await response.json();
      if(!response.ok){const error=Error(result.error||"プロジェクト操作を確認できませんでした");error.known=true;throw error;}
      return result;
    }
    const checkSummary=result=>result?{passed:result.passed,terminationUnconfirmed:result.terminationUnconfirmed===true,
      checks:(result.checks||[]).map(c=>({id:c.id,exitCode:c.exitCode,timedOut:c.timedOut,
        terminationConfirmed:c.terminationConfirmed,outputSha256:c.outputSha256,testSummary:c.testSummary}))}:null;
    const labels={ready_worker:"公開失敗を再現済み・候補作成待ち",revision_ready:"公開テストが失敗・次の候補を明示実行できます",
      awaiting_review:"候補を保存済み・差分確認待ち",candidate_verified:"候補の独立検証に成功・適用は別操作",
      applied_verified:"登録された隔離適用先で適用後検証に成功",pouc_running:"固定検査の有用な計算を再確認中",candidate_rejected:"非公開受入検証で拒否・自動再試行なし",
      attempt_budget_exhausted:"系列全体の候補3回を使い切りました",worker_active:"workerが作業中",
      not_reproduced:"公開失敗を再現できませんでした",baseline_unconfirmed:"公開失敗の再現が未確認",
      cancelled:"停止済み・再開には結果の確認が必要",worker_outcome_unknown:"前回workerの結果が未確認",
      validation_interrupted:"検証の終了が未確認・隔離状態",applied_unverified:"適用先のHEADを確認・適用後検証は未確認",
      application_unresolved:"適用結果が未確認",rolled_back:"登録された隔離適用先を基点へ戻しました"};
    const node=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=String(value??"");if(cls)n.className=cls;return n;};
    const list=(id,items)=>$(id).replaceChildren(...items.map(value=>node("li",value)));
    function renderFriendly(w,p,plan,a,status,failedJob){
      const configured=authorized&&catalogLoaded?projects.length>0:availability?.registeredProjectsConfigured,
        named=authorized&&catalogLoaded&&plan;
      text("project-setup-state",configured===false?"この起動には修復対象がありません。所有者側の準備が必要です。":
        !authorized?"登録済みの対象を見るには、所有者の起動リンクからこの画面を開いてください。":
        !catalogLoaded?"所有者キーで登録対象を確認しています。":
        projects.length?"対象は名前から選べます。この画面でパス・内部ID・JSONを入力する必要はありません。":"この起動で選べる修復対象がありません。");
      text("project-setup-next",configured===false||catalogLoaded&&!projects.length?
        "次の手順：起動した人に、対象の登録と隔離用コピーの準備を依頼してください。初回の登録ファイル作成は所有者の手作業です。下の操作手順で必要な準備を確認できます。":
        !authorized?"次の手順：所有者の起動リンクを開くか、必要な場合だけ手動キー欄を使います。その後、対象の名前を選んで範囲を確認してください。":
        "次の手順：対象名と編集範囲を確認し、症状と公開してよい再現情報を記入します。確認チェックだけでは検査やAIを開始しません。");
      text("project-target-name",named?plan.label:"対象を名前から選んでください");
      text("project-target-description",named?"このPCの所有者が起動時に用意した対象です。以下の範囲だけを修復候補に含められます。":
        "一覧の選択後に、編集できるファイル・検査の境界・隔離適用先をここで確認できます。");
      const operationLabels={edit:"変更",add:"追加",delete:"削除"};
      list("project-edit-files",named?(plan.allowedEdits||[]).map(e=>e.path+" — "+e.operations.map(op=>operationLabels[op]||"登録された操作").join("・")):
        ["対象を選ぶと、編集が許可されたファイルと操作を表示します。自分でパスを入力する必要はありません。"]);
      for(const [id,value] of [["project-public-count",plan?.publicTests?.length],["project-acceptance-count",plan?.acceptanceTestCount],["project-smoke-count",plan?.postApplyTests?.length]])
        text(id,named&&Number.isInteger(value)?value+"件":"未選択");
      const mode=catalogLoaded?worker.mode:availability?.mode,workerConfigured=catalogLoaded?worker.available:availability?.workerConfigured;
      text("project-worker-status",mode==="injected_worker_test"?"模擬worker（本物AIではない）：画面と制御の試験用です。":
        workerConfigured?"公式Codex CLIを使う設定があります。実行時に起動と利用可能性を確認します。設定だけで修復の成功を意味しません。":
        workerConfigured===false?"AIの実行役は未設定です。対象や範囲の確認と公開失敗の再現はできます。修復候補を作るには、所有者側で実行役の準備が必要です。":
        "AIの実行設定はまだ確認していません。設定があっても、この画面を開くだけではAIに送信しません。");
      const next={ready_worker:"今回の送信範囲を確認し、送信許可を入れてから候補を1回作成できます。",
        revision_ready:"直前の公開失敗を次の候補へ引き継ぎます。もう一度、今回の送信を許可して明示実行してください。",
        worker_active:"作業結果を待っています。必要なら、この仕事の停止ボタンを使ってください。",
        baseline_running:"登録済みの公開検査で、想定した失敗を確認しています。AIはまだ起動していません。",
        validating:"候補を別コピーの固定検査で確認しています。公開検査と独立した受入検査を区別して記録します。",
        awaiting_review:"保存した候補のファイル差分を読み、確認チェックを入れてから独立検証してください。",
        candidate_verified:"独立検証に合格しました。隔離コピーへの適用と、要約の公開はそれぞれ別の明示操作です。",
        applied_verified:"隔離コピーで適用後検証に合格しました。結果から共有要約を作れます。公開mainや本番への反映はしていません。",
        candidate_rejected:"独立した受入検査で候補を採用できませんでした。非公開の検査内容・出力をAIへ渡して再試行することはありません。",
        not_reproduced:"想定した失敗を再現できませんでした。登録された検査と症状を所有者と確認してください。",
        baseline_unconfirmed:"検査の完了を確認できません。起動失敗や時間切れを、故障の再現成功として扱いません。",
        attempt_budget_exhausted:"この仕事の系列では候補を3回作成しました。記録を確認し、これ以上自動で試行しません。",
        cancelled:"停止結果を確認してください。前回の終了が確認できた場合だけ、確認チェックから明示的に再開できます。",
        worker_outcome_unknown:"前回作業の結果が未確認です。保存状態と停止結果を確認してから再開します。",
        rolled_back:"隔離コピーを基点へ戻しました。検証済み候補と過去の成功記録は残っています。"};
      let title=!w?"先に仕事を保存してください":!p?"対象と症状を確認して、失敗を再現します":labels[status]||"保存状態を確認してください",
        guidance=!w?"上の欄でGatewayに届いた本文と目的を選び、仕事を保存します。":!p?
          "対象と範囲を確認してから「失敗を再現」を押します。この操作でAIは起動しません。":next[status]||"保存状態を読み、記録された次の操作を確認してください。";
      if(w?.projectRegistrationRequired){title="以前の登録設定の復元が必要です";guidance="保存された結果は保持しています。元の所有者登録が戻るまで、新しい実行・適用・共有はできません。";}
      if(needsRead){title="通信結果を確認してください";guidance="自動で再送しません。「保存状態を読む」で結果を確認し、その後に必要な操作だけを明示的に行ってください。";}
      if(failedJob&&(dispatchBlocked||failedJob.terminationUnconfirmed)){
        title="前回の作業の確認が必要です";guidance=failedJob.terminationUnconfirmed?
          "実プロセスの終了が未確認です。所有者による記録とプロセスの確認が必要です。チェック欄では候補作成を再開できません。":
          "停止状態を確認し、終了確認済みなら作業を停止してから保存状態を読み、明示的に再開してください。勝手に次のAIを呼びません。";
      }
      if(localOperation())guidance="公開再現または独立検証を実行中です。保存状態を読みながら待ちます。セッション確定後は停止ボタンで中止できます。";
      if(busy&&activeMutation?.action==="apply")guidance="隔離適用と適用後検証を実行中です。この画面から途中停止はしません。結果不明の場合は再適用せず保存状態を確認します。";
      if(cancelPending){title="停止要求の応答を待っています";guidance="保存状態は読めます。村・仕事の切替と新しい変更操作は、停止結果を確認するまで保留します。";}
      text("project-state-title",title);text("project-next-step",guidance);
      text("project-state-goal",w?"この仕事の目的："+w.goal:"目的はまだ保存されていません。");
      text("project-state-attempts","候補作成 "+(p?.attemptCount||0)+" / 3回（要件改訂を含む）・以前の結果 "+(w?.projectHistory?.length||0)+"版を保持");
      const reproduction=session?.baseline,confirmedFailure=reproduction?.checks?.some(c=>c.exitCode===1&&c.testSummary?.fail>0)&&
        reproduction.checks.every(c=>!c.error&&!c.timedOut&&c.terminationConfirmed&&c.testSummary?.skipped===0&&c.testSummary?.cancelled===0);
      const baselineText=confirmedFailure?"公開検査で想定した失敗を確認":reproduction?.passed?"想定した失敗を確認できず":"未実行・結果未確認",
        publicText=a?.publicResult? a.publicResult.passed?"合格":"不合格・公開失敗を記録":"未実行・結果未確認",
        acceptanceText=a?.acceptanceResult?a.acceptanceResult.passed?"合格（内容と出力は非公開）":"不合格（内容と出力は非公開）":"未実行・結果未確認",
        applyText=p?.application?labels[p.application.status]||"適用結果を確認中":"まだ適用していません";
      list("project-check-results",["故障の再現："+baselineText,"候補の公開検査："+publicText,"独立した受入検査："+acceptanceText,"隔離コピーへの適用："+applyText]);
      const stage=!p?0:["baseline_running","baseline_unconfirmed","not_reproduced"].includes(status)?1:
        ["ready_worker","revision_ready","worker_active","preparing_workspace"].includes(status)?2:
        ["awaiting_review","validating","candidate_rejected"].includes(status)?3:status==="applied_verified"?5:
          p.verification?4:a?.report?3:a?2:1;
      const completed=[Boolean(p),Boolean(confirmedFailure||p?.verification),Boolean(a?.report||p?.verification),
        Boolean(p?.verification),p?.application?.status==="applied_verified",w?.publication?.status==="published"];
      $("project-progress").replaceChildren(...["対象と範囲を確認","公開失敗を再現","候補を1回作成","差分確認と独立検証","隔離コピーへ適用（別の明示操作）","確認した要約を共有（別の明示操作）"].map((label,index)=>
        node("li",label,completed[index]?"is-complete":index===stage?"is-current":"")));
      const previous=(w?.projectHistory||[]).map(e=>"以前の版 "+e.version+"："+
        (projects.find(project=>project.id===e.snapshot.projectRepair.projectId)?.label||"以前の登録対象")+
        " — 検証済みの成功を保持 / "+(e.snapshot.publication?.status==="published"?"確認した要約を公開済み":"公開なし"));
      list("project-history-list",previous.length?previous:["以前の版はまだありません。要件を追加しても、以前の成功結果と公開済みの要約は履歴に残します。"]);
      text("project-diff-view",review?.diff||"候補を保存した後に「差分を読む」を押すと、変更したコードをここに表示します。");
      list("project-diff-files",review?.changedPaths?.length?review.changedPaths:["差分はまだ取得していません。取得しただけでは検証を開始しません。"]);
    }
    function render(){
      const w=getWork(),p=w?.projectRepair,plan=selected(),a=last();
      text("project-owner-status",authorized&&catalogLoaded?"所有者キーを確認済み。このページのメモリーだけに保持しています。":authorized?
        "この起動の所有者キーを確認しています。":
        "所有者キーは未確認です。キーはブラウザーの保存領域へ記録しません。");
      text("project-plan-summary",plan?JSON.stringify({id:plan.id,label:plan.label,baseCommit:plan.baseCommit,
        allowedEdits:plan.allowedEdits,publicTests:plan.publicTests,postApplyTests:plan.postApplyTests,
        acceptanceTestCount:plan.acceptanceTestCount,planDigest:plan.planDigest,worker},null,2):
        "対象の準備、または所有者キーでの一覧確認が必要です。初回設定の詳細は操作手順を参照してください。");
      const status=session?.status||p?.status;
      const pouc=session?.pouc||p?.pouc;
      text("project-pouc-result",!pouc?"PoUCの再計算記録はまだありません。":
        pouc.status==="verified"?"固定公開・非公開検査の再計算が一致しました。記録識別: "+pouc.proofDigest+
          "。同じ計算の再加算はありません。共有に含める場合は、必要な識別情報を公開要約へ記入して確認してください。":
        pouc.status==="running"?"登録された固定検査をローカルで再計算しています。":
          "PoUCは成功として記録されていません（"+pouc.status+"）。保存状態と終了確認を読んでください。");
      text("project-status",!w?"先にGateway本文と目的を選び、既存の操作で仕事を保存してください。":!p?
        "仕事は保存済みです。登録対象と症状を選び、公開失敗を明示的に再現してください。":JSON.stringify({
          workId:w.id,runId:w.runId,sourceMessageId:w.sourceMessage?.id,sessionId:p.sessionId,projectId:p.projectId,
          status:labels[status]||status,nextAction:w.nextAction,attempts:p.attemptCount,maxAttempts:3,
          baseline:checkSummary(session?.baseline),publicResult:checkSummary(a?.publicResult),
          acceptance:a?.acceptanceResult?{passed:a.acceptanceResult.passed,disclosure:"非公開テストの内容・ログは表示しません"}:null,
          verification:session?.verification?{id:session.verification.id,candidateCommit:session.verification.candidateCommit,
            diffSha256:session.verification.diffSha256,evidenceDigest:session.verification.evidenceDigest}:p.verification,
          expectedApplyHead:session?.application?session.application.readback?.head:projects.find(x=>x.id===p.projectId)?.baseCommit,
          application:p.application,workerMode:worker.mode==="injected_worker_test"?"模擬worker（本物AIではない）":
            worker.available?"実行設定あり・起動時に確認（認証済み接続の保証ではありません）":"未設定",jobs:jobs.map(j=>({id:j.id,status:j.status,mode:j.mode,
            modelLaunchIntent:j.modelLaunchIntent,modelProcessStarted:j.modelProcessStarted,reason:j.reason,
            terminationUnconfirmed:j.terminationUnconfirmed,candidateCommit:j.candidateCommit})),
          warnings:w.runtimeWarnings,readStateBeforeRetry:needsRead},null,2));
      const output=(a?.publicResult?.passed===false?a.publicResult:session?.baseline?.passed===false?session.baseline:null);
      if(output)$("project-status").textContent+="\n\n"+(output===a?.publicResult?"候補で記録した公開失敗":"基点で記録した公開失敗")+"の出力（末尾のみ）:\n"+
        (output.checks||[]).map(c=>String(c.output||"").slice(-6000)).join("\n");
      const failedJob=jobs.filter(j=>["failed_requires_owner_reconciliation","requires_owner_reconciliation"].includes(j.status))
        .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];
      if(failedJob&&(dispatchBlocked||failedJob.terminationUnconfirmed))$("project-status").textContent+="\n\n"+
        (failedJob.terminationUnconfirmed?"workerの終了が未確認です。チェック欄では解除できません。管理者が実プロセスと非公開記録を確認するまで候補作成を停止します。":
          "前回workerの停止状態と結果を確認してください。終了確認済みなら「作業を停止」でleaseを取り消し、保存状態を読んでから「明示的に再開」を行います。勝手に次のAIを呼びません。");
      if(busy)$("project-status").textContent+="\n\n"+(localOperation()?
        "公開再現／独立検証を実行中です。保存状態を読みながら待ちます。セッション確定後は停止ボタンから明示的に中止できます。":
        activeMutation?.action==="apply"?"隔離適用と適用後検証の応答待ちです。この画面から途中停止はしません。結果不明なら保存状態を読み、再適用せず確認してください。":"明示操作の応答を待っています。");
      if(cancelPending)$("project-status").textContent+="\n\n停止要求の応答待ちです。保存状態は読めますが、村・仕事の切替と新しい変更操作は停止結果が確定するまで行いません。";
      text("project-history",JSON.stringify({workId:w?.id,runId:w?.runId,sourceMessageId:w?.sourceMessage?.id,
        attempts:(session?.attempts||[]).map(x=>({id:x.id,number:x.number,status:x.status,parentCommit:x.parentCommit,
          candidateCommit:x.report?.candidateCommit,diagnosis:x.report?.diagnosis,unresolved:x.report?.unresolved,
          publicResult:checkSummary(x.publicResult),acceptance:x.acceptanceResult?{passed:x.acceptanceResult.passed}:null})),
        previousVersions:(w?.projectHistory||[]).map(e=>({version:e.version,digest:e.digest,
          projectId:e.snapshot.projectRepair.projectId,sessionId:e.snapshot.projectRepair.sessionId,
          result:e.snapshot.result,publication:e.snapshot.publication?{status:e.snapshot.publication.status,
            rumorId:e.snapshot.publication.rumor.id,rumorSha256:e.snapshot.publication.rumorSha256}:null})),
        currentPublication:w?.publication?{status:w.publication.status,rumorId:w.publication.rumor.id}:null},null,2));
      renderFriendly(w,p,plan,a,status,failedJob);sync();
    }
    function sync(){
      const w=getWork(),p=w?.projectRepair,s=session?.status,locked=busy||cancelPending||legacyBusy(),owner=authorized&&!locked,
        usable=owner&&!needsRead&&!w?.projectRegistrationRequired&&canMutateWork(w),plan=selected(),currentSelected=plan?.id===p?.projectId,name=reviewer(),validName=Boolean(name)&&name.length<=120;
      if(!canMutateWork(w))clearChecks();
      $("project-operator-key").disabled=locked;$("project-load-catalog").disabled=locked;
      $("project-lock").disabled=locked;$("project-plan").disabled=!owner;
      $("project-scope-reviewed").disabled=!owner||!plan||needsRead;
      $("project-refresh").disabled=!authorized||legacyBusy()||reading||busy&&!localOperation();
      for(const id of ["project-symptom","project-evidence","project-requirements","project-reviewer","project-cancel-reason"])
        $(id).disabled=!owner;
      const symptom=$("project-symptom").value.trim(),evidence=$("project-evidence").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),
        validInput=symptom.length>0&&symptom.length<=2000&&evidence.length<=10&&evidence.every(x=>x.length<=1000);
      $("project-start").disabled=!usable||!w||Boolean(p)||w.externalRepair||w.stage!=="ready"||!plan||!validInput||!$("project-scope-reviewed").checked;
      $("project-codex-consent").disabled=!usable||!p||!currentSelected||!worker.available||!readyStatuses.has(s)||activeJob()||dispatchBlocked;
      $("project-dispatch").disabled=$("project-codex-consent").disabled||!$("project-codex-consent").checked;
      $("project-dispatch").textContent=worker.mode==="injected_worker_test"?
        "模擬workerで次の候補を1回作る（本物AIではない）":"Codexで次の候補を1回だけ作る";
      const cancelOwner=authorized&&!legacyBusy()&&!needsRead&&!w?.projectRegistrationRequired&&(owner||localOperation()),
        cancelStatus=s||p?.status;
      $("project-cancel").disabled=!cancelOwner||cancelPending||!p?.sessionId||!currentSelected||
        ![...activeStatuses,"ready_worker","revision_ready","awaiting_review","worker_outcome_unknown","workspace_setup_interrupted"].includes(cancelStatus)||!$("project-cancel-reason").value.trim();
      $("project-cancel-reason").disabled=!cancelOwner;
      $("project-resume-reviewed").disabled=!usable||!p||!currentSelected||!["worker_outcome_unknown","workspace_setup_interrupted","cancelled","preparing_workspace"].includes(s)||session?.terminationUnconfirmed;
      $("project-resume").disabled=$("project-resume-reviewed").disabled||!$("project-resume-reviewed").checked;
      $("project-review-diff").disabled=!usable||!currentSelected||s!=="awaiting_review";
      const exactReview=review&&review.sessionId===p?.sessionId&&review.attemptId===last()?.id&&
        review.candidateCommit===last()?.report?.candidateCommit;
      $("project-diff-reviewed").disabled=!usable||!currentSelected||!exactReview||s!=="awaiting_review";
      $("project-validate").disabled=$("project-diff-reviewed").disabled||!$("project-diff-reviewed").checked||!validName;
      $("project-apply-reviewed").disabled=!usable||!currentSelected||s!=="candidate_verified"||!session?.verification;
      $("project-apply").disabled=$("project-apply-reviewed").disabled||!$("project-apply-reviewed").checked||!validName;
      $("project-pouc-reviewed").disabled=!usable||!currentSelected||!validName||!session?.verification||
        !["candidate_verified","applied_verified","rolled_back"].includes(s)||session?.terminationUnconfirmed||
        session?.pouc?.status==="verified"||(session?.pouc?.attempts??0)>=3||w?.publication?.status==="intent";
      $("project-pouc").disabled=$("project-pouc-reviewed").disabled||!$("project-pouc-reviewed").checked;
      $("project-rollback-reviewed").disabled=!usable||!currentSelected||!["applied_verified","application_unresolved"].includes(s)||!session?.application;
      $("project-rollback").disabled=$("project-rollback-reviewed").disabled||!$("project-rollback-reviewed").checked||!validName;
      const requirements=$("project-requirements").value.trim(),canRevise=usable&&p?.verification&&
        ["candidate_verified","applied_verified","rolled_back"].includes(s)&&!session?.terminationUnconfirmed&&
        w.publication?.status!=="intent"&&(w.projectHistory||[]).length<2&&p.attemptCount<3&&plan&&plan.id!==p.projectId&&validInput&&requirements.length>0&&requirements.length<=2000&&$("project-scope-reviewed").checked;
      $("project-revision-reviewed").disabled=!canRevise;$("project-revise").disabled=!canRevise||!$("project-revision-reviewed").checked;
    }
    function update(work){
      if(identity(work)!==lastIdentity){
        lastIdentity=identity(work);selectionVersion++;
        for(const id of ["project-symptom","project-evidence","project-requirements"])$(id).value="";
        if(projects.some(p=>p.id===work?.projectRepair?.projectId))$("project-plan").value=work.projectRepair.projectId;
      }
      const next=JSON.stringify([identity(work),work?.projectRepair?.sessionId,work?.projectRepair?.planDigest,
        work?.projectRepair?.verification?.id,work?.projectRepair?.verification?.diffSha256]);
      if(next!==signature){
        signature=next;generation++;resetProof();pendingDispatch=null;needsRead=false;stopPoll();
        if(session?.id!==work?.projectRepair?.sessionId){session=null;jobs=[];}
        if(authorized&&work?.projectRepair?.sessionId)Promise.resolve().then(refresh);
      }
      render();
    }
    function schedule(){
      stopPoll();if(authorized&&(localOperation()||pwork()?.sessionId&&(activeJob()||activeStatuses.has(session?.status))))
        timer=setTimeout(()=>refresh().catch(()=>{}),1800);
    }
    async function refresh(){
      if(reading||busy&&!localOperation()||!authorized)return;
      reading=true;clearChecks();sync();let stamp=context(),p=pwork();
      try{
        if(!p?.sessionId&&localOperation()){
          const w=getWork(),info=await request("/api/work/state?"+new URLSearchParams({villageId:w.villageId,workId:w.id}));
          if(stamp!==context())return;
          if(info.work?.id!==w.id||info.work?.villageId!==w.villageId)throw Error("開始中の仕事の保存先が一致しません");
          onWork(info.work);p=pwork();stamp=context();
        }
        if(p?.sessionId){
          const query="?sessionId="+encodeURIComponent(p.sessionId),[state,jobState]=await Promise.all([
            request("/api/project/state"+query),request("/api/project/jobs"+query)]);
          if(stamp!==context())return;
          if(state.work?.id!==getWork()?.id||state.work?.villageId!==getWork()?.villageId||state.id!==p.sessionId)
            throw Error("仕事とセッションの保存先が一致しません");
          const oldAttempt=last()?.id,oldCommit=last()?.report?.candidateCommit;
          onWork(state.work);session=state;jobs=jobState.jobs||[];dispatchBlocked=jobState.dispatchBlocked===true;
          if(!$("project-symptom").value)$("project-symptom").value=state.symptom||"";
          if(!$("project-evidence").value)$("project-evidence").value=(state.evidence||[]).join("\n");
          if(oldAttempt!==last()?.id||oldCommit!==last()?.report?.candidateCommit)resetProof();
          needsRead=false;
        }else needsRead=false;
        render();
      }catch(error){if(stamp===context())notice("保存状態を確認できません: "+error.message,true);}
      finally{reading=false;sync();schedule();}
    }
    async function connect(reuseKey){
      if(busy||cancelPending||legacyBusy())return;
      const value=typeof reuseKey==="string"?reuseKey:$("project-operator-key").value.trim();$("project-operator-key").value="";
      if(!/^[a-f0-9]{64}$/.test(value)){notice("この起動用の64文字の所有者キーを指定してください。",true);return;}
      key=value;authorized=true;catalogLoaded=false;busy=true;generation++;selectionVersion++;resetProof();stopPoll();onControls();
      try{
        const result=await request("/api/project/catalog");projects=result.projects||[];worker=result.worker||{available:false};catalogLoaded=true;
        const select=$("project-plan"),current=getWork()?.projectRepair?.projectId;
        select.replaceChildren();
        const empty=document.createElement("option");empty.value="";empty.textContent=projects.length?"登録対象を選択してください":"登録対象がありません";select.append(empty);
        for(const [index,project] of projects.entries()){const option=document.createElement("option");option.value=project.id;
          option.textContent=project.label+(projects.filter(p=>p.label===project.label).length>1?"（登録 "+(index+1)+"）":"");select.append(option);}
        if(current&&projects.some(p=>p.id===current))select.value=current;
        else if(projects.length===1)select.value=projects[0].id;
        notice("登録対象を読みました。AI・テスト・適用は実行していません。");
      }catch(error){key="";authorized=false;projects=[];notice("所有者キーで登録対象を確認できません: "+error.message,true);}
      finally{busy=false;render();onControls();}
      if(typeof reuseKey!=="string")onOwnerChange();
      await refresh();
    }
    function receiveOperatorFragment(fragment){
      if(!fragment.present)return;
      if(!fragment.value){notice("起動リンクの所有者キーの形式を確認できません。現在の権限は変更していません。正しい起動リンクか、手動キー欄を使ってください。",true);return;}
      if(busy||cancelPending||legacyBusy()){
        notice("処理中のため起動リンクのキーは破棄しました。現在の権限は変更していません。処理が終わってから起動リンクを開き直すか、手動で再接続してください。",true);return;
      }
      $("project-operator-key").value=fragment.value;
      return connect(); // Catalog/state GET only; never dispatches a worker.
    }
    async function mutate(path,body,{diff=false}={}){
      if(busy||cancelPending||legacyBusy()||needsRead||!authorized||body.action!=="cancel"&&!canMutateWork(getWork()))return;
      const stamp=selectionVersion,workIdentity=identity(getWork());busy=true;
      activeMutation={action:body.action,identity:workIdentity};clearChecks();stopPoll();onControls();schedule();
      notice("選択した仕事の明示操作を実行しています…");let accepted=false,result;
      try{
        result=await request(path,body);if(stamp!==selectionVersion||workIdentity!==identity(getWork()))return;
        if(result.work)onWork(result.work);
        if(result.session)session=result.session;
        if(result.job)jobs=[...jobs.filter(j=>j.id!==result.job.id),result.job];
        if(diff){review=result;text("project-diff",JSON.stringify({sessionId:result.sessionId,attemptId:result.attemptId,
          candidateCommit:result.candidateCommit,diffSha256:result.diffSha256,changedPaths:result.changedPaths},null,2)+"\n\n"+(result.diff||""));}
        accepted=true;notice(path.endsWith("dispatch")?"今回1回の作業を受け付けました。完了とは扱わず、保存状態を確認します。":"操作結果を保存しました。次の実行・適用・共有は別の明示操作です。");
      }catch(error){
        if(stamp===selectionVersion&&workIdentity===identity(getWork())){needsRead=!error.known;notice(error.message+(needsRead?" 結果不明です。自動再送しません。保存状態を読んでから明示的に操作してください。":""),true);}
      }finally{busy=false;activeMutation=null;render();onControls();}
      if(accepted)await refresh();return result;
    }
    const action=(action,extra={})=>mutate("/api/project/action",{action,sessionId:pwork()?.sessionId,...extra});
    $("project-load-catalog").addEventListener("click",connect);
    $("project-lock").addEventListener("click",()=>{key="";authorized=false;catalogLoaded=false;projects=[];session=null;jobs=[];generation++;selectionVersion++;resetProof();stopPoll();render();onControls();onOwnerChange();});
    $("project-operator-key").addEventListener("input",()=>{key="";authorized=false;catalogLoaded=false;generation++;selectionVersion++;resetProof();stopPoll();render();onControls();onOwnerChange();});
    $("project-plan").addEventListener("change",()=>{generation++;selectionVersion++;resetProof();pendingDispatch=null;render();});
    for(const id of ["project-symptom","project-evidence","project-requirements"])
      $(id).addEventListener("input",()=>{clearActionChecks();sync();});
    for(const id of ["project-reviewer","project-cancel-reason"])$(id).addEventListener("input",sync);
    for(const id of checkIds)$(id).addEventListener("change",sync);
    $("project-refresh").addEventListener("click",refresh);
    const startFields=()=>({villageId:getWork()?.villageId,workId:getWork()?.id,projectId:selected()?.id,
      symptom:$("project-symptom").value.trim(),evidence:$("project-evidence").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)});
    $("project-start").addEventListener("click",()=>{if(!$("project-start").disabled)return mutate("/api/project/action",{action:"start",...startFields(),allowStart:true});});
    $("project-dispatch").addEventListener("click",async()=>{
      if($("project-dispatch").disabled)return;
      const p=pwork(),requestId=pendingDispatch?.sessionId===p.sessionId?pendingDispatch.requestId:"request_"+crypto.randomUUID().replaceAll("-","");
      pendingDispatch={sessionId:p.sessionId,requestId};
      const result=await mutate("/api/project/dispatch",{sessionId:p.sessionId,projectId:p.projectId,planDigest:p.planDigest,requestId,allowExternalCodex:true});
      if(result?.job)pendingDispatch=null;
    });
    $("project-cancel").addEventListener("click",async()=>{
      if($("project-cancel").disabled)return;
      if(!busy)return action("cancel",{reason:$("project-cancel-reason").value.trim()});
      const w=getWork(),sessionId=pwork()?.sessionId,stamp=selectionVersion;cancelPending=true;clearChecks();sync();
      try{
        const result=await request("/api/project/action",{action:"cancel",sessionId,reason:$("project-cancel-reason").value.trim()});
        if(stamp!==selectionVersion||identity(w)!==identity(getWork())||pwork()?.sessionId!==sessionId)return;
        if(result.work)onWork(result.work);if(result.session)session=result.session;
        notice("このセッションへ停止を要求しました。実行プロセスの終了と保存結果を確認しています。");
      }catch(error){
        if(stamp===selectionVersion&&identity(w)===identity(getWork())&&pwork()?.sessionId===sessionId){
          needsRead=!error.known;notice("停止結果を確認できません: "+error.message+" 自動再送しません。",true);
        }
      }
      finally{cancelPending=false;render();onControls();schedule();}
    });
    $("project-resume").addEventListener("click",()=>{if(!$("project-resume").disabled)return action("resume",{allowResume:true});});
    $("project-review-diff").addEventListener("click",()=>{if(!$("project-review-diff").disabled)return mutate("/api/project/action",{action:"review",sessionId:pwork().sessionId},{diff:true});});
    $("project-validate").addEventListener("click",()=>{if(!$("project-validate").disabled)return action("validate",{reviewedDiffSha256:review.diffSha256,verifier:reviewer(),allowValidation:true});});
    $("project-apply").addEventListener("click",()=>{if(!$("project-apply").disabled){const v=session.verification,plan=projects.find(p=>p.id===pwork().projectId);return action("apply",{
      candidateCommit:v.candidateCommit,diffSha256:v.diffSha256,verificationId:v.id,expectedHead:plan.baseCommit,reviewer:reviewer(),allowApply:true});}});
    $("project-pouc").addEventListener("click",()=>{if(!$("project-pouc").disabled){const v=session.verification;return action("pouc",{
      candidateCommit:v.candidateCommit,diffSha256:v.diffSha256,verificationId:v.id,reviewer:reviewer(),allowPoUC:true});}});
    $("project-rollback").addEventListener("click",()=>{if(!$("project-rollback").disabled)return action("rollback",{expectedHead:session.verification.candidateCommit,reviewer:reviewer(),allowRollback:true});});
    $("project-revise").addEventListener("click",()=>{if(!$("project-revise").disabled)return mutate("/api/project/action",{action:"revise",...startFields(),
      previousSessionId:pwork().sessionId,reviewedPreviousCandidate:pwork().verification.candidateCommit,
      requirements:$("project-requirements").value.trim(),allowRevision:true});});
    render();
    fetch("/api/project/availability",{cache:"no-store"}).then(async response=>{
      if(response.ok){const value=await response.json();availability={registeredProjectsConfigured:typeof value.registeredProjectsConfigured==="boolean"?value.registeredProjectsConfigured:null,
        workerConfigured:typeof value.workerConfigured==="boolean"?value.workerConfigured:null,mode:value.mode};render();}
    }).catch(()=>{});
    receiveOwnerFragment=receiveOperatorFragment;
    const initial=bootstrap;bootstrap={present:false};receiveOperatorFragment(initial);
    return {update,sync,headers,refresh,reloadCatalog:()=>authorized?connect(key):undefined,
      hasOperator:()=>authorized&&Boolean(key),isBusy:()=>busy||cancelPending};
  };
})();
