// Executable extension logic tests with browser API fixtures, not signed-in E2E.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const load=name=>readFileSync(new URL("../../mini/arc-browser/"+name,import.meta.url),"utf8");
function background({grant=true,failAt=0,receipt={accepted:true,messageId:"m_one"},remove=true}={}){
 let listener;const calls=[],permissions=[];
 vm.runInNewContext(load("background.js"),{chrome:{action:{onClicked:{addListener(){}}},
  runtime:{onMessage:{addListener(fn){listener=fn;}}},permissions:{
   async request(){permissions.push("request");return grant;},
   async remove(){permissions.push("remove");if(remove==="throw")throw Error("cleanup_failed");return remove;}}},
  async fetch(url,init){calls.push({url,body:JSON.parse(init.body)});
   if(calls.length===failAt)throw Error("network_failed");
   return {ok:true,json:async()=>calls.length===1?{id:"arc_session",token:"secret"}:receipt};}});
 const send=(msg={},sender={tab:{id:1},frameId:0,url:"https://chatgpt.com/c/test"})=>new Promise(resolve=>listener({type:"arc_gateway_handoff",text:"answer",...msg},sender,resolve));
 return {send,calls,permissions};
}
test("handoff uses chosen loopback port, releases permission and reports receipt",async()=>{
 const h=background();const result=await h.send({port:12345});
 assert.equal(result.accepted,true);assert.equal(result.submitted,true);
 assert.ok(h.calls.every(x=>x.url==="http://127.0.0.1:12345/api/arc/handoff"));
 assert.deepEqual(h.permissions,["request","remove"]);
});
test("permission is revoked on token and delivery errors; uncertain delivery is distinct",async()=>{
 for(const failAt of [1,2]){const h=background({failAt});const result=await h.send();
  assert.equal(result.accepted,false);assert.equal(result.uncertain,failAt===2);
  assert.deepEqual(h.permissions,["request","remove"]);}
 const denied=background({grant:false});assert.equal((await denied.send()).error,"local_gateway_permission_denied");
 assert.equal(denied.calls.length,0);
});
test("permission cleanup failure preserves confirmed receipt and raises warning",async()=>{
 for(const remove of [false,"throw"]){const h=background({remove});const r=await h.send();
 assert.equal(r.accepted,true);assert.equal(r.permissionWarning,"local_gateway_permission_not_removed");}
});
test("pending queue receipt is preserved without a second submission",async()=>{
 const h=background({receipt:{submitted:true,accepted:false,messageId:"m_pending",jobState:"pending"}});
 const r=await h.send();assert.equal(r.submitted,true);assert.equal(r.accepted,false);
 assert.equal(r.messageId,"m_pending");assert.equal(h.calls.length,2);
});
test("invalid origin, iframe, port and oversize replies never request access",async()=>{
 const h=background();
 for(const sender of [{tab:{id:1},frameId:0,url:"https://evil.test/"},{tab:{id:1},frameId:1,url:"https://chatgpt.com/"}])
  assert.equal((await h.send({},sender)).error,"unauthorized_tab");
 for(const port of [0,65536,"8766",1.2])assert.equal((await h.send({port})).error,"invalid_gateway_port");
 assert.equal((await h.send({text:"a".repeat(951)})).error,"invalid_reply_size");
 assert.equal(h.permissions.length,0);
});
test("concurrent tabs cannot revoke an active transfer's permission",async()=>{
 const h=background();const first=h.send();const second=await h.send();
 assert.equal(second.error,"gateway_handoff_busy");await first;
 assert.deepEqual(h.permissions,["request","remove"]);
});
function picker({svg=false,ambiguous=false}={}){
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.style={};this.attrs={};this.textContent="";this.value="";}
  append(...children){this.children.push(...children);for(const child of children)child.parentElement=this;}
  addEventListener(type,fn){this.listeners[type]=fn;}
  contains(el){return el===this||this.children.some(x=>x.contains(el));}
  closest(selector){if(this.sensitive)return this;return selector.includes("password")?null:this;}
  getAttribute(name){return this.attrs[name]||null;}
  hasAttribute(name){return name in this.attrs;}
  click(){this.listeners.click?.({target:this});}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);}
 }
 const html=new Element("html"),fields={},sent=[];let pick;let reply={submitted:true,accepted:false,messageId:"m_pending"};
 const document={documentElement:html,body:new Element("body"),createElement:tag=>new Element(tag),
  addEventListener(type,fn){pick=fn;},removeEventListener(){},querySelectorAll:s=>fields[s]?(Array.isArray(fields[s])?fields[s]:[fields[s]]):[]};
 vm.runInNewContext(load("content.js"),{document,window:{},CSS:{escape:s=>s},HTMLElement:Element,
  chrome:{runtime:{sendMessage(msg,cb){sent.push(msg);cb(reply);}}}});
 const root=html.children[0];
 for(const [id,tag] of [["input","textarea"],["send","button"],["response","div"]]){
  const el=new Element(tag);el.id=id;fields["#"+id]=el;
  if(ambiguous&&id==="response")fields["#"+id]=[el,el];
  const target=svg&&id==="send"?{closest:selector=>selector.includes("password")?null:el}:el;
  pick({target,preventDefault(){},stopImmediatePropagation(){}});
 }
 if(ambiguous)return {root,fields};
 const session=root.children.at(-1),[prompt,send,capture,label,forward,result,reselect]=session.children;
 return {fields,sent,capture,forward,result,send,reselect,root,pickAgain(){
  for(const id of ["input","send","response"])pick({target:fields["#"+id],preventDefault(){},stopImmediatePropagation(){}});
 },port:label.children[0],reply:x=>{reply=x;}};
}
test("failed or oversized recapture cannot forward previously captured content",()=>{
 for(const invalid of [null,{sensitive:true},"a".repeat(5001)]){
  const p=picker();p.fields["#response"].textContent="old";p.capture.click();
  if(typeof invalid==="string")p.fields["#response"].textContent=invalid;
  else if(invalid)p.fields["#response"].sensitive=true;
  else p.fields["#response"]=null;
  p.capture.click();p.forward.click();assert.equal(p.sent.length,0);
 }
});
test("pending and uncertain captures cannot be duplicated by recapture or repeated click",()=>{
 for(const reply of [{submitted:true,accepted:false,messageId:"m_pending"},{accepted:true,messageId:"m_done"},{uncertain:true}]){
  const p=picker();p.reply(reply);p.port.value="12345";p.fields["#response"].textContent="answer";
  p.capture.click();p.forward.click();p.forward.click();p.capture.click();p.forward.click();
  assert.equal(p.sent.length,1);assert.equal(p.sent[0].port,12345);
 }
});
test("starting a new prompt invalidates the old capture",()=>{
 const p=picker();p.fields["#response"].textContent="old";p.capture.click();p.send.click();p.forward.click();
 assert.equal(p.sent.length,0);
});

test("selector drift to multiple matches fails closed",()=>{
 const p=picker();p.fields["#response"].textContent="old";p.capture.click();
 p.fields["#response"]=[p.fields["#response"],p.fields["#response"]];
 p.capture.click();p.forward.click();assert.equal(p.sent.length,0);
});

test("SVG send child resolves its actionable parent",()=>{
 const p=picker({svg:true});assert.match(p.root.children[2].textContent,/#send/);
});
test("ambiguous initial response selection does not enable session",()=>{
 const p=picker({ambiguous:true});assert.equal(p.root.children.length,4);
 assert.match(p.root.children[1].textContent,/一意/);
});

test("reselect clears capture without losing the overlay duplicate guard",()=>{
 const p=picker();p.fields["#response"].textContent="answer";
 p.capture.click();p.forward.click();p.reselect.click();assert.equal(p.root.children.length,4);
 p.pickAgain();p.forward.click();assert.equal(p.sent.length,1);
 p.capture.click();p.forward.click();assert.equal(p.sent.length,1);
});
