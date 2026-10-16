/** Fixed-code single-village child. IPC only: no HTTP, model, provider adapter,
 * shell, supplied code execution, or child-process launch. */
import {readFileSync,writeFileSync,lstatSync,existsSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {MetronMiniRuntime} from './runtime.mjs';
import {writeAtomicJson} from '../reusable/gateway-jobs/checkpoint.mjs';
import {villageSourceDigest} from './village-bootstrap.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=value=>sha(stable(value));
let runtime=null,seed,identity,destination,lock,launchId,sourceDigest,seedDigest,seedSourceMessageId=null,timer,ending=false;
const exact=(value,required,optional=[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))throw Error('village_bootstrap_invalid_child_command');};
const validDelivery=message=>['A','B'].includes(message.from)&&['A','B'].includes(message.to)&&message.from!==message.to&&typeof message.message==='string'&&message.message.length<=1024&&!!message.message.trim()&&message.message===message.message.trim()&&typeof message.messageId==='string'&&/^[A-Za-z0-9_-]{1,45}$/.test(message.messageId)&&message.code==='';
function read(path){const s=lstatSync(path);if(s.isSymbolicLink()||!s.isFile()||s.size>1024*1024)throw Error('village_bootstrap_invalid_child_file');return JSON.parse(readFileSync(path,'utf8'));}
function persist(){
 const value={newVillageId:identity,purpose:seed.purpose,inheritance:seed,sourceDigest,seedDigest,launchId,seedSourceMessageId,transport:runtime.state(),workflowTransport:{gateway:runtime.gateway.queue.snapshot(),mailboxes:{A:runtime.mailbox('A'),B:runtime.mailbox('B')}},pid:process.pid,modelCalls:0};
 const fileHashes=Object.fromEntries(['gateway.json','mother-A.json','mother-B.json'].map(file=>[file,sha(readFileSync(join(destination,'runtime',file)))]));
 writeAtomicJson(join(destination,'runtime-readback.json'),{runtime:value,fileHashes});return value;
}
function deliver(input){
 if(!runtime.gateway.getJob(input.messageId)&&(runtime.gateway.queue.snapshot().jobs.length+2>2000||['A','B'].some(owner=>runtime.mailbox(owner).messages.length>=1000)))throw Error('village_bootstrap_delivery_limit');
 return runtime.submit(input);
}
function finish(reason){
 if(ending)return;ending=true;clearTimeout(timer);
 try{if(runtime)persist();if(lock&&existsSync(lock)&&read(lock).launchId===launchId)unlinkSync(lock);}catch{}
 if(process.connected)process.send({event:'closing',reason},()=>process.exit(0));else process.exit(0);
}
process.on('disconnect',()=>finish('parent_disconnect'));process.on('SIGTERM',()=>finish('parent_stop'));
process.on('message',message=>{
 const reply=(result,error)=>{if(process.connected)process.send({replyId:message.replyId,...(error?{error}:{result})});};
 try{
  if(!message||typeof message.replyId!=='string'||ending)throw Error('village_bootstrap_invalid_child_command');
  if(message.command==='init'){
   exact(message,['replyId','command','destination','newVillageId','launchId','maxRunMs','sourceDigest']);
   if(runtime||typeof message.destination!=='string'||resolve(message.destination)!==message.destination||!Number.isInteger(message.maxRunMs)||message.maxRunMs<100||message.maxRunMs>900000)throw Error('village_bootstrap_invalid_child_init');
   destination=message.destination;identity=message.newVillageId;launchId=message.launchId;
   const stat=lstatSync(destination);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('village_bootstrap_unsafe_root');
   const manifest=read(join(destination,'manifest.json'));seed=read(join(destination,'seed.json'));
   if(manifest.newVillageId!==identity||manifest.sourceDigest!==message.sourceDigest||message.sourceDigest!==villageSourceDigest()||manifest.seedDigest!==digest(seed))throw Error('village_bootstrap_bundle_changed');
   sourceDigest=manifest.sourceDigest;seedDigest=manifest.seedDigest;
   lock=join(destination,'runtime-lock.json');
   if(existsSync(lock)){
    const previous=read(lock);let live=true;try{process.kill(previous.pid,0);}catch(error){live=error.code!=='ESRCH';}
    if(previous.kind!=='village-runtime'||previous.newVillageId!==identity||live)throw Error('village_bootstrap_runtime_owned');unlinkSync(lock);
   }
   const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({kind:'village-runtime',newVillageId:identity,pid:process.pid,launchId}));closeSync(fd);
   if(existsSync(join(destination,'runtime'))&&lstatSync(join(destination,'runtime')).isSymbolicLink())throw Error('village_bootstrap_unsafe_root');
   for(const file of ['gateway.json','mother-A.json','mother-B.json']){const path=join(destination,'runtime',file);if(existsSync(path)&&(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()))throw Error('village_bootstrap_unsafe_root');}
   runtime=new MetronMiniRuntime(join(destination,'runtime'));runtime.drain();
   if(seed.sourceMessage){
    if(typeof seed.sourceMessage.id!=='string'||typeof seed.sourceMessage.text!=='string'||!seed.sourceMessage.text.trim()||seed.sourceMessage.text.length>1024||seed.sourceMessage.sha256!==sha(seed.sourceMessage.text))throw Error('village_bootstrap_invalid_child_seed');
    seedSourceMessageId='m_'+sha(stable([identity,seedDigest,seed.sourceMessage.id])).slice(0,32);
    deliver({from:'A',to:'B',message:seed.sourceMessage.text,messageId:seedSourceMessageId,code:''});
   }
   timer=setTimeout(()=>finish('max_duration'),message.maxRunMs);reply(persist());return;
  }
  if(!runtime)throw Error('village_bootstrap_child_not_initialized');
  if(message.command==='send'){
   exact(message,['replyId','command','message','messageId']);if(!validDelivery({...message,from:'A',to:'B',code:''}))throw Error('village_bootstrap_invalid_delivery');
   const sent=deliver({from:'A',to:'B',message:message.message,messageId:message.messageId,code:''});reply({messageId:sent.messageId,deliveryState:sent.job.state,snapshot:persist()});return;
  }
  if(message.command==='deliver'){
   exact(message,['replyId','command','from','to','message','messageId','code']);if(!validDelivery(message))throw Error('village_bootstrap_invalid_delivery');
   const sent=deliver({from:message.from,to:message.to,message:message.message,messageId:message.messageId,code:''});reply({...sent,snapshot:persist()});return;
  }
  if(message.command==='state'){exact(message,['replyId','command']);reply(persist());return;}
  if(message.command==='stop'){exact(message,['replyId','command','reason']);if(typeof message.reason!=='string'||message.reason.length>64)throw Error('village_bootstrap_invalid_child_command');reply({stopping:true});setImmediate(()=>finish(message.reason||'owner_stop'));return;}
  throw Error('village_bootstrap_invalid_child_command');
 }catch(error){process.stderr.write(String(error.stack||error).slice(-4000)+'\n');reply(null,/^village_bootstrap_[a-z_]+$/.test(error.message)?error.message:'village_bootstrap_child_failed');if(message?.command==='init')setImmediate(()=>finish('initialization_failed'));}
});
