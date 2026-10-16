import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

// DOM/API protocol fixtures only. No browser, host process, real worker or model.
const html=readFileSync(new URL("../../mini/public/experience.html",import.meta.url),"utf8"),
  script=readFileSync(new URL("../../mini/public/project-ui.js",import.meta.url),"utf8");
const copy=x=>JSON.parse(JSON.stringify(x)),KEY="a".repeat(64),digest="b".repeat(64),commit="c".repeat(40),sessionId="agent_"+"d".repeat(32);
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture({status="awaiting_review",hash="",onPost,jobFixture=[],dispatchBlocked=false,noProject=false,
  availability={registeredProjectsConfigured:true,workerConfigured:true,mode:"injected_worker_test"},catalogProjects,
  workerFixture={available:true,mode:"injected_worker_test",status:"configured_not_preflighted"},legacyInitiallyBusy=false,beforeFactory,onOwnerChange}={}){
  const elements=new Map(),requests=[],notices=[],history=[];
  const browserListeners=new Map(),location={hash,pathname:"/experience",search:""};let legacyLocked=legacyInitiallyBusy;
  class Element{
    constructor(){this.value="";this.checked=false;this.disabled=false;this.textContent="";this.children=[];this.listeners={};}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    async emit(type){if(type==="click"&&this.disabled)return;for(const fn of this.listeners[type]||[])await fn({target:this});}
    set innerHTML(_){throw Error("UI content must be plain text");}
  }
  for(const match of html.matchAll(/\bid="([^"]+)"/g))elements.set(match[1],new Element());
  const $=id=>{assert.ok(elements.has(id),id);return elements.get(id);};
  const plans=catalogProjects??[{id:"fixture-project",label:"Registered fixture",baseCommit:"e".repeat(40),planDigest:digest,
    allowedEdits:[{path:"src/name.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],
    postApplyTests:["tests/smoke.test.mjs"],acceptanceTestCount:2},
    {id:"fixture-v2",label:"Owner-added requirements",baseCommit:"f".repeat(40),planDigest:"1".repeat(64)}];
  let work={id:"work_"+"2".repeat(32),villageId:"village-1",runId:"case_"+"3".repeat(32),sourceMessage:{id:"source_saved"},
    stage:"unresolved",nextAction:"project_"+status,projectRepair:{sessionId,projectId:plans[0]?.id??"fixture-project",planDigest:digest,status,attemptCount:1,verification:null}};
  if(noProject){delete work.projectRepair;work.stage="ready";}
  let state={id:sessionId,status,symptom:"Pinned public failure",evidence:["Public evidence"],attempts:[{
    id:"attempt_"+"4".repeat(32),number:1,status:"reported",report:{candidateCommit:commit},
    acceptanceResult:{passed:false,checks:[{output:"DO_NOT_DISPLAY_SEALED_TEST_OUTPUT"}]}}],work:copy(work)};
  let jobs=copy(jobFixture),blocked=dispatchBlocked;
  const response=(value,ok=true)=>({ok,json:async()=>copy(value)});
  async function fetch(path,init={}){
    const body=init.body?JSON.parse(init.body):null;requests.push({path,method:init.method,headers:init.headers,body});
    if(path==="/api/project/availability")return response(availability);
    if(init.headers?.["X-Metron-Project-Operator"]!==KEY)return response({error:"project_operator_capability_required"},false);
    if(path==="/api/project/catalog")return response({projects:plans,worker:workerFixture});
    if(path.startsWith("/api/project/state?"))return response({...state,work});
    if(path.startsWith("/api/project/jobs?"))return response({jobs,dispatchBlocked:blocked});
    if(onPost)return onPost({path,body,response,setState:next=>{state={...state,...next};},setJobs:next=>{jobs=next;}});
    if(body?.action==="review")return response({work,sessionId,attemptId:state.attempts[0].id,candidateCommit:commit,diffSha256:digest,
      changedPaths:["src/<script>.mjs"],diff:"<img src=x> actual diff text"});
    if(body?.action==="validate")return response({session:state,work});
    if(path==="/api/project/dispatch")return response({job:{id:"job_one",status:"reported_awaiting_independent_review"}});
    throw Error("Unexpected UI fixture request "+path);
  }
  const context=vm.createContext({document:{getElementById:$,createElement:()=>new Element()},fetch,URLSearchParams,
    location,history:{replaceState:(_,__,path)=>{history.push(path);location.hash="";}},
    addEventListener:(type,listener)=>browserListeners.set(type,[...(browserListeners.get(type)||[]),listener]),
    crypto:{randomUUID:()=>"55555555-5555-4555-8555-555555555555"},setTimeout:()=>1,clearTimeout(){}});
  const hashChange=async value=>{location.hash=value;await Promise.all((browserListeners.get("hashchange")||[]).map(listener=>listener()));await flush();};
  vm.runInContext(script,context);let ui;
  if(beforeFactory)await beforeFactory({hashChange,location,history,requests,browserListeners});
  ui=context.createMetronProjectUi({getWork:()=>work,onWork:next=>{work=copy(next);ui.update(work);},
    onControls(){if(ui){$("work-village").disabled=ui.isBusy();$("work-saved").disabled=ui.isBusy();}},
    legacyBusy:()=>legacyLocked,notice:(...args)=>notices.push(args),onOwnerChange});
  ui.update(work);await flush();
  const connect=async(value=KEY)=>{$("project-operator-key").value=value;await $("project-operator-key").emit("input");await $("project-load-catalog").emit("click");await flush();};
  return {$,ui,requests,notices,history,location,hashChange,connect,work:()=>work,posts:()=>requests.filter(r=>r.method==="POST"),setLegacyBusy:value=>{legacyLocked=value;},
    setWork:value=>{work=copy(value);ui.update(work);},setState:value=>{state={...state,...value};},setBlocked:value=>{blocked=value;}};
}
const textOf=node=>node.textContent+node.children.map(textOf).join("\n");

test("PoUC binds a fresh explicit action to the verified candidate and never dispatches AI on read",async()=>{
  const verification={id:"verification_"+"6".repeat(32),candidateCommit:commit,diffSha256:digest,evidenceDigest:"7".repeat(64)};
  const h=await fixture({status:"candidate_verified",onPost:({body,response,setState})=>{
    const pouc={status:"verified",attempts:1,proofDigest:"8".repeat(64)};
    assert.equal(body.action,"pouc");setState({pouc});return response({session:{id:sessionId,status:"candidate_verified",verification,pouc}});
  }});
  h.setState({verification});await h.connect();
  h.$("project-reviewer").value="local fixture reviewer";await h.$("project-reviewer").emit("input");
  assert.equal(h.posts().length,0);assert.equal(h.$("project-pouc").disabled,true);
  h.$("project-pouc-reviewed").checked=true;await h.$("project-pouc-reviewed").emit("change");
  assert.equal(h.$("project-pouc").disabled,false);await h.$("project-pouc").emit("click");
  const post=h.posts()[0];assert.equal(post.path,"/api/project/action");
  assert.deepEqual(post.body,{action:"pouc",sessionId,candidateCommit:commit,diffSha256:digest,
    verificationId:verification.id,reviewer:"local fixture reviewer",allowPoUC:true});
  assert.equal(h.$("project-pouc-reviewed").checked,false);assert.equal(h.$("project-pouc").disabled,true);
  assert.match(h.$("project-pouc-result").textContent,/8{64}/);assert.equal(h.posts().length,1);
  await h.ui.refresh();assert.equal(h.posts().length,1,"GET refresh cannot redo the calculation or contact a model");
});

test("owner bootstrap is stripped immediately, remains memory-only and never launches a worker",async()=>{
  const h=await fixture({hash:"#project-operator="+KEY});
  assert.deepEqual(h.history,["/experience"]);assert.equal(h.ui.hasOperator(),true);
  assert.equal(h.$("project-operator-key").value,"");assert.equal(h.posts().length,0);
  for(const request of h.requests){assert.equal(request.path.includes(KEY),false);
    assert.equal(request.headers?.["X-Metron-Project-Operator"],request.path==="/api/project/availability"?undefined:KEY);}
  assert.equal(h.$("project-status").textContent.includes("DO_NOT_DISPLAY_SEALED_TEST_OUTPUT"),false);
  assert.match(h.$("project-status").textContent,/模擬worker（本物AIではない）/);
  assert.equal(h.$("project-status").textContent.includes(KEY),false);
  await h.$("project-lock").emit("click");assert.equal(h.ui.hasOperator(),false);assert.equal(h.$("project-review-diff").disabled,true);
});

test("shared owner notifications carry no capability and prepared catalog reload invalidates approval using only GET",async()=>{
  const notifications=[];const h=await fixture({onOwnerChange:(...args)=>notifications.push(args)});await h.connect();
  assert.ok(notifications.length>0);assert.ok(notifications.every(args=>args.length===0));
  h.$("project-scope-reviewed").checked=true;await h.$("project-scope-reviewed").emit("change");
  const catalogCount=h.requests.filter(r=>r.path==="/api/project/catalog").length,count=notifications.length;
  await h.ui.reloadCatalog();assert.equal(h.$("project-scope-reviewed").checked,false);
  assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,catalogCount+1);
  assert.equal(notifications.length,count,"catalog-only reload does not cause recursive owner notifications");
  assert.equal(h.$("project-operator-key").value,"");assert.equal(h.posts().length,0);
  h.setLegacyBusy(true);await h.ui.reloadCatalog();assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,catalogCount+1);
});

