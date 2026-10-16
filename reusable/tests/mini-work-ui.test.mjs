import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

// DOM/API fixtures only: no browser, server, model, credentials or provider call.
const html=readFileSync(new URL("../../mini/public/experience.html",import.meta.url),"utf8");
const script=readFileSync(new URL("../../mini/public/experience.js",import.meta.url),"utf8");
const copy=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
const source=village=>({id:"message_"+village,body:"Gateway reply for "+village,bodySha256:"sha_"+village});
function savedWork(villageId="village-1",extra={}){
  return {id:"work_"+villageId,villageId,goal:"Saved goal for "+villageId,
    sourceMessage:source(villageId),knowledge:[{id:"adopted_snapshot",text:"Saved adopted knowledge",sourceVillage:"village-2"}],
    runId:"case_saved",stage:"interrupted",nextAction:"select_ai_and_explicitly_resume",
    attempts:[],executions:[],result:null,sharingCandidate:null,...extra};
}
async function fixture({works=[],onRun,onCivilizationAction,onPublish}={}){
  const elements=new Map(),all=[];
  class Element{
    constructor(tag){
      this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.value="";
      this.textContent="";this.disabled=false;this.checked=false;this.hidden=false;
      this.classList={toggle(){}};all.push(this);
    }
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=[...nodes];}
    get childElementCount(){return this.children.length;}
    addEventListener(type,listener){(this.listeners[type]??=[]).push(listener);}
    async emit(type){
      if(type==="click"&&this.disabled)return;
      await Promise.all((this.listeners[type]||[]).map(listener=>listener({target:this})));
    }
    set innerHTML(_){throw Error("User content must be rendered as text");}
  }
  for(const match of html.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
    const node=new Element(match[1]);node.id=match[2];elements.set(node.id,node);
  }
  const $=id=>{assert.ok(elements.has(id),"Unknown element "+id);return elements.get(id);};
  $("work-village").value="village-1";$("agent-model").value="auto";
  const document={getElementById:$,createElement:tag=>new Element(tag),
    querySelectorAll:selector=>selector==="button"?all.filter(x=>x.tagName==="BUTTON"):[]};
  const villages=Object.fromEntries(["village-1","village-2"].map(id=>[id,{
    villageId:id,sources:[source(id)],knowledge:[
      {id:"knowledge_"+id,text:"Adopted knowledge in "+id,sourceVillage:id,parentRumorId:"rumor_original"},
      {id:"knowledge_second_"+id,text:"Another adopted item",sourceVillage:id}
    ]
  }]));
  const stored=new Map(works.map(work=>[work.id,copy(work)]));
  const requests=[];
  const civilization={square:[],villages:Object.fromEntries(Object.keys(villages).map(id=>[id,{
    name:id,knowledge:[],incoming:[],events:[],gatewayFilterLevel:2,
    transport:{motherAInbox:0,motherBInbox:0,gatewayJobs:0}
  }]))};
  function workState(villageId,workId){
    const list=[...stored.values()].filter(work=>work.villageId===villageId);
    return {...copy(villages[villageId]),works:list.map(work=>({
      id:work.id,goal:work.goal,stage:work.stage,nextAction:work.nextAction,
      runId:work.runId,attemptsCount:work.attempts.length
    })),work:copy((workId?list.find(work=>work.id===workId):list.at(-1))||null)};
  }
  const response=data=>({ok:true,json:async()=>copy(data)});
  async function fetch(url,init={}){
    const target=new URL(url,"http://fixture.invalid");
    const body=init.body?JSON.parse(init.body):null;
    requests.push({path:target.pathname,query:target.searchParams,method:init.method||"GET",body,headers:init.headers});
    if(target.pathname==="/api/civilization/state")return response(civilization);
    if(target.pathname==="/api/advanced/status")return response({providers:{}});
    if(target.pathname==="/api/agent/status")return response({configured:{ollama:false,openai:false}});
    if(target.pathname==="/api/work/state")
      return response(workState(target.searchParams.get("villageId"),target.searchParams.get("workId")));
    if(target.pathname==="/api/work/action"){
      if(body.action==="create"){
        const village=villages[body.villageId];
        const work=savedWork(body.villageId,{id:"work_created",goal:body.goal,
          sourceMessage:copy(village.sources.find(item=>item.id===body.sourceMessageId)),
          knowledge:copy(village.knowledge.filter(item=>body.knowledgeIds.includes(item.id))),
          stage:"ready",nextAction:"select_ai_and_run",runId:null});
        stored.set(work.id,work);return response({work});
      }
      const work=stored.get(body.workId);
      if(body.action==="publish-share"){
        assert.ok(onPublish,"A fixture must explicitly opt into publication");
        const result=await onPublish(body,copy(work));
        if(result.work)stored.set(result.work.id,copy(result.work));
        return response(result);
      }
      assert.equal(body.action,"prepare-share");
      work.sharingCandidate={...work.sharingCandidate,body:body.body,status:"human_review_required"};
      if(body.repairSummary)work.sharingCandidate.rumor={...work.sharingCandidate.rumor,
        schemaVersion:"metron-rumor-v2",originVillage:work.villageId,body:body.body,
        sha256:"b".repeat(64),repairEvidence:{schemaVersion:1,...body.repairSummary}};
      return response({work});
    }
    if(target.pathname==="/api/agent/run"){
      assert.ok(onRun,"A fixture must explicitly opt into a simulated run");
      const result=await onRun(body,copy(stored.get(body.workId)));
      if(result.work)stored.set(result.work.id,copy(result.work));
      return response(result);
    }
    if(target.pathname==="/api/civilization/action"){
      assert.equal(body.action,"review");
      if(onCivilizationAction)await onCivilizationAction(body);
      villages[body.villageId].knowledge.push({id:"newly_adopted",text:"Newly adopted Rumor",sourceVillage:"village-1"});
      return response({state:civilization});
    }
    throw Error("Unexpected API request "+target.pathname);
  }
  const context=vm.createContext({document,fetch,URLSearchParams});
  vm.runInContext(script,context);
  await settle();
  return {$,context,requests,stored,villages,civilization,
    posts:()=>requests.filter(item=>item.method==="POST"),
    knowledgeInputs:()=>$("work-knowledge").children.filter(item=>item.tagName==="LABEL").map(item=>item.children[0])};
}

