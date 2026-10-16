import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {VillageBootstrap,villageSourceDigest} from '../../mini/village-bootstrap.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const request=number=>'request_'+number.toString(16).padStart(32,'0');
const command=(action,number,extra={})=>({action,requestId:request(number),newVillageId:'port-village',...extra});
async function isolated(run){
 const parent=process.env.METRON_VILLAGE_EVIDENCE_DIR||tmpdir();mkdirSync(parent,{recursive:true});
 const prefix=join(parent,'village-runtime-port-'),root=mkdtempSync(prefix);
 try{return await run(root);}finally{if(!process.env.METRON_VILLAGE_EVIDENCE_DIR){assert.ok(resolve(root).startsWith(resolve(prefix)));rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}}
}
function fixture(root){
 const work={id:'work_'+'a'.repeat(32),runId:'case_'+'b'.repeat(32),goal:'A selected source goal',
  sourceMessage:{id:'m_selected',body:'The selected local observation.',deliveryState:'done'},
  allowExternalCalls:true,dispatchToken:'NEVER_COPY_DISPATCH',lease:{token:'NEVER_COPY_LEASE'},env:{OPENAI_API_KEY:'NEVER_COPY_PROVIDER'}};
 const source={villageId:'village-1',work,works:[work],knowledge:[{id:'selected-knowledge',text:'Selected local knowledge',sourceVillage:'village-1',parentRumorId:null,rumorSha256:null,adoptedIn:'village-1',
  repairEvidence:{candidateCommit:'c'.repeat(40),verificationDigest:'d'.repeat(64),allowApply:true,env:{SECRET:'NEVER_COPY_REPAIR'}}}]};
 const options={root:join(root,'manager'),baseRoot:join(root,'children'),maxRunMs:120000,sourceVersion:'runtime-port-test',sourceProvider:({villageId,workId})=>{
  if(!['village-1','port-village'].includes(villageId))throw Error('unknown_registered_village');
  assert.ok(workId===null||workId===work.id);return {...structuredClone(source),villageId};
 }};
 const input={newVillageId:'port-village',directoryName:'port-home',displayName:'Child participant',sourceVillageId:'village-1',sourceWorkId:work.id,inheritGoal:true,inheritSourceMessage:true,knowledgeIds:['selected-knowledge'],purpose:'Independent child participation'};
 return {source,options,input,create:()=>new VillageBootstrap(options)};
}
async function prepare(desk,input,number=1){const preview=desk.preview(input);return desk.action({...input,action:'create',requestId:request(number),previewDigest:preview.previewDigest,allowCreate:true,dataReviewed:true});}
function rawCall(child,payload){
 return new Promise((done,reject)=>{
  const timer=setTimeout(()=>{child.off('message',onMessage);reject(Error('owned_child_reply_timeout'));},8000);
  function onMessage(message){if(message?.replyId!==payload.replyId)return;clearTimeout(timer);child.off('message',onMessage);done(message);}
  child.on('message',onMessage);child.send(payload,error=>{if(error){clearTimeout(timer);child.off('message',onMessage);reject(error);}});
 });
}

