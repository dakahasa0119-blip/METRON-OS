import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MetronMiniRuntime } from "../../mini/runtime.mjs";
import { CivilizationExperience } from "../../mini/civilization.mjs";
import { createMiniServer } from "../../mini/server.mjs";

async function temp(fn) {
  const root=mkdtempSync(join(tmpdir(),"metron-civilization-test-"));
  try {return await fn(root);}
  finally {rmSync(root,{recursive:true,force:true});}
}
function world(root) {
  const runtime=new MetronMiniRuntime(root);
  return { runtime,experience:new CivilizationExperience(root,runtime) };
}
test("two villages begin with independent goals and memory",()=>temp(root=>{
  const {experience}=world(root);
  const state=experience.state();
  assert.notEqual(state.villages.A.name,state.villages.B.name);
  assert.notEqual(state.villages.A.knowledge[0].text,state.villages.B.knowledge[0].text);
  assert.equal(state.square.length,0);
  assert.equal(state.transport.gatewayJobs,0);
  assert.equal(state.mode,"deterministic_experience_not_autonomous_ai");
}));

test("Village Square shares via real Gateway and requires explicit human adoption",()=>temp(root=>{
  const {runtime,experience}=world(root);
  const first=experience.publish({from:"A",text:"検証後に知識を継承する"});
  assert.equal(first.rumor.status,"awaiting_review");
  assert.equal(first.state.villages.A.knowledge.length,1);
  assert.equal(first.state.villages.B.knowledge.length,1);
  assert.equal(first.state.transport.gatewayJobs,2);
  assert.equal(runtime.state().ships.B.count,1);
  assert.equal(runtime.state().ships.A.messages[0].type,"ACK");
  const adopted=experience.review({rumorId:first.rumor.id,decision:"adopt"});
  assert.equal(adopted.rumor.status,"adopted");
  assert.equal(adopted.state.villages.B.knowledge.length,2);
  assert.equal(adopted.state.villages.B.knowledge[1].parentId,first.rumor.id);
  assert.equal(adopted.state.villages.A.knowledge.length,1);
  assert.throws(()=>experience.review({rumorId:first.rumor.id,decision:"adopt"}),/already reviewed/);
}));

test("recipient can quarantine a rumor without contaminating its memory",()=>temp(root=>{
  const {experience}=world(root);
  const r=experience.publish({text:"根拠未確認の情報"});
  const s=experience.review({rumorId:r.rumor.id,decision:"quarantine"}).state;
  assert.equal(s.square[0].status,"quarantined");
  assert.equal(s.villages.B.knowledge.length,1);
  assert.throws(()=>experience.derive({rumorId:r.rumor.id}),/must adopt/);
}));

test("adopted knowledge produces rule-based B-to-A proposal with lineage and review",()=>temp(root=>{
  const {experience,runtime}=world(root);
  const first=experience.publish({from:"A",text:"切れたセッションの証拠は保存する"});
  experience.review({rumorId:first.rumor.id,decision:"adopt"});
  const proposed=experience.derive({rumorId:first.rumor.id});
  assert.equal(proposed.rumor.from,"B");
  assert.equal(proposed.rumor.to,"A");
  assert.equal(proposed.rumor.parentId,first.rumor.id);
  assert.equal(proposed.rumor.source,"rule_based_derivation");
  assert.equal(proposed.state.villages.A.knowledge.length,1);
  experience.review({rumorId:proposed.rumor.id,decision:"adopt"});
  const complete=experience.state();
  assert.equal(complete.villages.A.knowledge.length,2);
  assert.equal(complete.transport.gatewayJobs,4);
  assert.equal(runtime.state().ships.A.count,2);
  assert.equal(runtime.state().ships.B.count,2);
  assert.throws(()=>experience.derive({rumorId:first.rumor.id}),/Already created/);
}));

test("BAKU salvages static DNA into quarantine; isolated crash scenario proves resend",()=>temp(root=>{
  const {experience}=world(root);
  const salvaged=experience.salvage();
  assert.equal(salvaged.artifact.executed,false);
  assert.equal(salvaged.artifact.state,"quarantined");
  assert.ok(salvaged.artifact.cards.some(c=>c.flags.includes("dynamic-evaluation")));
  const recovered=experience.recoveryDemo();
  assert.equal(recovered.check.result,"LOCAL_TWO_MOTHERSHIP_PASS");
  assert.equal(recovered.check.duplicateAfterCrash,1);
  assert.equal(recovered.state.events.at(-1).kind,"recovered");
  assert.equal(JSON.stringify(recovered.state).includes("untrusted"),false);
}));