test("before the controller exists only the latest owner link survives and one listener handles both phases",async()=>{
  const stale="9".repeat(64);let listeners;
  const h=await fixture({hash:"#project-operator="+stale,beforeFactory:async before=>{
    assert.equal(before.location.hash,"");assert.equal(before.requests.length,0,"script load grants no authority");
    listeners=before.browserListeners;assert.equal(listeners.get("hashchange").length,1);
    const received=before.hashChange("#project-operator="+KEY);
    assert.equal(before.location.hash,"");await received;
    assert.equal(before.requests.length,0,"pending bootstrap does not connect before the controller is ready");
  }});
  assert.equal(h.ui.hasOperator(),true);assert.equal(h.ui.headers()["X-Metron-Project-Operator"],KEY);
  assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,1);
  assert.equal(h.requests.some(r=>r.headers?.["X-Metron-Project-Operator"]===stale),false);
  assert.equal(listeners.get("hashchange").length,1,"factory readiness must not add a second listener");
  await h.hashChange("#project-operator="+KEY);
  assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,2,"one later link performs one GET connection");
  assert.equal(h.posts().length,0);
});

test("an invalid latest pre-controller owner link strips immediately and discards a previously valid bootstrap",async()=>{
  for(const hash of ["#project-operator=invalid","#project-operator="+"A".repeat(64),
    "#project-operator="+KEY+"&project-operator="+KEY]){
    const h=await fixture({hash:"#project-operator="+KEY,beforeFactory:async before=>{
      const received=before.hashChange(hash);assert.equal(before.location.hash,"");await received;
      assert.equal(before.requests.length,0);
    }});
    assert.equal(h.ui.hasOperator(),false);assert.equal(h.location.hash,"");
    assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,0);assert.equal(h.posts().length,0);
    assert.ok(h.notices.some(([message])=>/形式を確認できません/.test(message)));
  }
});