function verifiedShareWork(villageId="village-1",extra={}){
  const work=savedWork(villageId,{stage:"candidate_verified",result:{status:"verified_candidate"},...extra});
  const repairEvidence={schemaVersion:1,scope:"human_reviewed_external_worker",
    diagnosis:"Observed <img> root cause",applicability:"Only the pinned local project",limitations:"Production remains unverified",
    candidateCommit:"c".repeat(40),candidateDigest:null,diffSha256:"d".repeat(64),verificationDigest:"e".repeat(64),
    modelProvenance:"protocol_fixture_not_real_ai",checks:[{id:"regression",outcome:"passed",outputSha256:"f".repeat(64)}],
    productionApplied:false};
  const rumor={schemaVersion:"metron-rumor-v2",id:"r_reviewed",originVillage:villageId,originCore:"A",kind:"KNOWLEDGE",
    body:"Human-reviewed repair result",parentRumorId:"r_parent",createdAt:1,sha256:"a".repeat(64),repairEvidence};
  work.sharingCandidate={status:"human_review_required",workId:work.id,runId:work.runId,body:rumor.body,rumor};
  return work;
}
const publishReview=async h=>{h.$("work-publish-reviewed").checked=true;await h.$("work-publish-reviewed").emit("change");};
const publishedResponse=(body,work)=>({work:{...work,publication:{schemaVersion:1,status:"published",
  rumor:work.sharingCandidate.rumor,rumorSha256:body.reviewedRumorSha256,intentAt:1,completedAt:2}},
  rumor:work.sharingCandidate.rumor,duplicate:false});
const textOf=node=>node.textContent+node.children.map(textOf).join("\n");

