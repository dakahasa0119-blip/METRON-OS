/** Owner-driven, local-only village bundles. Existing civilization is never
 * rewritten. HTTP callers must enforce the owner's current capability. */
import {mkdirSync,lstatSync,realpathSync,readFileSync,writeFileSync,readdirSync,openSync,closeSync,unlinkSync,existsSync} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute,parse,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {writeAtomicJson} from '../reusable/gateway-jobs/checkpoint.mjs';

const fail=code=>Object.assign(Error(code),{code}),clone=value=>structuredClone(value);
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=value=>createHash('sha256').update(stable(value)).digest('hex');
const sha=value=>createHash('sha256').update(value).digest('hex');
const tick=()=>new Promise(done=>setImmediate(done)),sleep=ms=>new Promise(done=>setTimeout(done,ms));
const ID=/^[a-z][a-z0-9_-]{0,47}$/,REQUEST=/^request_[a-f0-9]{32}$/,HEX=/^[a-f0-9]{64}$/;
const MESSAGE_ID=/^[A-Za-z0-9_-]{1,45}$/,RUNTIME_BYTES=16*1024*1024;
const seedMessageId=(id,seedDigest,seed)=>seed.sourceMessage?'m_'+sha(stable([id,seedDigest,seed.sourceMessage.id])).slice(0,32):null;
const emptyMailbox=owner=>({schemaVersion:1,owner,messages:[]});
const unavailableTransport=()=>({version:'mini-0.1',mode:'offline_local',available:false,ships:Object.fromEntries(['A','B'].map(owner=>[owner,{owner,count:0,messages:[]}])),gateway:{jobs:0,byState:{},recent:[]}});
const reserved=value=>/^(?:con|prn|aux|nul|clock\$|com[0-9]|lpt[0-9])$/i.test(value)||['village-1','village-2'].includes(value.toLowerCase());
const name=value=>typeof value==='string'&&ID.test(value)&&!reserved(value);
const text=(value,max,empty=false)=>typeof value==='string'&&value.length<=max&&(empty||!!value.trim())&&value===value.trim();
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
const exact=(value,required,optional=[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))throw fail('village_bootstrap_invalid_request');};
const shape=(value,required,optional=[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...required,...optional].includes(key));
function directory(path,{create=false}={}){
 if(typeof path!=='string'||!isAbsolute(path))throw fail('village_bootstrap_absolute_root_required');
 if(process.platform==='win32'&&path.startsWith('\\\\'))throw fail('village_bootstrap_local_root_required');
 const full=resolve(path);let current=parse(full).root;
 for(const part of relative(current,full).split(sep).filter(Boolean)){
  current=join(current,part);
  if(!existsSync(current)){if(!create)throw fail('village_bootstrap_missing_root');mkdirSync(current);}
  const stat=lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw fail('village_bootstrap_unsafe_root');
 }
 return realpathSync(full);
}
const overlaps=(a,b)=>{const left=resolve(a).toLowerCase(),right=resolve(b).toLowerCase();return left===right||left.startsWith(right+sep)||right.startsWith(left+sep);};
function json(path,{maxBytes=1024*1024}={}){directory(dirname(path));const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)throw fail('village_bootstrap_invalid_record');return JSON.parse(readFileSync(path,'utf8'));}
function safeWrite(path,value){directory(dirname(path));if(existsSync(path)){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())throw fail('village_bootstrap_unsafe_file');}writeAtomicJson(path,value);}
const CHILD=fileURLToPath(new URL('./village-child.mjs',import.meta.url));
const SOURCE_FILES=['./village-bootstrap.mjs','./village-child.mjs','./runtime.mjs','../reusable/gateway-jobs/persistent-gateway.mjs',
 '../reusable/gateway-jobs/job-state.mjs','../reusable/gateway-jobs/checkpoint.mjs','../reusable/mothership/mailbox.mjs',
 '../reusable/mothership/workflow.mjs','../reusable/baku-dna/code-cards.mjs'];
export function villageSourceDigest(){return digest(SOURCE_FILES.map(path=>[path,sha(readFileSync(new URL(path,import.meta.url)))]));}
export function villageRuntimeReadback(destination){
 const file=join(destination,'runtime-readback.json');if(!existsSync(file))return null;
 const saved=json(file,{maxBytes:RUNTIME_BYTES}),checkpoints={};
 directory(join(destination,'runtime'));
 for(const [file,hash]of Object.entries(saved.fileHashes||{})){
  const path=join(destination,'runtime',file);if(!['gateway.json','mother-A.json','mother-B.json'].includes(file)||lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||lstatSync(path).size>RUNTIME_BYTES)throw fail('village_bootstrap_runtime_changed');
  const bytes=readFileSync(path);if(sha(bytes)!==hash)throw fail('village_bootstrap_runtime_changed');checkpoints[file]=JSON.parse(bytes.toString('utf8'));
 }
 if(Object.keys(saved.fileHashes||{}).length!==3)throw fail('village_bootstrap_invalid_runtime_receipt');
 if(saved.runtime?.workflowTransport&&(stable(saved.runtime.workflowTransport.gateway)!==stable(checkpoints['gateway.json'].queue)||stable(saved.runtime.workflowTransport.mailboxes)!==stable({A:checkpoints['mother-A.json'],B:checkpoints['mother-B.json']})))throw fail('village_bootstrap_runtime_changed');
 return clone(saved.runtime);
}

