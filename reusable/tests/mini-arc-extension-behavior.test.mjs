// Actual extension sources in executable DOM/API fixtures. No signed-in E2E claim.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {webcrypto,createHash} from "node:crypto";
const load=name=>readFileSync(new URL("../../mini/arc-browser/"+name,import.meta.url),"utf8");
const ID="arc_"+"1".repeat(32),ID2="arc_"+"2".repeat(32),sha=text=>createHash("sha256").update(text,"utf8").digest("hex");
const receipt=(body,extra={})=>({version:2,messageId:body.messageId,submitted:true,accepted:true,jobState:"done",
 ackState:"persisted",deliveryState:"delivered",sha256:body.sha256,totalBytes:body.totalBytes,receiptHash:body.sha256,...extra});
function background({grant=true,failAt=0,answer,remove=true}={}){
 let listener;const calls=[],permissions=[];
 const context=vm.createContext({TextEncoder,crypto:webcrypto,Uint8Array,
  chrome:{action:{onClicked:{addListener(){}}},runtime:{onMessage:{addListener(fn){listener=fn;}}},
   permissions:{async request(){permissions.push("request");return grant;},
    async remove(){permissions.push("remove");if(remove==="throw")throw Error("cleanup_failed");return remove;}}},
  async fetch(url,init){const body=JSON.parse(init.body);calls.push({url,body});
   if(calls.length===failAt)throw Error("network_failed");
   return {ok:true,json:async()=>body.action==="start"?{id:"arc_session",token:"fixture_one_time_token"}:
    typeof answer==="function"?answer(body):receipt(body,answer||{})};}});
 vm.runInContext(load("reply-state.js"),context);vm.runInContext(load("background.js"),context);
 const send=(msg={},sender={tab:{id:1},frameId:0,url:"https://chatgpt.com/c/synthetic-fixture"})=>
  new Promise(resolve=>listener({type:"arc_gateway_handoff",action:"deliver",version:2,messageId:ID,text:"answer",...msg},sender,resolve));
 return {send,calls,permissions};
}
test("V2 background hashes all raw Unicode bytes and uses the chosen loopback port",async()=>{
 const h=background(),text=" \n"+"長い回答🙂 e\u0301\r\n".repeat(500)+"\n ";
 const result=await h.send({port:12345,text});
 assert.equal(result.accepted,true);assert.equal(result.submitted,true);
 assert.ok(h.calls.every(x=>x.url==="http://127.0.0.1:12345/api/arc/handoff"));
 const body=h.calls[1].body;
 assert.equal(body.text,text);assert.equal(body.messageId,ID);assert.equal(body.version,2);
 assert.equal(body.sha256,sha(text));assert.equal(body.totalBytes,Buffer.byteLength(text,"utf8"));
 assert.equal(result.receiptHash,sha(text));assert.deepEqual(h.permissions,["request","remove"]);
});
test("permission is revoked on session and delivery errors, with uncertain delivery distinct",async()=>{
 for(const failAt of [1,2]){const h=background({failAt}),result=await h.send();
  assert.equal(result.accepted,false);assert.equal(result.uncertain,failAt===2);
  assert.equal(result.messageId,ID);assert.deepEqual(h.permissions,["request","remove"]);}
 const denied=background({grant:false});assert.equal((await denied.send()).error,"local_gateway_permission_denied");
 assert.equal(denied.calls.length,0);
});
test("permission cleanup failure preserves the confirmed V2 receipt and raises warning",async()=>{
 for(const remove of [false,"throw"]){const h=background({remove}),r=await h.send();
  assert.equal(r.accepted,true);assert.equal(r.permissionWarning,"local_gateway_permission_not_removed");}
});
test("pending receipt and explicit status use a stable ID without automatic retry",async()=>{
 const h=background({answer:body=>body.action==="status"?{version:2,messageId:body.messageId,submitted:false,accepted:false,
  deliveryState:"not_found",sha256:null,totalBytes:null,receiptHash:null}:receipt(body,{accepted:false,jobState:"pending",ackState:"pending"})});
 const pending=await h.send();assert.equal(pending.submitted,true);assert.equal(pending.accepted,false);
 assert.equal(h.calls.length,2);
 const status=await h.send({action:"status",text:undefined});
 assert.equal(status.accepted,false);assert.equal(status.submitted,false);assert.equal(h.calls.length,4);
 assert.deepEqual(Object.keys(h.calls[3].body).sort(),["action","id","messageId","token","version"]);
 assert.equal(h.calls[3].body.messageId,ID);assert.deepEqual(h.permissions,["request","remove","request","remove"]);
});
test("invalid origin, frame, ID, port, byte length and Unicode are refused before access",async()=>{
 const h=background();
 for(const sender of [{tab:{id:1},frameId:0,url:"https://evil.test/"},{tab:{id:1},frameId:1,url:"https://chatgpt.com/"}])
  assert.equal((await h.send({},sender)).error,"unauthorized_tab");
 for(const port of [0,65536,"8766",1.2])assert.equal((await h.send({port})).error,"invalid_gateway_port");
 for(const messageId of ["",ID.toUpperCase()," "+ID,"arc_"+"1".repeat(31)])assert.equal((await h.send({messageId})).error,"invalid_arc_request");
 for(const text of ["a".repeat(262145),"🙂".repeat(65536)+"x","\ud800","\udfff"," \n "])
  assert.equal((await h.send({text})).accepted,false);
 assert.equal(h.permissions.length,0);assert.equal(h.calls.length,0);
});
test("exact byte ceiling is accepted and a mismatched receiver fingerprint stays uncertain",async()=>{
 const good=background(),text="🙂".repeat(65536);
 assert.equal((await good.send({text})).accepted,true);assert.equal(good.calls[1].body.totalBytes,262144);
 const bad=background({answer:body=>receipt(body,{sha256:"0".repeat(64),receiptHash:"0".repeat(64)})});
 const result=await bad.send();assert.equal(result.accepted,false);assert.equal(result.uncertain,true);
 assert.equal(result.error,"arc_receipt_content_mismatch");
});
test("concurrent tabs cannot revoke an active transfer permission",async()=>{
 const h=background(),first=h.send(),second=await h.send({messageId:ID2});
 assert.equal(second.error,"gateway_handoff_busy");await first;assert.deepEqual(h.permissions,["request","remove"]);
});
function picker({svg=false,ambiguous=false,deferReply=false,pickTrusted=true}={}){
 let clock=0,pick=null,nextTimer=0;const timers=new Map(),later=new Map(),observers=[],created=[],fields={},sent=[],pending=[];
 let generating=false,reply=null,deferMutations=false;
 function mutate(node){for(const o of [...observers])if(o.active&&(o.node===node||o.node.contains(node))){
  if(deferMutations)o.records.push({target:node});else o.fn([{target:node}]);}}
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.extraListeners={};this.style={};this.attrs={};
   this._text="";this._value="";this.events=[];this.clicks=0;this.checked=false;this.disabled=false;this.isConnected=true;created.push(this);}
  get textContent(){return this._text;}
  set textContent(value){this._text=String(value);mutate(this);}
  get innerText(){return this._text;}
  get value(){return this._value;}
  set value(value){this._value=String(value);}
  append(...children){this.children.push(...children);for(const child of children)child.parentElement=this;}
  addEventListener(type,fn){if(!this.listeners[type])this.listeners[type]=fn;else (this.extraListeners[type]??=new Set()).add(fn);}
  removeEventListener(type,fn){if(this.listeners[type]===fn)delete this.listeners[type];else this.extraListeners[type]?.delete(fn);}
  contains(el){return el===this||this.children.some(x=>x.contains(el));}
  closest(selector){
   if(selector.includes("password"))return this.sensitive?this:null;
   if(selector.includes("aria-busy"))return this.attrs["aria-busy"]==="true"||this.attrs["data-is-streaming"]==="true"?this:null;
   if(selector.includes("button"))return this.tagName==="BUTTON"?this:this.parentElement?.closest(selector)||null;
   if(selector.includes("textarea"))return ["TEXTAREA","INPUT"].includes(this.tagName)||this.isContentEditable?this:null;
   return null;
  }
  getAttribute(name){return this.attrs[name]??null;}
  hasAttribute(name){return name==="disabled"&&this.disabled||name in this.attrs;}
  getClientRects(){return this.hidden?[]:[{}];}
  querySelectorAll(){return this.children.flatMap(child=>[
   ...((child.attrs["aria-busy"]==="true"||child.attrs["data-is-streaming"]==="true")?[child]:[]),...child.querySelectorAll()]);}
  focus(){this.focused=true;}
  dispatchEvent(event){this.events.push(event);const synthetic={...event,isTrusted:false,target:this,defaultPrevented:false,
   preventDefault(){this.defaultPrevented=true;}};this.listeners[event.type]?.(synthetic);
   for(const fn of [...(this.extraListeners[event.type]||[])])fn(synthetic);return !synthetic.defaultPrevented;}
  activate(isTrusted){if(this.disabled||this.hasAttribute("disabled"))return;this.clicks++;
   const before=this.checked,event={target:this,isTrusted,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
   if(this.type==="checkbox")this.checked=!this.checked;
   this.listeners.click?.(event);
   if(this.type==="checkbox"){
    if(event.defaultPrevented)this.checked=before;
    // Native checkbox activation may create a trusted change after an untrusted click.
    else this.listeners.change?.({target:this,isTrusted:true});
   }}
  click(){this.activate(false);}
  humanClick(){this.activate(true);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);}
 }
 class Textarea extends Element{constructor(){super("textarea");}get value(){return this._value;}set value(v){this._value=String(v);}}
 class Input extends Element{constructor(){super("input");}get value(){return this._value;}set value(v){this._value=String(v);}}
 const html=new Element("html"),body=new Element("body"),marker=new Element("button");html.append(body);
 marker.attrs["data-testid"]="stop-button";
 const document={documentElement:html,body,createTextNode:text=>{const node=new Element("#text");node.textContent=text;return node;},
  createElement:tag=>tag==="textarea"?new Textarea():tag==="input"?new Input():new Element(tag),
  addEventListener(type,fn){if(type==="click")pick=fn;},removeEventListener(type,fn){if(type==="click"&&pick===fn)pick=null;},
  querySelectorAll(selector){if(selector.startsWith("#")){const v=fields[selector];return v?(Array.isArray(v)?v:[v]):[];}
   return generating&&selector.includes("停止")?[marker]:[];}};
 class Mutation{constructor(fn){this.fn=fn;this.active=false;this.records=[];observers.push(this);}observe(node){this.node=node;this.active=true;}
  takeRecords(){const records=this.records;this.records=[];return records;}disconnect(){this.active=false;this.records=[];}}
 const runtime={lastError:null,sendMessage(msg,cb){sent.push(structuredClone(msg));if(deferReply)pending.push({msg,cb});
  else cb({version:2,messageId:msg.messageId,submitted:true,accepted:false,jobState:"pending",...reply});}};
 const window={},context=vm.createContext({document,window,CSS:{escape:s=>s},HTMLElement:Element,HTMLTextAreaElement:Textarea,HTMLInputElement:Input,
  TextEncoder,Uint8Array,crypto:webcrypto,Date:{now:()=>clock},MutationObserver:Mutation,
  setInterval(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearInterval(id){timers.delete(id);},
  Event:class{constructor(type,init){this.type=type;Object.assign(this,init);}},
  InputEvent:class{constructor(type,init){this.type=type;Object.assign(this,init);}},chrome:{runtime}});
 vm.runInContext(load("reply-state.js"),context);vm.runInContext(load("content.js"),context);
 const root=created.find(x=>x.id==="metron-arc-picker");
 for(const [id,tag] of [["input","textarea"],["send","button"],["response","div"]]){
  const node=document.createElement(tag);node.id=id;fields["#"+id]=node;body.append(node);
  if(ambiguous&&id==="response")fields["#"+id]=[node,node];
  const target=svg&&id==="send"?{closest:s=>s.includes("password")?null:node}:node;
  pick?.({target,isTrusted:pickTrusted,preventDefault(){},stopImmediatePropagation(){}});
 }
 const get=id=>created.find(x=>x.id==="metron-arc-"+id);
 const p={root,fields,sent,runtime,window,context,get,
  prompt:get("prompt"),send:get("send"),capture:get("capture"),forward:get("forward"),retry:get("retry"),checkStatus:get("status"),
  newRecord:get("new-record"),recovery:get("recovery-id"),resume:get("resume"),recordId:get("message-id"),completion:get("completion-reviewed"),
  completionState:get("completion-state"),result:get("result"),preview:get("preview"),reselect:get("reselect"),stop:get("stop"),port:get("port"),
  pickAgain(responseId="response",isTrusted=true){for(const id of ["input","send",responseId])pick?.({target:fields["#"+id],isTrusted,preventDefault(){},stopImmediatePropagation(){}});},
  appendResponse(id,text){const node=document.createElement("div");node.id=id;node.textContent=text;fields["#"+id]=node;body.append(node);return node;},
  confirm(){get("completion-reviewed").checked=false;get("completion-reviewed").humanClick();},
  after(fn,ms){later.set(++nextTimer,{fn,at:clock+ms});},
  tick(ms=1000){clock+=ms;for(const [id,task] of [...later])if(task.at<=clock){later.delete(id);task.fn();}
   for(const fn of [...timers.values()])fn();},
  generating(value){generating=value;p.tick(0);},
  deferMutations(value){deferMutations=value;},
  ready(text="answer"){fields["#response"].textContent=text;p.newRecord.humanClick();p.confirm();p.capture.humanClick();},
  reply(value){reply=value;},
  respond(value){const next=pending.shift();assert.ok(next,"an explicit request is pending");
   next.cb({version:2,messageId:next.msg.messageId,submitted:false,accepted:false,...value});},
  activeTimers:()=>timers.size,activeObservers:()=>observers.filter(x=>x.active).length};
 return p;
}
test("initial page and reload require an explicit new record or receiver recovery ID",()=>{
 const p=picker();p.fields["#response"].textContent="answer";p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent.length,0);assert.equal(p.recordId.textContent,"未選択");
 p.newRecord.humanClick();p.confirm();p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent.length,1);
 const id=p.sent[0].messageId;assert.match(id,/^arc_[a-f0-9]{32}$/);
 const fresh=picker();fresh.tick(20000);assert.equal(fresh.sent.length,0);assert.equal(fresh.recordId.textContent,"未選択");
 fresh.recovery.value=id;fresh.resume.humanClick();assert.equal(fresh.sent.length,0);
 fresh.checkStatus.humanClick();assert.equal(fresh.sent[0].action,"status");assert.equal(fresh.sent[0].messageId,id);
 assert.equal("text" in fresh.sent[0],false);
});