test("ordinary pre-controller anchors remain visible and do not replace the latest owner bootstrap",async()=>{
  for(const owner of [false,true]){
    const h=await fixture({hash:owner?"#project-operator="+KEY:"#project-desk",beforeFactory:async before=>{
      await before.hashChange("#project-desk");assert.equal(before.location.hash,"#project-desk");
      assert.equal(before.requests.length,0);
    }});
    assert.equal(h.location.hash,"#project-desk");assert.equal(h.ui.hasOperator(),owner);
    assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,owner?1:0);
    assert.deepEqual(h.history,owner?["/experience"]:[]);assert.equal(h.posts().length,0);
  }
});

test("fresh invalid owner fragments are stripped without authority and ordinary panel anchors are preserved",async()=>{
  for(const hash of ["#project-operator=invalid","#project-operator="+"A".repeat(64),
    "#project-operator="+KEY+"&project-operator="+KEY]){
    const h=await fixture({hash});assert.equal(h.location.hash,"");assert.deepEqual(h.history,["/experience"]);
    assert.equal(h.ui.hasOperator(),false);assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,0);
    assert.equal(h.posts().length,0);assert.ok(h.notices.some(([message])=>/形式を確認できません/.test(message)));
  }
  const ordinary=await fixture({hash:"#project-desk"});assert.equal(ordinary.location.hash,"#project-desk");
  assert.deepEqual(ordinary.history,[]);assert.equal(ordinary.ui.hasOperator(),false);
});

