import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MetronMiniRuntime } from "../../mini/runtime.mjs";
import { CivilizationExperienceV3 } from "../../mini/civilization-v3.mjs";
import { FileVillageSquare,createRumor,verifyRumor } from "../../mini/rumor-protocol.mjs";
import { createMiniServer } from "../../mini/server.mjs";

async function temp(fn) {
  const root=mkdtempSync(join(tmpdir(),"metron-original-protocol-"));
  try{return await fn(root);}
  finally{rmSync(root,{recursive:true,force:true});}
}
function setup(root){
  const runtime=new MetronMiniRuntime(root);
  return { runtime,world:new CivilizationExperienceV3(root,runtime) };
}
const v1="village-1",v2="village-2";
test("A and B are two cores within each ONE village, not separate villages",()=>temp(root=>{
  const {world}=setup(root),state=world.state();
  assert.deepEqual(Object.keys(state.villages),[v1,v2]);
  assert.deepEqual(state.villages[v1].id,v1);
  assert.deepEqual(state.villages[v1].motherShips,["A","B"]);
  assert.deepEqual(state.villages[v2].motherShips,["A","B"]);
  assert.equal(state.villages[v1].knowledge.length,1);
  assert.equal(state.villages[v2].knowledge.length,1);
  assert.equal(state.topology,"village_contains_A_and_B");
  assert.equal(state.square.length,0);
  assert.equal(state.limits.aiConsensus,"not_connected");
  assert.ok(existsSync(join(root,"gateway.json")));
  assert.ok(existsSync(join(root,"village-2","gateway.json")));
  assert.ok(existsSync(join(root,v1+"-knowledge.json")));
  assert.ok(existsSync(join(root,v2+"-knowledge.json")));
}));

test("real Rumor JSON exchange uses a shared file and does NOT auto-import into another village",()=>temp(root=>{
  const {world}=setup(root);
  const published=world.publish({from:v1,text:"作業履歴を残してから次の担当に渡す"});
  const path=join(root,"village-square","rumors",published.rumor.id+".json");
  const disk=JSON.parse(readFileSync(path,"utf8"));
  assert.equal(disk.schemaVersion,"metron-rumor-v1");
  assert.equal(verifyRumor(disk).originVillage,v1);
  assert.equal(world.state().square.length,1);
  assert.equal(world.state().villages[v2].incoming.length,0);
  assert.equal(world.state().villages[v2].knowledge.length,1);
  assert.equal(world.state().villages[v1].transport.gatewayJobs,2);
}));

test("independent recipient Gateway collects Rumor; human alone decides adoption",()=>temp(root=>{
  const {world}=setup(root);
  const rumor=world.publish({from:v1,text:"復旧可能性を確かめた上でコードを反映"});
  assert.throws(()=>world.receive({villageId:v1,rumorId:rumor.rumor.id}),/may not import/);
  const delivery=world.receive({villageId:v2,rumorId:rumor.rumor.id});
  assert.equal(delivery.deduplicated,false);
  assert.equal(delivery.receipt.status,"pending");
  assert.equal(delivery.state.villages[v2].knowledge.length,1);
  assert.equal(delivery.state.villages[v2].transport.gatewayJobs,2);
  assert.equal(world.receive({villageId:v2,rumorId:rumor.rumor.id}).deduplicated,true);
  const adopted=world.review({villageId:v2,rumorId:rumor.rumor.id,decision:"adopt"});
  assert.equal(adopted.receipt.status,"adopted");
  assert.equal(adopted.state.villages[v2].knowledge.length,2);
  assert.equal(adopted.state.villages[v2].knowledge[1].sourceVillage,v1);
  assert.equal(adopted.state.villages[v2].knowledge[1].parentRumorId,rumor.rumor.id);
  assert.equal(adopted.state.villages[v1].knowledge.length,1);
  assert.throws(()=>world.review({villageId:v2,rumorId:rumor.rumor.id,decision:"adopt"}),/already reviewed/);
}));