test("untrusted page events cannot select, create or resume an ID, confirm, capture, send or stop ARC",()=>{
 const p=picker({pickTrusted:false});assert.equal(p.root.children[2].textContent,"");
 p.pickAgain("response",false);assert.equal(p.root.children[2].textContent,"");
 p.pickAgain();p.fields["#response"].textContent="answer";p.prompt.value="Do not send synthetically";p.recovery.value=ID;
 for(const control of [p.newRecord,p.resume]){control.click();control.dispatchEvent({type:"click",isTrusted:true});}
 assert.equal(p.recordId.textContent,"未選択");
 p.newRecord.humanClick();const id=p.recordId.textContent;
 p.completion.click();assert.equal(p.completion.checked,false,"untrusted click default activation is cancelled");
 assert.equal(p.completion.listeners.change,undefined,"change events never authorize manual completion");
 p.completion.checked=true;p.completion.dispatchEvent({type:"change",isTrusted:true});p.tick(0);
 assert.equal(p.completion.checked,false);assert.equal(p.capture.disabled,true);
 p.confirm();p.capture.click();p.capture.dispatchEvent({type:"click"});assert.equal(p.preview.textContent,"");
 p.capture.humanClick();assert.equal(p.preview.textContent,"answer");
 for(const control of [p.send,p.forward,p.retry,p.checkStatus,p.newRecord,p.resume,p.reselect,p.stop]){
  control.click();control.dispatchEvent({type:"click",isTrusted:true});
 }
 assert.equal(p.fields["#send"].clicks,0);assert.equal(p.fields["#input"].value,"");assert.equal(p.sent.length,0);
 assert.equal(p.recordId.textContent,id);assert.equal(p.preview.textContent,"answer");
 assert.equal(p.activeTimers(),1);assert.equal(p.activeObservers(),1);assert.equal(p.window.__metronArcPickerActive,true);
 p.forward.humanClick();assert.equal(p.sent.length,1,"a genuine fixture gesture remains operative");
});

