import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

// Bounded DOM/API fixtures only. No browser, server, model, credentials or provider.
const html=readFileSync(new URL("../../mini/public/experience.html",import.meta.url),"utf8");
const experienceScript=readFileSync(new URL("../../mini/public/experience.js",import.meta.url),"utf8");
const villageScript=readFileSync(new URL("../../mini/public/village-ui.js",import.meta.url),"utf8");
const copy=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const textOf=node=>node.textContent+node.children.map(textOf).join("\n");
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const buttons=node=>descendants(node).filter(child=>child.tagName==="BUTTON");
const optionIds=node=>node.children.map(child=>child.value);

function dom(){
  const elements=new Map(),all=[];
  class Element{
    constructor(tag="div"){
      this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.value="";
      this.textContent="";this.disabled=false;this.checked=false;this.hidden=false;
      this.classList={toggle(){},add(){},remove(){}};this.dataset={};all.push(this);
    }
    append(...nodes){
      const empty=this.children.length===0;this.children.push(...nodes);
      if(this.tagName==="SELECT"&&empty)this.value=this.children[0]?.value||"";
    }
    replaceChildren(...nodes){
      this.children=[...nodes];this.textContent="";
      if(this.tagName==="SELECT")this.value=this.children[0]?.value||"";
    }
    get childElementCount(){return this.children.length;}
    get options(){return this.children;}
    addEventListener(type,listener){(this.listeners[type]??=[]).push(listener);}
    async emit(type,{force=false}={}){
      if(type==="click"&&this.disabled&&!force)return;
      for(const listener of this.listeners[type]||[])
        await listener({target:this,currentTarget:this,preventDefault(){}});
    }
    setAttribute(name,value){this[name]=String(value);}
    scrollIntoView(){}
    focus(){}
    set innerHTML(_){throw Error("Untrusted content must be rendered as text");}
  }
  for(const match of html.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
    const node=new Element(match[1]);node.id=match[2];
    node.value=match[0].match(/\bvalue="([^"]*)"/)?.[1]||"";
    node.disabled=/\sdisabled(?:\s|>)/.test(match[0]);elements.set(node.id,node);
  }
  for(const match of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
    const select=elements.get(match[1]);
    for(const option of match[2].matchAll(/<option\b[^>]*\bvalue="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)){
      const node=new Element("option");node.value=option[1];node.textContent=option[2];select.append(node);
      if(/\sselected(?:\s|>)/.test(option[0]))select.value=node.value;
    }
  }
  const $=id=>{assert.ok(elements.has(id),"Unknown element "+id);return elements.get(id);};
  return {$,elements,document:{getElementById:$,createElement:tag=>new Element(tag),
    querySelectorAll:selector=>selector==="button"?all.filter(node=>node.tagName==="BUTTON"):[]}};
}

const source=id=>({id:"message_"+id,body:"Gateway source for "+id,bodySha256:"sha_"+id});
const inheritedKnowledge={id:"inherited_"+"a".repeat(64),text:"Selected inherited <img> reference",
  sourceVillage:"village-2",adoptedIn:null,
  inheritance:{kind:"selected_reference",sourceKnowledgeId:"knowledge_from_parent"}};
const bundle=(extra={})=>({newVillageId:"dynamic-a",displayName:"Dynamic fixture village",status:"running",
  destination:"C:/fixture/villages/dynamic-a",seed:{purpose:"A separate dynamic purpose",
    inheritedGoal:{text:"Inherited goal selected by the owner"},knowledge:[copy(inheritedKnowledge)]},...extra});
const savedWork=(villageId="dynamic-a")=>({id:"saved_"+villageId,villageId,goal:"Persisted goal for "+villageId,
  sourceMessage:source(villageId),knowledge:[],runId:"saved_run",stage:"interrupted",
  nextAction:"select_ai_and_explicitly_resume",attempts:[],executions:[],result:null,sharingCandidate:null});
