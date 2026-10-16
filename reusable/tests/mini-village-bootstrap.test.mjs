import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {VillageBootstrap} from '../../mini/village-bootstrap.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex'),req=number=>'request_'+number.toString(16).padStart(32,'0');
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(predicate){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await predicate())return;await pause(20);}throw Error('Expected bounded village lifecycle transition');}
async function isolated(fn){
 const parent=process.env.METRON_VILLAGE_EVIDENCE_DIR||tmpdir();mkdirSync(parent,{recursive:true});const prefix=join(parent,'village-bootstrap-'),root=mkdtempSync(prefix);
 try{return await fn(root);}finally{if(!process.env.METRON_VILLAGE_EVIDENCE_DIR){assert.ok(resolve(root).startsWith(resolve(prefix)));rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}}
}
function setup(root,{maxRunMs=30000}={}){
 const manager=join(root,'manager'),base=join(root,'children'),original=join(root,'original');mkdirSync(original);writeFileSync(join(original,'untouched.json'),'original village bytes\n');
 const work={id:'work_'+'a'.repeat(32),runId:'case_'+'b'.repeat(32),goal:'Keep the original purpose across a new village',stage:'ready',
  sourceMessage:{id:'m_origin',body:'An explicitly selected delivered observation.',deliveryState:'done'},
  dispatchToken:'NEVER_COPY_DISPATCH',lease:{token:'NEVER_COPY_LEASE'},allowExternalCalls:true,application:{allowApply:true},env:{OPENAI_API_KEY:'NEVER_COPY_KEY'}};
 const source={villageId:'village-1',work,works:[work],knowledge:[
  {id:'origin_village-1',text:'Original village local knowledge',sourceVillage:'village-1',parentRumorId:null,rumorSha256:null,adoptedIn:'village-1'},
  {id:'knowledge_r_origin',text:'User adopted repair knowledge',sourceVillage:'village-2',parentRumorId:'r_origin',rumorSha256:'c'.repeat(64),adoptedIn:'village-1',
   leaseToken:'NEVER_COPY_KNOWLEDGE_TOKEN',repairEvidence:{candidateCommit:'d'.repeat(40),verificationDigest:'e'.repeat(64),allowApply:true,env:{SECRET:'NEVER_COPY_REPAIR_ENV'}}}
 ]};
 const provider=({villageId,workId})=>{assert.equal(villageId,'village-1');assert.ok(workId===null||workId===work.id);return structuredClone(source);};
 const options={root:manager,baseRoot:base,sourceProvider:provider,sourceVersion:'fixture-source-v1',maxRunMs};
 const input={newVillageId:'new-village',directoryName:'new-village-home',displayName:'My independent village',sourceVillageId:'village-1',sourceWorkId:work.id,
  inheritGoal:true,inheritSourceMessage:true,knowledgeIds:['knowledge_r_origin'],purpose:'A new explicit purpose'};
 return {work,source,options,input,original,create:()=>new VillageBootstrap(options)};
}
const createInput=(input,preview,number=1)=>({...input,action:'create',requestId:req(number),previewDigest:preview.previewDigest,allowCreate:true,dataReviewed:true});
const command=(action,number,extra={})=>({action,requestId:req(number),newVillageId:'new-village',...extra});

