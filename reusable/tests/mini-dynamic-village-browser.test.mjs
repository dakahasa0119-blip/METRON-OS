// Actual owned Chromium, canonical DOM/API, fixed Runtime child and native Git.
// One deterministic injected worker edits a declared fixture: NOT REAL AI/Codex.
// No user profile, provider, external network, login or automatic approval path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {join,dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createMiniServer} from '../../mini/server.mjs';
import {createRegisteredProjectPlan,commitRegisteredWorkspace} from '../../mini/project-tools.mjs';
const execute=promisify(execFile),OPERATOR='f'.repeat(64),LABEL='INJECTED DYNAMIC BROWSER FIXTURE WORKER - NOT REAL AI';
const sha=value=>createHash('sha256').update(value).digest('hex');
const ASSETS=new Set(['/experience','/experience.js','/experience.css','/project-ui.js','/village-ui.js','/setup-ui.js','/style.css']);
const put=(root,path,text)=>{const file=join(root,...path.split('/'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
function chromium(){return [process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser',
  process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,'Google','Chrome','Application','chrome.exe'),
  process.env['PROGRAMFILES(X86)']&&join(process.env['PROGRAMFILES(X86)'],'Microsoft','Edge','Application','msedge.exe')].filter(Boolean).find(existsSync)||null;}
function git(root,args){return execFileSync("git",["--no-pager","-c","core.autocrlf=false","-c","core.fsmonitor=false",
  "-c","core.hooksPath="+join(root,"disabled-fixture-hooks"),"-c","commit.gpgsign=false",
  "-c","user.name=Dynamic Village Fixture","-c","user.email=fixture@local.invalid",...args],{
  cwd:root,shell:false,windowsHide:true,encoding:"utf8",timeout:15000,stdio:["ignore","pipe","pipe"],
  env:{...process.env,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:process.platform==="win32"?"NUL":"/dev/null",GIT_TERMINAL_PROMPT:"0"}}).trim();}
function registeredFixture(root){
  const base=join(root,"p"),names={repositoryRoot:"r",baselineRoot:"b",candidateRoot:"c",applyRoot:"a",evidenceRoot:"e",tempRoot:"t",acceptanceRoot:"h"};
  const paths=Object.fromEntries(Object.entries(names).map(([key,name])=>[key,join(base,name)]));
  for(const path of Object.values(paths))mkdirSync(path,{recursive:true});
  const template=join(root,"empty-template");mkdirSync(template);git(paths.repositoryRoot,["init","--template="+template]);
  git(paths.repositoryRoot,["config","core.autocrlf","false"]);
  put(paths.repositoryRoot,"src/name.mjs","export const name = input => input.trim();\n");
  put(paths.repositoryRoot,"src/message.mjs",'import {name} from "./name.mjs";export const message = input => "Hello, " + name(input);\n');
  const check='import test from "node:test";import assert from "node:assert/strict";import {message} from "../src/message.mjs";test("normalizes a greeting",()=>assert.equal(message(" Ada "),"Hello, ada"));\n';
  put(paths.repositoryRoot,"tests/public.test.mjs",check);put(paths.repositoryRoot,"tests/post.test.mjs",check);
  git(paths.repositoryRoot,["add","."]);git(paths.repositoryRoot,["commit","-m","Deliberately faulty dynamic fixture baseline"]);
  const baseCommit=git(paths.repositoryRoot,["rev-parse","HEAD"]);
  for(const path of [paths.baselineRoot,paths.candidateRoot,paths.applyRoot])git(paths.repositoryRoot,["worktree","add","--detach",path,baseCommit]);
  put(paths.acceptanceRoot,"sealed/accept.test.mjs",check.replace('message(" Ada ")','message(" MIXED ")').replace('"Hello, ada"','"Hello, mixed"'));
  return createRegisteredProjectPlan({id:"dynamic-greeting",label:LABEL,...paths,baseCommit,
    allowedEdits:[{path:"src/name.mjs",operations:["edit"]}],publicTests:["tests/public.test.mjs"],
    acceptanceTests:["sealed/accept.test.mjs"],postApplyTests:["tests/post.test.mjs"]});
}
function injectedWorker(){
  const calls=[];return {calls,runAttempt:async({sessions,plan,sessionId,dispatchToken,workerId,claimId,signal})=>{
    assert.notEqual(signal.aborted,true);const lease=await sessions.claim({sessionId,dispatchToken,workerId,claimId});
    calls.push({sessionId,attemptId:lease.attempt.id,label:LABEL,modelCalls:0});
    assert.equal(existsSync(join(lease.attempt.workspaceRoot,"sealed/accept.test.mjs")),false);
    put(lease.attempt.workspaceRoot,"src/name.mjs","export const name = input => input.trim().toLowerCase();\n");
    const candidate=commitRegisteredWorkspace(plan,{workerRoot:lease.attempt.workspaceRoot,message:LABEL});
    await sessions.report({sessionId,leaseToken:lease.leaseToken,report:{reportId:"dynamic_fixture_report",
      candidateCommit:candidate.candidateCommit,diagnosis:LABEL+": normalize case",operations:["Explicit fixture source edit and real local Git commit"],unresolved:[]}});
    return {status:"reported_awaiting_independent_review",modelLaunchIntent:false,modelProcessStarted:false,terminationUnconfirmed:false,
      attemptId:lease.attempt.id,candidateCommit:candidate.candidateCommit,diffSha256:candidate.diffSha256,process:{exitCode:0}};
  }};
}

async function browserDriver(config){
  const $=id=>document.getElementById(id),text=id=>$(id)?.textContent||'',snapshots=[];
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const change=(id,value,event='input')=>{$(id).value=value;$(id).dispatchEvent(new Event(event,{bubbles:true}));};
  const read=id=>{try{return JSON.parse(text(id));}catch{return null;}};
  const bundle=()=>read('village-state-audit')?.bundle;
  const metrics=async()=>{const r=await fetch('/__dynamic-village-browser/metrics',{cache:'no-store'});check(r.ok,'fixture metrics unavailable');return r.json();};
  async function until(predicate,label,ms=35000){
    const end=Date.now()+ms;while(Date.now()<end){const m=await metrics();if(await predicate(m))return m;await new Promise(r=>setTimeout(r,65));}
    throw Error('Timeout '+label+'; work='+text('work-notice')+'; village='+text('village-notice')+'; project='+text('project-status'));
  }
  async function click(id){await until(()=>$(id)&&!$(id).disabled,id+' enabled');$(id).click();}
  const select=(id,value)=>change(id,value,'change');
  const controls=()=>Object.fromEntries(["work-village","work-saved","project-plan","project-symptom","project-evidence","project-scope-reviewed","project-start"]
    .map(id=>[id,{value:$(id)?.value,checked:$(id)?.checked,disabled:$(id)?.disabled}]));
  const snapshot=async phase=>snapshots.push({phase,controls:controls(),...await metrics()});
  async function villageAction(name,status){
    check(!$('village-action-reviewed').checked,'village action approval retained');
    await click('village-action-reviewed');await click('village-'+name);await until(()=>bundle()?.status===status,name+' saved '+status);
    check(!$('village-action-reviewed').checked,'village action review not consumed');
  }
  function rumorCard(id){return [...$('square-proposals').children].find(node=>node.textContent.includes(id.slice(0,14)));}
  async function receiveAndReview(rumorId,recipient,decision){
    select('rumor-recipient-village',recipient);
    await until(()=>rumorCard(rumorId)?.querySelector('button')&&!rumorCard(rumorId).querySelector('button').disabled,'selected recipient receive button');
    const receive=rumorCard(rumorId).querySelector('button');check(!receive.disabled,'recipient unavailable');receive.click();
    await until(m=>m.world.villages[recipient].incoming.some(r=>r.rumorId===rumorId&&r.status==='pending'),'explicit pending receipt');
    check(!(await metrics()).world.villages[recipient].knowledge.some(k=>k.parentRumorId===rumorId),'receive adopted automatically');
    await until(()=>[...$('village-incoming').children].some(node=>node.textContent.includes(config.shareBody)&&node.querySelectorAll('button').length===2&&!node.querySelectorAll('button')[decision==='adopt'?0:1].disabled),'review controls');
    const card=[...$('village-incoming').children].find(node=>node.textContent.includes(config.shareBody));
    card.querySelectorAll('button')[decision==='adopt'?0:1].click();
    await until(m=>m.world.villages[recipient].incoming.some(r=>r.rumorId===rumorId&&r.status===(decision==='adopt'?'adopted':'quarantined')),'explicit '+decision);
  }
  async function finish(ok,error,extra={}){
    const result={ok,error,phase:config.phase,snapshots,controls:controls(),...extra};
    const marker=document.createElement('pre');marker.id='dynamic-village-browser-verification';marker.dataset.result=ok?'pass':'fail';marker.textContent=JSON.stringify(result);document.body.append(marker);
    await fetch('/__dynamic-village-browser/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
  }
  try{
    await until(()=>$('project-load-catalog')&&!$('project-load-catalog').disabled,'owner control');
    check(!$('project-operator-key').value,'fresh browser retained owner capability');change('project-operator-key',config.operator);await click('project-load-catalog');
    await until(()=>!$('village-reload').disabled&&[...$('project-plan').options].some(o=>o.value===config.projectId),'owner catalogs');
    if(config.phase==='restored'){
      select('work-village',config.villageId);await until(()=>[...$('work-saved').options].some(o=>o.value===config.workId),'saved dynamic work');
      select('work-saved',config.workId);await until(m=>m.work?.id===config.workId&&m.session?.status==='rolled_back','persisted rollback/work binding');
      select('village-saved',config.villageId);await until(()=>bundle()?.status==='stopped','saved stopped bundle');
      const m=await metrics();check(m.childCount===0&&m.workerCalls===1,'GET/owner connection replayed work');
      check(m.work.publication.rumor.id===config.rumorId,'published Rumor identity changed');
      check(m.work.projectRepair.pouc?.status==='verified'&&m.work.projectRepair.pouc.proofDigest===config.poucDigest,'saved PoUC binding changed');
      check(m.world.villages['village-2'].knowledge.filter(k=>k.parentRumorId===config.rumorId).length===1,'adopted knowledge duplicated/lost');
      check(m.world.villages['village-1'].incoming.find(r=>r.rumorId===config.rumorId)?.status==='quarantined','quarantine lost');
      check(!$('agent-cloud-consent').checked&&!$('project-codex-consent').checked&&!$('work-publish-reviewed').checked&&!$('project-pouc-reviewed').checked,'approval survived fresh browser');
      check($('project-dispatch').disabled&&$('try-agentic-repair').disabled&&$('project-pouc').disabled,'stopped village permits repair or recomputation');
      await snapshot('fresh-parent-browser-get-only');await finish(true,null,{workId:config.workId,rumorId:config.rumorId});return;
    }
    // Publish harmless reference data through the actual Rumor DOM, then adopt in v1.
    select('rumor-source-village','village-2');select('rumor-recipient-village','village-1');change('rumor-text',config.referenceText);await click('share-knowledge');
    const seeded=await until(m=>m.world.square.some(r=>r.body===config.referenceText),'reference Rumor publication');
    const reference=seeded.world.square.find(r=>r.body===config.referenceText);
    await until(()=>rumorCard(reference.id)?.querySelector('button')&&!rumorCard(reference.id).querySelector('button').disabled,'reference receive control');rumorCard(reference.id).querySelector('button').click();
    await until(m=>m.world.villages['village-1'].incoming.some(r=>r.rumorId===reference.id&&r.status==='pending'),'reference pending receipt');
    await until(()=>[...$('village-incoming').children].some(n=>n.textContent.includes(config.referenceText)&&n.querySelectorAll('button').length===2&&!n.querySelector('button').disabled),'reference adopt control');
    [...$('village-incoming').children].find(n=>n.textContent.includes(config.referenceText)).querySelector('button').click();
    await until(m=>m.world.villages['village-1'].knowledge.some(k=>k.parentRumorId===reference.id),'reference adopted');
    select('work-village','village-1');await until(()=>[...$('work-source').options].some(o=>o.value===config.sourceId),'home observation');
    select('work-source',config.sourceId);change('agent-goal',config.goal);await click('create-work');
    const source=(await until(m=>m.sourceWork?.goal===config.goal,'source work saved through DOM')).sourceWork;
    check((await metrics()).workerCalls===0,'source creation dispatched a worker');
    await click('village-reload');await until(()=>[...$('village-source-work').options].some(o=>o.value===source.id),'source work in inheritance catalog');
    select('village-source-work',source.id);await until(()=>text('village-source-summary').includes(config.goal)&&!$('village-source-work').disabled,'selected inheritance source');
    change('village-new-id',config.villageId);change('village-directory',config.directory);change('village-purpose',config.purpose);
    await click('village-inherit-goal');await click('village-inherit-source');
    const inheritedLabel=[...document.querySelectorAll('#village-knowledge label')].find(n=>n.textContent.includes(config.referenceText));check(inheritedLabel,'reference choice missing');inheritedLabel.querySelector('input').click();
    await click('village-preview');await until(()=>read('village-preview-audit')?.selection?.newVillageId===config.villageId,'bootstrap preview');
    const preview=read('village-preview-audit');check(preview.seed.knowledge.length===1&&preview.seed.inheritedGoal.text===config.goal&&preview.seed.sourceMessage.text===config.sourceBody,'preview changed selected data');
    check($('village-create').disabled&&!$('village-preview-reviewed').checked,'creation lacked explicit review');await click('village-preview-reviewed');await click('village-create');
    await until(()=>bundle()?.status==='prepared','prepared bundle');check((await metrics()).childCount===0,'create launched child');
    await villageAction('launch','running');const firstPid=(await metrics()).childPid;check(firstPid&&firstPid!==config.parentPid,'Runtime child PID absent');
    await click('village-open-work');await until(m=>$('work-village').value===config.villageId&&m.sources.some(s=>s.body===config.sourceBody),'explicit same-screen work navigation');
    check($('agent-goal').value===config.goal&&!$('agent-cloud-consent').checked,'goal or fresh model consent mismatch');
    const active=await metrics(),seedSource=active.sources.find(s=>s.body===config.sourceBody),selectedReference=active.knowledge.find(k=>k.inheritance?.kind==='selected_reference');
    check(selectedReference&&selectedReference.adoptedIn===null,'inheritance falsely adopted');
    check([...document.querySelectorAll('#work-knowledge input')].every(i=>!i.checked),'inheritance was auto-selected');
    const referenceInput=[...document.querySelectorAll('#work-knowledge input')].find(i=>i.value===selectedReference.id);
    check(referenceInput?.parentElement.textContent.includes('継承参照'),'inheritance label absent');referenceInput.click();select('work-source',seedSource.id);await click('create-work');
    // A persisted backend work can become visible to metrics before the create
    // response finishes acceptSavedWork/projectUi.update. Wait for that exact
    // frontend identity and idle controls before entering fresh scope fields;
    // update intentionally clears approvals when the displayed work changes.
    const created=(await until(m=>m.work?.knowledge.some(k=>k.id===selectedReference.id)&&
      $('work-saved').value===m.work.id&&text('work-readback').includes(m.work.id)&&
      $('work-create-fields').hidden===true&&!$('project-plan').disabled,'dynamic work accepted by frontend')).work;
    await snapshot('dynamic-work-front-end-readback');
    check(created.runId!==source.runId&&created.villageId===config.villageId,'new work reused source identity');
    select('project-plan',config.projectId);change('project-symptom','The fixed greeting fixture retains uppercase names');change('project-evidence','The registered public assertion requires normalized lowercase');
    check(!$('project-scope-reviewed').checked,'project scope approval inherited');await click('project-scope-reviewed');await click('project-start');
    await until(m=>m.session?.status==='ready_worker'&&m.session.baselinePassed===false,'real fixed baseline failure');
    check(!$('project-codex-consent').checked&&$('project-dispatch').disabled,'worker dispatch preapproved');await click('project-codex-consent');await click('project-dispatch');
    await until(m=>m.workerCalls===1&&m.session?.status==='awaiting_review'&&m.session.attemptCount===1,'declared injected candidate');
    await click('project-review-diff');await until(()=>text('project-diff').includes('diff --git')&&text('project-diff').includes('toLowerCase'),'actual deterministic fixture diff');
    // This exact one-line fixture change is authored and reviewed in this test;
    // no unknown real model candidate is approved by browser automation.
    change('project-reviewer','Independent declared fixture review - NOT REAL AI');check(!$('project-diff-reviewed').checked,'diff review preapproved');await click('project-diff-reviewed');await click('project-validate');
    await until(m=>m.session?.status==='candidate_verified'&&m.session.publicPassed===true&&m.session.acceptancePassed===true,'independent fixed checks');
    check(!$('project-pouc-reviewed').checked&&$('project-pouc').disabled,'PoUC was preapproved');
    await click('project-pouc-reviewed');await click('project-pouc');
    const recomputed=await until(m=>m.work?.projectRepair?.pouc?.status==='verified'&&
      text('project-pouc-result').includes(m.work.projectRepair.pouc.proofDigest),'fixed PoUC recomputation and DOM readback',65000);
    const poucDigest=recomputed.work.projectRepair.pouc.proofDigest;
    check(text('project-pouc-result').includes(poucDigest)&&recomputed.workerCalls===1,'PoUC display or model call boundary changed');
    await snapshot('dynamic-registered-fixed-checks-recomputed');
    await click('project-apply-reviewed');await click('project-apply');await until(m=>m.session?.status==='applied_verified','isolated fixture application');
    await snapshot('dynamic-registered-fixture-applied');
    const reviewedBody=config.shareBody+' Local PoUC receipt: '+poucDigest;
    change('work-share-body',reviewedBody);change('work-share-diagnosis','The declared fixture lacked lowercase normalization');
    change('work-share-applicability','Only this registered disposable greeting fixture was checked');change('work-share-limitations','Injected worker fixture, NOT REAL AI; receiver must review independently');
    await click('save-work-share');await until(m=>m.work?.sharingCandidate?.body===reviewedBody,'private provenance draft');
    check(!$('work-publish-reviewed').checked&&$('publish-work-share').disabled,'draft published without review');await click('work-publish-reviewed');await click('publish-work-share');
    const published=(await until(m=>m.work?.publication?.status==='published','explicit provenance publication')).work.publication.rumor;
    check(published.originVillage===config.villageId&&published.repairEvidence.productionApplied===false,'repair Rumor scope mismatch');
    await receiveAndReview(published.id,'village-2','adopt');await receiveAndReview(published.id,'village-1','quarantine');
    change('project-reviewer','Exact isolated fixture rollback');await click('project-rollback-reviewed');await click('project-rollback');await until(m=>m.session?.status==='rolled_back','exact baseline rollback');
    const beforeStop=await metrics();await villageAction('stop','stopped');await until(m=>m.childCount===0,'first Runtime close');
    await villageAction('launch','running');const relaunched=await metrics();check(relaunched.childPid!==firstPid,'relaunch reused child PID');
    check(relaunched.childBCount===beforeStop.childBCount,'relaunch replayed inherited source or Rumor delivery');
    check(relaunched.sources.filter(s=>s.body===config.sourceBody).length===1,'seed source duplicated');
    await villageAction('stop','stopped');await until(m=>m.childCount===0,'second Runtime close');
    const end=await metrics();check(end.workerCalls===1&&end.session.attemptCount===1,'navigation/share/relaunch replayed worker');
    check(end.world.square.filter(r=>r.id===published.id).length===1,'Rumor publication duplicated');
    check(!JSON.stringify([...Object.keys(localStorage).map(k=>localStorage.getItem(k)),...Object.keys(sessionStorage).map(k=>sessionStorage.getItem(k))]).includes(config.operator),'owner capability persisted');
    await snapshot('rolled-back-stopped-relaunch-deduplicated');await finish(true,null,{sourceWorkId:source.id,workId:created.id,runId:created.runId,sessionId:end.session.id,candidateCommit:published.repairEvidence.candidateCommit,rumorId:published.id,rumorSha256:published.sha256,poucDigest,firstChildPid:firstPid,secondChildPid:relaunched.childPid});
  }catch(error){await finish(false,error.stack||String(error));}
}


function publicMetrics(app,config,worker){
  const world=app.civilization.state(),source=app.work.state({villageId:'village-1'});
  const member=world.villages[config.villageId],selected=member?app.work.state({villageId:config.villageId}):null;
  const work=selected?.work,s=work?.projectRepair?.sessionId?app.work.projectState({sessionId:work.projectRepair.sessionId,operator:true}):null;
  const last=s?.attempts.at(-1),runtime=member?app.villageBootstrap.state({newVillageId:config.villageId}).runtime:null;
  return {world,sourceWork:source.work,work:work??null,sources:selected?.sources||[],knowledge:selected?.knowledge||[],
    childCount:app.villageBootstrap.children.size,childPid:runtime?.pid??null,childBCount:runtime?.transport?.ships?.B?.count??0,
    workerCalls:worker.calls.length,session:s?{id:s.id,status:s.status,attemptCount:s.attempts.length,baselinePassed:s.baseline?.passed,
      publicPassed:last?.publicResult?.passed,acceptancePassed:last?.acceptanceResult?.passed,
      candidateCommit:last?.report?.candidateCommit,verificationId:s.verification?.id,applicationStatus:s.application?.status}:null};
}
async function bodyBytes(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>512000)throw Error('Test receipt limit');chunks.push(chunk);}return Buffer.concat(chunks);}
async function harness(app,config,worker){
  const requests=[],assets=[],barriers=new Set(),origin=new URL(app.url);let report=null;
  const proxy=createServer(async(req,res)=>{
    try{
      const local='http://127.0.0.1:'+proxy.address().port;
      if(req.headers.host!==new URL(local).host||(req.headers.origin&&req.headers.origin!==local)){res.writeHead(403);res.end('Loopback origin required');return;}
      const path=new URL(req.url,local).pathname;
      if(path==='/__dynamic-village-browser/driver.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end('('+browserDriver.toString()+')('+JSON.stringify(config)+');');return;}
      if(path==='/__dynamic-village-browser/barrier.svg'){
        const finish=()=>{res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');};
        if(report)finish();else{barriers.add(finish);res.once('close',()=>barriers.delete(finish));}return;
      }
      if(path==='/__dynamic-village-browser/metrics'){
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(publicMetrics(app,config,worker)));return;
      }
      const body=req.method==='POST'?await bodyBytes(req):Buffer.alloc(0);
      if(path==='/__dynamic-village-browser/complete'){
        report=JSON.parse(body.toString('utf8'));res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');for(const finish of barriers)finish();barriers.clear();return;
      }
      // Translate only the isolated proxy's loopback Origin/Host. Never inject
      // an operator header, mutation, worker, backend response or product JS.
      const headers={...req.headers,host:origin.host};if(headers.origin)headers.origin=origin.origin;delete headers.connection;
      const record={path,method:req.method,body:body.length?JSON.parse(body.toString('utf8')):null,operatorHeaderPresent:!!headers['x-metron-project-operator'],responseStatus:null};requests.push(record);
      const upstream=request(app.url+req.url,{agent:false,method:req.method,headers},up=>{
        record.responseStatus=up.statusCode;
        if(!ASSETS.has(path)){res.writeHead(up.statusCode,up.headers);up.pipe(res);return;}
        const chunks=[];let size=0;up.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){up.destroy(Error('Asset limit'));return;}chunks.push(chunk);});
        up.on('end',()=>{
          const original=Buffer.concat(chunks),html=path==='/experience';
          const sent=html?Buffer.from(original.toString('utf8').replace('</body>','<img hidden alt="" src="/__dynamic-village-browser/barrier.svg"><script type="module" src="/__dynamic-village-browser/driver.js"></script></body>')):original;
          assets.push({path,status:up.statusCode,productionBytes:original.length,productionSha256:sha(original),browserBytes:sent.length,browserSha256:sha(sent),htmlDriverInjected:html});
          const responseHeaders={...up.headers,'content-length':sent.length};delete responseHeaders['transfer-encoding'];res.writeHead(up.statusCode,responseHeaders);res.end(sent);
        });up.on('error',e=>{if(!res.headersSent)res.writeHead(502);res.end(e.message);});
      });upstream.setTimeout(120000,()=>upstream.destroy(Error('Loopback timeout')));upstream.on('error',e=>{if(!res.headersSent)res.writeHead(502);res.end(e.message);});upstream.end(body);
    }catch(error){if(!res.headersSent)res.writeHead(500);res.end(error.message);}
  });
  await new Promise((done,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',done);});
  return {url:'http://127.0.0.1:'+proxy.address().port,requests,assets,report:()=>report,
    close:async()=>{for(const finish of barriers)finish();barriers.clear();proxy.closeAllConnections();await new Promise(done=>proxy.close(done));}};
}

function evidenceFiles(root){
  const result={};function visit(dir,prefix=''){for(const entry of readdirSync(dir,{withFileTypes:true})){
    const file=join(dir,entry.name),key=prefix+entry.name;if(entry.isDirectory())visit(file,key+'/');else if(entry.isFile())result[key]=sha(readFileSync(file));
  }}visit(root);return result;
}
function safeRemove(parent,path){
  const rel=relative(resolve(parent),resolve(path));assert.ok(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep),'owned test cleanup path');
  rmSync(path,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}

test('real Chromium dynamic village DOM repairs one injected fixture, shares with human actions and restores without replay',
  {skip:!chromium()||process.env.METRON_RUN_VILLAGE_BROWSER!=='1',timeout:360000},async t=>{
    const tempParent=process.env.TEMP||tmpdir(),evidenceParent=process.env.METRON_VILLAGE_BROWSER_EVIDENCE_DIR||tmpdir();
    mkdirSync(tempParent,{recursive:true});mkdirSync(evidenceParent,{recursive:true});
    const root=mkdtempSync(join(tempParent,'mdvb-')),evidence=mkdtempSync(join(evidenceParent,'dynamic-browser-'));
    const worker=injectedWorker(),phases=[];let app,proxy,exerciseReport;
    try{
      const plan=registeredFixture(root),options={root:join(root,'data'),port:0,projectOperatorToken:OPERATOR,
        villageBootstrapOptions:{baseRoot:join(root,'villages'),maxRunMs:300000},
        workOptions:{projectPlans:[plan],runnerOptions:{env:{}}},
        projectCodexOptions:{label:LABEL,executable:join(root,'never-launched','codex.exe'),runAttempt:worker.runAttempt}};
      app=await createMiniServer(options);
      const config={operator:OPERATOR,parentPid:process.pid,projectId:plan.id,villageId:'browser-dynamic-greeting',directory:'browser-dynamic-home',
        sourceId:'dynamic_browser_source',sourceBody:'Normalize the registered greeting in this local fixture.',
        goal:'Normalize the registered greeting with selected reference data.',purpose:'A separately owned dynamic browser fixture purpose.',
        referenceText:'Selected reference: normalize lowercase only inside the registered greeting fixture.',
        shareBody:'Reviewed injected fixture result: lowercase normalization passed fixed local checks; NOT REAL AI.'};
      assert.equal(app.runtime.submit({messageId:config.sourceId,from:'A',to:'B',message:config.sourceBody,code:''}).job.state,'done');
      assert.equal(worker.calls.length,0);const baselineBytes=readFileSync(join(plan.applyRoot,'src/name.mjs'),'utf8');
      let beforeRestore=null;
      for(const phase of ['exercise','restored']){
        const dir=join(evidence,phase);mkdirSync(dir);
        proxy=await harness(app,{...config,phase,...(exerciseReport?{workId:exerciseReport.workId,rumorId:exerciseReport.rumorId,poucDigest:exerciseReport.poucDigest}:{})},worker);
        const args=['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--disable-extensions',
          '--user-data-dir='+join(root,'browser-'+phase),'--window-size=1440,1100','--screenshot='+join(dir,'page.png'),'--dump-dom',proxy.url+'/experience'];
        if(process.getuid?.()===0)args.unshift('--no-sandbox');
        const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','COMSPEC','LOCALAPPDATA','ProgramFiles','ProgramFiles(x86)']
          .filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));
        let stdout='',stderr='';
        try{({stdout,stderr}=await execute(chromium(),args,{timeout:phase==='exercise'?230000:65000,maxBuffer:16*1024*1024,windowsHide:true,env:{...env,TEMP:tempParent,TMP:tempParent}}));}
        catch(error){stdout=error.stdout||'';stderr=error.stderr||'';throw error;}
        finally{
          writeFileSync(join(dir,'dom.private.html'),stdout);writeFileSync(join(dir,'browser-stderr.log'),stderr);
          writeFileSync(join(dir,'requests.json'),JSON.stringify(proxy.requests,null,2));writeFileSync(join(dir,'served-assets.json'),JSON.stringify(proxy.assets,null,2));
          writeFileSync(join(dir,'receipt.json'),JSON.stringify(proxy.report(),null,2));
        }
        const report=proxy.report();assert.ok(report,'No browser completion: '+stderr.slice(-1500));assert.equal(report.ok,true,report.error);
        assert.match(stdout,/<pre id="dynamic-village-browser-verification" data-result="pass">/);
        for(const asset of ASSETS)assert.ok(proxy.assets.some(a=>a.path===asset&&a.status===200),'Missing canonical asset '+asset);
        for(const asset of proxy.assets.filter(a=>!a.htmlDriverInjected))assert.equal(asset.productionSha256,asset.browserSha256,'Product asset altered');
        const posts=proxy.requests.filter(r=>r.method==='POST');
        if(phase==='exercise'){
          exerciseReport=report;assert.equal(worker.calls.length,1);
          assert.deepEqual(posts.filter(r=>r.path==='/api/village/action').map(r=>r.body.action),['create','launch','stop','launch','stop']);
          assert.equal(posts.filter(r=>r.path==='/api/work/action'&&r.body.action==='create').length,2,'Both source and dynamic work created by DOM');
          assert.equal(posts.filter(r=>r.path==='/api/project/dispatch').length,1,'Exactly one injected worker dispatch');
          assert.deepEqual(posts.filter(r=>r.path==='/api/project/action').map(r=>r.body.action),['start','review','validate','pouc','apply','rollback']);
          assert.equal(posts.filter(r=>r.path==='/api/work/action'&&r.body.action==='publish-share').length,1,'Exactly one explicit repair publication');
          for(const post of posts.filter(r=>r.path.startsWith('/api/village/')||r.path.startsWith('/api/project/')||r.body?.villageId===config.villageId||r.body?.from===config.villageId))
            assert.equal(post.operatorHeaderPresent,true,'Dynamic/owner mutation omitted current capability');
          const s=app.work.projectState({sessionId:report.sessionId,operator:true}),last=s.attempts[0];
          assert.equal(s.status,'rolled_back');assert.equal(s.attempts.length,1);assert.equal(last.publicResult.passed,true);assert.equal(last.acceptanceResult.passed,true);
          assert.equal(s.application.postApply.passed,true);assert.equal(s.verification.candidateCommit,report.candidateCommit);
          assert.equal(s.pouc.status,'verified');assert.equal(s.pouc.proofDigest,report.poucDigest);
          assert.equal(s.pouc.receipt.productionRepairVerified,false);assert.equal(s.pouc.receipt.distributedTrust,false);
          const jobs=app.projectDesk.jobs({sessionId:s.id}).jobs;assert.equal(jobs.length,1);assert.equal(jobs[0].mode,'injected_worker_test');assert.equal(jobs[0].modelProcessStarted,false);
          const world=app.civilization.state(),rumor=world.square.find(r=>r.id===report.rumorId);
          assert.ok(rumor);assert.equal(rumor.schemaVersion,'metron-rumor-v2');assert.equal(rumor.originVillage,config.villageId);assert.equal(rumor.sha256,report.rumorSha256);
          assert.equal(rumor.repairEvidence.productionApplied,false);assert.equal(rumor.repairEvidence.candidateCommit,report.candidateCommit);
          assert.equal(world.villages['village-2'].knowledge.filter(k=>k.parentRumorId===rumor.id).length,1);
          assert.ok(world.villages['village-2'].knowledge.find(k=>k.parentRumorId===rumor.id).text.includes(report.poucDigest));
          assert.equal(world.villages['village-1'].knowledge.some(k=>k.parentRumorId===rumor.id),false,'Quarantined repair was adopted');
          assert.equal(app.villageBootstrap.children.size,0);assert.equal(app.villageBootstrap.state({newVillageId:config.villageId}).bundle.status,'stopped');
          beforeRestore=evidenceFiles(plan.evidenceRoot);
        }else{
          assert.equal(posts.length,0,'Fresh parent/browser readback replayed a mutation');assert.equal(worker.calls.length,1);assert.equal(app.villageBootstrap.children.size,0);
          assert.deepEqual(evidenceFiles(plan.evidenceRoot),beforeRestore,'Readback changed registered check evidence');
        }
        assert.equal(git(plan.applyRoot,['rev-parse','HEAD']),plan.baseCommit,'Exact rollback HEAD');
        assert.equal(git(plan.applyRoot,['status','--porcelain']),'','Rollback leaves clean owned fixture');
        assert.equal(readFileSync(join(plan.applyRoot,'src/name.mjs'),'utf8'),baselineBytes,'Exact original faulty fixture bytes restored, not a healthy repair claim');
        phases.push({phase,report,productPostCount:posts.length});await proxy.close();proxy=null;
        if(phase==='exercise'){await app.close();app=null;app=await createMiniServer(options);assert.equal(app.villageBootstrap.children.size,0);}
      }
      writeFileSync(join(evidence,'browser-evidence.json'),JSON.stringify({label:'REAL_OWNED_CHROMIUM_DYNAMIC_VILLAGE_WITH_INJECTED_WORKER_NOT_REAL_AI',
        testSourceSha256:sha(readFileSync(new URL(import.meta.url))),browser:chromium(),fixtureRoot:root,registeredProject:{id:plan.id,applyRoot:plan.applyRoot,baseCommit:plan.baseCommit},modelCalls:0,workerCalls:worker.calls,phases,
        boundaries:{isolatedFreshProfiles:true,canonicalProductAssets:true,productionDomMutationsOnly:true,proxyOwnerInjection:false,
          realRuntimeChild:true,realNativeGitAndFixedChecks:true,realAi:false,liveChatGpt:false,arcExtension:false,remoteTransport:false},
        limitation:'Declared deterministic fixture only; this test does not establish real model repair or production applicability.'},null,2));
      t.diagnostic('Saved actual dynamic village browser evidence: '+evidence);
    }finally{
      if(proxy)await proxy.close();if(app)await app.close();
      if(!process.env.METRON_VILLAGE_BROWSER_EVIDENCE_DIR){safeRemove(tempParent,root);safeRemove(evidenceParent,evidence);}
    }
  });