test("same-document owner links reconnect by GET only and invalid replacements preserve the current authority",async()=>{
  const h=await fixture({hash:"#project-desk"});
  const connection=h.hashChange("#project-operator="+KEY);assert.equal(h.location.hash,"","strip is synchronous before connection completes");
  await connection;assert.equal(h.ui.hasOperator(),true);assert.equal(h.$("project-operator-key").value,"");
  assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,1);assert.equal(h.posts().length,0);
  for(const hash of ["#project-operator=invalid","#project-operator="+KEY+"&project-operator="+"9".repeat(64)]){
    await h.hashChange(hash);assert.equal(h.location.hash,"");assert.equal(h.ui.headers()["X-Metron-Project-Operator"],KEY);
    assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,1);assert.equal(h.posts().length,0);
  }
  await h.hashChange("#project-desk");assert.equal(h.location.hash,"#project-desk");
});

test("owner links during legacy work are discarded without switching authority or queuing a later connection",async()=>{
  const h=await fixture();await h.connect();const catalogs=h.requests.filter(r=>r.path==="/api/project/catalog").length;
  h.setLegacyBusy(true);await h.hashChange("#project-operator="+"9".repeat(64));
  assert.equal(h.location.hash,"");assert.equal(h.ui.headers()["X-Metron-Project-Operator"],KEY);
  assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,catalogs);assert.equal(h.posts().length,0);
  assert.ok(h.notices.some(([message])=>/処理中.*破棄/.test(message)));
  h.setLegacyBusy(false);await flush();assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,catalogs);
  const initial=await fixture({hash:"#project-operator="+KEY,legacyInitiallyBusy:true});
  assert.equal(initial.location.hash,"");assert.equal(initial.ui.hasOperator(),false);
  assert.equal(initial.requests.filter(r=>r.path==="/api/project/catalog").length,0);
});

test("wrong owner key and unchecked/stale diff approval cannot validate; exact review pins are sent",async()=>{
  const h=await fixture();assert.deepEqual(h.requests.map(r=>r.path),["/api/project/availability"]);await h.connect("9".repeat(64));
  assert.equal(h.ui.hasOperator(),false);assert.equal(h.posts().length,0);
  await h.connect();h.$("project-reviewer").value="Owner reviewer";await h.$("project-reviewer").emit("input");
  assert.equal(h.$("project-validate").disabled,true);await h.$("project-review-diff").emit("click");await flush();
  assert.match(h.$("project-diff").textContent,/<img src=x> actual diff text/);assert.equal(h.$("project-validate").disabled,true);
  h.$("project-diff-reviewed").checked=true;await h.$("project-diff-reviewed").emit("change");assert.equal(h.$("project-validate").disabled,false);
  h.$("project-plan").value="fixture-v2";await h.$("project-plan").emit("change");
  assert.equal(h.$("project-diff-reviewed").checked,false);assert.equal(h.$("project-validate").disabled,true);
  h.$("project-plan").value="fixture-project";await h.$("project-plan").emit("change");
  await h.$("project-review-diff").emit("click");h.$("project-diff-reviewed").checked=true;await h.$("project-diff-reviewed").emit("change");
  await h.$("project-validate").emit("click");await flush();
  const validated=h.posts().find(r=>r.body.action==="validate");
  assert.deepEqual(validated.body,{action:"validate",sessionId,reviewedDiffSha256:digest,verifier:"Owner reviewer",allowValidation:true});
  assert.equal(h.$("project-diff-reviewed").checked,false);
});

test("uncertain dispatch consumes consent, requires state readback and only explicitly retries the same request",async()=>{
  let calls=0;
  const h=await fixture({status:"ready_worker",onPost:({path,body,response})=>{
    assert.equal(path,"/api/project/dispatch");calls++;
    if(calls===1)throw Error("Synthetic lost response");
    return response({job:{id:"job_saved",status:"failed_requires_owner_reconciliation"},duplicate:true});
  }});await h.connect();
  assert.equal(h.$("project-dispatch").disabled,true);h.$("project-codex-consent").checked=true;
  await h.$("project-codex-consent").emit("change");await h.$("project-dispatch").emit("click");
  assert.equal(h.$("project-codex-consent").checked,false);assert.equal(h.posts().length,1);
  h.$("project-codex-consent").checked=true;await h.$("project-codex-consent").emit("change");
  assert.equal(h.$("project-dispatch").disabled,true);
  await h.$("project-refresh").emit("click");await flush();assert.equal(h.posts().length,1);
  h.$("project-codex-consent").checked=true;await h.$("project-codex-consent").emit("change");await h.$("project-dispatch").emit("click");
  assert.equal(h.posts().length,2);assert.deepEqual(h.posts()[1].body,h.posts()[0].body);
  assert.equal(h.posts()[0].body.allowExternalCodex,true);assert.match(h.posts()[0].body.requestId,/^request_[a-f0-9]{32}$/);
  assert.equal(h.posts()[0].headers["X-Metron-Project-Operator"],KEY);
});