test('preview and manifest inherit only explicitly selected text/provenance; stale review and unknown fields fail',()=>isolated(async root=>{
 const f=setup(root),desk=f.create();try{
  const catalog=desk.catalog({sourceVillageId:'village-1',sourceWorkId:f.work.id});assert.equal(catalog.source.work.goal,f.work.goal);
  const none=desk.preview({...f.input,inheritGoal:false,inheritSourceMessage:false,knowledgeIds:[]});
  assert.equal(none.seed.inheritedGoal,null);assert.equal(none.seed.sourceMessage,null);assert.deepEqual(none.seed.knowledge,[]);
  const preview=desk.preview(f.input);assert.equal(preview.seed.inheritedGoal.text,f.work.goal);assert.equal(preview.seed.sourceMessage.text,f.work.sourceMessage.body);
  assert.equal(preview.seed.knowledge[0].parentRumorId,'r_origin');
  for(const token of ['NEVER_COPY','allowApply','allowExternalCalls','dispatchToken','lease','env'])assert.equal(JSON.stringify(preview).includes(token),false,token);
  assert.throws(()=>desk.preview({...f.input,env:{SECRET:true}}),{code:'village_bootstrap_invalid_request'});
  const adoptedIn=f.source.knowledge[1].adoptedIn;f.source.knowledge[1].adoptedIn={leaseToken:'NEVER_COPY'};
  assert.throws(()=>desk.preview(f.input),{code:'village_bootstrap_invalid_knowledge'});f.source.knowledge[1].adoptedIn=adoptedIn;
  const runId=f.work.runId;f.work.runId={env:{SECRET:'NEVER_COPY'}};
  assert.throws(()=>desk.preview(f.input),{code:'village_bootstrap_invalid_source_work'});f.work.runId=runId;
  f.work.goal='Changed selected source purpose';
  await assert.rejects(desk.action(createInput(f.input,preview)),{code:'village_bootstrap_preview_stale'});
  assert.equal(readdirSync(f.options.baseRoot).length,0);
  const current=desk.preview(f.input),made=await desk.action(createInput(f.input,current,2));assert.equal(made.bundle.status,'prepared');assert.equal(made.runtime,null);
  const manifest=readFileSync(join(made.bundle.destination,'manifest.json'),'utf8')+readFileSync(join(made.bundle.destination,'seed.json'),'utf8');
  assert.equal(manifest.includes('NEVER_COPY'),false);assert.equal(readFileSync(join(f.original,'untouched.json'),'utf8'),'original village bytes\n');
 }finally{await desk.close();}
}));