test("repair summary is all-or-empty, saved privately, and editing consumes publication review",async()=>{
  const work=verifiedShareWork(),h=await fixture({works:[work]});
  for(const id of ["work-share-diagnosis","work-share-applicability","work-share-limitations"])
    h.$(id).value="";
  h.$("work-share-diagnosis").value="Observed cause";await h.$("work-share-diagnosis").emit("input");
  await h.$("save-work-share").emit("click");await settle();
  assert.equal(h.posts().length,0);assert.match(h.$("work-notice").textContent,/すべて/);
  h.$("work-share-applicability").value="Pinned project only";
  h.$("work-share-limitations").value="No production application";
  await h.$("work-share-limitations").emit("input");
  await h.$("save-work-share").emit("click");await settle();
  assert.deepEqual(h.posts().map(x=>x.body),[{action:"prepare-share",villageId:work.villageId,workId:work.id,
    body:work.sharingCandidate.body,repairSummary:{diagnosis:"Observed cause",applicability:"Pinned project only",limitations:"No production application"}}]);
  assert.equal(h.$("work-publish-reviewed").checked,false);assert.equal(h.$("publish-work-share").disabled,true);
  await publishReview(h);assert.equal(h.$("publish-work-share").disabled,false);
  h.$("work-share-limitations").value="Changed limitation";await h.$("work-share-limitations").emit("input");
  assert.equal(h.$("work-publish-reviewed").checked,false);assert.equal(h.$("publish-work-share").disabled,true);
  await h.$("refresh-work").emit("click");await settle();
  assert.equal(h.$("work-share-limitations").value,"Changed limitation");
  assert.equal(h.posts().length,1,"saving or reading a draft must not publish");
});

test("publication requires exact prepared bytes and separate review, then freezes the stable Rumor",async()=>{
  const work=verifiedShareWork(),h=await fixture({works:[work],onPublish:publishedResponse});
  assert.equal(h.posts().length,0);assert.match(h.$("work-share-evidence").textContent,/verificationDigest/);
  assert.equal(h.$("work-share-diagnosis").value,work.sharingCandidate.rumor.repairEvidence.diagnosis);
  h.$("agent-cloud-consent").checked=true;
  assert.equal(h.$("publish-work-share").disabled,true,"AI consent cannot authorize publication");
  await publishReview(h);assert.equal(h.$("publish-work-share").disabled,false);
  h.$("work-share-body").value="Unprepared replacement";
  await h.$("publish-work-share").emit("click");await settle();
  assert.equal(h.posts().length,0,"a programmatic value change cannot publish old prepared bytes");
  assert.equal(h.$("work-publish-reviewed").checked,false);
  h.$("work-share-body").value=work.sharingCandidate.body;await publishReview(h);
  await h.$("publish-work-share").emit("click");await settle();
  assert.deepEqual(h.posts().map(x=>x.body),[{action:"publish-share",villageId:work.villageId,workId:work.id,
    reviewedRumorSha256:work.sharingCandidate.rumor.sha256,allowPublish:true}]);
  assert.equal(h.$("work-publish-reviewed").checked,false);
  for(const id of ["work-share-body","work-share-diagnosis","work-share-applicability","work-share-limitations","save-work-share","publish-work-share"])
    assert.equal(h.$(id).disabled,true,id);
  assert.match(h.$("work-publication-status").textContent,/r_reviewed/);
  await h.$("refresh-work").emit("click");await settle();
  assert.equal(h.posts().length,1);assert.match(h.$("work-publication-status").textContent,/r_reviewed/);
});

test("publication rejects V1, unverified stages, dirty drafts and mismatched selected work",async()=>{
  for(const change of [work=>{work.sharingCandidate.rumor.schemaVersion="metron-rumor-v1";},
    work=>{work.stage="unresolved";},work=>{work.result.status="unresolved";}]){
    const work=verifiedShareWork();change(work);const h=await fixture({works:[work]});
    await publishReview(h);assert.equal(h.$("publish-work-share").disabled,true);assert.equal(h.posts().length,0);
  }
  const dirty=await fixture({works:[verifiedShareWork()]});await publishReview(dirty);
  await dirty.$("work-share-body").emit("input");
  assert.equal(dirty.$("publish-work-share").disabled,true);assert.equal(dirty.$("work-publish-reviewed").checked,false);
  for(const target of ["work-village","work-saved"]){
    const h=await fixture({works:[verifiedShareWork()]});await publishReview(h);
    h.$(target).value=target==="work-village"?"village-2":"different_work_id";
    h.$("publish-work-share").disabled=false;
    await h.$("publish-work-share").emit("click");await settle();assert.equal(h.posts().length,0,target);
  }
});