test('child runtime port retains full acknowledged workflow, routes A/B, and restores one seed observation',()=>isolated(async root=>{
 const f=fixture(root);let desk=f.create(),seedId;
 try{
  const made=await prepare(desk,f.input),[participant]=desk.participants(),port=participant.runtime;
  assert.equal(participant.id,f.input.newVillageId);assert.equal(participant.name,f.input.displayName);assert.equal(participant.root,join(made.bundle.destination,'participation'));assert.equal(port.root,participant.root);
  assert.equal(port.available,false);assert.equal(port.state().ships.B.count,0);assert.deepEqual(port.mailbox('A').messages,[]);assert.equal(existsSync(join(made.bundle.destination,'runtime')),false);assert.equal(desk.children.size,0);
  participant.seed.purpose='Changed returned clone';assert.equal(desk.participants()[0].seed.purpose,f.input.purpose);
  await assert.rejects(port.submit({from:'A',to:'B',message:'No launch',messageId:'m_no_launch',code:''}),{code:'village_bootstrap_runtime_unavailable'});
  const started=await desk.action(command('launch',2,{allowLaunch:true}));assert.notEqual(started.runtime.pid,process.pid);assert.equal(started.runtime.sourceDigest,villageSourceDigest());assert.equal(started.runtime.seedDigest,made.bundle.seedDigest);
  seedId='m_'+sha(JSON.stringify([f.input.newVillageId,made.bundle.seedDigest,f.source.work.sourceMessage.id])).slice(0,32);
  assert.equal(port.available,true);assert.doesNotThrow(()=>port.assertActive());assert.equal(port.seedSourceMessageId,seedId);
  assert.equal(port.gateway.getJob(seedId).state,'done');assert.equal(port.mailbox('B').messages.find(message=>message.id===seedId).body,f.source.work.sourceMessage.body);
  const queueClone=port.gateway.queue.snapshot();queueClone.jobs[0].payload.envelope.body='Changed returned clone';assert.equal(port.gateway.getJob(seedId).payload.envelope.body,f.source.work.sourceMessage.body);
  const mailboxClone=port.mailbox('B');mailboxClone.messages[0].body='Changed returned clone';assert.equal(port.mailbox('B').messages[0].body,f.source.work.sourceMessage.body);
  for(let index=0;index<21;index++){
   const input={from:index%2?'B':'A',to:index%2?'A':'B',message:'Full source observation '+index,messageId:'m_port_'+index,code:''};
   const sent=await port.submit(input);assert.equal(sent.job.state,'done');assert.equal(sent.job.payload.envelope.sender,input.from);assert.equal(sent.job.payload.envelope.recipient,input.to);assert.equal(sent.deduplicated,false);
  }
  assert.equal(port.state().ships.B.messages.some(message=>message.id===seedId),false);
  assert.equal(port.mailbox('B').messages.some(message=>message.id===seedId),true);assert.equal(port.gateway.queue.snapshot().jobs.length,44);assert.equal(port.gateway.getJob(seedId).payload.envelope.body,f.source.work.sourceMessage.body);
  const repeated=await port.submit({from:'A',to:'B',message:'Full source observation 0',messageId:'m_port_0',code:''});assert.equal(repeated.deduplicated,true);assert.equal(port.gateway.queue.snapshot().jobs.length,44);
  await desk.action(command('send-local',3,{allowSend:true,message:'Compatible owner local message'}));assert.equal(port.state().ships.B.count,23);assert.equal(port.gateway.queue.snapshot().jobs.length,46);
  for(const marker of ['NEVER_COPY','allowExternalCalls','allowApply','dispatchToken','leaseToken','OPENAI_API_KEY'])assert.equal(JSON.stringify(desk.state({newVillageId:f.input.newVillageId}).runtime).includes(marker),false,marker);
  await desk.action(command('stop',4,{allowStop:true}));assert.equal(port.available,false);assert.equal(port.gateway.queue.snapshot().jobs.length,46);
  const readback=JSON.parse(readFileSync(join(made.bundle.destination,'runtime-readback.json'),'utf8')).runtime;
  assert.deepEqual(readback.workflowTransport.gateway,JSON.parse(readFileSync(join(made.bundle.destination,'runtime','gateway.json'),'utf8')).queue);
  assert.deepEqual(readback.workflowTransport.mailboxes.B,JSON.parse(readFileSync(join(made.bundle.destination,'runtime','mother-B.json'),'utf8')));
 }finally{await desk.close();}
 desk=f.create();try{
  const [participant]=desk.participants(),port=participant.runtime;assert.equal(desk.children.size,0);assert.equal(port.available,false);assert.equal(port.seedSourceMessageId,seedId);assert.equal(port.mailbox('B').messages.length,23);
  const started=await desk.action(command('launch',5,{allowLaunch:true}));assert.equal(started.runtime.seedSourceMessageId,seedId);assert.equal(port.available,true);assert.equal(port.mailbox('B').messages.filter(message=>message.id===seedId).length,1);assert.equal(port.gateway.queue.snapshot().jobs.length,46);
  await desk.action(command('stop',6,{allowStop:true}));
  const readbackFile=join(f.options.baseRoot,f.input.directoryName,'runtime-readback.json'),before=readFileSync(readbackFile,'utf8'),changed=JSON.parse(before);
  changed.runtime.workflowTransport.mailboxes.B.messages[0].body='Forged readback only';writeFileSync(readbackFile,JSON.stringify(changed));
  try{assert.throws(()=>port.mailbox('B'),{code:'village_bootstrap_runtime_changed'});}finally{writeFileSync(readbackFile,before);}
 }finally{await desk.close();}
}));