function registry(){
  const village=(id,extra={})=>({id,name:id,knowledge:[],incoming:[],events:[],gatewayFilterLevel:2,
    transport:{motherAInbox:0,motherBInbox:0,gatewayJobs:0},...extra});
  return {square:[{id:"rumor_dynamic",originVillage:"dynamic-a",originCore:"A",body:"Dynamic source Rumor fixture",sha256:"b".repeat(64)}],
    villages:{"village-1":village("village-1"),"village-2":village("village-2"),
      "dynamic-a":village("dynamic-a",{name:"Dynamic fixture village",dynamic:true,available:true,inheritance:copy(bundle().seed)}),
      "dynamic-offline":village("dynamic-offline",{name:"Unavailable fixture village",dynamic:true,available:false,
        inheritance:{purpose:"Read-only unavailable purpose",inheritedGoal:null,knowledge:[]}})}};
}

async function experienceFixture({works=[],authorized=true,state=registry()}={}){
  const h=dom(),requests=[],stored=new Map(works.map(work=>[work.id,copy(work)]));
  let projectOptions,villageOptions,operator="fixture-owner-one";
  const owner={hasOperator:()=>authorized,isBusy:()=>false,sync(){},update(){},reloadCatalog:async()=>{},
    headers:()=>({"Content-Type":"application/json","X-Metron-Mini":"1","X-Metron-Project-Operator":operator})};
  const response=value=>({ok:true,json:async()=>copy(value)});
  const workState=(villageId,workId)=>{
    const village=state.villages[villageId];assert.ok(village,"Unknown fixture village "+villageId);
    const list=[...stored.values()].filter(work=>work.villageId===villageId);
    return {villageId,dynamic:village.dynamic===true,available:village.available!==false,
      inheritance:copy(village.inheritance||null),sources:[source(villageId)],
      knowledge:village.dynamic?[copy(inheritedKnowledge)]:[],
      works:list.map(work=>({id:work.id,goal:work.goal,stage:work.stage,runId:work.runId,attemptsCount:work.attempts.length})),
      work:copy((workId?list.find(work=>work.id===workId):list.at(-1))||null)};
  };
  async function fetch(url,init={}){
    const target=new URL(url,"http://fixture.invalid"),body=init.body?JSON.parse(init.body):null;
    requests.push({path:target.pathname,query:target.searchParams,method:init.method||"GET",body,
      headers:init.headers?copy(init.headers):undefined});
    if(target.pathname==="/api/civilization/state")return response(state);
    if(target.pathname==="/api/advanced/status")return response({providers:{}});
    if(target.pathname==="/api/agent/status")return response({configured:{ollama:false,openai:false}});
    if(target.pathname==="/api/work/state")return response(workState(target.searchParams.get("villageId"),target.searchParams.get("workId")));
    if(target.pathname==="/api/work/action"){
      assert.equal(body.action,"create","Fixture permits only an explicit work create");
      const work={...savedWork(body.villageId),id:"work_created",goal:body.goal,stage:"ready",runId:null,
        sourceMessage:source(body.villageId),knowledge:body.knowledgeIds.includes(inheritedKnowledge.id)?[copy(inheritedKnowledge)]:[]};
      stored.set(work.id,work);return response({work});
    }
    if(target.pathname==="/api/civilization/action"){
      if(body.action==="publish")state.square.push({id:"rumor_published",originVillage:body.from,originCore:"A",body:body.text,sha256:"c".repeat(64)});
      else if(body.action==="receive"){
        const rumor=state.square.find(item=>item.id===body.rumorId);assert.ok(rumor);
        state.villages[body.villageId].incoming.push({rumorId:rumor.id,sourceVillage:rumor.originVillage,status:"pending"});
      }else if(body.action==="review"){
        const entry=state.villages[body.villageId].incoming.find(item=>item.rumorId===body.rumorId);assert.ok(entry);
        entry.status=body.decision==="adopt"?"adopted":"quarantined";
      }else assert.fail("Unexpected civilization mutation "+body.action);
      return response({state});
    }
    throw Error("Unexpected fixture API request "+target.pathname);
  }
  const context=vm.createContext({document:h.document,fetch,URLSearchParams,
    createMetronProjectUi:options=>{projectOptions=options;return owner;},
    createMetronVillageUi:options=>{villageOptions=options;return {sync(){},isBusy:()=>false,ownerChanged:async()=>{},reload:async()=>{}};}});
  vm.runInContext(experienceScript,context);await settle();
  assert.ok(villageOptions,"Experience must connect the public village widget");
  return {...h,requests,state,stored,posts:()=>requests.filter(item=>item.method==="POST"),
    open:async selected=>{assert.equal(typeof villageOptions.onOpenWork,"function");await villageOptions.onOpenWork(copy(selected));await settle();},
    changed:async()=>{assert.equal(typeof villageOptions.onChanged,"function");await villageOptions.onChanged();await settle();},
    select:async(id,value)=>{h.$(id).value=value;await h.$(id).emit("change");await settle();},
    rotateHeader:value=>{operator=value;},
    setOwner:async value=>{authorized=value;await projectOptions.onOwnerChange?.();await settle();}};
}

