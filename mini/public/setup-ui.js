/** Mechanical preparation of host-registered slots; never starts a model. */
(()=>{
  globalThis.createMetronSetupUi=({owner,externalBusy=()=>false,onControls=()=>{},onReady=()=>{}})=>{
    const $=id=>document.getElementById(id),text=(id,v)=>{$(id).textContent=String(v??"");};
    let slots=[],version=0,busy=false,reading=false,pending=null,readConfirmed=false,timer=null,seenReady=new Set();
    const selected=()=>slots.find(s=>s.id===$("setup-slot").value),status=s=>s?.status||s?.job?.status||"unprepared";
    const labels={unprepared:"隔離用コピーの準備前",queued:"準備要求を保存済み",preparing:"Git作業領域を準備中",ready:"準備済み・修復とAI実行はまだ別操作",requires_owner_reconciliation:"途中結果を所有者が確認する必要があります"};
    const say=(value,error=false)=>{text("setup-notice",value);$("setup-notice").className="work-notice"+(error?" error":"");};
    async function request(path,body){const r=await fetch(path,{method:body?"POST":"GET",headers:owner.headers(),cache:"no-store",...(body?{body:JSON.stringify(body)}:{})});
      const v=await r.json();if(!r.ok){const e=Error(v.error||"project_setup_failed");e.known=!r.status||r.status<500;throw e;}return v;}
    function render(){
      const slot=selected(),scope=slot?.publicScope,node=$("setup-scope");node.replaceChildren();
      const add=v=>{const p=document.createElement("p");p.textContent=v;node.append(p);};
      if(slot){add("対象: "+slot.label);add("状態: "+(labels[status(slot)]||status(slot)));
        for(const edit of scope?.allowedEdits||[])add("編集対象: "+edit.path+" / "+edit.operations.join("・"));
        add("公開検査: "+(scope?.publicTests?.length??0)+"件、非公開受入: "+(scope?.acceptanceTestCount??0)+"件（内容・名前・出力は表示しません）、適用後検査: "+(scope?.postApplyTests?.length??0)+"件。");
      }else add(owner.hasOperator()?"所有者が用意した対象を名前から選んでください。候補がなければ、初回の対象・公開/非公開検査の指定は所有者側で必要です。":"所有者の起動リンクで接続すると、準備候補を読めます。");
      text("setup-audit",JSON.stringify({slot,pendingRequest:pending?{requestId:pending.requestId,slotId:pending.slotId}:null},null,2));sync();
    }
    function sync(){const locked=busy||externalBusy(),ok=owner.hasOperator()&&!locked&&!reading,s=selected();
      $("setup-slot").disabled=!ok||Boolean(pending);$("setup-reload").disabled=!owner.hasOperator()||busy||reading;
      $("setup-reviewed").disabled=!ok||!s||status(s)!=="unprepared"||Boolean(pending);
      $("setup-prepare").disabled=$("setup-reviewed").disabled||!$("setup-reviewed").checked;
      $("setup-retry-reviewed").disabled=!ok||!pending||!readConfirmed;
      $("setup-retry").disabled=$("setup-retry-reviewed").disabled||!$("setup-retry-reviewed").checked;
      $("setup-dismiss").disabled=!ok||!pending||!readConfirmed;
    }
    const stopPoll=()=>{if(timer)clearTimeout(timer);timer=null;};
    function schedule(){stopPoll();if(owner.hasOperator()&&slots.some(s=>["queued","preparing"].includes(status(s))))timer=setTimeout(reload,1200);}
    async function reload(){
      if(!owner.hasOperator()||busy||reading)return;
      const stamp=++version;reading=true;$("setup-reviewed").checked=false;$("setup-retry-reviewed").checked=false;sync();stopPoll();let becameReady=false;
      try{const value=await request("/api/project/setup");if(stamp!==version)return;slots=value.slots||[];
        const select=$("setup-slot"),current=pending?.slotId||select.value;select.replaceChildren();const empty=document.createElement("option");empty.value="";empty.textContent=slots.length?"準備する対象を選択":"所有者が指定した準備候補はありません";select.append(empty);
        for(const slot of slots){const option=document.createElement("option");option.value=slot.id;option.textContent=slot.label+"（"+(labels[status(slot)]||status(slot))+"）";select.append(option);
          const mark=slot.id+":"+slot.setupDigest+":"+(slot.job?.id||"");if(status(slot)==="ready"&&!seenReady.has(mark)){seenReady.add(mark);becameReady=true;}}
        if(slots.some(s=>s.id===current))select.value=current;else if(slots.length===1)select.value=slots[0].id;
        readConfirmed=true;say(pending?"保存状態を読みました。結果不明の要求は同じ要求IDでのみ明示再送できます。":"準備状態を読みました。AIやテストは実行していません。");render();
      }catch(error){if(stamp===version)say("準備状態を確認できません: "+error.message,true);}
      finally{reading=false;sync();schedule();}
      if(becameReady)await onReady();
    }
    async function prepare(body){
      if(busy||externalBusy()||!owner.hasOperator())return;const stamp=version;busy=true;pending=body;readConfirmed=false;$("setup-reviewed").checked=false;$("setup-retry-reviewed").checked=false;sync();onControls();
      try{const value=await request("/api/project/setup/prepare",body);if(stamp!==version)return;
        const slot=slots.find(s=>s.id===body.slotId);if(slot){slot.job=value.job;slot.status=value.job?.status||"preparing";}pending=null;say("隔離用Git作業領域の準備を受け付けました。修復・AI・テストは開始しません。");render();
      }catch(error){if(stamp===version){if(error.known)pending=null;say("準備結果を確認できません: "+error.message+" 自動再送しません。保存状態を読み直してください。",true);}}
      finally{busy=false;sync();onControls();schedule();}
    }
    $("setup-slot").addEventListener("change",()=>{version++;$("setup-reviewed").checked=false;$("setup-retry-reviewed").checked=false;render();});
    for(const id of ["setup-reviewed","setup-retry-reviewed"])$(id).addEventListener("change",sync);
    $("setup-reload").addEventListener("click",reload);
    $("setup-prepare").addEventListener("click",()=>{if($("setup-prepare").disabled)return;const slot=selected();return prepare({slotId:slot.id,setupDigest:slot.setupDigest,
      requestId:"setup_"+crypto.randomUUID().replaceAll("-",""),allowPrepare:true});});
    $("setup-retry").addEventListener("click",()=>{if(!$("setup-retry").disabled)return prepare(pending);});
    $("setup-dismiss").addEventListener("click",()=>{if($("setup-dismiss").disabled)return;pending=null;readConfirmed=false;$("setup-retry-reviewed").checked=false;render();say("再送を閉じました。既に保存された準備結果を取り消す操作ではありません。");});
    function ownerChanged(){version++;stopPoll();$("setup-reviewed").checked=false;$("setup-retry-reviewed").checked=false;readConfirmed=false;slots=[];render();if(owner.hasOperator())return reload();}
    render();return {reload,sync,ownerChanged,isBusy:()=>busy};
  };
})();