test('fixed child and parent port reject extra authority, supplied code, unstable IDs and invalid routes',()=>isolated(async root=>{
 const f=fixture(root),desk=f.create();try{
  await prepare(desk,f.input);await desk.action(command('launch',2,{allowLaunch:true}));const port=desk.runtimePort(f.input.newVillageId),before=port.gateway.queue.snapshot();
  await assert.rejects(port.submit({from:'A',to:'A',message:'Invalid route',messageId:'m_bad_route',code:''}),{code:'village_bootstrap_invalid_delivery'});
  await assert.rejects(port.submit({from:'A',to:'B',message:'Code forbidden',messageId:'m_bad_code',code:'process.exit()'}),{code:'village_bootstrap_invalid_delivery'});
  await assert.rejects(port.submit({from:'A',to:'B',message:'Authority forbidden',messageId:'m_bad_auth',code:'',allowExternalCalls:true}),{code:'village_bootstrap_invalid_request'});
  await assert.rejects(port.submit({from:'A',to:'B',message:'Stable ID required',code:''}),{code:'village_bootstrap_invalid_request'});
  const child=desk.children.get(f.input.newVillageId).child;
  const codeReply=await rawCall(child,{replyId:'test_invalid_code',command:'deliver',from:'A',to:'B',message:'No code execution',messageId:'m_raw_code',code:'process.exit()'});assert.equal(codeReply.error,'village_bootstrap_invalid_delivery');
  const authReply=await rawCall(child,{replyId:'test_invalid_authority',command:'deliver',from:'A',to:'B',message:'No authority copying',messageId:'m_raw_authority',code:'',env:{SECRET:'NEVER_COPY'}});assert.equal(authReply.error,'village_bootstrap_invalid_child_command');
  assert.deepEqual(port.gateway.queue.snapshot(),before);const actual=await rawCall(child,{replyId:'test_state_proof',command:'state'});assert.deepEqual(actual.result.workflowTransport.gateway,before);
 }finally{await desk.close();}
}));