async function widgetFixture({status="running",authorized=true}={}){
  const h=dom(),requests=[],opened=[],changes=[];let current=bundle({status}),counter=0;
  h.$("village-new-id").value="next-village";h.$("village-directory").value="next-village";
  h.$("village-purpose").value="Explicit next purpose";h.$("village-reason").value="Owner pause";
  const response=value=>({ok:true,json:async()=>copy(value)});
  const fetch=async(url,init={})=>{
    const target=new URL(url,"http://fixture.invalid"),body=init.body?JSON.parse(init.body):null;
    requests.push({path:target.pathname,body,headers:copy(init.headers)});
    if(target.pathname==="/api/village/catalog")return response({baseRoot:"C:/fixture/villages",sourceVersion:1,bundles:[current],
      source:{villageId:"village-1",works:[],work:null,knowledge:[]}});
    if(target.pathname==="/api/village/state")return response({bundle:current,runtime:current.status==="running"?{modelCalls:0}:null});
    assert.equal(target.pathname,"/api/village/action");assert.equal(body.action,"stop");
    current={...current,status:"stopped"};return response({bundle:current,runtime:null});
  };
  const context=vm.createContext({document:h.document,fetch,URLSearchParams,
    crypto:{randomUUID:()=>String(++counter).padStart(32,"0")}});
  vm.runInContext(villageScript,context);
  const ui=context.createMetronVillageUi({owner:{hasOperator:()=>authorized,
    headers:()=>({"X-Metron-Project-Operator":"fixture-owner-only"})},
    onOpenWork:selected=>opened.push(copy(selected)),onChanged:(...args)=>changes.push(args)});
  const load=async()=>{await ui.ownerChanged();if(authorized){h.$("village-saved").value=current.newVillageId;await h.$("village-saved").emit("change");}await settle();};
  await load();
  return {...h,ui,requests,opened,changes,load,setOwner:value=>{authorized=value;},posts:()=>requests.filter(item=>item.body)};
}

test("all village selectors use the registry, retain their IDs, and keep independent legacy Rumor defaults",async()=>{
  const h=await experienceFixture(),ids=["work-village","village-source-village","rumor-source-village","rumor-recipient-village"];
  for(const id of ids)assert.deepEqual(optionIds(h.$(id)),Object.keys(h.state.villages),id);
  assert.equal(h.$("rumor-source-village").value,"village-1");
  assert.equal(h.$("rumor-recipient-village").value,"village-2");
  for(const id of ids)await h.select(id,"dynamic-a");
  h.state.villages["dynamic-b"]={...copy(h.state.villages["dynamic-a"]),id:"dynamic-b",name:"Another dynamic village"};
  await h.changed();
  for(const id of ids){
    assert.ok(optionIds(h.$(id)).includes("dynamic-b"),id);
    assert.equal(h.$(id).value,"dynamic-a",id+" must preserve selection during registry refresh");
  }
  assert.equal(h.posts().length,0,"registry refresh and selector changes only read");
});

