// Real loopback HTTP and the fixed local Node child; synthetic owned data only.
// No browser, provider, credential input or remote service.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,writeFileSync,existsSync,lstatSync,rmSync} from "node:fs";
import {join,resolve,relative,isAbsolute} from "node:path";
import {createMiniServer} from "../../mini/server.mjs";

const PHASE=resolve(import.meta.dirname,"../../../metron-evidence/village-bootstrap-20261015");
const OWNER="1".repeat(64),OTHER="2".repeat(64); // Synthetic test capabilities, never real credentials.
const requestId=()=>"request_"+randomUUID().replaceAll("-","");
const sha=b=>createHash("sha256").update(b).digest("hex");
async function isolated(fn){
  mkdirSync(PHASE,{recursive:true});const root=mkdtempSync(join(PHASE,"village-http-"));
  let passed=false;try{const result=await fn(root);passed=true;return result;}finally{
    const child=relative(PHASE,root);assert.ok(child&&!child.startsWith("..")&&!isAbsolute(child));
    if(passed)rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
}
async function http(app,path,{body,raw,owner=OWNER,origin,contentType="application/json",explicit=true}={}){
  const headers={};if(owner)headers["X-Metron-Project-Operator"]=owner;
  if(body!==undefined||raw!==undefined){headers["Content-Type"]=contentType;if(explicit)headers["X-Metron-Mini"]="1";}
  if(origin)headers.Origin=origin;
  const response=await fetch(app.url+path,{method:body!==undefined||raw!==undefined?"POST":"GET",headers,
    ...(body!==undefined||raw!==undefined?{body:raw??JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
}
const options=root=>({root:join(root,"parent"),port:0,projectOperatorToken:OWNER,
  villageBootstrapOptions:{baseRoot:join(root,"created"),sourceVersion:"synthetic-http-village-v1",maxRunMs:120000}});
const selection=(extra={})=>({newVillageId:"http-child",directoryName:"http-child",displayName:"HTTP child fixture",
  sourceVillageId:"village-1",inheritGoal:false,inheritSourceMessage:false,knowledgeIds:[],purpose:"Synthetic local child",...extra});
const createBody=(input,preview,extra={})=>({action:"create",requestId:requestId(),...input,
  previewDigest:preview.previewDigest,allowCreate:true,dataReviewed:true,...extra});
function snapshot(root,{skip=[]}={}){
  const result={};const walk=(directory,prefix="")=>{
    for(const name of readdirSync(directory).sort()){
      if(!prefix&&skip.includes(name))continue;
      const path=prefix?prefix+"/"+name:name,full=join(directory,name),stat=lstatSync(full);
      assert.equal(stat.isSymbolicLink(),false);
      if(stat.isDirectory())walk(full,path);else if(stat.isFile())result[path]=sha(readFileSync(full));
    }
  };walk(root);return result;
}

test("village HTTP management requires owner/origin/explicit JSON and rejects path or query overrides",()=>isolated(async root=>{
  const app=await createMiniServer(options(root));try{
    for(const path of ["/api/village/catalog","/api/village/state?newVillageId=http-child"]){
      assert.equal((await http(app,path,{owner:null})).status,403);
      assert.equal((await http(app,path,{owner:OTHER})).status,403);
    }
    const input=selection();
    assert.equal((await http(app,"/api/village/preview",{body:input,owner:null})).status,403);
    assert.equal((await http(app,"/api/village/preview",{body:input,origin:"https://example.invalid"})).status,403);
    assert.equal((await http(app,"/api/village/preview",{body:input,explicit:false})).status,403);
    assert.equal((await http(app,"/api/village/preview",{body:input,contentType:"text/plain"})).status,415);
    assert.equal((await http(app,"/api/village/preview",{raw:"{"})).data.error,"invalid_json");
    for(const body of [[],null,{...input,destination:join(root,"http-path-is-not-authority")},
      {...input,command:"not a command channel"},{...input,knowledgeIds:["same","same"]},
      {...input,newVillageId:"village-1"},{...input,directoryName:"../escape"}])
      assert.equal((await http(app,"/api/village/preview",{body})).status,400);
    for(const query of ["?baseRoot=override","?sourceVillageId=village-1&sourceVillageId=village-2"])
      assert.equal((await http(app,"/api/village/catalog"+query)).data.error,"invalid_management_query");
    assert.equal((await http(app,"/api/village/action",{body:{action:"launch",requestId:requestId(),newVillageId:"missing",allowLaunch:true},owner:OTHER})).status,403);
    const catalog=await http(app,"/api/village/catalog");assert.equal(catalog.status,200);
    assert.equal(catalog.data.limits.modelCalls,0);assert.equal(catalog.data.limits.automaticLaunch,false);
    assert.deepEqual(catalog.data.bundles,[]);assert.deepEqual(readdirSync(join(root,"created")),[]);
  }finally{await app.close();}
}));

test("reviewed village HTTP creation, actual child delivery and restart preserve existing villages without copying authority",{timeout:120000},()=>isolated(async root=>{
  const opts=options(root);let app=await createMiniServer(opts);
  try{
    const mission=await http(app,"/api/mission",{body:{from:"A",to:"B",message:"Selected synthetic Gateway observation",code:""}});
    assert.equal(mission.status,200);
    const saved=await http(app,"/api/work/action",{body:{action:"create",villageId:"village-1",goal:"Selected synthetic goal",
      sourceMessageId:mission.data.messageId,knowledgeIds:["origin_village-1"]}});
    assert.equal(saved.status,200);const work=saved.data.work;
    const unselected=await http(app,"/api/work/action",{body:{action:"create",villageId:"village-1",goal:"SYNTHETIC_UNSELECTED_PRIVATE_GOAL",
      sourceMessageId:mission.data.messageId,knowledgeIds:[]}});assert.equal(unselected.status,200);
    writeFileSync(join(opts.root,"unselected-note.json"),JSON.stringify({testOnly:"SYNTHETIC_PARENT_FILE_NOT_SELECTED"}));
    const protectedBefore=snapshot(opts.root,{skip:["village-bootstrap"]});
    const input=selection({sourceWorkId:work.id,inheritGoal:true,inheritSourceMessage:true,knowledgeIds:["origin_village-1"]});
    const preview=await http(app,"/api/village/preview",{body:input});assert.equal(preview.status,200);
    assert.equal(preview.data.seed.inheritedGoal.text,work.goal);
    assert.equal(preview.data.seed.sourceMessage.text,work.sourceMessage.body);
    assert.equal(preview.data.seed.knowledge.length,1);
    assert.deepEqual(readdirSync(join(root,"created")),[],"preview never prepares or launches");
    const body=createBody(input,preview.data),created=await http(app,"/api/village/action",{body});
    assert.equal(created.status,200);assert.equal(created.data.bundle.status,"prepared");
    assert.equal(created.data.runtime,null);assert.equal(created.data.bundle.launch,null);
    const destination=join(root,"created","http-child");
    assert.deepEqual(readdirSync(destination).sort(),["manifest.json","ownership.json","participation","seed.json"]);
    assert.equal(existsSync(join(destination,"runtime")),false,"registration does not launch or create child Runtime data");
    const participant=app.civilization.state().villages["http-child"];
    assert.ok(participant);assert.equal(participant.dynamic,true);assert.equal(participant.available,false);
    const seed=JSON.parse(readFileSync(join(destination,"seed.json"),"utf8"));assert.deepEqual(seed,preview.data.seed);
    const bundleText=readdirSync(destination).filter(p=>lstatSync(join(destination,p)).isFile()).map(p=>readFileSync(join(destination,p),"utf8")).join("\n");
    for(const omitted of [OWNER,OTHER,"SYNTHETIC_UNSELECTED_PRIVATE_GOAL","SYNTHETIC_PARENT_FILE_NOT_SELECTED",unselected.data.work.id])
      assert.equal(bundleText.includes(omitted),false,"only reviewed seed data is inherited");
    assert.equal((await http(app,"/api/village/action",{body})).data.duplicate,true);
    assert.equal((await http(app,"/api/village/action",{body:{...body,purpose:"changed"}})).data.error,"village_bootstrap_request_conflict");
    assert.equal((await http(app,"/api/village/action",{body:{...body,requestId:requestId()}})).data.error,"village_bootstrap_name_exists");
    const sameDirectory=selection({newVillageId:"another-child"});
    const duplicatePathPreview=await http(app,"/api/village/preview",{body:sameDirectory});
    assert.equal((await http(app,"/api/village/action",{body:createBody(sameDirectory,duplicatePathPreview.data)})).data.error,"village_bootstrap_name_exists");
    assert.deepEqual(snapshot(opts.root,{skip:["village-bootstrap"]}),protectedBefore);
    await app.close();app=await createMiniServer(opts);
    const restored=await http(app,"/api/village/state?newVillageId=http-child");
    assert.equal(restored.data.bundle.status,"prepared");assert.equal(restored.data.runtime,null);
    assert.equal(app.villageBootstrap.children.size,0);
    const launchBody={action:"launch",requestId:requestId(),newVillageId:"http-child",allowLaunch:true};
    const launched=await http(app,"/api/village/action",{body:launchBody});
    assert.equal(launched.status,200);assert.equal(launched.data.bundle.status,"running");
    assert.equal(launched.data.runtime.newVillageId,"http-child");assert.equal(launched.data.runtime.modelCalls,0);
    assert.ok(Number.isInteger(launched.data.runtime.pid)&&launched.data.runtime.pid>0);
    assert.notEqual(launched.data.runtime.pid,process.pid);assert.deepEqual(launched.data.runtime.inheritance,seed);
    const inheritedInbox=JSON.parse(readFileSync(join(destination,"runtime","mother-B.json"),"utf8"));
    assert.equal(inheritedInbox.messages.length,1);assert.equal(inheritedInbox.messages[0].body,seed.sourceMessage.text);
    const localBody={action:"send-local",requestId:requestId(),newVillageId:"http-child",message:"Explicit isolated child message",allowSend:true};
    const sent=await http(app,"/api/village/action",{body:localBody});assert.equal(sent.status,200);
    assert.equal(sent.data.sendResult.deliveryState,"done");assert.equal(sent.data.runtime.modelCalls,0);
    const repeated=await http(app,"/api/village/action",{body:localBody});assert.equal(repeated.data.duplicate,true);
    const inbox=JSON.parse(readFileSync(join(destination,"runtime","mother-B.json"),"utf8"));
    assert.equal(inbox.messages.filter(m=>m.id===sent.data.sendResult.messageId).length,1);
    const stopped=await http(app,"/api/village/action",{body:{action:"stop",requestId:requestId(),newVillageId:"http-child",allowStop:true}});
    assert.equal(stopped.status,200);assert.equal(stopped.data.bundle.status,"stopped");
    assert.equal(stopped.data.bundle.launch.terminationConfirmed,true);
    const childBefore=snapshot(destination),launchId=stopped.data.bundle.launch.launchId;
    await app.close();app=await createMiniServer(opts);
    for(let i=0;i<2;i++){
      const state=await http(app,"/api/village/state?newVillageId=http-child");assert.equal(state.status,200);
      assert.equal(state.data.bundle.status,"stopped");assert.equal(state.data.bundle.launch.launchId,launchId);
      assert.equal(state.data.runtime.modelCalls,0);assert.equal(app.villageBootstrap.children.size,0);
      assert.equal((await http(app,"/api/village/catalog")).status,200);
    }
    const oldLaunchRetry=await http(app,"/api/village/action",{body:launchBody});
    assert.equal(oldLaunchRetry.data.duplicate,true);assert.equal(oldLaunchRetry.data.bundle.status,"stopped");
    assert.equal(app.villageBootstrap.children.size,0);assert.deepEqual(snapshot(destination),childBefore);
    assert.deepEqual(snapshot(opts.root,{skip:["village-bootstrap"]}),protectedBefore);
  }finally{await app.close();}
}));

test("village HTTP rejects stale or unreviewed creation and disabled management does not create a child",()=>isolated(async root=>{
  let app=await createMiniServer(options(root));try{
    const input=selection(),preview=(await http(app,"/api/village/preview",{body:input})).data;
    const valid=createBody(input,preview);
    for(const body of [{...valid,requestId:requestId(),dataReviewed:false},{...valid,requestId:requestId(),allowCreate:false}])
      assert.equal((await http(app,"/api/village/action",{body})).data.error,"village_bootstrap_explicit_creation_review_required");
    const stale=await http(app,"/api/village/action",{body:{...valid,requestId:requestId(),purpose:"new purpose after review"}});
    assert.equal(stale.data.error,"village_bootstrap_preview_stale");
    assert.deepEqual(readdirSync(join(root,"created")),[]);
    await app.close();app=await createMiniServer({root:join(root,"disabled"),port:0,projectOperatorToken:OWNER});
    assert.equal((await http(app,"/api/village/catalog")).status,409);
    assert.equal((await http(app,"/api/village/preview",{body:input})).data.error,"village_bootstrap_not_configured");
    assert.equal(existsSync(join(root,"disabled","created-villages")),false);
  }finally{await app.close();}
}));