export class VillageBootstrap {
 constructor({root,baseRoot,sourceProvider,sourceVersion='local-source',maxRunMs=300000,beforeStop=null}={}){
  if(typeof sourceProvider!=='function'||!text(sourceVersion,160)||!Number.isInteger(maxRunMs)||maxRunMs<100||maxRunMs>900000||(beforeStop!==null&&typeof beforeStop!=='function'))throw fail('village_bootstrap_invalid_configuration');
  if(typeof root!=='string'||typeof baseRoot!=='string'||overlaps(root,baseRoot))throw fail('village_bootstrap_roots_overlap');
  this.root=directory(root,{create:true});this.baseRoot=directory(baseRoot,{create:true});this.sourceProvider=sourceProvider;this.sourceVersion=sourceVersion;
  this.maxRunMs=maxRunMs;this.beforeStop=beforeStop;this.sourceDigest=villageSourceDigest();this.children=new Map();this.runtimeSnapshots=new Map();this.tasks=new Set();this.pending=new Map();this.closed=false;
  this.lock=join(this.root,'manager-lock.json');this.lockId=randomUUID();
  if(existsSync(this.lock)){const old=json(this.lock);if(old.kind!=='village-bootstrap-manager'||!Number.isInteger(old.pid)||typeof old.lockId!=='string'||alive(old.pid))throw fail('village_bootstrap_manager_owned');unlinkSync(this.lock);}
  const fd=openSync(this.lock,'wx',0o600);writeFileSync(fd,JSON.stringify({kind:'village-bootstrap-manager',pid:process.pid,lockId:this.lockId}));closeSync(fd);
  try{
   directory(join(this.root,'bundles'),{create:true});directory(join(this.root,'requests'),{create:true});directory(join(this.root,'child-logs'),{create:true});
   for(const id of this.#ids()){
    const record=this.#read(id);
    if(record.status==='preparing'){record.status='creation_interrupted';this.#save(record);}
    if(['launching','running','stopping','termination_unconfirmed'].includes(record.status)){
     const uncertain=Number.isInteger(record.launch?.pid)&&alive(record.launch.pid);
     record.status=uncertain?'termination_unconfirmed':'interrupted';
     record.launch={...record.launch,terminationConfirmed:!uncertain,terminationUnconfirmed:uncertain,reason:'parent_restart_no_automatic_launch'};this.#save(record);
    }
   }
  }catch(error){this.#releaseManager();throw error;}
 }
 #guard(){if(directory(this.root)!==this.root||directory(this.baseRoot)!==this.baseRoot)throw fail('village_bootstrap_root_changed');}
 #ids(){return readdirSync(join(this.root,'bundles')).filter(file=>/^[a-z][a-z0-9_-]{0,47}\.json$/.test(file)).map(file=>file.slice(0,-5));}
 #path(id){if(!name(id))throw fail('village_bootstrap_invalid_id');return join(this.root,'bundles',id+'.json');}
 #read(id){this.#guard();const record=json(this.#path(id));if(record.newVillageId!==id||!name(record.directoryName)||record.destination!==join(this.baseRoot,record.directoryName)||!HEX.test(record.previewDigest)||!HEX.test(record.seedDigest)||typeof record.ownershipId!=='string')throw fail('village_bootstrap_invalid_record');return record;}
 #save(record){record.updatedAt=Date.now();safeWrite(this.#path(record.newVillageId),record);}
 #view(record){const view=clone(Object.fromEntries(['newVillageId','displayName','directoryName','destination','status','seed','seedDigest','previewDigest','sourceVersion','sourceDigest','createdAt','updatedAt','creation','launch'].map(key=>[key,record[key]])));
  if(view.status==='termination_unconfirmed'&&Number.isInteger(view.launch?.pid)&&!alive(view.launch.pid)){view.status='interrupted';view.launch.terminationConfirmed=true;view.launch.terminationUnconfirmed=false;}return view;}
 #result(id,duplicate=false,sendResult){const state=this.state({newVillageId:id});return {...state,duplicate,...(sendResult?{sendResult}:{} )};}
 #source(villageId,workId){if(!['village-1','village-2'].includes(villageId)&&!name(villageId))throw fail('village_bootstrap_invalid_source');const source=this.sourceProvider({villageId,workId:workId??null});if(!source||typeof source.then==='function'||source.villageId!==villageId||!Array.isArray(source.knowledge)||!Array.isArray(source.works))throw fail('village_bootstrap_invalid_source');return source;}
 #knowledge(item){
  if(!item||!text(item.id,64)||!text(item.text,320)||!text(item.sourceVillage,64)||!(item.parentRumorId===null||text(item.parentRumorId,64))||!(item.rumorSha256===null||HEX.test(item.rumorSha256))||!(item.adoptedIn===null||item.adoptedIn===undefined||text(item.adoptedIn,64)))throw fail('village_bootstrap_invalid_knowledge');
  const value={id:item.id,text:item.text,sha256:sha(item.text),sourceVillage:item.sourceVillage,parentRumorId:item.parentRumorId,rumorSha256:item.rumorSha256,adoptedIn:item.adoptedIn??null};
  const repair=item.repairEvidence??item.repairProvenance;
  if(repair){if(typeof repair!=='object'||Array.isArray(repair)||(!item.repairEvidence&&!shape(repair,[],['candidateCommit','candidateDigest','diffSha256','verificationDigest'])))throw fail('village_bootstrap_invalid_knowledge');const p={};for(const key of ['candidateCommit','candidateDigest','diffSha256','verificationDigest']){const v=repair[key];if(v!==null&&v!==undefined){if(typeof v!=='string'||!new RegExp('^[a-f0-9]{'+(key==='candidateCommit'?40:64)+'}$').test(v))throw fail('village_bootstrap_invalid_knowledge');p[key]=v;}}value.repairProvenance=p;}
  return value;
 }
 catalog({sourceVillageId='village-1',sourceWorkId=null}={}){
  const source=this.#source(sourceVillageId,sourceWorkId),work=sourceWorkId?source.work:null;
  return {baseRoot:this.baseRoot,sourceVersion:this.sourceVersion,bundles:this.#ids().map(id=>this.#view(this.#read(id))),
   source:{villageId:sourceVillageId,works:source.works.map(w=>({id:w.id,goal:w.goal,stage:w.stage,runId:w.runId})),
    work:work?{id:work.id,goal:work.goal,sourceMessage:work.sourceMessage?{id:work.sourceMessage.id,text:work.sourceMessage.body,sha256:sha(work.sourceMessage.body)}:null}:null,
    knowledge:source.knowledge.map(item=>this.#knowledge(item))},limits:{singleLocalVillagePerBundle:true,remoteDeployment:false,automaticLaunch:false,modelCalls:0}};
 }
 preview(input){
  this.#guard();exact(input,['newVillageId','directoryName','sourceVillageId','inheritGoal','inheritSourceMessage','knowledgeIds','purpose'],['sourceWorkId','displayName']);
  const selection={...clone(input),sourceWorkId:input.sourceWorkId??null,displayName:input.displayName??input.newVillageId};
  if(!name(selection.newVillageId)||!name(selection.directoryName)||!text(selection.displayName,120)||!text(selection.purpose,500,true)||typeof selection.inheritGoal!=='boolean'||typeof selection.inheritSourceMessage!=='boolean'||!Array.isArray(selection.knowledgeIds)||selection.knowledgeIds.length>5||new Set(selection.knowledgeIds).size!==selection.knowledgeIds.length||selection.knowledgeIds.some(id=>!text(id,64)))throw fail('village_bootstrap_invalid_selection');
  if(selection.sourceWorkId!==null&&!/^work_[a-f0-9]{32}$/.test(selection.sourceWorkId))throw fail('village_bootstrap_invalid_source_work');
  if((selection.inheritGoal||selection.inheritSourceMessage)&&!selection.sourceWorkId)throw fail('village_bootstrap_explicit_source_work_required');
  const source=this.#source(selection.sourceVillageId,selection.sourceWorkId),work=selection.sourceWorkId?source.work:null;
  if(selection.sourceWorkId&&work?.id!==selection.sourceWorkId)throw fail('village_bootstrap_source_work_mismatch');
  const seed={purpose:selection.purpose,inheritedGoal:null,sourceMessage:null,knowledge:[],provenance:{sourceVillageId:selection.sourceVillageId,sourceWorkId:selection.sourceWorkId}};
  if(selection.inheritGoal){if(!text(work.goal,500)||!/^case_[a-f0-9]{32}$/.test(work.runId))throw fail('village_bootstrap_invalid_source_work');seed.inheritedGoal={text:work.goal,sha256:sha(work.goal),workId:work.id,runId:work.runId,villageId:selection.sourceVillageId};}
  if(selection.inheritSourceMessage){const message=work.sourceMessage;if(!message||message.deliveryState!=='done'||!text(message.body,1024)||!text(message.id,64))throw fail('village_bootstrap_source_not_delivered');seed.sourceMessage={id:message.id,text:message.body,sha256:sha(message.body),sourceVillageId:selection.sourceVillageId,sourceWorkId:work.id};}
  seed.knowledge=selection.knowledgeIds.map(id=>{const item=source.knowledge.find(item=>item.id===id);if(!item)throw fail('village_bootstrap_knowledge_not_available');return this.#knowledge(item);});
  const destination=join(this.baseRoot,selection.directoryName),selectionDigest=digest(selection);
  return {selection,destination,seed,selectionDigest,sourceVersion:this.sourceVersion,previewDigest:digest({selection,destination,seed,sourceVersion:this.sourceVersion,sourceDigest:this.sourceDigest})};
 }
 state(input){exact(input,['newVillageId']);const record=this.#read(input.newVillageId);this.#assertOwned(record,{allowMissing:true});return {bundle:this.#view(record),runtime:this.#runtimeSnapshot(record)};}
 participants(){
  const participants=[];
  for(const id of this.#ids()){
   const record=this.#read(id);if(!['prepared','stopped','running','interrupted'].includes(record.status))continue;
   try{this.#validateBundle(record);}catch(error){if(error.code==='village_bootstrap_source_version_changed')continue;throw error;}
   const root=join(record.destination,'participation');if(existsSync(root))directory(root);
   participants.push({id,name:record.displayName,root,seed:clone(record.seed),seedDigest:record.seedDigest,runtime:this.runtimePort(id)});
  }
  return participants;
 }
 runtimePort(id){
  const record=this.#read(id);this.#validateBundle(record);const manager=this,root=join(record.destination,'participation');if(existsSync(root))directory(root);
  const snapshot=()=>{const current=manager.#read(id);manager.#validateBundle(current);return manager.#runtimeSnapshot(current);};
  return {root,
   get available(){try{manager.#assertRuntimeActive(id);return true;}catch(error){if(['village_bootstrap_runtime_unavailable','village_bootstrap_source_version_changed'].includes(error.code))return false;throw error;}},
   get seedSourceMessageId(){return snapshot()?.seedSourceMessageId??null;},
   assertActive(){manager.#assertRuntimeActive(id);},
   state(){return clone(snapshot()?.transport??unavailableTransport());},
   mailbox(owner){if(!['A','B'].includes(owner))throw fail('village_bootstrap_invalid_delivery');return clone(snapshot()?.workflowTransport.mailboxes[owner]??emptyMailbox(owner));},
   gateway:{getJob(messageId){return clone(snapshot()?.workflowTransport.gateway.jobs.find(job=>job.id===messageId)??null);},queue:{snapshot(){return clone(snapshot()?.workflowTransport.gateway??{schemaVersion:1,config:null,jobs:[]});}}},
   async submit(input){
    manager.#assertRuntimeActive(id);exact(input,['from','to','message','messageId'],['code']);
    if(!['A','B'].includes(input.from)||!['A','B'].includes(input.to)||input.from===input.to||!text(input.message,1024)||typeof input.messageId!=='string'||!MESSAGE_ID.test(input.messageId)||(input.code!==undefined&&input.code!==''))throw fail('village_bootstrap_invalid_delivery');
    const result=await manager.#call(id,'deliver',{from:input.from,to:input.to,message:input.message,messageId:input.messageId,code:''});const {snapshot:acknowledged,...sent}=result;return clone(sent);
   }
  };
 }
 #assertRuntimeActive(id){
  const record=this.#read(id);this.#validateBundle(record);const entry=this.children.get(id);
  if(this.closed||!existsSync(this.lock))throw fail('village_bootstrap_runtime_unavailable');const owner=json(this.lock);
  if(owner.kind!=='village-bootstrap-manager'||owner.pid!==process.pid||owner.lockId!==this.lockId||record.status!=='running'||!entry||entry.exited||entry.processExitObserved||!entry.child.connected||record.launch?.launchId!==entry.launchId||record.launch?.pid!==entry.child.pid)throw fail('village_bootstrap_runtime_unavailable');
  return entry;
 }
 #validateRuntimeSnapshot(record,snapshot){
  if(!snapshot||typeof snapshot!=='object'||snapshot.newVillageId!==record.newVillageId||snapshot.purpose!==record.seed.purpose||snapshot.pid!==record.launch?.pid||snapshot.sourceDigest!==record.sourceDigest||snapshot.seedDigest!==record.seedDigest||snapshot.launchId!==record.launch?.launchId||snapshot.seedSourceMessageId!==seedMessageId(record.newVillageId,record.seedDigest,record.seed)||snapshot.modelCalls!==0||stable(snapshot.inheritance)!==stable(record.seed)||!snapshot.transport?.ships||!Array.isArray(snapshot.workflowTransport?.gateway?.jobs)||snapshot.workflowTransport.gateway.jobs.length>2000||!['A','B'].every(owner=>snapshot.workflowTransport.mailboxes?.[owner]?.owner===owner&&Array.isArray(snapshot.workflowTransport.mailboxes[owner].messages)&&snapshot.workflowTransport.mailboxes[owner].messages.length<=1000)||Buffer.byteLength(JSON.stringify(snapshot))>RUNTIME_BYTES)throw fail('village_bootstrap_invalid_runtime_receipt');
  const {gateway,mailboxes}=snapshot.workflowTransport,jobs=gateway.jobs,transport=snapshot.transport;
  const recent=jobs.slice(-20).map(job=>({id:job.id,state:job.state,attempts:job.attempts,from:job.payload?.envelope?.sender,to:job.payload?.envelope?.recipient,type:job.payload?.envelope?.type,meta:job.state==='done'?job.result?.meta:null}));
  if(transport.version!=='mini-0.1'||transport.mode!=='offline_local'||!['A','B'].every(owner=>transport.ships[owner]?.owner===owner&&transport.ships[owner].count===mailboxes[owner].messages.length&&stable(transport.ships[owner].messages)===stable(mailboxes[owner].messages.slice(-20)))||transport.gateway?.jobs!==jobs.length||stable(transport.gateway.byState)!==stable(jobs.reduce((counts,job)=>(counts[job.state]=(counts[job.state]||0)+1,counts),{}))||stable(transport.gateway.recent)!==stable(recent))throw fail('village_bootstrap_invalid_runtime_receipt');
  return clone(snapshot);
 }
 #runtimeSnapshot(record){
  const entry=this.children.get(record.newVillageId),cached=this.runtimeSnapshots.get(record.newVillageId);
  if(entry&&record.launch?.launchId===entry.launchId){if(cached?.launchId===entry.launchId)return this.#validateRuntimeSnapshot(record,cached);return null;}
  if(record.launch?.terminationConfirmed===true&&record.launch.terminationUnconfirmed!==true&&['stopped','interrupted'].includes(record.status)){
   const snapshot=villageRuntimeReadback(record.destination);if(!snapshot)return null;
   // Older source bundles remain inspectable in the catalog without joining.
   if(record.sourceDigest!==this.sourceDigest||record.sourceVersion!==this.sourceVersion)return snapshot;
   return this.#validateRuntimeSnapshot(record,snapshot);
  }
  return null;
 }
 #assertOwned(record,{allowMissing=false}={}){
  this.#guard();if(!existsSync(record.destination)){if(allowMissing&&['preparing','creation_interrupted','cancelled'].includes(record.status))return;throw fail('village_bootstrap_missing_destination');}
  directory(record.destination);const owner=join(record.destination,'ownership.json');
  if(!existsSync(owner)){if(allowMissing&&record.creation?.stage==='reserved')return;throw fail('village_bootstrap_destination_not_owned');}
  const mark=json(owner);if(mark.ownershipId!==record.ownershipId||mark.newVillageId!==record.newVillageId)throw fail('village_bootstrap_destination_not_owned');
 }
 #validateBundle(record){
  this.#assertOwned(record);const manifest=json(join(record.destination,'manifest.json')),seed=json(join(record.destination,'seed.json'));
  if(manifest.previewDigest!==record.previewDigest||manifest.seedDigest!==record.seedDigest||manifest.newVillageId!==record.newVillageId||manifest.sourceDigest!==record.sourceDigest||manifest.sourceVersion!==record.sourceVersion||manifest.displayName!==record.displayName||!text(record.displayName,120)||digest(seed)!==record.seedDigest||stable(seed)!==stable(record.seed))throw fail('village_bootstrap_bundle_changed');
  this.#validateSeed(record);
  if(record.sourceVersion!==this.sourceVersion||record.sourceDigest!==villageSourceDigest())throw fail('village_bootstrap_source_version_changed');
 }
 #validateSeed(record){
  const seed=record.seed,bad=()=>{throw fail('village_bootstrap_bundle_changed');};
  if(!shape(seed,['purpose','inheritedGoal','sourceMessage','knowledge','provenance'])||!text(seed.purpose,500,true)||seed.purpose!==record.purpose||!shape(seed.provenance,['sourceVillageId','sourceWorkId'])||seed.provenance.sourceVillageId!==record.sourceVillageId||seed.provenance.sourceWorkId!==record.sourceWorkId||!Array.isArray(seed.knowledge)||seed.knowledge.length>5||record.inheritGoal!==!!seed.inheritedGoal||record.inheritSourceMessage!==!!seed.sourceMessage)bad();
  if(seed.inheritedGoal){const value=seed.inheritedGoal;if(!shape(value,['text','sha256','workId','runId','villageId'])||!text(value.text,500)||value.sha256!==sha(value.text)||!/^work_[a-f0-9]{32}$/.test(value.workId)||!/^case_[a-f0-9]{32}$/.test(value.runId)||value.villageId!==record.sourceVillageId||value.workId!==record.sourceWorkId)bad();}
  if(seed.sourceMessage){const value=seed.sourceMessage;if(!shape(value,['id','text','sha256','sourceVillageId','sourceWorkId'])||!text(value.id,64)||!text(value.text,1024)||value.sha256!==sha(value.text)||value.sourceVillageId!==record.sourceVillageId||value.sourceWorkId!==record.sourceWorkId)bad();}
  for(const value of seed.knowledge){
   if(!shape(value,['id','text','sha256','sourceVillage','parentRumorId','rumorSha256','adoptedIn'],['repairProvenance'])||!text(value.id,64)||!text(value.text,320)||value.sha256!==sha(value.text)||!text(value.sourceVillage,64)||!(value.parentRumorId===null||text(value.parentRumorId,64))||!(value.rumorSha256===null||HEX.test(value.rumorSha256))||!(value.adoptedIn===null||text(value.adoptedIn,64)))bad();
   if(value.repairProvenance&&(!shape(value.repairProvenance,[],['candidateCommit','candidateDigest','diffSha256','verificationDigest'])||Object.entries(value.repairProvenance).some(([key,hash])=>typeof hash!=='string'||!new RegExp('^[a-f0-9]{'+(key==='candidateCommit'?40:64)+'}$').test(hash))))bad();
  }
 }
 async action(input){
  if(this.closed)throw fail('village_bootstrap_closed');this.#guard();
  if(!input||!REQUEST.test(input.requestId)||typeof input.action!=='string')throw fail('village_bootstrap_invalid_request');
  const payloadDigest=digest(input),requestFile=join(this.root,'requests',input.requestId+'.json');
  if(existsSync(requestFile)){
   const old=json(requestFile);if(old.payloadDigest!==payloadDigest)throw fail('village_bootstrap_request_conflict');
   if(this.pending.has(input.requestId)){await this.pending.get(input.requestId);return this.#result(old.newVillageId,true,json(requestFile).sendResult);}
   if(old.status==='failed')throw fail(old.error);
   if(!old.newVillageId||!existsSync(this.#path(old.newVillageId)))throw fail('village_bootstrap_request_interrupted');
   return this.#result(old.newVillageId,true,old.sendResult);
  }
  const create=input.action==='create';
  const selectionKeys=['newVillageId','directoryName','sourceVillageId','inheritGoal','inheritSourceMessage','knowledgeIds','purpose'];
  const actionKeys={cancel:['reason'],resume:['allowResume'],launch:['allowLaunch'],stop:['allowStop'],'send-local':['message','allowSend']};
  if(create)exact(input,['action','requestId',...selectionKeys,'previewDigest','allowCreate','dataReviewed'],['sourceWorkId','displayName']);
  else{if(!actionKeys[input.action])throw fail('village_bootstrap_invalid_action');exact(input,['action','requestId','newVillageId',...actionKeys[input.action]]);}
  if(!name(input.newVillageId))throw fail('village_bootstrap_invalid_id');
  const receipt={requestId:input.requestId,payloadDigest,newVillageId:input.newVillageId,status:'pending',createdAt:Date.now()};safeWrite(requestFile,receipt);
  const run=(async()=>{
   try{
    let result;
    if(create){if(input.allowCreate!==true||input.dataReviewed!==true||!HEX.test(input.previewDigest))throw fail('village_bootstrap_explicit_creation_review_required');
     const selection=Object.fromEntries([...selectionKeys,'sourceWorkId','displayName'].filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]));
     const preview=this.preview(selection);if(preview.previewDigest!==input.previewDigest)throw fail('village_bootstrap_preview_stale');
     if(this.#ids().some(id=>id.toLowerCase()===input.newVillageId.toLowerCase()||this.#read(id).directoryName.toLowerCase()===input.directoryName.toLowerCase())||readdirSync(this.baseRoot).some(entry=>entry.toLowerCase()===input.directoryName.toLowerCase()))throw fail('village_bootstrap_name_exists');
     const record={...preview.selection,destination:preview.destination,seed:preview.seed,seedDigest:digest(preview.seed),previewDigest:preview.previewDigest,sourceVersion:this.sourceVersion,sourceDigest:this.sourceDigest,
      ownershipId:randomUUID(),status:'preparing',creation:{requestId:input.requestId,stage:'reserved'},launch:null,createdAt:Date.now()};this.#save(record);
     result=await this.#prepare(record);
    }else result=await this.#operate(input);
    receipt.status='completed';if(result.sendResult)receipt.sendResult=result.sendResult;safeWrite(requestFile,receipt);return result;
   }catch(error){receipt.status='failed';receipt.error=error.code||'village_bootstrap_operation_failed';safeWrite(requestFile,receipt);throw error;}
  })();this.pending.set(input.requestId,run);this.tasks.add(run);
  try{return await run;}finally{this.pending.delete(input.requestId);this.tasks.delete(run);}
 }
 async #prepare(original){
  const id=original.newVillageId;
  try{
   await tick();let record=this.#read(id);if(record.status!=='preparing')return this.#result(id);
   if(!existsSync(record.destination)){
    mkdirSync(record.destination);safeWrite(join(record.destination,'ownership.json'),{schemaVersion:1,newVillageId:id,ownershipId:record.ownershipId});
    record.creation.stage='destination_owned';this.#save(record);
   }else this.#assertOwned(record);
   await tick();record=this.#read(id);if(record.status!=='preparing')return this.#result(id);
   for(const [file,value]of [['seed.json',record.seed],['manifest.json',{schemaVersion:1,newVillageId:id,displayName:record.displayName,sourceVersion:record.sourceVersion,sourceDigest:record.sourceDigest,seedDigest:record.seedDigest,previewDigest:record.previewDigest,automaticLaunch:false,externalAi:false}]]){
    const path=join(record.destination,file);if(existsSync(path)&&stable(json(path))!==stable(value))throw fail('village_bootstrap_bundle_changed');if(!existsSync(path))safeWrite(path,value);
   }
   record.status='prepared';record.creation.stage='prepared';this.#save(record);return this.#result(id);
  }catch(error){const record=this.#read(id);record.status='creation_interrupted';record.creation.error=error.code||'village_bootstrap_prepare_failed';this.#save(record);throw error;}
 }
 async #operate(input){
  const record=this.#read(input.newVillageId),id=record.newVillageId;
  if(input.action==='cancel'){
   if(!text(input.reason,500)||!['preparing','prepared','creation_interrupted','cancelled'].includes(record.status))throw fail('village_bootstrap_cannot_cancel');
   record.status='cancelled';record.creation.cancelReason=input.reason;this.#save(record);return this.#result(id);
  }
  if(input.action==='resume'){
   if(input.allowResume!==true)throw fail('village_bootstrap_explicit_resume_required');
   if(['creation_interrupted','cancelled'].includes(record.status)){record.status='preparing';delete record.creation.error;this.#save(record);return this.#prepare(record);}
   if(!['interrupted','termination_unconfirmed'].includes(record.status)||record.launch?.pid&&alive(record.launch.pid))throw fail('village_bootstrap_termination_unconfirmed');
   record.status='stopped';record.launch={...record.launch,terminationConfirmed:true,terminationUnconfirmed:false};this.#save(record);return this.#result(id);
  }
  if(input.action==='launch'){
   if(input.allowLaunch!==true)throw fail('village_bootstrap_explicit_launch_required');
   if(!['prepared','stopped'].includes(record.status)||this.children.has(id))throw fail('village_bootstrap_not_launchable');
   this.#validateBundle(record);return this.#launch(record);
  }
  if(input.action==='stop'){
   if(input.allowStop!==true)throw fail('village_bootstrap_explicit_stop_required');
   if(!this.children.has(id)){if(record.status==='stopped')return this.#result(id);throw fail('village_bootstrap_termination_unconfirmed');}
   if(this.beforeStop){const guarded=this.beforeStop(id);if(guarded&&typeof guarded.then==='function')throw fail('village_bootstrap_invalid_configuration');}
   await this.#stop(id,'owner_stop');return this.#result(id);
  }
  if(input.action==='send-local'){
   if(input.allowSend!==true||!text(input.message,1024)||record.status!=='running'||!this.children.has(id))throw fail('village_bootstrap_explicit_local_message_required');
   const result=await this.#call(id,'send',{message:input.message,messageId:'m_'+sha(input.requestId).slice(0,32)});
   return this.#result(id,false,{messageId:result.messageId,deliveryState:result.deliveryState});
  }
  throw fail('village_bootstrap_invalid_action');
 }
 async #launch(record){
  const id=record.newVillageId,launchId=randomUUID();record.status='launching';record.launch={launchId,pid:null,startedAt:Date.now(),endedAt:null,terminationConfirmed:false,terminationUnconfirmed:false,processExitObserved:false};this.#save(record);
  const env={};for(const key of ['PATH','SystemRoot','WINDIR','COMSPEC','TEMP','TMP'])if(typeof process.env[key]==='string')env[key]=process.env[key];
  // This is trusted fixed code, not an untrusted-code sandbox. Node's Permission
  // Model disables fsync, which the unchanged real Runtime requires for durable
  // checkpoints. No supplied code is loaded; only this pinned child is launched.
  let child;try{child=spawn(process.execPath,[CHILD],{cwd:dirname(CHILD),env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});}catch(error){record.status='interrupted';record.launch.terminationConfirmed=true;this.#save(record);throw error;}
  const entry={child,launchId,pending:new Map(),reason:'child_exit',stderr:'',exited:false,processExitObserved:false,pipeCloseObserved:false,startupError:null,exitCode:null,signal:null};this.children.set(id,entry);
  child.stderr.on('data',chunk=>{entry.stderr=(entry.stderr+chunk.toString()).slice(-32000);});
  child.on('message',message=>{
   if(message?.replyId&&entry.pending.has(message.replyId)){
    const p=entry.pending.get(message.replyId);entry.pending.delete(message.replyId);clearTimeout(p.timer);
    if(message.error)p.reject(fail(message.error));else try{
     if(['init','state','send','deliver'].includes(p.command)){
      const current=this.#read(id),snapshot=['init','state'].includes(p.command)?message.result:message.result?.snapshot;
      if(this.children.get(id)!==entry||current.launch?.launchId!==launchId)throw fail('village_bootstrap_child_exited');
      this.runtimeSnapshots.set(id,this.#validateRuntimeSnapshot(current,snapshot));
     }
     p.resolve(message.result);
    }catch(error){p.reject(error);}
   }
   if(message?.event==='closing')entry.reason=message.reason;
  });
  const logDirectory=join(this.root,'child-logs'),writeLog=()=>safeWrite(join(logDirectory,launchId+'.json'),{executable:process.execPath,args:[CHILD],cwd:dirname(CHILD),environmentNames:Object.keys(env),pid:child.pid??null,exitCode:entry.exitCode,signal:entry.signal,stderr:entry.stderr,processExitObserved:entry.processExitObserved,pipeCloseObserved:entry.pipeCloseObserved,...(entry.startupError?{startupError:entry.startupError}:{})});
  entry.exit=new Promise(done=>{
   const finish=(code,signal)=>{
    if(entry.exited)return;entry.exited=true;entry.exitCode=code;entry.signal=signal;
    if(this.children.get(id)===entry)this.children.delete(id);for(const p of entry.pending.values()){clearTimeout(p.timer);p.reject(fail('village_bootstrap_child_exited'));}entry.pending.clear();
    const current=this.#read(id);if(current.launch?.launchId===launchId){current.status=['owner_stop','parent_close','parent_stop','parent_disconnect','max_duration'].includes(entry.reason)?'stopped':'interrupted';current.launch={...current.launch,endedAt:Date.now(),exitCode:code,signal,reason:entry.reason,terminationConfirmed:true,terminationUnconfirmed:false,processExitObserved:entry.processExitObserved};this.#save(current);}
    writeLog();done();
   };
   child.once('exit',(code,signal)=>{
    entry.processExitObserved=true;
    // Let already queued closing IPC supply its reason before classification.
    setImmediate(()=>finish(code,signal));
   });
   child.once('close',(code,signal)=>{
    entry.pipeCloseObserved=true;
    if(!entry.exited){if(entry.startupError&&!Number.isInteger(child.pid)){entry.reason='child_start_failed';finish(code,signal);}return;}
    // A prior launch may close its pipes after a new launch or fixture cleanup.
    // Only its unique receipt may change; process termination is already known.
    try{if(existsSync(logDirectory))writeLog();}catch{}
   });
  });
  child.once('error',error=>{if(!Number.isInteger(child.pid))entry.startupError=error.code||'village_bootstrap_child_start_failed';for(const p of entry.pending.values()){clearTimeout(p.timer);p.reject(fail('village_bootstrap_child_start_failed'));}entry.pending.clear();});
  record.launch.pid=child.pid??null;this.#save(record);
  try{await this.#call(id,'init',{destination:record.destination,newVillageId:id,launchId,maxRunMs:this.maxRunMs,sourceDigest:record.sourceDigest});const current=this.#read(id);if(entry.exited)throw fail('village_bootstrap_child_exited');if(current.status==='launching'){current.status='running';this.#save(current);}return this.#result(id);}
  catch(error){await this.#stop(id,'launch_failed');throw error;}
 }
 #call(id,command,data={}){
  const entry=this.children.get(id);if(!entry||entry.exited)throw fail('village_bootstrap_not_running');const replyId=randomUUID();
  return new Promise((resolveCall,reject)=>{const timer=setTimeout(()=>{entry.pending.delete(replyId);reject(fail('village_bootstrap_child_timeout'));},8000);
   entry.pending.set(replyId,{resolve:resolveCall,reject,timer,command});entry.child.send({replyId,command,...data},error=>{if(error){clearTimeout(timer);entry.pending.delete(replyId);reject(fail('village_bootstrap_child_disconnected'));}});
  });
 }
 async #stop(id,reason){
  const entry=this.children.get(id);if(!entry)return;entry.reason=reason;
  const record=this.#read(id);record.status='stopping';this.#save(record);
  try{await this.#call(id,'stop',{reason});}catch{}
  await Promise.race([entry.exit,sleep(1500)]);if(!entry.exited){entry.child.kill();await Promise.race([entry.exit,sleep(1500)]);}
  if(!entry.exited){const current=this.#read(id);current.status='termination_unconfirmed';current.launch.terminationUnconfirmed=true;this.#save(current);throw fail('village_bootstrap_termination_unconfirmed');}
 }
 #releaseManager(){if(existsSync(this.lock)&&json(this.lock).lockId===this.lockId)unlinkSync(this.lock);}
 async close(){
  if(this.closed)return;this.closed=true;
  for(const id of this.#ids()){const record=this.#read(id);if(record.status==='preparing'){record.status='creation_interrupted';this.#save(record);}}
  await Promise.allSettled([...this.tasks]);await Promise.allSettled([...this.children.keys()].map(id=>this.#stop(id,'parent_close')));this.#releaseManager();
 }
}