test("a visible busy descendant of the selected response blocks manual capture without a Stop marker",()=>{
 const p=picker();p.ready("outer wrapper reply");const child=p.appendResponse("busy-child","streaming child");
 p.fields["#response"].append(child);child.attrs["aria-busy"]="true";p.tick(10000);p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent.length,0);assert.equal(p.completion.checked,false);assert.equal(p.capture.disabled,true);
 delete child.attrs["aria-busy"];p.tick(0);p.confirm();p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent.length,1);
});
test("known generating and streaming pauses cannot be manually overridden; quiet alone is insufficient",()=>{
 const p=picker();p.ready("initial");p.generating(true);p.tick(10000);p.completion.disabled=false;p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent.length,0);assert.equal(p.completion.checked,false);assert.equal(p.capture.disabled,true);
 p.generating(false);p.tick(10000);assert.equal(p.capture.disabled,true,"no send baseline means manual fallback");
 p.confirm();p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent.length,1);
});
test("busy to idle plus fresh baseline, send readiness and stable observations supplies only a completion candidate",()=>{
 const p=picker();p.fields["#response"].textContent="old";p.prompt.value="New question";
 p.fields["#send"].listeners.click=()=>p.generating(true);p.send.humanClick();
 p.appendResponse("new-response","final");p.reselect.humanClick();p.pickAgain("new-response");p.tick(1000);
 assert.equal(p.capture.disabled,true);assert.equal(p.sent.length,0);
 p.generating(false);p.tick(1000);assert.equal(p.capture.disabled,false);assert.equal(p.completion.checked,false);
 assert.match(p.completionState.textContent,/完了候補/);p.capture.humanClick();assert.equal(p.sent.length,0);
 p.forward.humanClick();assert.equal(p.sent[0].text,"final");
});

