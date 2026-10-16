import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash,randomBytes} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync,symlinkSync} from "node:fs";
import {join,resolve,relative,isAbsolute,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {ProjectSetup} from "../../mini/project-setup.mjs";
import {loadProjectSetupStartup,validateProjectSetupSlots,validateProjectSetupCompatibility} from "../../mini/project-setup-config.mjs";

const phase=resolve(fileURLToPath(new URL("../../../metron-evidence/village-bootstrap-20261015",import.meta.url)));
mkdirSync(phase,{recursive:true});
const request=()=>"setup_"+randomBytes(16).toString("hex");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
function git(root,args){
  const result=spawnSync("git",["--no-pager","-c","core.hooksPath="+join(root,"disabled-hooks"),"-c","core.fsmonitor=false",
    "-c","core.autocrlf=false","-c","commit.gpgsign=false","-c","user.name=Setup Test","-c","user.email=setup-test@example.invalid",...args],
  {cwd:root,shell:false,windowsHide:true,encoding:"utf8",timeout:15000});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim();
}
function fixture(t){
  const root=mkdtempSync(join(phase,"s-")),repo=join(root,"r"),sealed=join(root,"s"),runtime=join(root,"d"),allocation=join(root,"o");
  for(const p of [repo,sealed,runtime,join(root,"empty-template")])mkdirSync(p);
  mkdirSync(join(repo,"src"));mkdirSync(join(repo,"tests"));
  writeFileSync(join(repo,"src","value.mjs"),"export const value = 1;\n");
  writeFileSync(join(repo,"tests","public.test.mjs"),"// Fixed public fixture; setup must never execute this file.\nthrow new Error('setup executed a test');\n");
  writeFileSync(join(repo,"tests","smoke.test.mjs"),"// Fixed smoke fixture; setup must never execute this file.\nthrow new Error('setup executed a test');\n");
  writeFileSync(join(sealed,"owner.test.mjs"),"// Independent host check; not worker input.\nthrow new Error('setup executed a sealed test');\n");
  git(repo,["init","--template="+join(root,"empty-template")]);git(repo,["add","."]);git(repo,["commit","-m","Synthetic setup fixture"]);
  const baseCommit=git(repo,["rev-parse","HEAD"]),slot={id:"setup-fixture",label:"Synthetic setup target",repositoryRoot:repo,baseCommit,
    allowedEdits:[{path:"src/value.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],postApplyTests:["tests/smoke.test.mjs"],
    acceptanceRoot:sealed,acceptanceTests:["owner.test.mjs"],allocationRoot:allocation};
  t.after(()=>{
    const rel=relative(phase,resolve(root));assert.ok(rel&&!isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+sep));
    rmSync(root,{recursive:true,force:true});
  });
  return {root,repo,sealed,runtime,allocation,slot,baseCommit};
}
const inputFor=(setup,slotId="setup-fixture",requestId=request())=>({slotId,setupDigest:setup.catalog().slots.find(s=>s.id===slotId).setupDigest,requestId,allowPrepare:true});
const treeCount=repo=>git(repo,["worktree","list","--porcelain"]).split("\n").filter(line=>line.startsWith("worktree ")).length;

test("startup manifest remains independent, exact and bounded",t=>{
  const f=fixture(t);assert.deepEqual(loadProjectSetupStartup({}),{setupSlots:[]});
  const file=join(f.root,"slots.json");writeFileSync(file,"\uFEFF"+JSON.stringify([f.slot]));
  const loaded=loadProjectSetupStartup({METRON_PROJECT_SETUP_MANIFEST:file,METRON_CODEX_EXECUTABLE:"not consulted"});
  assert.equal(loaded.setupSlots.length,1);assert.equal(loaded.setupSlots[0].id,f.slot.id);
  assert.equal(Object.isFrozen(loaded.setupSlots[0]),true);assert.equal(treeCount(f.repo),1);
  for(const value of [[{...f.slot,command:"node"}],[f.slot,{...f.slot,id:f.slot.id.toUpperCase(),allocationRoot:join(f.root,"other")}],[],{}]){
    writeFileSync(file,JSON.stringify(value));assert.throws(()=>loadProjectSetupStartup({METRON_PROJECT_SETUP_MANIFEST:file}),{code:"invalid_project_setup_manifest"});
  }
  writeFileSync(file,Buffer.from([0xff]));assert.throws(()=>loadProjectSetupStartup({METRON_PROJECT_SETUP_MANIFEST:file}),{code:"invalid_project_setup_manifest"});
  writeFileSync(file," ".repeat(32769));assert.throws(()=>loadProjectSetupStartup({METRON_PROJECT_SETUP_MANIFEST:file}),{code:"invalid_project_setup_manifest"});
  assert.throws(()=>loadProjectSetupStartup({METRON_PROJECT_SETUP_MANIFEST:"relative.json"}),{code:"invalid_project_setup_manifest"});
});

test("explicit setup creates three detached worktrees and only a registered plan",async t=>{
  const f=fixture(t),source=sha(readFileSync(join(f.repo,"src","value.mjs"))),sealed=sha(readFileSync(join(f.sealed,"owner.test.mjs")));let issued;
  const setup=new ProjectSetup({root:f.runtime,slots:[f.slot],onPrepared:plan=>{
    const persisted=JSON.parse(readFileSync(join(f.runtime,"project-setup",f.slot.id+".json"),"utf8"));
    assert.equal(persisted.job.status,"ready");assert.equal(persisted.job.planDigest,plan.planDigest);issued=plan;
  }});t.after(()=>setup.close());
  assert.deepEqual(setup.preparedPlans(),[]);assert.equal(treeCount(f.repo),1);
  const input=inputFor(setup),first=setup.prepare(input);assert.equal(first.job.status,"queued");assert.equal(first.duplicate,false);
  assert.equal(setup.prepare(input).duplicate,true);await setup.waitForIdle();
  const state=setup.state({slotId:f.slot.id});assert.equal(state.job.status,"ready",JSON.stringify(state));assert.equal(treeCount(f.repo),4);
  assert.equal(issued.id,f.slot.id);assert.equal(state.job.planDigest,issued.planDigest);
  for(const name of ["a","b","c"]){assert.equal(git(join(f.allocation,name),["rev-parse","HEAD"]),f.baseCommit);assert.equal(git(join(f.allocation,name),["branch","--show-current"]),"");}
  assert.equal(git(f.repo,["rev-parse","HEAD"]),f.baseCommit);assert.equal(sha(readFileSync(join(f.repo,"src","value.mjs"))),source);
  assert.equal(sha(readFileSync(join(f.sealed,"owner.test.mjs"))),sealed);assert.equal(git(f.repo,["status","--porcelain"]),"");
  const publicText=JSON.stringify(setup.catalog());
  for(const privateValue of [f.repo,f.sealed,f.allocation,"owner.test.mjs","ownerNonce","runtimeRoot"])assert.equal(publicText.includes(privateValue),false);
  assert.equal(setup.prepare(input).job.status,"ready");assert.throws(()=>setup.prepare({...input,requestId:request()}),{code:"project_setup_slot_already_attempted"});
  await setup.close();const restored=new ProjectSetup({root:f.runtime,slots:[f.slot]});t.after(()=>restored.close());
  assert.equal(restored.catalog().slots[0].status,"ready");const before=treeCount(f.repo);
  assert.equal(restored.preparedPlans()[0].planDigest,issued.planDigest);assert.equal(treeCount(f.repo),before);
  assert.equal(restored.prepare(input).duplicate,true);assert.equal(treeCount(f.repo),before);
});

test("HTTP-shaped input cannot replace host paths, commands or pinned scope",t=>{
  const f=fixture(t),setup=new ProjectSetup({root:f.runtime,slots:[f.slot]});t.after(()=>setup.close());const input=inputFor(setup);
  for(const extra of [{repositoryRoot:f.root},{command:"node"},{baseCommit:f.baseCommit},{publicTests:[]}])
    assert.throws(()=>setup.prepare({...input,...extra}),{code:"project_setup_explicit_prepare_required"});
  assert.throws(()=>setup.prepare({...input,allowPrepare:false}),{code:"project_setup_explicit_prepare_required"});
  assert.throws(()=>setup.prepare({...input,setupDigest:"0".repeat(64)}),{code:"project_setup_digest_mismatch"});
  assert.throws(()=>setup.prepare({...input,requestId:"arbitrary"}),{code:"project_setup_explicit_prepare_required"});
  assert.throws(()=>setup.state({slotId:f.slot.id,path:f.root}),{code:"project_setup_slot_required"});
  assert.equal(treeCount(f.repo),1);assert.equal(existsSync(f.allocation),false);
});

test("preexisting allocation is quarantined without changes or automatic retry",async t=>{
  const f=fixture(t);mkdirSync(f.allocation);writeFileSync(join(f.allocation,"keep.txt"),"existing data\n");
  const setup=new ProjectSetup({root:f.runtime,slots:[f.slot]});const input=inputFor(setup);setup.prepare(input);await setup.waitForIdle();
  assert.equal(setup.state({slotId:f.slot.id}).job.reason,"project_setup_allocation_not_empty");
  assert.equal(readFileSync(join(f.allocation,"keep.txt"),"utf8"),"existing data\n");assert.deepEqual(readdirSync(f.allocation),["keep.txt"]);
  assert.equal(treeCount(f.repo),1);assert.equal(setup.prepare(input).duplicate,true);await setup.close();
  const restored=new ProjectSetup({root:f.runtime,slots:[f.slot]});t.after(()=>restored.close());assert.deepEqual(restored.preparedPlans(),[]);
  assert.equal(restored.catalog().slots[0].status,"requires_owner_reconciliation");assert.equal(treeCount(f.repo),1);
});

test("cancellation before launch and restart never prepare or run checks",async t=>{
  const f=fixture(t),setup=new ProjectSetup({root:f.runtime,slots:[f.slot]});const input=inputFor(setup);setup.prepare(input);await setup.close();
  assert.equal(setup.state({slotId:f.slot.id}).job.reason,"project_setup_cancelled");assert.equal(treeCount(f.repo),1);assert.equal(existsSync(f.allocation),false);
  const restored=new ProjectSetup({root:f.runtime,slots:[f.slot]});t.after(()=>restored.close());assert.deepEqual(restored.preparedPlans(),[]);
  assert.equal(restored.prepare(input).duplicate,true);await restored.waitForIdle();assert.equal(treeCount(f.repo),1);
});

test("host scope rejects overlap, case collisions, unsafe paths and symlink roots",t=>{
  const f=fixture(t);
  for(const change of [{allocationRoot:join(f.repo,"nested")},{acceptanceRoot:f.repo},{allowedEdits:[{path:"../outside",operations:["edit"]}]},
    {allowedEdits:[{path:"src/value.mjs",operations:["edit"]},{path:"SRC/VALUE.MJS",operations:["edit"]}]},
    {publicTests:["tests/public.test.mjs","TESTS/PUBLIC.test.mjs"]}])assert.throws(()=>validateProjectSetupSlots([{...f.slot,...change}]));
  assert.throws(()=>new ProjectSetup({root:f.repo,slots:[f.slot]}),{code:"project_setup_roots_overlap"});
  const alias=join(f.root,"alias");let symlinkAvailable=true;
  try{symlinkSync(f.repo,alias,process.platform==="win32"?"junction":"dir");}catch(error){if(["EPERM","EACCES"].includes(error.code))symlinkAvailable=false;else throw error;}
  if(symlinkAvailable)assert.throws(()=>validateProjectSetupSlots([{...f.slot,repositoryRoot:alias}]),{code:"project_setup_invalid_root"});
  assert.equal(treeCount(f.repo),1);
});

test("attributes and partial-clone configuration are refused before disk preparation",async t=>{
  const f=fixture(t);writeFileSync(join(f.repo,".gitattributes"),"*.mjs filter=not-executed\n");git(f.repo,["add",".gitattributes"]);git(f.repo,["commit","-m","Attributes forbidden"]);
  const slot={...f.slot,baseCommit:git(f.repo,["rev-parse","HEAD"])};const setup=new ProjectSetup({root:f.runtime,slots:[slot]});t.after(()=>setup.close());
  setup.prepare(inputFor(setup));await setup.waitForIdle();assert.equal(setup.state({slotId:slot.id}).job.reason,"project_setup_git_attributes_forbidden");
  assert.equal(existsSync(f.allocation),false);assert.equal(treeCount(f.repo),1);
  const g=fixture(t);git(g.repo,["config","remote.origin.promisor","true"]);const other=new ProjectSetup({root:g.runtime,slots:[g.slot]});t.after(()=>other.close());
  other.prepare(inputFor(other));await other.waitForIdle();assert.equal(other.state({slotId:g.slot.id}).job.reason,"project_setup_external_git_configuration");
  assert.equal(existsSync(g.allocation),false);assert.equal(treeCount(g.repo),1);
});

test("configured hooks are disabled and sealed drift fails closed",async t=>{
  const f=fixture(t),hooks=join(f.root,"h"),sentinel=join(f.root,"hook-ran");mkdirSync(hooks);
  writeFileSync(join(hooks,"post-checkout"),"#!/bin/sh\necho unsafe > '"+sentinel.replaceAll("\\","/")+"'\n",{mode:0o755});git(f.repo,["config","core.hooksPath",hooks]);
  const setup=new ProjectSetup({root:f.runtime,slots:[f.slot]});t.after(()=>setup.close());setup.prepare(inputFor(setup));await setup.waitForIdle();
  assert.equal(setup.state({slotId:f.slot.id}).job.status,"ready");assert.equal(existsSync(sentinel),false);
  await setup.close();writeFileSync(join(f.sealed,"owner.test.mjs"),"// changed by host\n");
  assert.throws(()=>new ProjectSetup({root:f.runtime,slots:[f.slot]}),{code:"project_setup_ledger_invalid"});assert.equal(existsSync(sentinel),false);
});

test("a recorded queued interruption is read as owner reconciliation without worktrees",async t=>{
  const f=fixture(t),setup=new ProjectSetup({root:f.runtime,slots:[f.slot]});const input=inputFor(setup);setup.prepare(input);
  // A second startup observes durable intent while the original has not entered its job.
  const restored=new ProjectSetup({root:f.runtime,slots:[f.slot]});t.after(()=>restored.close());
  assert.equal(restored.state({slotId:f.slot.id}).job.reason,"project_setup_interrupted");assert.equal(restored.prepare(input).duplicate,true);
  await setup.waitForIdle();assert.equal(treeCount(f.repo),1);assert.equal(existsSync(f.allocation),false);await setup.close();
});

test("completed worktrees stay quarantined when activation fails, with no retry",async t=>{
  const f=fixture(t);let calls=0;const setup=new ProjectSetup({root:f.runtime,slots:[f.slot],onPrepared:()=>{calls++;throw new Error("owner activation unavailable");}});
  const input=inputFor(setup);setup.prepare(input);await setup.waitForIdle();
  assert.equal(setup.state({slotId:f.slot.id}).job.status,"requires_owner_reconciliation");assert.equal(calls,1);assert.equal(treeCount(f.repo),4);
  assert.deepEqual(setup.preparedPlans(),[]);assert.equal(setup.prepare(input).duplicate,true);assert.equal(calls,1);
  await setup.close();const restored=new ProjectSetup({root:f.runtime,slots:[f.slot],onPrepared:()=>{calls++;}});t.after(()=>restored.close());
  assert.deepEqual(restored.preparedPlans(),[]);assert.equal(treeCount(f.repo),4);assert.equal(calls,1);
});

test("failed durable ready save never activates a plan and retains owned worktrees",async t=>{
  const f=fixture(t),activePlans=new Map();let callbacks=0,readyFailures=0;
  const setup=new ProjectSetup({root:f.runtime,slots:[f.slot],onPrepared:plan=>{callbacks++;activePlans.set(plan.id,plan);}});
  const save=setup.save.bind(setup);
  setup.save=record=>{
    if(record.job.status==="ready"&&readyFailures===0){readyFailures++;throw Object.assign(new Error("synthetic ready checkpoint failure"),{code:"EIO"});}
    return save(record);
  };
  const input=inputFor(setup);setup.prepare(input);await setup.waitForIdle();
  assert.equal(readyFailures,1);assert.equal(callbacks,0);assert.equal(activePlans.size,0);assert.equal(setup.plans.size,0);
  const persisted=JSON.parse(readFileSync(join(f.runtime,"project-setup",f.slot.id+".json"),"utf8"));
  assert.equal(persisted.job.status,"requires_owner_reconciliation");assert.equal(persisted.job.reason,"project_setup_failed");
  assert.equal(Object.hasOwn(persisted.job,"planDigest"),false);assert.equal(treeCount(f.repo),4);
  assert.equal(setup.prepare(input).duplicate,true);assert.equal(callbacks,0);await setup.close();
  const restored=new ProjectSetup({root:f.runtime,slots:[f.slot],onPrepared:plan=>activePlans.set(plan.id,plan)});t.after(()=>restored.close());
  assert.deepEqual(restored.preparedPlans(),[]);assert.equal(activePlans.size,0);assert.equal(treeCount(f.repo),4);
});

test("repository and sealed roots cannot overlap across separate slots",t=>{
  const f=fixture(t),g=fixture(t);
  const other={...g.slot,id:"other-fixture",acceptanceRoot:f.repo,acceptanceTests:["tests/public.test.mjs"]};
  assert.throws(()=>validateProjectSetupSlots([f.slot,other]),{code:"project_setup_roots_overlap"});
  assert.throws(()=>validateProjectSetupSlots([other,f.slot]),{code:"project_setup_roots_overlap"});
  assert.equal(treeCount(f.repo),1);assert.equal(treeCount(g.repo),1);
});

test("mixed registry prevents private-root overlap while allowing deliberate shared source",async t=>{
  assert.deepEqual(validateProjectSetupCompatibility([],["legacy opaque plan"]),[]);
  const f=fixture(t),g=fixture(t);let plan;
  const setup=new ProjectSetup({root:f.runtime,slots:[f.slot],onPrepared:value=>{plan=value;}});t.after(()=>setup.close());
  setup.prepare(inputFor(setup));await setup.waitForIdle();assert.equal(setup.state({slotId:f.slot.id}).job.status,"ready");assert.ok(plan);
  const slot={...g.slot,id:"new-fixture"},sourceBytes=sha(readFileSync(join(f.repo,"src","value.mjs"))),sealedBytes=sha(readFileSync(join(f.sealed,"owner.test.mjs")));
  const worktrees=treeCount(f.repo),oldLedger=sha(readFileSync(join(f.runtime,"project-setup",f.slot.id+".json")));
  assert.equal(validateProjectSetupCompatibility([slot],[plan])[0].id,slot.id);
  const shared={...slot,repositoryRoot:plan.repositoryRoot,baseCommit:plan.baseCommit};
  assert.equal(validateProjectSetupCompatibility([shared],[plan])[0].repositoryRoot,plan.repositoryRoot);
  assert.equal(Object.isFrozen(validateProjectSetupCompatibility([shared],[plan])[0]),true);
  assert.throws(()=>validateProjectSetupCompatibility([{...slot,repositoryRoot:plan.acceptanceRoot}],[plan]),{code:"project_setup_roots_overlap"});
  assert.throws(()=>validateProjectSetupCompatibility([{...slot,acceptanceRoot:plan.repositoryRoot,acceptanceTests:["tests/public.test.mjs"]}],[plan]),{code:"project_setup_roots_overlap"});
  for(const key of ["repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot","commonRoot"])
    assert.throws(()=>validateProjectSetupCompatibility([{...slot,allocationRoot:join(plan[key],"new-allocation")}],[plan]),{code:"project_setup_roots_overlap"});
  for(const key of ["baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","commonRoot"])
    assert.throws(()=>validateProjectSetupCompatibility([{...slot,repositoryRoot:plan[key]}],[plan]),{code:"project_setup_roots_overlap"});
  for(const malformed of [null,"not a plan",{}, {...plan,tempRoot:"relative"}])
    assert.throws(()=>validateProjectSetupCompatibility([slot],[malformed]),{code:"project_setup_invalid_existing_plan"});
  assert.equal(treeCount(f.repo),worktrees);assert.equal(treeCount(g.repo),1);assert.equal(existsSync(g.allocation),false);
  assert.equal(sha(readFileSync(join(f.runtime,"project-setup",f.slot.id+".json"))),oldLedger);
  assert.equal(sha(readFileSync(join(f.repo,"src","value.mjs"))),sourceBytes);assert.equal(sha(readFileSync(join(f.sealed,"owner.test.mjs"))),sealedBytes);
});

test("ignored extra files and dirty source are rejected without copying into worktrees",async t=>{
  const f=fixture(t);writeFileSync(join(f.repo,".gitignore"),"local-only.txt\n");git(f.repo,["add",".gitignore"]);git(f.repo,["commit","-m","Ignore private local file"]);
  writeFileSync(join(f.repo,"local-only.txt"),"synthetic local-only fixture; not worker material\n");
  const setup=new ProjectSetup({root:f.runtime,slots:[{...f.slot,baseCommit:git(f.repo,["rev-parse","HEAD"])}]});t.after(()=>setup.close());
  setup.prepare(inputFor(setup));await setup.waitForIdle();assert.equal(setup.state({slotId:f.slot.id}).job.reason,"project_setup_source_not_clean");
  assert.equal(treeCount(f.repo),1);assert.equal(existsSync(f.allocation),false);
});