test("Village Square provenance and independent memory survive process recreation",()=>temp(root=>{
  let {experience}=world(root);
  const original=experience.publish({text:"保存してから配送する"});
  experience.review({rumorId:original.rumor.id,decision:"adopt"});
  ({experience}=world(root));
  const s=experience.state();
  assert.equal(s.square[0].id,original.rumor.id);
  assert.equal(s.villages.B.knowledge[1].origin,"A");
  assert.equal(s.villages.B.knowledge[1].parentId,original.rumor.id);
  assert.equal(s.events.length,2);
  assert.equal(s.transport.gatewayJobs,2);
}));

test("bad input and corrupt state fail closed without silently overwriting memory",()=>temp(root=>{
  const {experience}=world(root);
  assert.throws(()=>experience.publish({from:"C",text:"Hi"}),/short idea/);
  assert.throws(()=>experience.publish({text:"a".repeat(321)}),/short idea/);
  assert.throws(()=>experience.review({rumorId:"bad",decision:"adopt"}),/Unknown/);
  assert.throws(()=>experience.review({rumorId:"bad",decision:"allow_all"}),/adopt or quarantine/);
  const file=join(root,"civilization.json");
  writeFileSync(file,"not JSON");
  assert.throws(()=>world(root),SyntaxError);
  assert.equal(readFileSync(file,"utf8"),"not JSON");
}));

test("concept HTTP endpoints persist real review decisions and reject wrong origin",()=>temp(async root=>{
  const app=await createMiniServer({root,port:0});
  const headers={"Content-Type":"application/json","X-Metron-Mini":"1"};
  const action=async body=>{
    const response=await fetch(app.url+"/api/civilization/action",{
      method:"POST",headers,body:JSON.stringify(body)
    });
    return {status:response.status,body:await response.json()};
  };
  try {
    const [index,script,style]=await Promise.all([
      fetch(app.url+"/experience").then(r=>r.text()),
      fetch(app.url+"/experience.js").then(r=>r.text()),
      fetch(app.url+"/experience.css").then(r=>r.text())
    ]);
    assert.match(index,/Village Square/);
    assert.match(script,/\/api\/civilization\/action/);
    assert.match(style,/concept-map/);
    const prior=await fetch(app.url+"/api/civilization/state").then(r=>r.json());
    assert.equal(prior.villages.B.knowledge.length,1);
    const badOrigin=await fetch(app.url+"/api/civilization/action",{
      method:"POST",headers:{...headers,Origin:"https://invalid.example"},
      body:JSON.stringify({action:"salvage"})
    });
    assert.equal(badOrigin.status,403);
    const posted=await action({action:"publish",from:"A",text:"共通のルールを試す"});
    assert.equal(posted.status,200);
    assert.equal(posted.body.state.villages.B.knowledge.length,1);
    const reviewed=await action({
      action:"review",rumorId:posted.body.rumor.id,decision:"adopt"
    });
    assert.equal(reviewed.status,200);
    assert.equal(reviewed.body.state.villages.B.knowledge.length,2);
    assert.equal((await action({action:"nonsense"})).status,400);
    assert.equal((await action({action:"salvage"})).body.artifact.state,"quarantined");
  }finally{await app.close();}
}));

function availableChrome() {
  return [
    process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
    "/usr/bin/chromium","/usr/bin/chromium-browser",
    process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,"Google","Chrome","Application","chrome.exe"),
    process.env["PROGRAMFILES(X86)"]&&join(process.env["PROGRAMFILES(X86)"],"Microsoft","Edge","Application","msedge.exe")
  ].filter(Boolean).find(existsSync);
}
const run=promisify(execFile);
test("actual Chromium renders the interactive civilization map from local persisted state",
{skip:!availableChrome()},()=>temp(async root=>{
  const app=await createMiniServer({root:join(root,"storage"),port:0});
  try {
    const chrome=availableChrome();
    const args=["--headless=new","--disable-gpu","--disable-background-networking",
      "--no-first-run","--disable-extensions",
      "--virtual-time-budget=6000",
      "--user-data-dir="+join(root,"chrome-profile"),
      "--dump-dom",app.url+"/experience"];
    if(process.getuid?.()===0)args.unshift("--no-sandbox");
    const {stdout}=await run(chrome,args,{timeout:30000,maxBuffer:8*1024*1024,windowsHide:true});
    assert.match(stdout,/id="memory-a-count">記憶 1</);
    assert.match(stdout,/id="stat-ideas">0/);
    assert.match(stdout,/文明の状態を読み込みました/);
  }finally{await app.close();}
}));