test("a completion candidate expires when an idle reply mutates without a new busy-to-idle transition",()=>{
 const p=picker();p.fields["#response"].textContent="old";p.prompt.value="New question";
 p.fields["#send"].listeners.click=()=>p.generating(true);p.send.humanClick();
 const response=p.appendResponse("new-response","first final");p.reselect.humanClick();p.pickAgain("new-response");
 p.generating(false);p.tick(1000);assert.equal(p.capture.disabled,false);p.capture.humanClick();
 response.textContent="continued reply";p.tick(20000);p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.capture.disabled,true);assert.equal(p.completion.checked,false);assert.equal(p.preview.textContent,"");assert.equal(p.sent.length,0);
 p.confirm();p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent[0].text,"continued reply");
});
test("selected response mutation invalidates manual confirmation and a stale capture synchronously",()=>{
 const p=picker();p.ready("old");p.fields["#response"].textContent="changed";p.forward.humanClick();
 assert.equal(p.completion.checked,false);assert.equal(p.preview.textContent,"");assert.equal(p.sent.length,0);
 p.confirm();p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent[0].text,"changed");
 for(const deferred of [false,true]){
  const same=picker();same.ready("same final text");same.deferMutations(deferred);
  same.fields["#response"].textContent="same final text";same.forward.humanClick();
  assert.equal(same.completion.checked,false);assert.equal(same.preview.textContent,"");assert.equal(same.sent.length,0);
 }
});
test("failed or oversized recapture cannot forward previously captured content",()=>{
 for(const invalid of [null,{sensitive:true},{broad:true},"a".repeat(262145)]){
  const p=picker();p.ready("old");
  if(typeof invalid==="string")p.fields["#response"].textContent=invalid;
  else if(invalid?.broad)p.fields["#response"]=p.root.parentElement;
  else if(invalid)p.fields["#response"].sensitive=true;else p.fields["#response"]=null;
  p.confirm();p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent.length,0);
  if(invalid?.broad)assert.equal(p.activeObservers(),0);
 }
});
test("submitted captures stay suppressed except for an explicit same-ID retry or status",()=>{
 for(const reply of [{submitted:true,accepted:false},{submitted:true,accepted:true},{uncertain:true,submitted:false}]){
  const p=picker();p.reply(reply);p.ready();p.forward.humanClick();p.forward.humanClick();p.capture.humanClick();p.forward.humanClick();
  assert.equal(p.sent.length,1);const id=p.sent[0].messageId;
  if(!reply.accepted){p.retry.humanClick();assert.equal(p.sent.length,2);assert.equal(p.sent[1].messageId,id);}
 }
});
test("lost reply can be checked and explicitly retried using the same stable delivery ID",()=>{
 const p=picker({deferReply:true});p.ready("same raw answer");p.forward.humanClick();const id=p.sent[0].messageId;
 p.respond({uncertain:true});p.tick(10000);assert.equal(p.sent.length,1);
 p.checkStatus.humanClick();assert.equal(p.sent[1].action,"status");assert.equal(p.sent[1].messageId,id);
 p.respond({deliveryState:"not_found"});p.retry.humanClick();
 assert.equal(p.sent[2].action,"deliver");assert.equal(p.sent[2].messageId,id);assert.equal(p.sent[2].text,"same raw answer");
});