test("uncertain publication requires a fresh explicit same-SHA retry and never resends on refresh",async()=>{
  let attempts=0;const work=verifiedShareWork(),h=await fixture({works:[work],onPublish:(body,current)=>{
    if(++attempts===1)throw Error("Fixture connection lost after request");
    return publishedResponse(body,current);
  }});
  await publishReview(h);await h.$("publish-work-share").emit("click");await settle();
  assert.equal(h.posts().length,1);assert.equal(h.$("work-publish-reviewed").checked,false);
  assert.equal(h.$("publish-work-share").disabled,true);assert.equal(h.$("work-share-body").disabled,true);
  assert.match(h.$("work-publication-status").textContent,/自動で再送しません/);
  await h.$("refresh-work").emit("click");await settle();assert.equal(h.posts().length,1);
  await publishReview(h);await h.$("publish-work-share").emit("click");await settle();
  assert.equal(h.posts().length,2);assert.deepEqual(h.posts()[1].body,h.posts()[0].body);
  assert.equal(h.$("work-publish-reviewed").checked,false);
});

test("saved publication intent permits only the same SHA, while selection changes consume review",async()=>{
  const work=verifiedShareWork();work.publication={schemaVersion:1,status:"intent",rumor:work.sharingCandidate.rumor,
    rumorSha256:work.sharingCandidate.rumor.sha256,intentAt:1,completedAt:null};
  const h=await fixture({works:[work,verifiedShareWork("village-2")],onPublish:publishedResponse});
  assert.equal(h.posts().length,0);assert.equal(h.$("work-share-body").disabled,true);
  await publishReview(h);assert.equal(h.$("publish-work-share").disabled,false);
  h.$("work-village").value="village-2";await h.$("work-village").emit("change");await settle();
  assert.equal(h.$("work-publish-reviewed").checked,false);assert.equal(h.posts().length,0);
  await publishReview(h);h.$("work-saved").value="";await h.$("work-saved").emit("change");await settle();
  assert.equal(h.$("work-publish-reviewed").checked,false);assert.equal(h.posts().length,0);
  const changed=verifiedShareWork();changed.publication={...work.publication,rumorSha256:"0".repeat(64)};
  const mismatch=await fixture({works:[changed]});await publishReview(mismatch);
  assert.equal(mismatch.$("publish-work-share").disabled,true);assert.equal(mismatch.posts().length,0);
});

test("repair evidence remains plain text with origin, parent and receiver-verification boundaries",async()=>{
  const work=verifiedShareWork(),rumor=work.sharingCandidate.rumor,h=await fixture({works:[work]});
  const item={id:"knowledge_repair",text:rumor.body,sourceVillage:rumor.originVillage,parentRumorId:rumor.id,
    rumorSha256:rumor.sha256,repairEvidence:rumor.repairEvidence};
  h.civilization.square.push(rumor);
  h.civilization.villages["village-2"].incoming.push({rumorId:rumor.id,sourceVillage:rumor.originVillage,status:"adopted"});
  h.civilization.villages["village-2"].knowledge.push(item);
  h.villages["village-1"].knowledge.push(item);
  vm.runInContext("render("+JSON.stringify(h.civilization)+")",h.context);
  await h.$("refresh-work").emit("click");await settle();
  for(const id of ["square-proposals","village-incoming","village-memories","work-knowledge"]){
    const text=textOf(h.$(id));
    assert.match(text,/Observed <img> root cause/,id);assert.match(text,/送信元の認証ではありません/,id);
    assert.match(text,/受信側で検証済みという意味ではありません/,id);assert.match(text,/village-1/,id);
    assert.match(text,id==="square-proposals"||id==="village-incoming"?/r_parent/:/r_reviewed/,id);
  }
  assert.equal(h.posts().length,0);
});