test("pending independent validation permits read-only progress and a separately pinned explicit cancellation",async()=>{
  let finishValidation;
  const h=await fixture({onPost:({body,response,setState})=>{
    if(body.action==="review")return response({sessionId,attemptId:"attempt_"+"4".repeat(32),candidateCommit:commit,
      diffSha256:digest,changedPaths:["src/name.mjs"],diff:"reviewed fixture diff"});
    if(body.action==="validate"){
      setState({status:"validating"});
      return new Promise(resolve=>{finishValidation=()=>{setState({status:"cancelled"});resolve(response({}));};});
    }
    if(body.action==="cancel")return response({session:{id:sessionId,status:"validating",cancelRequested:true}});
    throw Error("Unexpected mutation while validation is pending");
  }});await h.connect();
  h.$("project-reviewer").value="Owner verifier";await h.$("project-reviewer").emit("input");
  h.$("project-cancel-reason").value="Stop the pinned pending validator";await h.$("project-cancel-reason").emit("input");
  await h.$("project-review-diff").emit("click");h.$("project-diff-reviewed").checked=true;
  await h.$("project-diff-reviewed").emit("change");
  const pending=h.$("project-validate").emit("click");await flush();
  assert.equal(h.ui.isBusy(),true);assert.equal(h.$("project-refresh").disabled,false);
  assert.equal(h.$("project-cancel").disabled,false);assert.equal(h.$("project-dispatch").disabled,true);
  assert.equal(h.$("project-apply").disabled,true);
  const catalogsBefore=h.requests.filter(r=>r.path==="/api/project/catalog").length;
  await h.hashChange("#project-operator="+"9".repeat(64));
  assert.equal(h.location.hash,"");assert.equal(h.ui.headers()["X-Metron-Project-Operator"],KEY);
  assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,catalogsBefore);
  assert.match(h.notices.at(-1)[0],/処理中.*破棄/);
  const readsBefore=h.requests.filter(r=>r.path.startsWith("/api/project/state?")).length;
  await h.$("project-refresh").emit("click");await flush();
  assert.ok(h.requests.filter(r=>r.path.startsWith("/api/project/state?")).length>readsBefore);
  assert.match(h.$("project-status").textContent,/validating|独立検証/);
  await h.$("project-cancel").emit("click");
  const cancelled=h.posts().find(r=>r.body.action==="cancel");
  assert.deepEqual(cancelled.body,{action:"cancel",sessionId,reason:"Stop the pinned pending validator"});
  assert.equal(cancelled.headers["X-Metron-Project-Operator"],KEY);
  assert.equal(h.posts().filter(r=>r.body.action==="validate").length,1);
  assert.equal(h.posts().filter(r=>r.path==="/api/project/dispatch").length,0);
  finishValidation();await pending;await flush();assert.equal(h.ui.isBusy(),false);
  assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,catalogsBefore,"discarded owner links are never queued");
});

test("failed or unconfirmed jobs cannot be unblocked by consent; backend reconciliation enables only a new explicit attempt",async()=>{
  for(const terminationUnconfirmed of [false,true]){
    const h=await fixture({status:"ready_worker",dispatchBlocked:true,jobFixture:[{id:"failed_job",createdAt:1,
      status:"failed_requires_owner_reconciliation",terminationUnconfirmed,reason:"project_codex_worker_failed"}]});
    await h.connect();h.$("project-codex-consent").checked=true;await h.$("project-codex-consent").emit("change");
    assert.equal(h.$("project-dispatch").disabled,true);assert.equal(h.posts().length,0);
    assert.match(h.$("project-status").textContent,terminationUnconfirmed?/管理者が実プロセス/:/停止状態と結果を確認/);
    if(!terminationUnconfirmed){
      h.setBlocked(false);h.setState({status:"revision_ready"});await h.$("project-refresh").emit("click");
      assert.equal(h.posts().length,0);assert.equal(h.$("project-codex-consent").checked,false);
      h.$("project-codex-consent").checked=true;await h.$("project-codex-consent").emit("change");
      assert.equal(h.$("project-dispatch").disabled,false);
    }
  }
});