test('membership derives from current owned bundles and uncertain ownership never reads changing files',()=>isolated(async root=>{
 const f=fixture(root),desk=f.create();try{
  const made=await prepare(desk,f.input),recordFile=join(f.options.root,'bundles',f.input.newVillageId+'.json'),manifestFile=join(made.bundle.destination,'manifest.json'),ownerFile=join(made.bundle.destination,'ownership.json');
  const originalRecord=readFileSync(recordFile,'utf8'),originalManifest=readFileSync(manifestFile,'utf8'),originalOwner=readFileSync(ownerFile,'utf8');
  assert.equal(desk.participants().length,1);
  f.source.knowledge[0].repairProvenance={candidateCommit:'c'.repeat(40),verificationDigest:'d'.repeat(64)};delete f.source.knowledge[0].repairEvidence;
  const next=desk.preview({...f.input,newVillageId:'next-village',directoryName:'next-home',sourceVillageId:'port-village'});assert.deepEqual(next.seed.knowledge[0].repairProvenance,f.source.knowledge[0].repairProvenance);assert.equal(next.seed.provenance.sourceVillageId,'port-village');
  assert.throws(()=>desk.preview({...f.input,sourceVillageId:'unknown-village'}),/unknown_registered_village/);
  f.source.knowledge[0].repairProvenance.allowApply=true;assert.throws(()=>desk.preview({...f.input,sourceVillageId:'port-village'}),{code:'village_bootstrap_invalid_knowledge'});delete f.source.knowledge[0].repairProvenance.allowApply;
  for(const status of ['cancelled','creation_interrupted','preparing']){writeFileSync(recordFile,JSON.stringify({...JSON.parse(originalRecord),status}));assert.deepEqual(desk.participants(),[]);}
  writeFileSync(recordFile,originalRecord);
  const staleRecord={...JSON.parse(originalRecord),sourceDigest:'e'.repeat(64)},staleManifest={...JSON.parse(originalManifest),sourceDigest:'e'.repeat(64)};
  writeFileSync(recordFile,JSON.stringify(staleRecord));writeFileSync(manifestFile,JSON.stringify(staleManifest));assert.deepEqual(desk.participants(),[]);assert.equal(desk.catalog().bundles.length,1);
  writeFileSync(ownerFile,JSON.stringify({...JSON.parse(originalOwner),ownershipId:'wrong-owner'}));assert.throws(()=>desk.participants(),{code:'village_bootstrap_destination_not_owned'});
  writeFileSync(ownerFile,originalOwner);writeFileSync(recordFile,originalRecord);writeFileSync(manifestFile,originalManifest);
  const forgedSeed=JSON.parse(readFileSync(join(made.bundle.destination,'seed.json'),'utf8'));forgedSeed.env={SECRET:'NEVER_COPY'};const forgedDigest=sha(JSON.stringify(forgedSeed,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value));
  const originalSeed=readFileSync(join(made.bundle.destination,'seed.json'),'utf8');writeFileSync(join(made.bundle.destination,'seed.json'),JSON.stringify(forgedSeed));writeFileSync(recordFile,JSON.stringify({...JSON.parse(originalRecord),seed:forgedSeed,seedDigest:forgedDigest}));writeFileSync(manifestFile,JSON.stringify({...JSON.parse(originalManifest),seedDigest:forgedDigest}));
  assert.throws(()=>desk.participants(),{code:'village_bootstrap_bundle_changed'});
  writeFileSync(join(made.bundle.destination,'seed.json'),originalSeed);writeFileSync(recordFile,originalRecord);writeFileSync(manifestFile,originalManifest);
  writeFileSync(recordFile,JSON.stringify({...JSON.parse(originalRecord),status:'termination_unconfirmed',launch:{launchId:'unowned-live-fixture',pid:process.pid,terminationConfirmed:false,terminationUnconfirmed:true}}));
  writeFileSync(join(made.bundle.destination,'runtime-readback.json'),'{changing child file');const unavailable=desk.runtimePort(f.input.newVillageId);
  assert.equal(unavailable.available,false);assert.equal(unavailable.state().available,false);assert.deepEqual(unavailable.mailbox('B').messages,[]);assert.deepEqual(unavailable.gateway.queue.snapshot().jobs,[]);assert.equal(desk.state({newVillageId:f.input.newVillageId}).runtime,null);assert.deepEqual(desk.participants(),[]);
 }finally{await desk.close();}
}));

test('validated owner-stop guard runs once per request and parent cleanup remains bounded',()=>isolated(async root=>{
 const f=fixture(root);let blocked=true,calls=0;
 const desk=new VillageBootstrap({...f.options,beforeStop:id=>{calls++;assert.equal(id,f.input.newVillageId);if(blocked)throw Object.assign(Error('work_active'),{code:'work_active'});}});
 try{
  await prepare(desk,f.input);await desk.action(command('launch',2,{allowLaunch:true}));const child=desk.children.get(f.input.newVillageId),stop=command('stop',3,{allowStop:true});
  await assert.rejects(desk.action(stop),{code:'work_active'});assert.equal(calls,1);assert.equal(desk.children.get(f.input.newVillageId),child);assert.equal(desk.runtimePort(f.input.newVillageId).available,true);assert.equal(desk.state({newVillageId:f.input.newVillageId}).bundle.status,'running');
  blocked=false;await assert.rejects(desk.action(stop),{code:'work_active'});assert.equal(calls,1);
  const allowed=command('stop',4,{allowStop:true}),stopped=await desk.action(allowed);assert.equal(stopped.bundle.launch.terminationConfirmed,true);assert.equal(calls,2);
  assert.equal((await desk.action(allowed)).duplicate,true);assert.equal(calls,2);
  await desk.action(command('launch',5,{allowLaunch:true}));blocked=true;
 }finally{await desk.close();}
 assert.equal(calls,2);assert.equal(desk.children.size,0);assert.equal(desk.state({newVillageId:f.input.newVillageId}).bundle.launch.reason,'parent_close');
}));
