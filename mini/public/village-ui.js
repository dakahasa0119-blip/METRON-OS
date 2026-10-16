/** Owner-selected local village bundles. Reads never create or launch. */
(()=>{
  globalThis.createMetronVillageUi=({owner,externalBusy=()=>false,onControls=()=>{},onOpenWork=()=>{},onChanged=()=>{}})=>{
    const $=id=>document.getElementById(id),text=(id,value)=>{$(id).textContent=String(value??"");};
    const fields=["village-new-id","village-directory","village-purpose","village-source-village","village-source-work","village-inherit-goal","village-inherit-source"];
    let catalog=null,bundle=null,runtime=null,workStop=null,preview=null,knowledge=[],version=0,reading=false,busy=false,pending=null,readConfirmed=false;
    const labels={prepared:"作成済み・まだ起動していません",running:"村内の母艦A/BとGatewayが起動中",stopped:"停止済み",cancelled:"作成を保留しました",
      preparing:"作成中",creation_interrupted:"作成途中・保存状態を確認して明示再開してください",launching:"起動中",stopping:"停止中",
      interrupted:"中断・終了状態を確認してください",termination_unconfirmed:"終了未確認・管理者の確認が必要です"};
    const say=(message,error=false)=>{text("village-notice",message);$("village-notice").className="work-notice"+(error?" error":"");};
    const cloneBundle=value=>JSON.parse(JSON.stringify(value));
    const selectedId=()=>$("village-saved").value;
    const selection=()=>({newVillageId:$("village-new-id").value.trim(),directoryName:$("village-directory").value.trim(),
      sourceVillageId:$("village-source-village").value,...($("village-source-work").value?{sourceWorkId:$("village-source-work").value}:{}),
      inheritGoal:$("village-inherit-goal").checked,inheritSourceMessage:$("village-inherit-source").checked,
      knowledgeIds:knowledge.filter(x=>x.input.checked).map(x=>x.value.id),purpose:$("village-purpose").value.trim()});
    const valid=()=>{const s=selection();return /^[a-z][a-z0-9_-]{0,47}$/.test(s.newVillageId)&&/^[a-z][a-z0-9_-]{0,47}$/.test(s.directoryName)&&
      s.purpose.length>0&&s.purpose.length<=500&&s.knowledgeIds.length<=5&&(!s.inheritGoal&&!s.inheritSourceMessage||Boolean(s.sourceWorkId));};
    function invalidate(){version++;preview=null;$("village-preview-reviewed").checked=false;$("village-action-reviewed").checked=false;renderPreview();sync();}
    async function request(path,body){
      const response=await fetch(path,{method:body?"POST":"GET",headers:owner.headers(),cache:"no-store",...(body?{body:JSON.stringify(body)}:{})});
      const value=await response.json();if(!response.ok){const error=Error(value.error||"village_request_failed");error.known=!response.status||response.status<500;throw error;}return value;
    }
    const line=(parent,label,value)=>{const node=document.createElement("p");node.textContent=label+String(value??"取り込まない");parent.append(node);};
    function renderPreview(){
      const node=$("village-preview-card");node.replaceChildren();
      if(!preview){line(node,"", "選別した内容をプレビューしてから作成してください。");text("village-preview-audit","");return;}
      line(node,"新村ID: ",preview.selection.newVillageId);line(node,"専用保存先: ",preview.destination);
      line(node,"新しい目的: ",preview.seed.purpose);
      line(node,"引き継ぐ元の目的: ",preview.seed.inheritedGoal?.text);
      line(node,"引き継ぐ受信本文: ",preview.seed.sourceMessage?.text);
      for(const item of preview.seed.knowledge||[]){line(node,"選んだ知識: ",item.text);line(node,"知識の出所の村: ",item.sourceVillage);}
      line(node,"元の村: ",preview.selection.sourceVillageId==="village-1"?"第一の村":"第二の村");
      if(preview.selection.sourceWorkId)line(node,"元の仕事: ",catalog?.source?.work?.goal||"選択した保存済みの仕事（完全な由来は監査情報）");
      line(node,"", "選んだ本文と知識だけをデータとして保存します。資格情報・ログイン設定・所有者権限・実行許可は自動継承しません。選んだ本文に機密がないか、人が確認してください。");
      text("village-preview-audit",JSON.stringify(preview,null,2));
    }
    function renderSource(){
      const source=catalog?.source;const select=$("village-source-work"),selected=select.value;select.replaceChildren();
      const empty=document.createElement("option");empty.value="";empty.textContent="引き継ぐ元の仕事を選択（任意）";select.append(empty);
      for(const work of source?.works||[]){const option=document.createElement("option");option.value=work.id;option.textContent=work.goal+"（"+work.stage+"）";select.append(option);}
      if((source?.works||[]).some(w=>w.id===selected))select.value=selected;
      text("village-source-summary",source?.work?"元の目的: "+source.work.goal+"\n元の受信本文: "+source.work.sourceMessage.text:
        "元の仕事を選ぶと、目的と受信本文を個別に選別できます。採用済み知識は下で別に選びます。");
      const node=$("village-knowledge");node.replaceChildren();knowledge=[];
      for(const item of source?.knowledge||[]){const label=document.createElement("label"),input=document.createElement("input"),span=document.createElement("span");
        label.className="work-knowledge-option";input.type="checkbox";input.addEventListener("change",invalidate);
        span.textContent=item.text+"\n出所: "+item.sourceVillage+(item.parentRumorId?" / 親Rumor: "+item.parentRumorId:"");label.append(input,span);node.append(label);knowledge.push({input,value:item});}
      if(!knowledge.length)line(node,"", "この村に選択できる採用知識はありません。");
    }
    function renderBundle(){
      text("village-bundle-status",bundle?(labels[bundle.status]||bundle.status):"新しい村はまだ選択していません。");
      text("village-bundle-summary",bundle?"村: "+(bundle.displayName||bundle.newVillageId||bundle.id)+"\n保存先: "+bundle.destination+"\n目的: "+(bundle.seed?.purpose||""):"");
      text("village-runtime",runtime?"母艦A/BとGatewayの保存状態を読みました。モデル呼出し: "+runtime.modelCalls+"。下の送信はこの村の内部だけです。":"起動中の村内ランタイムはありません。");
      text("village-state-audit",JSON.stringify({bundle,runtime,workStop,pendingRequest:pending?{requestId:pending.body.requestId,action:pending.body.action}:null},null,2));sync();
    }
    function sync(){
      const authorized=owner.hasOperator(),locked=busy||externalBusy(),edit=authorized&&!locked&&!pending;
      for(const id of fields)$(id).disabled=!edit||reading;
      for(const item of knowledge)item.input.disabled=!edit||reading;
      $("village-saved").disabled=!authorized||locked||reading||Boolean(pending);
      $("village-reload").disabled=!authorized||busy||reading;
      $("village-preview").disabled=!edit||reading||!valid();
      $("village-preview-reviewed").disabled=!edit||!preview;
      $("village-create").disabled=!edit||!preview||!$("village-preview-reviewed").checked;
      const ops=authorized&&!locked&&!reading&&!pending&&bundle&&selectedId()===(bundle.newVillageId||bundle.id),reviewed=$("village-action-reviewed").checked;
      $("village-action-reviewed").disabled=!authorized||locked||reading||(!bundle&&!pending);
      if($("village-open-work"))$("village-open-work").disabled=!ops||bundle.status!=="running";
      $("village-launch").disabled=!ops||!reviewed||!["prepared","stopped"].includes(bundle.status);
      $("village-stop").disabled=!ops||!reviewed||!["running","launching","stopping","interrupted","termination_unconfirmed"].includes(bundle.status);
      const reason=$("village-reason").value.trim(),message=$("village-message").value.trim();
      $("village-cancel").disabled=!ops||!reviewed||!["preparing","prepared","creation_interrupted"].includes(bundle.status)||!reason||reason.length>500;
      $("village-resume").disabled=!ops||!reviewed||!["cancelled","creation_interrupted","interrupted"].includes(bundle.status);
      $("village-send").disabled=!ops||!reviewed||bundle.status!=="running"||!message||message.length>1024;
      $("village-message").disabled=!ops||bundle.status!=="running";$("village-reason").disabled=!ops;
      $("village-retry").disabled=!authorized||locked||reading||!pending||!readConfirmed||!reviewed;
      $("village-dismiss").disabled=!authorized||locked||reading||!pending||!readConfirmed;
    }
    async function reload(){
      if(!owner.hasOperator()||busy||reading)return;
      const stamp=++version,query=new URLSearchParams({sourceVillageId:$("village-source-village").value});
      if($("village-source-work").value)query.set("sourceWorkId",$("village-source-work").value);
      reading=true;preview=null;$("village-preview-reviewed").checked=false;$("village-action-reviewed").checked=false;sync();renderPreview();
      try{
        const value=await request("/api/village/catalog?"+query);if(stamp!==version)return;
        catalog=value;renderSource();text("village-base-root","所有者が指定した専用保存の親フォルダー: "+value.baseRoot);
        const select=$("village-saved"),current=pending?.body.newVillageId||select.value;select.replaceChildren();
        const empty=document.createElement("option");empty.value="";empty.textContent="保存された新しい村を選ぶ";select.append(empty);
        for(const item of value.bundles||[]){const option=document.createElement("option");option.value=item.newVillageId||item.id;option.textContent=(item.displayName||option.value)+"（"+(labels[item.status]||item.status)+"）";select.append(option);}
        if((value.bundles||[]).some(b=>(b.newVillageId||b.id)===current))select.value=current;
        bundle=null;runtime=null;
        if(select.value){const saved=await request("/api/village/state?"+new URLSearchParams({newVillageId:select.value}));if(stamp!==version)return;bundle=saved.bundle;runtime=saved.runtime;}
        readConfirmed=true;say(pending?"保存状態を読みました。結果不明の要求は自動再送しません。同じ要求を再確認して明示再送するか、再送せず閉じてください。":"保存状態を読みました。村の作成・起動・送信は実行していません。");renderBundle();onChanged();
      }catch(error){if(stamp===version)say("村の保存状態を確認できません: "+error.message,true);}
      finally{reading=false;sync();}
    }
    async function showPreview(){
      if($("village-preview").disabled)return;const stamp=version,s=selection();reading=true;sync();
      try{const value=await request("/api/village/preview",s);if(stamp!==version)return;preview=value;renderPreview();say("選別した全内容と専用保存先を確認してください。まだ作成・起動していません。");}
      catch(error){if(stamp===version)say("プレビューを確認できません: "+error.message,true);}
      finally{reading=false;sync();}
    }
    async function send(body){
      if(busy||externalBusy()||!owner.hasOperator())return;
      const stamp=version;busy=true;readConfirmed=false;pending={body};$("village-preview-reviewed").checked=false;$("village-action-reviewed").checked=false;sync();onControls();
      try{const value=await request("/api/village/action",body);if(stamp!==version)return;pending=null;bundle=value.bundle;runtime=value.runtime??null;
        workStop=value.workStop?{requested:Number.isInteger(value.workStop.requested)&&value.workStop.requested>=0?value.workStop.requested:0,sessions:(Array.isArray(value.workStop.sessions)?value.workStop.sessions:[]).map(item=>({
          sessionId:typeof item.sessionId==="string"?item.sessionId.slice(0,80):null,status:item.status==="fulfilled"?"fulfilled":"rejected",
          ...(item.error?{error:String(item.error).slice(0,300)}:{})}))}:null;
        if(bundle){const id=bundle.newVillageId||bundle.id;const select=$("village-saved");if(!select.children||![...select.children].some(o=>o.value===id)){const option=document.createElement("option");option.value=id;option.textContent=bundle.displayName||id;select.append(option);}select.value=id;}
        preview=null;renderPreview();renderBundle();onChanged();
        const stopUnresolved=workStop?.sessions.some(item=>item.status==="rejected")===true;
        const stopRequested=(workStop?.requested||0)>0;
        say(stopUnresolved?"村の停止結果は保存しましたが、作業の停止確認に失敗したセッションがあります。監査記録と所有者側の状態を確認してください。自動で再送・再開しません。":
          stopRequested?"村は停止済みです。修復ワーカーに停止を要求しました。終了状態は仕事画面で確認してください。":
          "要求された操作の結果を保存しました。起動・送信・再開はそれぞれ別操作です。",stopUnresolved);
      }catch(error){if(stamp===version){if(error.known)pending=null;say("操作の完了を確認できません: "+error.message+" 自動再送しません。保存状態を読み直してください。",true);}}
      finally{busy=false;sync();onControls();}
    }
    const action=(name,allow,extra={})=>{if($("village-"+name.replace("send-local","send")).disabled)return;
      return send({action:name,requestId:"request_"+crypto.randomUUID().replaceAll("-",""),newVillageId:selectedId(),...(allow?{[allow]:true}:{}),...extra});};
    for(const id of fields)$(id).addEventListener(id.includes("inherit")||id.includes("source")?"change":"input",()=>{
      invalidate();if(id==="village-source-village"){$("village-source-work").value="";$("village-inherit-goal").checked=false;$("village-inherit-source").checked=false;}
      if(id==="village-source-village"||id==="village-source-work")return reload();
    });
    $("village-preview").addEventListener("click",showPreview);$("village-reload").addEventListener("click",reload);
    $("village-preview-reviewed").addEventListener("change",sync);$("village-action-reviewed").addEventListener("change",sync);
    for(const id of ["village-reason","village-message"])$(id).addEventListener("input",()=>{$("village-action-reviewed").checked=false;sync();});
    $("village-saved").addEventListener("change",()=>{invalidate();bundle=null;runtime=null;renderBundle();return reload();});
    $("village-create").addEventListener("click",()=>{if(!$("village-create").disabled)return send({action:"create",requestId:"request_"+crypto.randomUUID().replaceAll("-",""),
      ...preview.selection,previewDigest:preview.previewDigest,allowCreate:true,dataReviewed:true});});
    if($("village-open-work"))$("village-open-work").addEventListener("click",()=>{
      if(!$("village-open-work").disabled&&owner.hasOperator()&&bundle?.status==="running")return onOpenWork(cloneBundle(bundle));
    });
    $("village-launch").addEventListener("click",()=>action("launch","allowLaunch"));
    $("village-stop").addEventListener("click",()=>action("stop","allowStop"));
    $("village-resume").addEventListener("click",()=>action("resume","allowResume"));
    $("village-cancel").addEventListener("click",()=>action("cancel",null,{reason:$("village-reason").value.trim()}));
    $("village-send").addEventListener("click",()=>action("send-local","allowSend",{message:$("village-message").value.trim()}));
    $("village-retry").addEventListener("click",()=>{if(!$("village-retry").disabled)return send(pending.body);});
    $("village-dismiss").addEventListener("click",()=>{if($("village-dismiss").disabled)return;pending=null;readConfirmed=false;invalidate();renderBundle();say("保存状態を確認し、要求の再送を閉じました。元の操作を取り消した意味ではありません。");});
    function ownerChanged(){version++;preview=null;catalog=null;bundle=null;runtime=null;workStop=null;readConfirmed=false;$("village-preview-reviewed").checked=false;$("village-action-reviewed").checked=false;renderPreview();renderBundle();
      if(owner.hasOperator())return reload();say("登録プロジェクト欄の所有者接続を確認してください。キーは共有のメモリーだけで管理します。");}
    renderPreview();renderBundle();sync();return {reload,sync,ownerChanged,isBusy:()=>busy};
  };
})();
