import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../../mini/public/experience.html",import.meta.url),"utf8"),script=readFileSync(new URL("../../mini/public/setup-ui.js",import.meta.url),"utf8"),copy=x=>JSON.parse(JSON.stringify(x));
async function fixture({onPrepare,authorized=true}={}){
  class Element{constructor(){this.value="";this.checked=false;this.disabled=false;this.children=[];this.textContent="";this.listeners={};}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}addEventListener(t,f){(this.listeners[t]??=[]).push(f);}
    async emit(t){if(t==="click"&&this.disabled)return;for(const f of this.listeners[t]||[])await f({target:this});}set innerHTML(v){throw Error("plain text only");}}
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()])),requests=[];let ready=0,timer;
  const $=id=>{assert.ok(elements.has(id),id);return elements.get(id);};
  const slot={id:"slot-one",label:"Named owner target",setupDigest:"a".repeat(64),status:"unprepared",job:null,
    publicScope:{baseCommit:"b".repeat(40),allowedEdits:[{path:"src/file.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],postApplyTests:["tests/smoke.test.mjs"],acceptanceTestCount:2}};
  const response=(v,ok=true)=>({ok,json:async()=>copy(v)});
  async function fetch(path,init={}){assert.equal(authorized,true);const body=init.body?JSON.parse(init.body):null;requests.push({path,body,headers:init.headers});
    assert.equal(init.headers["X-Metron-Project-Operator"],"fixture-only-owner");
    if(path==="/api/project/setup")return response({slots:[slot],activeJobs:[]});
    if(onPrepare){const result=onPrepare({body,response});if(result)return result;}
    slot.status="queued";slot.job={id:"setup-job",status:"queued",slotId:slot.id,requestId:body.requestId};return response({job:slot.job,duplicate:false});
  }
  const context=vm.createContext({document:{getElementById:$,createElement:()=>new Element()},fetch,crypto:{randomUUID:()=>"1".repeat(32)},
    setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;}});vm.runInContext(script,context);
  const ui=context.createMetronSetupUi({owner:{hasOperator:()=>authorized,headers:()=>({"X-Metron-Project-Operator":"fixture-only-owner"})},onReady:()=>{ready++;}});
  return {$,ui,requests,slot,posts:()=>requests.filter(r=>r.body),setOwner:v=>{authorized=v;},ready:()=>ready,poll:async()=>{const fn=timer;timer=null;if(fn)await fn();},
    prepare:async()=>{$("setup-reviewed").checked=true;await $("setup-reviewed").emit("change");await $("setup-prepare").emit("click");}};
}
const textOf=e=>e.textContent+e.children.map(textOf).join("\n");
test("owner GET reveals named slot and permitted boundaries only, with no preparation on load",async()=>{
  const h=await fixture({authorized:false});assert.equal(h.requests.length,0);h.setOwner(true);await h.ui.ownerChanged();assert.equal(h.posts().length,0);
  assert.match(textOf(h.$("setup-scope")),/Named owner target/);assert.match(textOf(h.$("setup-scope")),/src\/file.mjs/);assert.match(textOf(h.$("setup-scope")),/非公開受入: 2件/);
  assert.equal(textOf(h.$("setup-scope")).includes("fixture-only-owner"),false);assert.equal(h.$("setup-prepare").disabled,true);
});
test("one reviewed mechanical prepare uses exact setup ID; ready polling refreshes project catalog once without model or tests",async()=>{
  const h=await fixture();await h.ui.ownerChanged();await h.prepare();assert.deepEqual(h.posts()[0].body,{slotId:"slot-one",setupDigest:"a".repeat(64),requestId:"setup_"+"1".repeat(32),allowPrepare:true});
  assert.equal(h.$("setup-reviewed").checked,false);h.slot.status="ready";h.slot.job.status="ready";await h.poll();assert.equal(h.ready(),1);
  await h.ui.reload();assert.equal(h.ready(),1);assert.equal(h.posts().length,1);assert.equal(h.requests.some(r=>/dispatch|action|agent|codex/.test(r.path)),false);
});
test("uncertain preparation never auto resends and explicit retry preserves the exact request after GET readback",async()=>{
  let fail=true;const h=await fixture({onPrepare:()=>{if(fail){fail=false;throw Error("lost response");}}});await h.ui.ownerChanged();await h.prepare();
  const body=copy(h.posts()[0].body);assert.equal(h.$("setup-retry").disabled,true);await h.ui.reload();assert.equal(h.posts().length,1);
  h.$("setup-retry-reviewed").checked=true;await h.$("setup-retry-reviewed").emit("change");await h.$("setup-retry").emit("click");
  assert.deepEqual(h.posts()[1].body,body);assert.equal(h.$("setup-retry-reviewed").checked,false);
});
test("slot changes and owner disconnect invalidate preparation review",async()=>{
  const h=await fixture();await h.ui.ownerChanged();h.$("setup-reviewed").checked=true;await h.$("setup-reviewed").emit("change");
  await h.$("setup-slot").emit("change");assert.equal(h.$("setup-reviewed").checked,false);assert.equal(h.$("setup-prepare").disabled,true);
  h.setOwner(false);await h.ui.ownerChanged();assert.equal(h.$("setup-reload").disabled,true);assert.equal(h.posts().length,0);
});