test("work reload reads saved context and model changes never start or resume AI",async()=>{
  const work=savedWork("village-1",{sourceMessage:{id:"historic_reply",body:"<img> persisted source",bodySha256:"saved_sha"}});
  const h=await fixture({works:[work]});
  assert.equal(h.posts().length,0);
  assert.match(h.$("work-readback").textContent,/Saved goal for village-1/);
  assert.match(h.$("work-readback").textContent,/<img> persisted source/);
  assert.match(h.$("work-readback").textContent,/saved_sha/);
  assert.match(h.$("work-readback").textContent,/Saved adopted knowledge/);
  assert.equal(h.$("agent-resume-id").value,"case_saved");
  assert.match(html,/<input id="agent-resume-id"[^>]*readonly/);
  h.$("agent-model").value="openai";await h.$("agent-model").emit("change");
  await h.$("refresh-work").emit("click");await settle();
  assert.equal(h.posts().length,0);
  assert.match(h.$("work-readback").textContent,/明示的に再開/);
  assert.equal(h.$("agent-cloud-consent").checked,false);
});

test("create snapshots explicitly selected Gateway source, goal and adopted knowledge without running",async()=>{
  const h=await fixture();
  assert.equal(h.$("try-agentic-repair").disabled,true);
  h.$("work-source").value="message_village-1";await h.$("work-source").emit("change");
  h.$("agent-goal").value="Use the reply and this adopted item to investigate the fixture";
  await h.$("agent-goal").emit("input");h.knowledgeInputs()[1].checked=true;
  assert.match(h.$("work-source-preview").textContent,/sha_village-1/);
  await h.$("create-work").emit("click");await settle();
  assert.equal(h.posts().length,1);
  assert.deepEqual(h.posts()[0].body,{
    action:"create",villageId:"village-1",goal:h.$("agent-goal").value,
    sourceMessageId:"message_village-1",knowledgeIds:["knowledge_second_village-1"]
  });
  assert.equal(h.posts()[0].headers["X-Metron-Mini"],"1");
  assert.equal(h.$("work-saved").value,"work_created");
  assert.match(h.$("work-readback").textContent,/Another adopted item/);
  assert.match(h.$("work-readback").textContent,/sha_village-1/);
  assert.equal(h.$("agent-resume-id").value,"");
});

test("one explicit run sends only saved-work identity and separate provider consent",async()=>{
  let finishRun;
  const waiting=new Promise(resolve=>{finishRun=resolve;});
  const h=await fixture({works:[savedWork()],onRun:async(body,work)=>{
    await waiting;
    const result={status:"unresolved",reason:"Fixture candidate failed public checks"};
    return {work:{...work,stage:"unresolved",nextAction:"select_ai_and_explicitly_resume",
      attempts:[{attempt:1,diagnosis:"Observed failure",publicPassed:false}],executions:[{provider:body.provider}],result},result};
  }});
  h.$("agent-model").value="openai";
  await h.$("try-agentic-repair").emit("click");
  assert.equal(h.posts().length,0);assert.match(h.$("work-notice").textContent,/許可が必要/);
  h.$("agent-cloud-consent").checked=true;
  const pending=h.$("try-agentic-repair").emit("click");await settle();
  await h.$("try-agentic-repair").emit("click");
  assert.equal(h.posts().length,1);
  assert.deepEqual(h.posts()[0].body,{villageId:"village-1",workId:"work_village-1",provider:"openai",allowExternalCalls:true});
  assert.equal(h.$("agent-cloud-consent").checked,false);
  finishRun();await pending;await settle();
  assert.equal(h.posts().length,1);
  assert.match(h.$("work-history").textContent,/Observed failure/);
  assert.match(h.$("agentic-repair-result").textContent,/Fixture candidate failed public checks/);
  assert.equal(h.$("try-agentic-repair").disabled,false);
  await h.$("try-agentic-repair").emit("click");
  assert.equal(h.posts().length,1,"the prior checkbox does not authorize a second OpenAI run");
});