test('actual single-village child delivers once, stops, restarts and reads inherited context and persisted A/B/Gateway',()=>isolated(async root=>{
 const f=setup(root),desk=f.create();const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='NEVER_COPY_PARENT_PROVIDER';
 try{
  const preview=desk.preview(f.input),create=createInput(f.input,preview);await desk.action(create);
  assert.equal((await desk.action(create)).duplicate,true);
  await assert.rejects(desk.action({...create,requestId:req(2)}),{code:'village_bootstrap_name_exists'});
  await assert.rejects(desk.action({...create,purpose:'different'}),{code:'village_bootstrap_request_conflict'});
  const launch=command('launch',3,{allowLaunch:true}),started=await desk.action(launch);assert.equal(started.bundle.status,'running');
  assert.notEqual(started.runtime.pid,process.pid);assert.equal(started.runtime.inheritance.inheritedGoal.text,f.work.goal);
  assert.deepEqual(Object.keys(started.runtime.transport.ships),['A','B']);assert.equal(started.runtime.transport.gateway.jobs,2);
  assert.equal((await desk.action(launch)).duplicate,true);
  await assert.rejects(desk.action(command('launch',4,{allowLaunch:true})),{code:'village_bootstrap_not_launchable'});
  const send=command('send-local',5,{message:'A local message in the new village',allowSend:true});
  const delivered=await desk.action(send);assert.equal(delivered.sendResult.deliveryState,'done');
  assert.equal((await desk.action(send)).duplicate,true);assert.equal(desk.state({newVillageId:f.input.newVillageId}).runtime.transport.gateway.jobs,4);
  const stopped=await desk.action(command('stop',6,{allowStop:true}));assert.equal(stopped.bundle.status,'stopped');assert.equal(stopped.bundle.launch.terminationConfirmed,true);
  const restarted=await desk.action(command('launch',7,{allowLaunch:true}));assert.notEqual(restarted.runtime.pid,started.runtime.pid);
  assert.equal(restarted.runtime.transport.ships.B.count,2);assert.equal(restarted.runtime.transport.ships.A.count,2);
  assert.equal(restarted.runtime.transport.ships.B.messages.find(message=>message.id===delivered.sendResult.messageId).body,send.message);
  assert.equal(JSON.stringify(restarted).includes('NEVER_COPY'),false);
  const gateway=readFileSync(join(restarted.bundle.destination,'runtime/gateway.json'),'utf8');assert.equal(gateway.includes('NEVER_COPY_PARENT_PROVIDER'),false);
 }finally{if(prior===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prior;await desk.close();}
 const restored=f.create();try{const state=restored.state({newVillageId:f.input.newVillageId});assert.equal(state.bundle.status,'stopped');assert.equal(restored.children.size,0);assert.equal(state.runtime.transport.ships.B.count,2);}finally{await restored.close();}
}));

test('draft cancellation and creation interruption persist; explicit resume creates only the same owned destination',()=>isolated(async root=>{
 const f=setup(root);let desk=f.create();
 const preview=desk.preview(f.input),creating=desk.action(createInput(f.input,preview));
 const collision={...f.input,newVillageId:'another-village'};
 await assert.rejects(desk.action(createInput(collision,desk.preview(collision),9)),{code:'village_bootstrap_name_exists'});
 const cancelled=await desk.action(command('cancel',2,{reason:'Owner cancelled this draft'}));assert.equal(cancelled.bundle.status,'cancelled');await creating;
 await desk.close();desk=f.create();
 try{assert.equal(desk.state({newVillageId:f.input.newVillageId}).bundle.status,'cancelled');
  const resumed=await desk.action(command('resume',3,{allowResume:true}));assert.equal(resumed.bundle.status,'prepared');
 }finally{await desk.close();}
 const otherRoot=join(root,'interruption');mkdirSync(otherRoot);const g=setup(otherRoot);let other=g.create();const inFlight=other.action(createInput(g.input,other.preview(g.input)));
 await other.close();await inFlight;other=g.create();try{assert.equal(other.state({newVillageId:g.input.newVillageId}).bundle.status,'creation_interrupted');assert.equal(other.children.size,0);assert.equal((await other.action(command('resume',4,{allowResume:true}))).bundle.status,'prepared');}finally{await other.close();}
}));

test('names, existing/casefold roots, symlinks, permissions and competing writers are refused without overwriting',()=>isolated(async root=>{
 const f=setup(root),desk=f.create();try{
  assert.throws(()=>f.create(),{code:'village_bootstrap_manager_owned'});
  if(process.platform==='win32')assert.throws(()=>new VillageBootstrap({...f.options,root:'\\\\server\\share\\manager',baseRoot:'\\\\server\\share\\children'}),{code:'village_bootstrap_local_root_required'});
  for(const bad of ['village-1','village-2','CON','con','lpt1','../outside','UPPER','trail.'])assert.throws(()=>desk.preview({...f.input,newVillageId:bad}));
  for(const bad of ['../outside','c:\\elsewhere','nul','UPPER'])assert.throws(()=>desk.preview({...f.input,directoryName:bad}));
  mkdirSync(join(f.options.baseRoot,'NEW-VILLAGE-HOME'));writeFileSync(join(f.options.baseRoot,'NEW-VILLAGE-HOME','keep'),'unchanged');
  await assert.rejects(desk.action(createInput(f.input,desk.preview(f.input))),{code:'village_bootstrap_name_exists'});
  assert.equal(readFileSync(join(f.options.baseRoot,'NEW-VILLAGE-HOME','keep'),'utf8'),'unchanged');
  const target=join(root,'symlink-target');mkdirSync(target);const link=join(root,'linked-base');symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>new VillageBootstrap({...f.options,root:join(root,'other-manager'),baseRoot:link}),{code:'village_bootstrap_unsafe_root'});
  const next={...f.input,directoryName:'safe-home'};const made=await desk.action(createInput(next,desk.preview(next),2));
  await assert.rejects(desk.action(command('launch',3,{allowLaunch:false})),{code:'village_bootstrap_explicit_launch_required'});
  await assert.rejects(desk.action(command('send-local',4,{message:'not started',allowSend:true})),{code:'village_bootstrap_explicit_local_message_required'});
  const original=readFileSync(join(made.bundle.destination,'seed.json'),'utf8');writeFileSync(join(made.bundle.destination,'seed.json'),original.replace('A new explicit purpose','Tampered new purpose'));
  await assert.rejects(desk.action(command('launch',5,{allowLaunch:true})),{code:'village_bootstrap_bundle_changed'});
 }finally{await desk.close();}
}));

