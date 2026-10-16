/** Explicit local startup configuration; HTTP never supplies roots or programs. */
import {readFileSync,lstatSync,openSync,closeSync,fstatSync,constants} from "node:fs";
import {resolve,isAbsolute,parse,relative,sep,basename} from "node:path";
import {randomBytes} from "node:crypto";
import {createRegisteredProjectPlan} from "./project-tools.mjs";
const fail=code=>Object.assign(new Error(code),{code});
function regularFile(value,limit,code){
  if(typeof value!=="string"||!value||!isAbsolute(value))throw fail(code);
  const path=resolve(value);let current=parse(path).root;
  for(const part of relative(current,path).split(sep).filter(Boolean)){
    current=resolve(current,part);const stat=lstatSync(current);
    if(stat.isSymbolicLink())throw fail(code);
  }
  const stat=lstatSync(path);if(!stat.isFile()||stat.size>limit)throw fail(code);
  return {path,stat};
}
function workerOptions(executable){
  if(!executable)return undefined;
  if(!/^codex(?:\.exe)?$/i.test(basename(executable)))throw fail("project_codex_official_executable_required");
  try{return {executable:regularFile(executable,1024*1024*1024,"project_codex_official_executable_required").path};}
  catch{throw fail("project_codex_official_executable_required");}
}
export function loadProjectStartup(env=process.env,{createPlan=createRegisteredProjectPlan,allowSetupSlots=false}={}){
  const registry=env.METRON_PROJECT_REGISTRY,executable=env.METRON_CODEX_EXECUTABLE;
  if(!registry){
    // Only the local startup caller can authorize already validated setup slots.
    // An HTTP request cannot enable this path or choose a program.
    if(allowSetupSlots)return {projectPlans:[],projectOperatorToken:randomBytes(32).toString("hex"),
      projectCodexOptions:workerOptions(executable)};
    if(executable)throw fail("project_registry_required_for_codex");
    return {projectPlans:[],projectOperatorToken:null,projectCodexOptions:undefined};
  }
  let configs,fd;
  try{
    const {path,stat}=regularFile(registry,32768,"invalid_project_startup_registry");
    fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const opened=fstatSync(fd);
    if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw fail("invalid_project_startup_registry");
    const bytes=readFileSync(fd),after=fstatSync(fd);
    if(bytes.length>32768||bytes.length!==opened.size||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)
      throw fail("invalid_project_startup_registry");
    configs=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes).replace(/^\uFEFF/,""));
  }catch{throw fail("invalid_project_startup_registry");}
  finally{if(fd!==undefined)closeSync(fd);}
  if(!Array.isArray(configs)||configs.length<1||configs.length>8||configs.some(c=>!c||typeof c!=="object"||Array.isArray(c))||
    new Set(configs.map(c=>c.id)).size!==configs.length)throw fail("invalid_project_startup_registry");
  const projectCodexOptions=workerOptions(executable);
  const projectPlans=configs.map(createPlan);
  return {projectPlans,projectOperatorToken:randomBytes(32).toString("hex"),
    projectCodexOptions};
}