test("auto can run locally without consent and consumes fallback consent for only one run",async()=>{
  const h=await fixture({works:[savedWork()],onRun:async(_,work)=>({
    work:{...work,stage:"unresolved"},result:{status:"unresolved"}})});
  assert.match(html,/Ollama（同意不要）/);assert.match(html,/ローカル実行には不要です/);
  await h.$("try-agentic-repair").emit("click");
  h.$("agent-cloud-consent").checked=true;
  await h.$("try-agentic-repair").emit("click");
  assert.equal(h.$("agent-cloud-consent").checked,false);
  await h.$("try-agentic-repair").emit("click");
  assert.deepEqual(h.posts().map(p=>({provider:p.body.provider,allowExternalCalls:p.body.allowExternalCalls})),[
    {provider:"auto",allowExternalCalls:false},
    {provider:"auto",allowExternalCalls:true},
    {provider:"auto",allowExternalCalls:false}
  ]);
});

test("new work refuses more than five adopted-knowledge selections before saving",async()=>{
  const h=await fixture();
  for(let i=0;i<4;i++)h.villages["village-1"].knowledge.push({id:"extra_"+i,text:"Extra adopted item "+i});
  await h.$("refresh-work").emit("click");await settle();
  h.$("work-source").value="message_village-1";await h.$("work-source").emit("change");
  h.$("agent-goal").value="A bounded work goal";await h.$("agent-goal").emit("input");
  for(const input of h.knowledgeInputs())input.checked=true;
  await h.$("create-work").emit("click");await settle();
  assert.equal(h.posts().length,0);
  assert.match(h.$("work-notice").textContent,/採用済み知識は5件まで/);
});

test("terminal outcomes and four saved attempts prevent another UI run",async()=>{
  for(const stage of ["running","candidate_verified","candidate_rejected","not_reproduced","readback_failed","attempt_budget_exhausted"]){
    const h=await fixture({works:[savedWork("village-1",{stage})]});
    assert.equal(h.$("try-agentic-repair").disabled,true,stage);
    await h.$("try-agentic-repair").emit("click");assert.equal(h.posts().length,0);
  }
  const h=await fixture({works:[savedWork("village-1",{stage:"unresolved",attempts:[{},{},{},{}]})]});
  assert.equal(h.$("try-agentic-repair").disabled,true);
  await h.$("try-agentic-repair").emit("click");assert.equal(h.posts().length,0);
});

test("a fourth retained candidate can explicitly resume verification without external consent",async()=>{
  const work=savedWork("village-1",{verificationPending:true,nextAction:"verify_saved_candidate",
    attempts:[{attempt:1},{attempt:2},{attempt:3},{attempt:4,publicPassed:true}],
    invocationHistory:[{provider:"openai",model:"fixture_model",allowExternalCalls:true,outcome:"interrupted"}]});
  const h=await fixture({works:[work],onRun:async(body,current)=>{
    assert.equal(body.provider,"openai");assert.equal(body.allowExternalCalls,false);
    const result={status:"verified_candidate",productionChanged:false};
    return {work:{...current,verificationPending:false,stage:"candidate_verified",result},result};
  }});
  assert.equal(h.posts().length,0);
  assert.equal(h.$("try-agentic-repair").disabled,false);
  assert.equal(h.$("try-agentic-repair").textContent,"保存した候補の確認検査を再開");
  assert.match(h.$("work-readback").textContent,/AIの新規呼び出しなし/);
  assert.match(h.$("work-history").textContent,/invocationHistory/);
  assert.match(h.$("work-history").textContent,/fixture_model/);
  h.$("agent-model").value="openai";h.$("agent-cloud-consent").checked=false;
  await h.$("try-agentic-repair").emit("click");await settle();
  assert.deepEqual(h.posts().map(item=>item.path),["/api/agent/run"]);
  assert.equal(h.posts()[0].body.allowExternalCalls,false);
  assert.match(h.$("work-notice").textContent,/AIの新規呼び出しは行っていません/);
  assert.equal(h.stored.get(work.id).attempts.length,4);
  assert.equal(h.$("try-agentic-repair").disabled,true);
});