test("opening a bundle is explicit, running-only and owner-only; changes notify the host",async()=>{
  for(const status of ["prepared","stopped","cancelled"]){
    const h=await widgetFixture({status});assert.equal(h.$("village-open-work").disabled,true,status);
    await h.$("village-open-work").emit("click",{force:true});assert.equal(h.opened.length,0,status);
    assert.equal(h.posts().length,0,status);
  }
  const h=await widgetFixture({authorized:false});
  assert.equal(h.$("village-open-work").disabled,true);assert.equal(h.requests.length,0);
  h.setOwner(true);await h.load();assert.equal(h.$("village-open-work").disabled,false);
  await h.$("village-open-work").emit("click");
  assert.equal(h.opened.length,1);assert.equal(h.opened[0].newVillageId,"dynamic-a");assert.equal(h.posts().length,0);
  const before=h.changes.length;
  h.$("village-action-reviewed").checked=true;await h.$("village-action-reviewed").emit("change");
  await h.$("village-stop").emit("click");await settle();
  assert.equal(h.changes.length,before+1);assert.equal(h.$("village-open-work").disabled,true);
  assert.deepEqual(h.posts().map(item=>item.body.action),["stop"]);
});

test("opening new work reads the chosen bundle, clears consent, and leaves inherited references unchecked",async()=>{
  for(const inheritedGoal of [{text:"Inherited owner goal"},null]){
    const h=await experienceFixture(),selected=bundle({seed:{purpose:"Fallback separate purpose",inheritedGoal,knowledge:[copy(inheritedKnowledge)]}});
    h.$("agent-goal").value="Unsaved previous-village text";
    h.$("agent-cloud-consent").checked=true;h.$("work-publish-reviewed").checked=true;
    await h.open(selected);
    assert.equal(h.$("work-village").value,"dynamic-a");
    assert.equal(h.$("agent-goal").value,inheritedGoal?.text||selected.seed.purpose);
    assert.equal(h.$("agent-cloud-consent").checked,false);assert.equal(h.$("work-publish-reviewed").checked,false);
    assert.equal(h.$("work-saved").value,"");assert.equal(h.$("work-source").value,"");
    const row=h.$("work-knowledge").children.find(node=>descendants(node).some(child=>child.value===inheritedKnowledge.id));
    assert.ok(row,"Selected inheritance must remain an explicit knowledge choice");
    assert.match(textOf(row),/継承参照/);assert.match(textOf(row),/Selected inherited <img> reference/);
    assert.equal(descendants(row).find(child=>child.value===inheritedKnowledge.id).checked,false);
    assert.equal(h.requests.filter(item=>item.path==="/api/work/state").at(-1).query.get("villageId"),"dynamic-a");
    assert.equal(h.posts().length,0,"opening work must not create, run, publish, receive or adopt");
  }
});

test("opening a bundle retains persisted work and its goal instead of replacing it with the seed",async()=>{
  const work=savedWork(),h=await experienceFixture({works:[work]});
  h.$("agent-cloud-consent").checked=true;h.$("work-publish-reviewed").checked=true;
  await h.open(bundle());
  assert.equal(h.$("work-village").value,work.villageId);assert.equal(h.$("work-saved").value,work.id);
  assert.equal(h.$("agent-goal").value,work.goal);assert.match(h.$("work-readback").textContent,/Persisted goal for dynamic-a/);
  assert.equal(h.$("agent-cloud-consent").checked,false);assert.equal(h.$("work-publish-reviewed").checked,false);
  assert.equal(h.posts().length,0);
});