test('child IPC disconnect and duration bound terminate the owned process without automatic restart',()=>isolated(async root=>{
 const f=setup(root,{maxRunMs:30000}),desk=f.create(),trace={events:[],snapshots:[]};let observedEntry;
 const saveTrace=phase=>{const child=observedEntry?.child;trace.snapshots.push({phase,at:Date.now(),eventCount:trace.events.length,...(child?{launchId:observedEntry.launchId,pid:child.pid??null,exitCode:child.exitCode,signalCode:child.signalCode,connected:child.connected,exited:observedEntry.exited,processExitObserved:observedEntry.processExitObserved,pipeCloseObserved:observedEntry.pipeCloseObserved}:{})});writeFileSync(join(root,'ipc-lifecycle-events.json'),JSON.stringify(trace,null,2)+'\n');};
 try{
  await desk.action(createInput(f.input,desk.preview(f.input)));await desk.action(command('launch',2,{allowLaunch:true}));
  observedEntry=desk.children.get(f.input.newVillageId);const child=observedEntry.child;
  child.on('exit',(code,signal)=>trace.events.push({event:'exit',at:Date.now(),code,signal}));
  child.on('close',(code,signal)=>trace.events.push({event:'close',at:Date.now(),code,signal}));
  child.on('disconnect',()=>trace.events.push({event:'disconnect',at:Date.now()}));
  child.on('error',error=>trace.events.push({event:'error',at:Date.now(),code:error.code??null}));
  child.disconnect();
  // Once the IPC channel is gone the parent cannot authenticate a final reason.
  // Confirm process exit, retain the interruption, and require explicit resume.
  await until(()=>desk.state({newVillageId:f.input.newVillageId}).bundle.status==='interrupted');
  assert.equal(desk.state({newVillageId:f.input.newVillageId}).bundle.launch.terminationConfirmed,true);assert.equal(desk.children.size,0);
  assert.equal(desk.state({newVillageId:f.input.newVillageId}).bundle.launch.processExitObserved,true);assert.equal(trace.events.some(event=>event.event==='exit'),true);
  await assert.rejects(desk.action(command('launch',3,{allowLaunch:true})),{code:'village_bootstrap_not_launchable'});
 }finally{try{saveTrace('before_cleanup');}finally{try{await desk.close();}finally{saveTrace('after_cleanup');}}}
 const second=join(root,'duration');mkdirSync(second);const g=setup(second,{maxRunMs:400}),bounded=g.create();try{
  await bounded.action(createInput(g.input,bounded.preview(g.input)));await bounded.action(command('launch',2,{allowLaunch:true}));
  await until(()=>bounded.state({newVillageId:g.input.newVillageId}).bundle.status==='stopped');assert.equal(bounded.state({newVillageId:g.input.newVillageId}).bundle.launch.reason,'max_duration');
 }finally{await bounded.close();}
}));

test('unexpected child interruption requires explicit resume; a live unknown PID never grants restart authority',()=>isolated(async root=>{
 const f=setup(root);let desk=f.create();try{
  await desk.action(createInput(f.input,desk.preview(f.input)));await desk.action(command('launch',2,{allowLaunch:true}));
  await desk.action(command('send-local',3,{message:'Persist before interruption',allowSend:true}));
  const interrupted=desk.children.get(f.input.newVillageId),closeHandlers=interrupted.child.listeners('close');assert.equal(closeHandlers.length,1);const delayedClose=closeHandlers[0];interrupted.child.removeListener('close',delayedClose);
  interrupted.child.kill('SIGKILL');await until(()=>desk.state({newVillageId:f.input.newVillageId}).bundle.status==='interrupted');
  await assert.rejects(desk.action(command('launch',4,{allowLaunch:true})),{code:'village_bootstrap_not_launchable'});
  await desk.action(command('resume',5,{allowResume:true}));const again=await desk.action(command('launch',6,{allowLaunch:true}));assert.equal(again.runtime.transport.ships.B.count,2);
  const active=desk.children.get(f.input.newVillageId),activeRecord=readFileSync(join(f.options.root,'bundles',f.input.newVillageId+'.json'),'utf8');
  delayedClose(interrupted.child.exitCode,interrupted.child.signalCode);
  assert.equal(desk.children.get(f.input.newVillageId),active);assert.equal(readFileSync(join(f.options.root,'bundles',f.input.newVillageId+'.json'),'utf8'),activeRecord);
  const priorReceipt=JSON.parse(readFileSync(join(f.options.root,'child-logs',interrupted.launchId+'.json'),'utf8'));assert.equal(priorReceipt.processExitObserved,true);assert.equal(priorReceipt.pipeCloseObserved,true);
 }finally{await desk.close();}
 const file=join(f.options.root,'bundles',f.input.newVillageId+'.json'),record=JSON.parse(readFileSync(file,'utf8'));record.status='running';record.launch.pid=process.pid;writeFileSync(file,JSON.stringify(record));
 desk=f.create();try{assert.equal(desk.children.size,0);assert.equal(desk.state({newVillageId:f.input.newVillageId}).bundle.status,'termination_unconfirmed');await assert.rejects(desk.action(command('resume',7,{allowResume:true})),{code:'village_bootstrap_termination_unconfirmed'});await assert.rejects(desk.action(command('launch',8,{allowLaunch:true})),{code:'village_bootstrap_not_launchable'});}finally{await desk.close();}
}));