test("a late Cancel response keeps selection and new mutations locked after the original validation finishes",async()=>{
  let finishValidation,finishCancel;
  const h=await fixture({onPost:({body,response,setState})=>{
    if(body.action==="review")return response({sessionId,attemptId:"attempt_"+"4".repeat(32),candidateCommit:commit,
      diffSha256:digest,changedPaths:["src/name.mjs"],diff:"reviewed fixture diff"});
    if(body.action==="validate")return new Promise(resolve=>{finishValidation=()=>{
      setState({status:"candidate_verified",verification:{id:"verification_"+"6".repeat(32),candidateCommit:commit,diffSha256:digest}});
      resolve(response({}));};});
    if(body.action==="cancel")return new Promise(resolve=>{finishCancel=()=>resolve(response({}));});
    throw Error("No other mutation is allowed while cancellation is pending");
  }});await h.connect();h.$("project-reviewer").value="Owner verifier";await h.$("project-reviewer").emit("input");
  h.$("project-cancel-reason").value="Stop exactly this validator";await h.$("project-cancel-reason").emit("input");
  await h.$("project-review-diff").emit("click");h.$("project-diff-reviewed").checked=true;
  await h.$("project-diff-reviewed").emit("change");
  const validation=h.$("project-validate").emit("click");await flush();
  const cancellation=h.$("project-cancel").emit("click");await flush();
  finishValidation();await validation;await flush();
  assert.equal(h.ui.isBusy(),true,"the pending cancellation owns the mutation lock");
  for(const id of ["work-village","work-saved","project-plan","project-load-catalog","project-lock","project-start",
    "project-dispatch","project-resume","project-validate","project-apply","project-rollback","project-revise"])
    assert.equal(h.$(id).disabled,true,id+" must remain locked until Cancel settles");
  assert.equal(h.$("project-refresh").disabled,false,"read-only reconciliation remains available");
  const catalogsBefore=h.requests.filter(r=>r.path==="/api/project/catalog").length;
  await h.hashChange("#project-operator="+"9".repeat(64));
  assert.equal(h.location.hash,"");assert.equal(h.ui.headers()["X-Metron-Project-Operator"],KEY);
  assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,catalogsBefore);
  assert.match(h.notices.at(-1)[0],/処理中.*破棄/);
  h.$("project-apply-reviewed").checked=true;await h.$("project-apply-reviewed").emit("change");
  await h.$("project-apply").emit("click");assert.equal(h.posts().length,3,"no new apply may race a late Cancel");
  finishCancel();await cancellation;await flush();assert.equal(h.ui.isBusy(),false);
  assert.equal(h.requests.filter(r=>r.path==="/api/project/catalog").length,catalogsBefore,"late cancellation never releases a queued authority switch");
});

test("named target cards expose permitted edits and check boundaries without requiring IDs or JSON input",async()=>{
  const h=await fixture();await h.connect();
  assert.equal(h.$("project-target-name").textContent,"Registered fixture");
  assert.match(textOf(h.$("project-edit-files")),/src\/name\.mjs/);assert.match(textOf(h.$("project-edit-files")),/変更/);
  assert.equal(h.$("project-public-count").textContent,"1件");assert.equal(h.$("project-acceptance-count").textContent,"2件");
  assert.equal(h.$("project-smoke-count").textContent,"1件");
  const main=["project-target-card","project-state-card","project-history-list"].map(id=>textOf(h.$(id))).join("\n");
  for(const secret of [KEY,sessionId,h.work().id,h.work().runId,digest,"DO_NOT_DISPLAY_SEALED_TEST_OUTPUT"])
    assert.equal(main.includes(secret),false,"main cards must omit audit-only or private data");
  for(const option of h.$("project-plan").children)assert.equal(option.textContent.includes(option.value)&&Boolean(option.value),false);
  assert.equal(JSON.parse(h.$("project-plan-summary").textContent).id,"fixture-project");
  assert.equal(JSON.parse(h.$("project-status").textContent.split("\n\n")[0]).sessionId,sessionId);
  assert.equal(h.posts().length,0);
});