test("uncertain conflict displays the safe receiver reason and performs no automatic recovery",()=>{
 const p=picker();p.reply({submitted:false,accepted:false,uncertain:true,error:"arc_message_conflict"});p.ready("answer");
 const id=p.recordId.textContent;p.forward.humanClick();p.tick(60000);
 assert.match(p.result.textContent,/Gateway結果未確認/);assert.match(p.result.textContent,/arc_message_conflict/);
 assert.equal(p.sent.length,1);assert.equal(p.recordId.textContent,id);assert.equal(p.forward.disabled,true);
 const unsafe=picker();unsafe.reply({submitted:false,accepted:false,uncertain:true,error:"private details / not an error code"});
 unsafe.ready();unsafe.forward.humanClick();assert.doesNotMatch(unsafe.result.textContent,/private details/);
});

test("failed delivery, ACK or dead jobs are terminal in the UI and cannot trigger endless retries",()=>{
 for(const failure of [{deliveryState:"failed"},{ackState:"failed"},{jobState:"dead"}]){
  const p=picker();p.reply({submitted:true,accepted:false,...failure});p.ready("answer");const id=p.recordId.textContent;
  p.forward.humanClick();assert.match(p.result.textContent,/失敗で停止/);assert.match(p.result.textContent,/失敗段階/);
  assert.match(p.result.textContent,/Mini側の修復が必要/);assert.ok(p.result.textContent.includes(id));
  assert.equal(p.retry.disabled,true);assert.equal(p.forward.disabled,true);assert.equal(p.checkStatus.disabled,false);
  p.retry.humanClick();p.forward.humanClick();p.tick(60000);assert.equal(p.sent.length,1);assert.equal(p.recordId.textContent,id);
  p.retry.disabled=false;p.retry.humanClick();assert.equal(p.sent.length,1,"terminal state also guards a page-mutated disabled attribute");
  p.checkStatus.humanClick();assert.equal(p.sent.length,2);assert.equal(p.sent[1].action,"status");assert.equal(p.sent[1].messageId,id);
 }
});
test("same body in a new explicit record is a distinct message, with whitespace retained",()=>{
 const p=picker(),text=" \nSame answer🙂\n ";p.ready(text);p.forward.humanClick();const first=p.sent[0].messageId;
 p.newRecord.humanClick();p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent.length,2);assert.notEqual(p.sent[1].messageId,first);assert.equal(p.sent[1].text,text);
});
test("starting a new prompt invalidates the old capture",()=>{
 const p=picker();p.ready("old");p.send.humanClick();p.forward.humanClick();assert.equal(p.sent.length,0);
});
test("an initially empty composer enables its disabled send from the single input event",()=>{
 const p=picker(),field=p.fields["#input"],button=p.fields["#send"];button.disabled=true;
 assert.equal(field.value,"");field.listeners.input=()=>{button.disabled=false;};p.prompt.value="Explicit prompt";
 p.send.humanClick();assert.equal(field.value,"Explicit prompt");assert.equal(field.events.length,1);
 assert.equal(field.events[0].type,"input");assert.equal(button.clicks,1);assert.match(p.recordId.textContent,/^arc_[a-f0-9]{32}$/);
 p.tick(5000);assert.equal(button.clicks,1);assert.equal(field.events.length,1);assert.equal(p.activeTimers(),1);
});
test("delayed composer readiness waits without early or duplicate input, click or delivery ID",()=>{
 const p=picker(),field=p.fields["#input"],button=p.fields["#send"];p.ready("baseline");const id=p.recordId.textContent;
 button.disabled=true;field.listeners.input=()=>p.after(()=>{button.disabled=false;},100);p.prompt.value="Delayed prompt";
 p.send.humanClick();assert.equal(field.value,"Delayed prompt");assert.equal(field.events.length,1);assert.equal(button.clicks,0);
 assert.equal(p.recordId.textContent,id);assert.match(p.root.children[2].textContent,/#response/);
 p.send.disabled=false;p.send.humanClick();assert.equal(field.events.length,1,"a second gesture cannot restart an active wait");
 p.tick(99);assert.equal(button.clicks,0);assert.equal(p.recordId.textContent,id);
 p.tick(1);assert.equal(button.clicks,1);assert.notEqual(p.recordId.textContent,id);
 assert.doesNotMatch(p.root.children[2].textContent,/#response/);assert.equal(p.activeTimers(),1);assert.equal(p.activeObservers(),0);
 p.tick(5000);assert.equal(button.clicks,1);assert.equal(field.events.length,1);
 p.reselect.humanClick();p.pickAgain();p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent.length,0,"the pre-input response baseline still rejects the old reply after waiting");
 p.appendResponse("fresh-response","fresh");p.reselect.humanClick();p.pickAgain("fresh-response");p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent[0].text,"fresh");
});
test("a permanently disabled composer send times out without losing its selected response or record",()=>{
 const p=picker(),field=p.fields["#input"],button=p.fields["#send"];p.ready("baseline");const id=p.recordId.textContent;
 button.attrs["aria-disabled"]="true";p.prompt.value="Never ready";p.send.humanClick();
 assert.equal(field.events.length,1);assert.equal(p.activeTimers(),2);p.tick(1999);assert.equal(button.clicks,0);
 p.tick(1);assert.equal(button.clicks,0);assert.equal(p.recordId.textContent,id);assert.equal(p.activeTimers(),1);
 assert.match(p.root.children[2].textContent,/#response/);delete button.attrs["aria-disabled"];p.tick(5000);
 assert.equal(button.clicks,0);assert.equal(field.events.length,1);p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent[0].text,"baseline");assert.equal(p.sent[0].messageId,id);
});
test("stopping or reselecting cancels a composer wait before delayed readiness",()=>{
 for(const action of ["stop","reselect"]){const p=picker(),field=p.fields["#input"],button=p.fields["#send"];
  const id=p.recordId.textContent;
  button.disabled=true;field.listeners.input=()=>p.after(()=>{button.disabled=false;},100);p.prompt.value="Pending";
  p.send.humanClick();assert.equal(field.events.length,1);assert.equal(p.activeTimers(),2);p[action].humanClick();p.tick(5000);
  assert.equal(button.clicks,0);assert.equal(field.events.length,1);assert.equal(p.sent.length,0);
  assert.equal(p.activeTimers(),action==="stop"?0:1);assert.equal(p.activeObservers(),0);assert.equal(p.recordId.textContent,id);
 }
});
test("untrusted send cannot fill an empty composer or start waiting for readiness",()=>{
 const p=picker(),field=p.fields["#input"],button=p.fields["#send"];button.disabled=true;p.prompt.value="Untrusted";
 field.listeners.input=()=>{button.disabled=false;};p.send.click();p.send.dispatchEvent({type:"click",isTrusted:true});p.tick(5000);
 assert.equal(field.value,"");assert.equal(field.events.length,0);assert.equal(button.clicks,0);assert.equal(p.activeTimers(),1);
});
test("prompt or composer edits cancel waiting instead of transmitting stale pending text",()=>{
 for(const edit of ["prompt-input","prompt-property","composer-input","composer-property"]){
  const p=picker(),field=p.fields["#input"],button=p.fields["#send"];button.disabled=true;p.prompt.value="Pending";p.send.humanClick();
  const id=p.recordId.textContent;
  assert.equal(field.events.length,1);const node=edit.startsWith("prompt")?p.prompt:field;node.value="Edited";
  if(edit.endsWith("input"))node.dispatchEvent({type:"input"});button.disabled=false;p.tick(100);
  assert.equal(button.clicks,0);assert.equal(field.events.length,edit==="composer-input"?2:1);
  assert.equal(p.activeTimers(),1);assert.equal(p.activeObservers(),1);assert.equal(p.recordId.textContent,id);
 }
});
test("selector drift, sensitivity and response content changes cancel a pending composer send",()=>{
 for(const change of ["input-drift","send-drift","response-drift","sensitive","response-text","same-response-text"]){
  const p=picker(),field=p.fields["#input"],button=p.fields["#send"],response=p.fields["#response"];
  const id=p.recordId.textContent;
  response.textContent="baseline";button.disabled=true;p.prompt.value="Pending";p.send.humanClick();assert.equal(field.events.length,1);
  if(change==="input-drift")p.fields["#input"]=[field,field];
  else if(change==="send-drift")p.fields["#send"]=[button,button];
  else if(change==="response-drift")p.fields["#response"]=p.appendResponse("replacement","baseline");
  else if(change==="sensitive")field.sensitive=true;
  else response.textContent=change==="same-response-text"?"baseline":"changed";
  button.disabled=false;p.tick(100);assert.equal(button.clicks,0);assert.equal(p.activeTimers(),1);assert.equal(p.activeObservers(),1);assert.equal(p.recordId.textContent,id);
 }
});
test("a new explicit record or recovery operation cancels a pending composer send",()=>{
 for(const action of ["newRecord","resume"]){const p=picker(),field=p.fields["#input"],button=p.fields["#send"];
  button.disabled=true;p.prompt.value="Pending";p.send.humanClick();assert.equal(field.events.length,1);
  p.recovery.value=ID;p[action].humanClick();const id=p.recordId.textContent;button.disabled=false;p.tick(100);
  assert.equal(button.clicks,0);assert.equal(p.recordId.textContent,id);assert.equal(p.activeTimers(),1);
 }
});
test("contenteditable sends use one input event and content mutations cancel delayed readiness",()=>{
 for(const edit of [false,true]){const p=picker(),field=p.fields["#input"],button=p.fields["#send"];
  field.isContentEditable=true;button.disabled=true;field.listeners.input=()=>p.after(()=>{button.disabled=false;},100);
  p.prompt.value="Editable prompt";p.send.humanClick();assert.equal(field.textContent,"Editable prompt");assert.equal(field.events.length,1);
  assert.equal(field.events[0].inputType,"insertText");assert.equal(field.events[0].data,"Editable prompt");assert.equal(p.activeObservers(),2);
  if(edit)field.textContent="Edited without an input event";p.tick(100);assert.equal(button.clicks,edit?0:1);
  assert.equal(p.activeTimers(),1);assert.equal(p.activeObservers(),edit?1:0);
 }
});
test("a native composer setter failure ends the operation without an input event or send",()=>{
 const p=picker(),field=p.fields["#input"],button=p.fields["#send"],id=p.recordId.textContent;
 const proto=p.context.HTMLTextAreaElement.prototype;
 p.prompt.value="Invalid setter";
 Object.defineProperty(proto,"value",{...Object.getOwnPropertyDescriptor(proto,"value"),set(){throw Error("synthetic_invalid_input");}});
 p.send.humanClick();p.tick(5000);
 assert.equal(field.events.length,0);assert.equal(button.clicks,0);assert.equal(p.recordId.textContent,id);assert.equal(p.send.disabled,false);
 assert.equal(p.activeTimers(),1);assert.equal(p.activeObservers(),1);
});
test("valid send requires a new response selection and refuses the unchanged earlier reply",()=>{
 const p=picker();p.fields["#response"].textContent="earlier";p.prompt.value="New prompt";
 p.send.humanClick();assert.equal(p.fields["#send"].clicks,1);assert.equal(p.fields["#input"].value,"New prompt");
 assert.equal(p.fields["#input"].events[0].type,"input");p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent.length,0);
 p.reselect.humanClick();p.pickAgain();p.confirm();p.capture.humanClick();assert.match(p.completionState.textContent,/送信前と同じ/);
 p.appendResponse("new-response","fresh");p.reselect.humanClick();p.pickAgain("new-response");p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent.length,1);assert.equal(p.sent[0].text,"fresh");
});
test("consecutive sends cannot forward the first reply as a second prompt response",()=>{
 const p=picker();p.fields["#response"].textContent="before";p.prompt.value="First";p.send.humanClick();
 p.appendResponse("first-reply","first answer");p.prompt.value="Second";p.send.humanClick();
 assert.equal(p.fields["#send"].clicks,1);p.reselect.humanClick();p.pickAgain("first-reply");p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent.length,1);assert.equal(p.sent[0].text,"first answer");
});
test("unavailable send leaves the response selectable without creating a new delivery ID",()=>{
 const p=picker();p.ready("visible");const id=p.recordId.textContent;p.fields["#send"].attrs.disabled="";
 p.prompt.value="New prompt";p.send.humanClick();assert.equal(p.fields["#send"].clicks,0);assert.equal(p.recordId.textContent,id);
 p.confirm();p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent[0].text,"visible");
});
test("a distinct selected response can repeat pre-send text, while a reused changed node remains selectable",()=>{
 for(const reused of [false,true]){
  const p=picker();p.fields["#response"].textContent="earlier";p.prompt.value="New prompt";p.send.humanClick();
  if(reused)p.fields["#response"].textContent="new in reused node";else p.appendResponse("new-response","earlier");
  p.reselect.humanClick();p.pickAgain(reused?"response":"new-response");p.confirm();p.capture.humanClick();p.forward.humanClick();
  assert.equal(p.sent.length,1);assert.equal(p.sent[0].text,reused?"new in reused node":"earlier");
 }
});
test("a new explicit send permits identical text without reusing its former ID",()=>{
 const p=picker();p.ready("same");p.forward.humanClick();const old=p.sent[0].messageId;p.prompt.value="Ask again";p.send.humanClick();
 p.appendResponse("new-response","same");p.reselect.humanClick();p.pickAgain("new-response");p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent.length,2);assert.notEqual(p.sent[1].messageId,old);
 p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent.length,2);
});
test("an in-flight receipt is bound to its old record when a new explicit send starts",()=>{
 const p=picker({deferReply:true});p.ready("same");p.forward.humanClick();const first=p.sent[0].messageId;
 p.prompt.value="New prompt";p.send.humanClick();p.appendResponse("new-response","same");
 p.reselect.humanClick();p.pickAgain("new-response");p.confirm();p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent.length,1);
 p.respond({uncertain:true});p.forward.humanClick();assert.equal(p.sent.length,2);assert.notEqual(p.sent[1].messageId,first);
});
test("selector drift and ambiguous initial selection fail closed; SVG resolves its button",()=>{
 const p=picker();p.ready("answer");p.fields["#response"]=[p.fields["#response"],p.fields["#response"]];
 p.confirm();p.capture.humanClick();p.forward.humanClick();assert.equal(p.sent.length,0);
 const ambiguous=picker({ambiguous:true});assert.equal(ambiguous.root.children.length,4);assert.match(ambiguous.root.children[1].textContent,/一意/);
 const svg=picker({svg:true});assert.match(svg.root.children[2].textContent,/#send/);
});
test("reselection preserves delivery ID and submitted guard while clearing preview and confirmation",()=>{
 const p=picker();p.ready();p.forward.humanClick();const id=p.recordId.textContent;p.reselect.humanClick();
 assert.equal(p.preview.textContent,"");assert.equal(p.completion.checked,false);p.pickAgain();p.confirm();p.capture.humanClick();p.forward.humanClick();
 assert.equal(p.sent.length,1);assert.equal(p.recordId.textContent,id);
});
test("stop disconnects observations and timers and cannot cause network polling or new sends",()=>{
 const p=picker({deferReply:true});p.ready();p.forward.humanClick();assert.equal(p.sent.length,1);
 p.stop.humanClick();assert.equal(p.activeTimers(),0);assert.equal(p.activeObservers(),0);assert.equal(p.window.__metronArcPickerActive,undefined);
 p.fields["#response"].textContent="late";p.tick(60000);p.respond({accepted:true,submitted:true});p.forward.humanClick();p.checkStatus.humanClick();
 assert.equal(p.sent.length,1);
});