test("verified result opens a human-editable local sharing draft; saving never publishes",async()=>{
  const work=savedWork("village-1",{stage:"candidate_verified",nextAction:"inspect_candidate_and_prepare_share",
    result:{status:"verified_candidate",productionChanged:false},
    sharingCandidate:{body:"Actual verified diagnostic result",status:"human_review_required",workId:"work_village-1",runId:"case_saved",
      evidence:{publicPassed:true,holdoutPassed:true},rumor:{body:"Actual verified diagnostic result"}}});
  const h=await fixture({works:[work]});
  assert.equal(h.$("work-share-body").value,"Actual verified diagnostic result");
  assert.match(h.$("work-share-evidence").textContent,/human_review_required/);
  h.$("work-share-body").value="Human-reviewed <b>plain text</b> candidate";
  await h.$("work-share-body").emit("input");
  await h.$("refresh-work").emit("click");await settle();
  assert.equal(h.$("work-share-body").value,"Human-reviewed <b>plain text</b> candidate");
  await h.$("save-work-share").emit("click");await settle();
  assert.deepEqual(h.posts().map(item=>item.path),["/api/work/action"]);
  assert.deepEqual(h.posts()[0].body,{action:"prepare-share",villageId:"village-1",workId:work.id,body:"Human-reviewed <b>plain text</b> candidate"});
  assert.match(h.$("work-notice").textContent,/公開・受信・採用は行っていません/);
});

test("switching villages opens that village's saved work without retaining external consent",async()=>{
  const h=await fixture({works:[savedWork(),savedWork("village-2")]});
  h.$("agent-cloud-consent").checked=true;
  h.$("work-village").value="village-2";await h.$("work-village").emit("change");await settle();
  assert.equal(h.$("work-saved").value,"work_village-2");
  assert.match(h.$("work-readback").textContent,/Saved goal for village-2/);
  assert.doesNotMatch(h.$("work-readback").textContent,/Saved goal for village-1/);
  assert.equal(h.$("agent-cloud-consent").checked,false);
  assert.equal(h.posts().length,0);
});

test("Rumor review refreshes adopted knowledge but does not run a saved work",async()=>{
  const h=await fixture();
  h.$("work-village").value="village-2";await h.$("work-village").emit("change");await settle();
  const before=h.requests.filter(item=>item.path==="/api/work/state").length;
  await vm.runInContext('act("review",{villageId:"village-2",rumorId:"rumor_test",decision:"adopt"})',h.context);
  await settle();
  assert.equal(h.requests.filter(item=>item.path==="/api/work/state").length,before+1);
  assert.ok(h.knowledgeInputs().some(input=>input.value==="newly_adopted"));
  assert.deepEqual(h.posts().map(item=>item.path),["/api/civilization/action"]);
});

test("a slow civilization action locks village and saved-work selectors",async()=>{
  let release;
  const waiting=new Promise(resolve=>{release=resolve;});
  const h=await fixture({works:[savedWork()],onCivilizationAction:()=>waiting});
  const action=vm.runInContext('act("review",{villageId:"village-2",rumorId:"rumor_test",decision:"adopt"})',h.context);
  await settle();
  assert.equal(h.$("work-village").disabled,true);
  assert.equal(h.$("work-saved").disabled,true);
  assert.equal(h.$("try-agentic-repair").disabled,true);
  release();await action;await settle();
  assert.equal(h.$("work-village").disabled,false);
  assert.equal(h.$("work-saved").disabled,false);
  assert.deepEqual(h.posts().map(item=>item.path),["/api/civilization/action"]);
});

test("programmatic village or work mismatch cannot run or save a sharing draft",async()=>{
  for(const target of ["work-village","work-saved"]){
    const h=await fixture({works:[savedWork()]});
    h.$(target).value=target==="work-village"?"village-2":"different_work_id";
    await h.$("try-agentic-repair").emit("click");await settle();
    assert.equal(h.posts().length,0,target);
    assert.match(h.$("work-notice").textContent,/選択と表示が一致しないため実行しません/);
  }
  const work=savedWork("village-1",{stage:"candidate_verified",result:{status:"verified_candidate"},
    sharingCandidate:{body:"Verified local draft",status:"human_review_required"}});
  const h=await fixture({works:[work]});
  h.$("work-saved").value="different_work_id";
  await h.$("save-work-share").emit("click");await settle();
  assert.equal(h.posts().length,0);
  assert.match(h.$("work-notice").textContent,/選択と表示が一致しないため実行しません/);
});