test("noise filter strength is set by Gateway user, not hidden or automatic acceptance",()=>temp(root=>{
  const {world}=setup(root);
  const rumor=world.publish({from:v1,text:"短い"});
  assert.equal(world.setFilter({villageId:v2,level:2}).state.villages[v2].gatewayFilterLevel,2);
  const result=world.receive({villageId:v2,rumorId:rumor.rumor.id});
  assert.ok(result.receipt.noiseFlags.includes("short_message"));
  assert.equal(result.receipt.status,"pending");
  assert.equal(result.state.villages[v2].knowledge.length,1);
  assert.equal(world.review({villageId:v2,rumorId:rumor.rumor.id,decision:"quarantine"}).receipt.status,"quarantined");
  assert.equal(world.state().villages[v2].knowledge.length,1);
  assert.equal(world.setFilter({villageId:v2,level:0}).state.villages[v2].gatewayFilterLevel,0);
  assert.throws(()=>world.setFilter({villageId:v2,level:4}),/level must/);
}));

test("village-2 may publish a new Rumor to village-1, no fake AI derivation",()=>temp(root=>{
  const {world}=setup(root);
  const rum=world.publish({from:v2,text:"テスト結果の根拠を相互に保持する"});
  assert.equal(rum.rumor.originVillage,v2);
  assert.equal(world.state().villages[v2].transport.gatewayJobs,2);
  const received=world.receive({villageId:v1,rumorId:rum.rumor.id});
  assert.equal(received.state.villages[v1].incoming[0].status,"pending");
  assert.equal(received.state.villages[v2].knowledge.length,1);
}));

test("BAKU analyzes actual user-supplied source without executing or persisting it",()=>temp(root=>{
  const {world}=setup(root);
  const code="function unsafe(){return eval('1 + 1'); }";
  const result=world.salvage({code});
  assert.equal(result.artifact.sourceStored,false);
  assert.equal(result.artifact.executed,false);
  assert.ok(result.artifact.cards[0].flags.includes("dynamic-evaluation"));
  assert.equal(readFileSync(join(root,v1+"-knowledge.json"),"utf8").includes("function unsafe"),false);
  assert.throws(()=>world.salvage({}),/BAKU needs code/);
}));

test("legacy A/B-as-villages checkpoint remains untouched on v3 startup",()=>temp(root=>{
  const original='{"schemaVersion":1,"villages":{"A":{},"B":{}}}';
  writeFileSync(join(root,"civilization.json"),original);
  const {world}=setup(root);
  assert.equal(world.state().version,"civilization-0.3");
  assert.equal(readFileSync(join(root,"civilization.json"),"utf8"),original);
  assert.equal(world.state().square.length,0);
}));

test("Rumor SHA detects tampering without pretending to authenticate publisher",()=>temp(root=>{
  const {world}=setup(root);
  const r=world.publish({from:v1,text:"操作の履歴を残す"}).rumor;
  const path=join(root,"village-square","rumors",r.id+".json");
  const changed={...JSON.parse(readFileSync(path,"utf8")),body:"書き換えられた内容"};
  writeFileSync(path,JSON.stringify(changed));
  assert.throws(()=>world.receive({villageId:v2,rumorId:r.id}),/invalid_or_modified_rumor/);
  assert.throws(()=>world.state(),/invalid_or_modified_rumor/); // corrupt public rumor fails closed
}));

test("restart preserves both village checkpoints and user decisions",()=>temp(root=>{
  let {world}=setup(root);
  const r=world.publish({from:v1,text:"コンテキストを継承する"}).rumor;
  world.receive({villageId:v2,rumorId:r.id});
  world.review({villageId:v2,rumorId:r.id,decision:"adopt"});
  ({world}=setup(root));
  assert.equal(world.state().villages[v1].motherShips.length,2);
  assert.equal(world.state().villages[v2].knowledge.length,2);
  assert.equal(world.state().villages[v2].incoming[0].status,"adopted");
  assert.equal(world.state().square[0].id,r.id);
}));