test("dynamic mutations use current owner headers while unavailable or unowned villages remain readable",async()=>{
  const h=await experienceFixture();await h.select("work-village","dynamic-a");
  h.$("work-source").value="message_dynamic-a";await h.$("work-source").emit("change");
  h.$("agent-goal").value="Explicit dynamic work goal";await h.$("agent-goal").emit("input");
  h.rotateHeader("fixture-owner-current-work");await h.$("create-work").emit("click");await settle();
  assert.equal(h.posts().length,1);assert.equal(h.posts()[0].path,"/api/work/action");
  assert.equal(h.posts()[0].body.villageId,"dynamic-a");assert.deepEqual(h.posts()[0].body.knowledgeIds,[]);
  assert.equal(h.posts()[0].headers["X-Metron-Project-Operator"],"fixture-owner-current-work");
  await h.select("rumor-source-village","dynamic-a");h.$("rumor-text").value="Explicit dynamic Rumor";
  h.rotateHeader("fixture-owner-current-rumor");await h.$("share-knowledge").emit("click");await settle();
  assert.equal(h.posts().at(-1).body.from,"dynamic-a");
  assert.equal(h.posts().at(-1).headers["X-Metron-Project-Operator"],"fixture-owner-current-rumor");
  for(const [villageId,authorized] of [["dynamic-offline",true],["dynamic-a",false]]){
    const denied=await experienceFixture({authorized});await denied.select("work-village",villageId);
    assert.ok(denied.requests.some(item=>item.path==="/api/work/state"&&item.query.get("villageId")===villageId));
    denied.$("work-source").value="message_"+villageId;await denied.$("work-source").emit("change");
    denied.$("agent-goal").value="Readable but not authorized to mutate";await denied.$("agent-goal").emit("input");
    assert.equal(denied.$("create-work").disabled,true);
    await denied.$("create-work").emit("click",{force:true});await settle();
    await denied.select("rumor-source-village",villageId);denied.$("rumor-text").value="Must not publish";
    await denied.$("share-knowledge").emit("click",{force:true});await settle();assert.equal(denied.posts().length,0);
    const resumed=await experienceFixture({authorized,works:[savedWork(villageId)]});await resumed.select("work-village",villageId);
    assert.equal(resumed.$("try-agentic-repair").disabled,true);
    await resumed.$("try-agentic-repair").emit("click",{force:true});await settle();assert.equal(resumed.posts().length,0);
  }
});

test("selected Rumor source and recipient require separate explicit publish, receive and review actions",async()=>{
  const h=await experienceFixture();await h.select("rumor-source-village","dynamic-a");
  await h.select("rumor-recipient-village","village-1");
  assert.equal(h.posts().length,0,"choosing a Rumor route never sends or reviews");
  h.$("rumor-text").value="An explicitly selected dynamic publication";
  await h.$("share-knowledge").emit("click");await settle();
  assert.deepEqual(h.posts().map(item=>item.body),[{action:"publish",from:"dynamic-a",text:h.$("rumor-text").value}]);
  const card=h.$("square-proposals").children.find(node=>textOf(node).includes("Dynamic source Rumor fixture"));
  assert.ok(card);assert.equal(buttons(card).length,1);await buttons(card)[0].emit("click");await settle();
  assert.deepEqual(h.posts().at(-1).body,{action:"receive",villageId:"village-1",rumorId:"rumor_dynamic"});
  assert.deepEqual(h.posts().map(item=>item.body.action),["publish","receive"],"receiving never adopts automatically");
  const incoming=h.$("village-incoming").children.find(node=>textOf(node).includes("Dynamic source Rumor fixture"));
  assert.ok(incoming);assert.equal(buttons(incoming).length,2);await buttons(incoming)[0].emit("click");await settle();
  assert.deepEqual(h.posts().at(-1).body,{action:"review",villageId:"village-1",rumorId:"rumor_dynamic",decision:"adopt"});
  assert.deepEqual(h.posts().map(item=>item.path),Array(3).fill("/api/civilization/action"));
});
