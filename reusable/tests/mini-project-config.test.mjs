import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {loadProjectStartup} from "../../mini/project-config.mjs";
function isolated(fn){
  const prefix=join(tmpdir(),"metron-config-"),root=mkdtempSync(prefix);
  try{return fn(root);}finally{assert.ok(resolve(root).startsWith(resolve(prefix)));rmSync(root,{recursive:true,force:true});}
}
test("ordinary Mini startup remains disabled and never asks a project or worker to run",()=>{
  let called=0;const createPlan=()=>{called++;};
  assert.deepEqual(loadProjectStartup({},{createPlan}),{projectPlans:[],projectOperatorToken:null,projectCodexOptions:undefined});
  assert.throws(()=>loadProjectStartup({METRON_CODEX_EXECUTABLE:"unselected-program"},{createPlan}),{code:"project_registry_required_for_codex"});
  assert.equal(called,0);
});
test("explicit local registration creates a fresh owner capability and fixed worker configuration without execution",()=>isolated(root=>{
  const registry=join(root,"projects.json"),exe=join(root,"codex.exe"),configs=[{id:"one"},{id:"two"}];
  writeFileSync(registry,"\uFEFF"+JSON.stringify(configs));writeFileSync(exe,"not an executable; no execution is allowed in this test");
  const observed=[],env={METRON_PROJECT_REGISTRY:registry,METRON_CODEX_EXECUTABLE:exe};
  const createPlan=c=>{observed.push(c);return Object.freeze({...c,validated:true});};
  const first=loadProjectStartup(env,{createPlan}),second=loadProjectStartup(env,{createPlan});
  assert.deepEqual(observed,[...configs,...configs]);assert.equal(first.projectPlans.length,2);
  assert.match(first.projectOperatorToken,/^[a-f0-9]{64}$/);assert.notEqual(first.projectOperatorToken,second.projectOperatorToken);
  assert.deepEqual(first.projectCodexOptions,{executable:exe});assert.deepEqual(env,{METRON_PROJECT_REGISTRY:registry,METRON_CODEX_EXECUTABLE:exe});
}));
test("validated host setup slots can configure an official worker before any checkout is prepared",()=>isolated(root=>{
  const exe=join(root,"codex.exe");writeFileSync(exe,"metadata only; never execute");
  let calls=0;
  const configured=loadProjectStartup({METRON_CODEX_EXECUTABLE:exe},{allowSetupSlots:true,createPlan:()=>{calls++;}});
  assert.deepEqual(configured.projectPlans,[]);assert.equal(calls,0);
  assert.deepEqual(configured.projectCodexOptions,{executable:exe});assert.match(configured.projectOperatorToken,/^[a-f0-9]{64}$/);
  assert.throws(()=>loadProjectStartup({METRON_CODEX_EXECUTABLE:"other-program"},{allowSetupSlots:true}),{code:"project_codex_official_executable_required"});
  assert.throws(()=>loadProjectStartup({METRON_CODEX_EXECUTABLE:exe}),{code:"project_registry_required_for_codex"});
}));
test("invalid registry or program configuration fails before accepting any registered plan",()=>isolated(root=>{
  const registry=join(root,"projects.json"),other=join(root,"other.exe");writeFileSync(other,"no execution");
  let called=0;const createPlan=c=>{called++;return c;};
  for(const body of ["invalid",JSON.stringify([]),JSON.stringify([{id:"same"},{id:"same"}])," ".repeat(32769)]){
    writeFileSync(registry,body);assert.throws(()=>loadProjectStartup({METRON_PROJECT_REGISTRY:registry},{createPlan}),{code:"invalid_project_startup_registry"});
  }
  writeFileSync(registry,JSON.stringify([{id:"one"}]));
  assert.throws(()=>loadProjectStartup({METRON_PROJECT_REGISTRY:registry,METRON_CODEX_EXECUTABLE:other},{createPlan}),{code:"project_codex_official_executable_required"});
  assert.throws(()=>loadProjectStartup({METRON_PROJECT_REGISTRY:registry,METRON_CODEX_EXECUTABLE:"codex.exe"},{createPlan}),{code:"project_codex_official_executable_required"});
  assert.throws(()=>loadProjectStartup({METRON_PROJECT_REGISTRY:"relative.json"},{createPlan}),{code:"invalid_project_startup_registry"});
  assert.equal(called,0);
}));
test("startup reports an actionable configuration failure without dumping selected file contents",()=>isolated(root=>{
  const path=join(root,"invalid-projects.json"),sentinel="SYNTHETIC_PRIVATE_CONFIG_CONTENT_MUST_NOT_BE_PRINTED";
  writeFileSync(path,sentinel);
  const env={};for(const key of ["PATH","PATHEXT","SystemRoot","WINDIR","COMSPEC","TEMP","TMP"])
    if(typeof process.env[key]==="string")env[key]=process.env[key];
  const result=spawnSync(process.execPath,[fileURLToPath(new URL("../../mini/start.mjs",import.meta.url))],{
    env:{...env,METRON_PROJECT_REGISTRY:path,METRON_CODEX_EXECUTABLE:"",METRON_MINI_DATA:join(root,"unused-runtime"),METRON_MINI_PORT:"0"},
    encoding:"utf8",windowsHide:true,shell:false,timeout:10000});
  assert.equal(result.status,1);assert.equal(result.error,undefined);
  assert.match(result.stderr,/METRON_PROJECT_SETUP_FAILED/);assert.match(result.stderr,/METRON_MINI_PROJECT_USER_FLOW/);
  assert.match(result.stderr,/No worker was started/);assert.ok(!result.stderr.includes(sentinel));
  assert.ok(!result.stdout.includes("METRON_MINI_RUNNING"));assert.ok(!result.stdout.includes("project-operator="));
}));