test("isolated recovery validates A/B in one village, not P2P communication",()=>temp(root=>{
  const {world}=setup(root);
  const result=world.recoveryDemo();
  assert.equal(result.check.result,"LOCAL_TWO_MOTHERSHIP_PASS");
  assert.equal(result.check.historicalCrossSpreadsheetLinkVerified,false);
  assert.equal(result.state.square.length,0);
}));

test("HTTP endpoints publish actual Rumor files, require receiver import, and block other origins",()=>temp(async root=>{
  const app=await createMiniServer({root,port:0});
  const headers={"Content-Type":"application/json","X-Metron-Mini":"1"};
  async function action(body,head=headers){
    const r=await fetch(app.url+"/api/civilization/action",{
      method:"POST",headers:head,body:JSON.stringify(body)});
    return {status:r.status,payload:await r.json()};
  }
  try{
    const html=await fetch(app.url+"/experience").then(r=>r.text());
    assert.match(html,/Village Square/);
    assert.match(html,/母艦 A/);
    assert.match(html,/母艦 B/);
    const prior=await fetch(app.url+"/api/civilization/state").then(r=>r.json());
    assert.equal(prior.topology,"village_contains_A_and_B");
    const p=await action({action:"publish",from:v1,text:"文脈を維持する"});
    assert.equal(p.status,200);
    assert.equal(p.payload.state.villages[v2].incoming.length,0);
    const recv=await action({action:"receive",villageId:v2,rumorId:p.payload.rumor.id});
    assert.equal(recv.status,200);
    assert.equal(recv.payload.receipt.status,"pending");
    const rev=await action({action:"review",villageId:v2,rumorId:p.payload.rumor.id,decision:"adopt"});
    assert.equal(rev.status,200);
    assert.equal(rev.payload.state.villages[v2].knowledge.length,2);
    assert.equal((await action({action:"derive",rumorId:p.payload.rumor.id})).status,400);
    assert.equal((await action({action:"filter",villageId:v2,level:0})).status,200);
    assert.equal((await action({action:"salvage",code:"function broken(){ return eval('x') }"})).status,200);
    assert.equal((await action({action:"publish",text:"x"},{
      ...headers,Origin:"https://not-local.example"
    })).status,403);
  }finally{await app.close();}
}));

const execute=promisify(execFile);
function chrome(){
  return [
    process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
    "/usr/bin/chromium","/usr/bin/chromium-browser",
    process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,"Google","Chrome","Application","chrome.exe"),
    process.env["PROGRAMFILES(X86)"]&&join(process.env["PROGRAMFILES(X86)"],"Microsoft","Edge","Application","msedge.exe")
  ].filter(Boolean).find(existsSync);
}
test("Chromium renders village boundaries and local Rumor protocol",{
  skip:!chrome()
},()=>temp(async root=>{
  const app=await createMiniServer({root:join(root,"local"),port:0});
  try{
    const args=["--headless=new","--disable-gpu","--disable-background-networking",
      "--no-first-run","--disable-extensions","--virtual-time-budget=6000",
      "--user-data-dir="+join(root,"chrome"),"--dump-dom",app.url+"/experience"];
    if(process.getuid?.()===0)args.unshift("--no-sandbox");
    const {stdout}=await execute(chrome(),args,{timeout:30000,maxBuffer:8*1024*1024,windowsHide:true});
    assert.match(stdout,/第一の村/);
    assert.match(stdout,/第二の村/);
    assert.match(stdout,/母艦 A/);
    assert.match(stdout,/Village Square/);
    assert.match(stdout,/Rumor JSON/);
    assert.match(stdout,/確認完了/);
  }finally{await app.close();}
}));