test("start and requirements revision require fresh scope review for the selected work and catalog",async()=>{
  const h=await fixture({noProject:true});await h.connect();
  h.$("project-plan").value="fixture-project";await h.$("project-plan").emit("change");
  h.$("project-symptom").value="A public assertion fails";await h.$("project-symptom").emit("input");
  h.$("project-evidence").value="A harmless reproduction";await h.$("project-evidence").emit("input");
  assert.equal(h.$("project-start").disabled,true);
  h.$("project-scope-reviewed").checked=true;await h.$("project-scope-reviewed").emit("change");
  assert.equal(h.$("project-start").disabled,false);assert.equal(h.posts().length,0,"review does not start checks or AI");
  h.$("project-plan").value="fixture-v2";await h.$("project-plan").emit("change");
  assert.equal(h.$("project-scope-reviewed").checked,false);assert.equal(h.$("project-start").disabled,true);
  h.$("project-scope-reviewed").checked=true;await h.$("project-scope-reviewed").emit("change");
  h.setWork({...h.work(),id:"work_"+"7".repeat(32)});assert.equal(h.$("project-scope-reviewed").checked,false);
  h.$("project-scope-reviewed").checked=true;await h.connect();assert.equal(h.$("project-scope-reviewed").checked,false);
  const old={...h.work(),stage:"candidate_verified",projectRepair:{sessionId,projectId:"fixture-project",planDigest:digest,
    attemptCount:1,status:"candidate_verified",verification:{id:"verification_"+"6".repeat(32),candidateCommit:commit,diffSha256:digest}}};
  h.setWork(old);h.setState({status:"candidate_verified",verification:old.projectRepair.verification});await h.$("project-refresh").emit("click");
  h.$("project-plan").value="fixture-v2";await h.$("project-plan").emit("change");
  h.$("project-symptom").value="A new public failure";await h.$("project-symptom").emit("input");
  h.$("project-requirements").value="Owner-added requirement";await h.$("project-requirements").emit("input");
  h.$("project-revision-reviewed").checked=true;await h.$("project-revision-reviewed").emit("change");
  assert.equal(h.$("project-revise").disabled,true);
  h.$("project-scope-reviewed").checked=true;await h.$("project-scope-reviewed").emit("change");
  assert.equal(h.$("project-revise").disabled,false);assert.equal(h.posts().length,0);
});

test("unconfigured targets and workers explain the missing preparation without claiming self-service setup or connection success",async()=>{
  const empty=await fixture({noProject:true,availability:{registeredProjectsConfigured:false,workerConfigured:false,mode:"unavailable"}});
  assert.match(empty.$("project-setup-state").textContent,/対象.*準備|修復対象.*ありません/);
  assert.match(empty.$("project-setup-next").textContent,/所有者|起動した人/);assert.equal(empty.posts().length,0);
  const loadedEmpty=await fixture({noProject:true,catalogProjects:[],availability:{registeredProjectsConfigured:false,workerConfigured:false,mode:"unavailable"}});
  await loadedEmpty.connect();assert.match(loadedEmpty.$("project-setup-state").textContent,/修復対象.*ありません/);
  assert.equal(loadedEmpty.$("project-scope-reviewed").disabled,true);assert.equal(loadedEmpty.$("project-start").disabled,true);
  assert.equal(loadedEmpty.posts().length,0);
  const hostOnly=await fixture({workerFixture:{available:false,mode:"unavailable",status:"not_configured"},
    availability:{registeredProjectsConfigured:true,workerConfigured:false,mode:"unavailable"}});
  await hostOnly.connect();assert.match(hostOnly.$("project-worker-status").textContent,/未設定|準備.*必要/);
  assert.match(hostOnly.$("project-setup-next").textContent,/選|確認/);assert.equal(hostOnly.$("project-dispatch").disabled,true);
  const configured=await fixture({workerFixture:{available:true,mode:"official_codex_cli",status:"configured_not_preflighted"},
    availability:{registeredProjectsConfigured:true,workerConfigured:true,mode:"official_codex_cli"}});
  await configured.connect();assert.match(configured.$("project-worker-status").textContent,/実行時|起動時/);
  assert.doesNotMatch(configured.$("project-worker-status").textContent,/接続成功|認証済み|ログイン確認済み/);
  assert.equal(configured.posts().length,0);
});
