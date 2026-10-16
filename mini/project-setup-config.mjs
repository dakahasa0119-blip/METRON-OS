/** Host-authored setup slots. Browser input never supplies paths or programs. */
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,fstatSync,constants,existsSync} from "node:fs";
import {resolve,isAbsolute,parse,relative,sep,dirname,join} from "node:path";

const fail=code=>Object.assign(new Error(code),{code});
const keys=["id","label","repositoryRoot","baseCommit","allowedEdits","publicTests","postApplyTests","acceptanceRoot","acceptanceTests","allocationRoot"];
const fold=value=>resolve(value).toLowerCase();
export const setupRootsOverlap=(a,b)=>{a=fold(a);b=fold(b);return a===b||a.startsWith(b+sep)||b.startsWith(a+sep);};
export function setupRelativePath(value){
  if(typeof value!=="string"||!value||value.length>180||isAbsolute(value)||/[\\:<>|?*\x00-\x1f\x7f]/.test(value)||
    value.split("/").some(p=>!p||p==="."||p===".."||/[. ]$/.test(p)||/^(?:\.git|node_modules)$/i.test(p)||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(p)))throw fail("project_setup_invalid_slot");
  return value;
}
/** Existing ancestors must be real directories; a missing final component is optional. */
export function setupDirectory(value,{missing=false}={}){
  if(typeof value!=="string"||!value||!isAbsolute(value))throw fail("project_setup_invalid_root");
  const path=resolve(value),parts=relative(parse(path).root,path).split(sep).filter(Boolean);let current=parse(path).root;
  for(let i=0;i<parts.length;i++){
    current=join(current,parts[i]);
    if(missing&&i===parts.length-1&&!existsSync(current))return join(realpathSync(dirname(current)),parts[i]);
    const stat=lstatSync(current);
    if(stat.isSymbolicLink()||!stat.isDirectory())throw fail("project_setup_invalid_root");
  }
  return realpathSync(path);
}
export function setupReadFile(path,limit=2*1024*1024){
  setupDirectory(dirname(path));const stat=lstatSync(path);let fd;
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size>limit)throw fail("project_setup_invalid_file");
  try{
    fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=fstatSync(fd);
    if(before.dev!==stat.dev||before.ino!==stat.ino||before.size!==stat.size)throw fail("project_setup_file_changed");
    const bytes=readFileSync(fd),after=fstatSync(fd);
    if(bytes.length>limit||bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)
      throw fail("project_setup_file_changed");
    return bytes;
  }finally{if(fd!==undefined)closeSync(fd);}
}
const fixedTests=value=>{
  if(!Array.isArray(value)||value.length<1||value.length>8)throw fail("project_setup_invalid_slot");
  const paths=value.map(setupRelativePath);
  if(paths.some(p=>!p.endsWith(".test.mjs"))||new Set(paths.map(p=>p.toLowerCase())).size!==paths.length)
    throw fail("project_setup_invalid_slot");
  return paths;
};
const freeze=value=>{if(value&&typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function validateProjectSetupSlots(input){
  if(!Array.isArray(input)||input.length>8)throw fail("project_setup_invalid_slots");
  const ids=new Set();
  const slots=input.map(slot=>{
    if(!slot||typeof slot!=="object"||Array.isArray(slot)||Object.keys(slot).length!==keys.length||keys.some(k=>!Object.hasOwn(slot,k))||
      typeof slot.id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(slot.id)||ids.has(slot.id.toLowerCase())||
      typeof slot.label!=="string"||!slot.label.trim()||slot.label!==slot.label.trim()||slot.label.length>120||
      typeof slot.baseCommit!=="string"||!/^[a-f0-9]{40}$/.test(slot.baseCommit))throw fail("project_setup_invalid_slot");
    ids.add(slot.id.toLowerCase());
    if(!Array.isArray(slot.allowedEdits)||!slot.allowedEdits.length||slot.allowedEdits.length>64)throw fail("project_setup_invalid_slot");
    const seen=new Set(),allowedEdits=slot.allowedEdits.map(entry=>{
      if(!entry||typeof entry!=="object"||Array.isArray(entry)||Object.keys(entry).length!==2||!Object.hasOwn(entry,"path")||
        !Object.hasOwn(entry,"operations")||!Array.isArray(entry.operations)||!entry.operations.length||entry.operations.length>3||
        new Set(entry.operations).size!==entry.operations.length||entry.operations.some(op=>!["add","edit","delete"].includes(op)))
        throw fail("project_setup_invalid_slot");
      const path=setupRelativePath(entry.path),key=path.toLowerCase();if(seen.has(key))throw fail("project_setup_invalid_slot");seen.add(key);
      return {path,operations:[...entry.operations]};
    });
    const normalized={...slot,allowedEdits,publicTests:fixedTests(slot.publicTests),postApplyTests:fixedTests(slot.postApplyTests),
      acceptanceTests:fixedTests(slot.acceptanceTests),repositoryRoot:setupDirectory(slot.repositoryRoot),
      acceptanceRoot:setupDirectory(slot.acceptanceRoot),allocationRoot:setupDirectory(slot.allocationRoot,{missing:true})};
    for(const path of normalized.acceptanceTests)setupReadFile(join(normalized.acceptanceRoot,...path.split("/")));
    const roots=[normalized.repositoryRoot,normalized.acceptanceRoot,normalized.allocationRoot];
    for(let i=0;i<roots.length;i++)for(let j=0;j<i;j++)if(setupRootsOverlap(roots[i],roots[j]))throw fail("project_setup_roots_overlap");
    return normalized;
  });
  for(let i=0;i<slots.length;i++)for(let j=0;j<i;j++){
    if(setupRootsOverlap(slots[i].repositoryRoot,slots[j].acceptanceRoot)||setupRootsOverlap(slots[j].repositoryRoot,slots[i].acceptanceRoot))
      throw fail("project_setup_roots_overlap");
    for(const key of ["repositoryRoot","acceptanceRoot","allocationRoot"])
      if(setupRootsOverlap(slots[i].allocationRoot,slots[j][key])||setupRootsOverlap(slots[j].allocationRoot,slots[i][key]))
        throw fail("project_setup_roots_overlap");
  }
  return freeze(slots);
}
/** Read-only mixed-registry check, called before creating runtime storage. */
export function validateProjectSetupCompatibility(rawSlots,projectPlans=[]){
  const slots=validateProjectSetupSlots(rawSlots),rootKeys=["repositoryRoot","baselineRoot","candidateRoot","applyRoot","evidenceRoot","tempRoot","acceptanceRoot","commonRoot"];
  if(!slots.length)return slots;
  if(!Array.isArray(projectPlans)||projectPlans.length>8)throw fail("project_setup_invalid_existing_plan");
  const existing=projectPlans.map(plan=>{
    if(!plan||typeof plan!=="object"||Array.isArray(plan)||typeof plan.id!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(plan.id))
      throw fail("project_setup_invalid_existing_plan");
    try{return Object.fromEntries(rootKeys.map(key=>[key,setupDirectory(plan[key])])) ;}
    catch{throw fail("project_setup_invalid_existing_plan");}
  });
  for(const slot of slots)for(const plan of existing){
    const sharedSource=fold(slot.repositoryRoot)===fold(plan.repositoryRoot);
    for(const key of rootKeys){
      if(setupRootsOverlap(slot.allocationRoot,plan[key]))throw fail("project_setup_roots_overlap");
      if(key!=="acceptanceRoot"&&setupRootsOverlap(slot.acceptanceRoot,plan[key]))throw fail("project_setup_roots_overlap");
      if(!["repositoryRoot","commonRoot"].includes(key)&&setupRootsOverlap(slot.repositoryRoot,plan[key]))throw fail("project_setup_roots_overlap");
    }
    // The source may deliberately reuse an existing original repository. Its
    // normal .git common directory is then necessarily inside that same root.
    const ownContainedCommon=sharedSource&&fold(plan.commonRoot).startsWith(fold(plan.repositoryRoot)+sep);
    if(setupRootsOverlap(slot.repositoryRoot,plan.commonRoot)&&!ownContainedCommon)throw fail("project_setup_roots_overlap");
  }
  return slots;
}
export function loadProjectSetupStartup(env=process.env){
  if(!env.METRON_PROJECT_SETUP_MANIFEST)return {setupSlots:[]};
  try{
    const file=env.METRON_PROJECT_SETUP_MANIFEST;
    if(typeof file!=="string"||!isAbsolute(file))throw fail("invalid_project_setup_manifest");
    const input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(setupReadFile(resolve(file),32768)).replace(/^\uFEFF/,""));
    if(!Array.isArray(input)||!input.length)throw fail("invalid_project_setup_manifest");
    return {setupSlots:validateProjectSetupSlots(input)};
  }catch{throw fail("invalid_project_setup_manifest");}
}
