import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../../mini/public/experience.html",import.meta.url),"utf8"),script=readFileSync(new URL("../../mini/public/village-ui.js",import.meta.url),"utf8");
const copy=x=>JSON.parse(JSON.stringify(x)),flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
async function fixture({post,authorized=true}={}){
  class Element{constructor(){this.value="";this.checked=false;this.disabled=false;this.children=[];this.textContent="";this.listeners={};}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}addEventListener(t,f){(this.listeners[t]??=[]).push(f);}
    async emit(t){if(t==="click"&&this.disabled)return;for(const f of this.listeners[t]||[])await f({target:this});}set innerHTML(v){throw Error("plain text only");}}
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()])),requests=[];
  const $=id=>{assert.ok(elements.has(id),id);return elements.get(id);};
  $("village-new-id").value="new-purpose";$("village-directory").value="new-purpose-store";$("village-source-village").value="village-1";
  $("village-purpose").value="A separate new purpose";$("village-reason").value="Owner pause";
  let bundle=null,runtime=null,count=0;
  const source={villageId:"village-1",works:[{id:"saved-work",goal:"Prior goal",stage:"candidate_verified",runId:"prior-run"}],work:null,
    knowledge:[{id:"knowledge-one",text:"Reviewed selected knowledge",sourceVillage:"village-2",parentRumorId:"rumor-one",rumorSha256:"a".repeat(64)}]};
  const response=(v,ok=true)=>({ok,json:async()=>copy(v)});
  const seed=s=>({purpose:s.purpose,inheritedGoal:s.inheritGoal?{text:"Prior goal",workId:s.sourceWorkId,runId:"prior-run",villageId:s.sourceVillageId,sha256:"b".repeat(64)}:null,
    sourceMessage:s.inheritSourceMessage?{id:"source-one",text:"<img src=x> original body",sha256:"c".repeat(64),sourceVillageId:s.sourceVillageId,sourceWorkId:s.sourceWorkId}:null,
    knowledge:s.knowledgeIds.length?copy(source.knowledge):[],provenance:{sourceVillageId:s.sourceVillageId,sourceWorkId:s.sourceWorkId??null}});
  async function fetch(path,init={}){assert.ok(authorized,"owner must authorize before any widget request");const body=init.body?JSON.parse(init.body):null;requests.push({path,body,headers:init.headers});
    assert.equal(init.headers["X-Metron-Project-Operator"],"fixture-owner-only");
    if(path.startsWith("/api/village/catalog?")){const q=new URLSearchParams(path.split("?")[1]);return response({baseRoot:"C:/owner/villages",sourceVersion:1,bundles:bundle?[bundle]:[],source:{...source,
      work:q.get("sourceWorkId")?{id:"saved-work",goal:"Prior goal",sourceMessage:{id:"source-one",text:"<img src=x> original body",sha256:"c".repeat(64)}}:null}});}
    if(path.startsWith("/api/village/state?"))return response({bundle,runtime});
    if(path==="/api/village/preview"){if(post){const result=post({path,body,response});if(result)return result;}return response({selection:body,destination:"C:/owner/villages/"+body.directoryName,seed:seed(body),selectionDigest:"d".repeat(64),previewDigest:"e".repeat(64),sourceVersion:1});}
    if(post){const result=post({path,body,response});if(result)return result;}
    if(body.action==="create")bundle={newVillageId:body.newVillageId,destination:"C:/owner/villages/"+body.directoryName,seed:seed(body),previewDigest:body.previewDigest,status:"prepared"};
    else if(body.action==="launch"){bundle.status="running";runtime={newVillageId:bundle.newVillageId,transport:{ships:{A:{},B:{}},gateway:{}},modelCalls:0};}
    else if(body.action==="stop"){bundle.status="stopped";runtime=null;}
    else if(body.action==="cancel")bundle.status="cancelled";
    else if(body.action==="resume")bundle.status="prepared";
    return response({bundle,runtime,duplicate:false});
  }
  const context=vm.createContext({document:{getElementById:$,createElement:()=>new Element()},fetch,URLSearchParams,
    crypto:{randomUUID:()=>String(++count).padStart(32,"0")}});vm.runInContext(script,context);
  const ui=context.createMetronVillageUi({owner:{hasOperator:()=>authorized,headers:()=>({"X-Metron-Project-Operator":"fixture-owner-only"})}});
  return {$,ui,requests,posts:()=>requests.filter(r=>r.body),setOwner:v=>{authorized=v;},bundle:()=>bundle,preview:()=>$("village-preview").emit("click"),
    create:async()=>{await $("village-preview").emit("click");$("village-preview-reviewed").checked=true;await $("village-preview-reviewed").emit("change");await $("village-create").emit("click");}};
}
const textOf=e=>e.textContent+e.children.map(textOf).join("\n");

test("owner connection reads only and preview explicitly selects purpose, body, knowledge and destination without copying authority",async()=>{
  const h=await fixture({authorized:false});assert.equal(h.requests.length,0);assert.equal(h.$("village-create").disabled,true);
  h.setOwner(true);await h.ui.ownerChanged();assert.equal(h.posts().length,0);
  h.$("village-source-work").value="saved-work";await h.$("village-source-work").emit("change");
  h.$("village-inherit-source").checked=true;await h.$("village-inherit-source").emit("change");
  const knowledge=h.$("village-knowledge").children[0].children[0];knowledge.checked=true;await knowledge.emit("change");
  await h.preview();assert.equal(h.posts().length,1);assert.deepEqual(h.posts()[0].body,{newVillageId:"new-purpose",directoryName:"new-purpose-store",sourceVillageId:"village-1",sourceWorkId:"saved-work",
    inheritGoal:false,inheritSourceMessage:true,knowledgeIds:["knowledge-one"],purpose:"A separate new purpose"});
  const shown=textOf(h.$("village-preview-card"));assert.match(shown,/C:\/owner\/villages\/new-purpose-store/);assert.match(shown,/<img src=x> original body/);
  assert.match(shown,/Reviewed selected knowledge/);assert.match(shown,/元の目的: 取り込まない/);assert.equal(shown.includes("fixture-owner-only"),false);
  assert.equal(h.$("village-create").disabled,true);h.$("village-preview-reviewed").checked=true;await h.$("village-preview-reviewed").emit("change");
  await h.$("village-create").emit("click");const created=h.posts().at(-1).body;
  assert.equal(created.action,"create");assert.equal(created.previewDigest,"e".repeat(64));assert.equal(created.dataReviewed,true);assert.equal(created.allowCreate,true);
  assert.equal(h.bundle().status,"prepared");assert.equal(h.posts().filter(r=>r.body.action==="launch").length,0);
  assert.equal(JSON.stringify(created).includes("fixture-owner-only"),false);assert.equal(h.$("village-preview-reviewed").checked,false);
});

test("edits invalidate preview approval and stale preview replies cannot restore it",async()=>{
  let finish,hold=false;const h=await fixture({post:({path,body,response})=>path==="/api/village/preview"&&hold?new Promise(r=>{finish=()=>r(response({selection:body,destination:"stale",seed:{purpose:"old",knowledge:[]},previewDigest:"old"}));}):null});
  await h.ui.ownerChanged();await h.preview();h.$("village-preview-reviewed").checked=true;await h.$("village-preview-reviewed").emit("change");
  h.$("village-purpose").value="New purpose";await h.$("village-purpose").emit("input");assert.equal(h.$("village-create").disabled,true);
  hold=true;const pending=h.preview();await flush();h.$("village-directory").value="changed-directory";await h.$("village-directory").emit("input");
  finish();await pending;assert.equal(h.$("village-preview-reviewed").checked,false);assert.equal(h.$("village-create").disabled,true);assert.equal(textOf(h.$("village-preview-card")).includes("stale"),false);
  assert.equal(h.posts().some(r=>r.body.action==="create"),false);
});

test("unknown create preserves the exact request and requires readback plus a new explicit review before same-ID retry",async()=>{
  let fail=true;const h=await fixture({post:({path,body})=>{if(path==="/api/village/action"&&body.action==="create"&&fail){fail=false;throw Error("connection lost");}}});
  await h.ui.ownerChanged();await h.create();const original=copy(h.posts().at(-1).body);assert.match(h.$("village-notice").textContent,/自動再送しません/);
  assert.equal(h.$("village-retry").disabled,true);const count=h.posts().length;await h.ui.reload();assert.equal(h.posts().length,count);
  h.$("village-action-reviewed").checked=true;await h.$("village-action-reviewed").emit("change");assert.equal(h.$("village-retry").disabled,false);
  await h.$("village-retry").emit("click");assert.deepEqual(h.posts().at(-1).body,original);assert.equal(h.bundle().status,"prepared");
  await h.ui.reload();assert.equal(h.posts().length,count+1,"GET/reload never repeats the create or starts a child");
});

test("prepared village launch, local send, stop, draft cancel and resume each require a separate consumed review",async()=>{
  const h=await fixture();await h.ui.ownerChanged();await h.create();
  const review=async()=>{h.$("village-action-reviewed").checked=true;await h.$("village-action-reviewed").emit("change");};
  assert.equal(h.$("village-launch").disabled,true);await review();await h.$("village-launch").emit("click");assert.equal(h.bundle().status,"running");
  assert.equal(h.$("village-action-reviewed").checked,false);h.$("village-message").value="One local message";await h.$("village-message").emit("input");await review();await h.$("village-send").emit("click");
  assert.deepEqual(Object.keys(h.posts().at(-1).body).sort(),["action","allowSend","message","newVillageId","requestId"].sort());
  await review();await h.$("village-stop").emit("click");assert.equal(h.bundle().status,"stopped");assert.equal(h.$("village-launch").disabled,true);
  assert.equal(h.posts().some(r=>/project|codex/.test(r.path)),false);
  const draft=await fixture();await draft.ui.ownerChanged();await draft.create();
  draft.$("village-action-reviewed").checked=true;await draft.$("village-action-reviewed").emit("change");
  await draft.$("village-cancel").emit("click");assert.equal(draft.bundle().status,"cancelled");assert.equal(draft.$("village-resume").disabled,true);
  draft.$("village-action-reviewed").checked=true;await draft.$("village-action-reviewed").emit("change");
  await draft.$("village-resume").emit("click");assert.equal(draft.bundle().status,"prepared");
  assert.equal(draft.posts().some(r=>r.body.action==="launch"),false,"explicit resume never launches a child");
});
