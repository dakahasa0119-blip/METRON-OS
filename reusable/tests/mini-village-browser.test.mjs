// Actual isolated Chromium + product DOM handlers + loopback HTTP/native Git.
// Host preparation supplies only harmless source work/knowledge and a local Git
// slot. Creation, launch, send, stop and setup are exclusively production clicks.
// No user browser, CUA, AI/provider/CLI worker, remote transport or installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,lstatSync,existsSync,rmSync} from 'node:fs';
import {join,dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createMiniServer} from '../../mini/server.mjs';

const execute=promisify(execFile),OPERATOR='b'.repeat(64),CANARY='SYNTHETIC_AUTHORITY_NEVER_COPY';
const sha=value=>createHash('sha256').update(value).digest('hex');
const TEST_SHA=sha(readFileSync(new URL(import.meta.url)));
const ASSETS=new Set(['/experience','/experience.js','/experience.css','/project-ui.js','/village-ui.js','/setup-ui.js','/style.css']);
function chromium(){return [process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser',
  process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,'Google','Chrome','Application','chrome.exe'),
  process.env['PROGRAMFILES(X86)']&&join(process.env['PROGRAMFILES(X86)'],'Microsoft','Edge','Application','msedge.exe')].filter(Boolean).find(existsSync)||null;}
function put(root,path,text){const file=join(root,...path.split('/'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);}
function git(root,args){return execFileSync('git',['--no-pager','-c','core.longpaths=true','-c','core.autocrlf=false','-c','core.fsmonitor=false',
  '-c','core.hooksPath='+join(root,'disabled-fixture-hooks'),'-c','commit.gpgsign=false','-c','user.name=Village Browser Fixture',
  '-c','user.email=fixture@local.invalid',...args],{cwd:root,shell:false,windowsHide:true,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']}).trim();}
function setupFixture(root){
  const repositoryRoot=join(root,'repository'),acceptanceRoot=join(root,'sealed'),allocationRoot=join(root,'allocation'),template=join(root,'empty-template');
  for(const path of [repositoryRoot,acceptanceRoot,template])mkdirSync(path);
  put(repositoryRoot,'src/value.mjs','export const value = 1;\n');
  // Any accidental test execution fails: this phase prepares Git, not repairs.
  for(const path of ['tests/public.test.mjs','tests/smoke.test.mjs'])put(repositoryRoot,path,"throw new Error('SETUP_MUST_NOT_RUN_TESTS');\n");
  put(acceptanceRoot,'owner.test.mjs',"throw new Error('SETUP_MUST_NOT_RUN_SEALED_TESTS');\n");
  git(repositoryRoot,['init','--template='+template]);git(repositoryRoot,['add','.']);git(repositoryRoot,['commit','-m','First-party village browser setup fixture']);
  const baseCommit=git(repositoryRoot,['rev-parse','HEAD']);
  return {id:'village-browser-slot',label:'Prepared local browser fixture',repositoryRoot,acceptanceRoot,allocationRoot,baseCommit,
    allowedEdits:[{path:'src/value.mjs',operations:['edit']}],publicTests:['tests/public.test.mjs'],postApplyTests:['tests/smoke.test.mjs'],acceptanceTests:['owner.test.mjs']};
}
function sourceFixture(app){
  const selected='Selected harmless adopted knowledge for the new village.',unselected='Unselected harmless knowledge must stay in the source village.';
  const rumors=[selected,unselected].map(text=>app.civilization.publish({from:'village-2',text}).rumor);
  for(const rumor of rumors){app.civilization.receive({villageId:'village-1',rumorId:rumor.id});app.civilization.review({villageId:'village-1',rumorId:rumor.id,decision:'adopt'});}
  const sourceBody='Harmless preseeded observation for explicit village inheritance.';
  const source=app.runtime.submit({from:'A',to:'B',message:sourceBody,code:''});
  const work=app.work.create({villageId:'village-1',sourceMessageId:source.messageId,goal:'Keep this source goal as reference data only.',knowledgeIds:[]}).work;
  // Synthetic authority-shaped canaries are host fixture data, not credentials.
  // The work validator permits audit metadata; the bootstrap must copy text only.
  const file=join(app.runtime.root,'work-ledger',work.id+'.json'),saved=JSON.parse(readFileSync(file,'utf8'));
  Object.assign(saved,{dispatchToken:CANARY,allowExternalCalls:true,env:{OPENAI_API_KEY:CANARY},application:{allowApply:true}});writeFileSync(file,JSON.stringify(saved));
  return {workId:work.id,sourceGoal:work.goal,sourceBody,selected,unselected,selectedKnowledgeId:'knowledge_'+rumors[0].id,unselectedKnowledgeId:'knowledge_'+rumors[1].id};
}
function sourceManifest(root){
  const files=[];function visit(dir,prefix=''){for(const name of readdirSync(dir).sort()){
    if(!prefix&&['village-bootstrap','project-setup'].includes(name))continue;
    const file=join(dir,name),path=prefix+name,stat=lstatSync(file);assert.equal(stat.isSymbolicLink(),false);
    if(stat.isDirectory())visit(file,path+'/');else if(stat.isFile())files.push({path,sha256:sha(readFileSync(file))});
  }}visit(root);return files;
}

async function browserDriver(config){
  const $=id=>document.getElementById(id),text=id=>$(id)?.textContent||'',snapshots=[];
  const check=(value,message)=>{if(!value)throw Error(message);};
  const change=(id,value,event='input')=>{$(id).value=value;$(id).dispatchEvent(new Event(event,{bubbles:true}));};
  const read=id=>{try{return JSON.parse(text(id));}catch{return null;}};
  const state=()=>read('village-state-audit');
  const status=()=>state()?.bundle?.status;
  async function metrics(){const r=await fetch('/__village-browser/metrics',{cache:'no-store'});check(r.ok,'metrics unavailable');return r.json();}
  async function waitFor(predicate,label){const deadline=Date.now()+35000;while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,40));}
    throw Error('Timed out: '+label+'; village='+text('village-notice')+'; setup='+text('setup-notice'));}
  const snapshot=phase=>snapshots.push({phase,village:state(),setup:read('setup-audit'),notice:text('village-notice')});
  async function connect(){
    await waitFor(()=>$('project-load-catalog')&&!$('project-load-catalog').disabled,'owner connect control');
    check(!$('project-operator-key').value,'owner capability persisted across browser process');
    change('project-operator-key',config.operator);$('project-load-catalog').click();
    await waitFor(()=>$('village-reload')&&!$('village-reload').disabled&&[...$('setup-slot').options].some(o=>o.value===config.slotId),'village/setup catalogs');
  }
  async function act(name,predicate,label){
    check(!$('village-action-reviewed').checked,'prior action approval was reused');
    $('village-action-reviewed').click();await waitFor(()=>!$('village-'+name).disabled,'explicit '+name+' control');
    $('village-'+name).click();await waitFor(predicate,label);check(!$('village-action-reviewed').checked,'action did not consume review');snapshot(label);
  }
  async function finish(ok,error){
    const marker=document.createElement('pre');marker.id='village-browser-verification';marker.dataset.result=ok?'pass':'fail';marker.textContent=JSON.stringify({ok,error,phase:config.phase});document.body.append(marker);
    await fetch('/__village-browser/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ok,error,phase:config.phase,snapshots,finalVillage:state(),finalSetup:read('setup-audit')})});
  }
  try{
    await connect();
    if(config.scenario==='setup'){
      if(config.phase==='exercise'){
        change('setup-slot',config.slotId,'change');
        check($('setup-prepare').disabled&&!$('setup-reviewed').checked,'setup lacked independent explicit review');
        $('setup-reviewed').click();await waitFor(()=>!$('setup-prepare').disabled,'setup prepare control');$('setup-prepare').click();
      }
      await waitFor(()=>read('setup-audit')?.slot?.status==='ready','native Git slot preparation or restored ready state');
      await waitFor(()=>[...$('project-plan').options].some(o=>o.value===config.slotId),'prepared project appears in real catalog');
      check(!$('setup-reviewed').checked,'setup approval persisted');
      const m=await metrics();check(m.childCount===0&&m.readyPlans===1,'setup launched child or did not register plan');
      snapshot(config.phase==='exercise'?'setup-ready':'setup-parent-restart-get-only');await finish(true);return;
    }
    if(config.phase==='restored'){
      check((await metrics()).childCount===0,'parent startup/GET launched a child');
      change('village-saved',config.villageId,'change');await waitFor(()=>status()==='stopped','saved bundle after parent restart');
      const s=state();check(s.runtime.transport.ships.B.messages.some(m=>m.body===config.message),'persisted B message absent');
      check(s.runtime.transport.ships.B.count===2&&s.runtime.transport.ships.A.count===2,'restored seed plus explicit A/B counts changed');
      check(s.runtime.modelCalls===0,'model call reported in child');
      const m=await metrics();check(m.childCount===0&&m.readyPlans===0,'GET/reconnect changed runtime readiness');snapshot('parent-restart-get-only');await finish(true);return;
    }
    change('village-source-work',config.workId,'change');
    await waitFor(()=>text('village-source-summary').includes(config.sourceGoal)&&!$('village-source-work').disabled,'source work read');
    change('village-new-id',config.villageId);change('village-directory',config.directory);change('village-purpose',config.purpose);
    $('village-inherit-goal').click();$('village-inherit-source').click();
    const label=[...document.querySelectorAll('#village-knowledge label')].find(l=>l.textContent.includes(config.selected));
    check(label,'selected inherited knowledge missing');label.querySelector('input').click();
    check([...document.querySelectorAll('#village-knowledge input')].filter(i=>i.checked).length===1,'unexpected knowledge selection');
    await waitFor(()=>!$('village-preview').disabled,'preview control');$('village-preview').click();
    await waitFor(()=>read('village-preview-audit')?.selection?.newVillageId===config.villageId,'selection preview');
    const preview=read('village-preview-audit');
    check(preview.seed.inheritedGoal.text===config.sourceGoal&&preview.seed.sourceMessage.text===config.sourceBody,'selected source text mismatch');
    check(preview.seed.knowledge.length===1&&preview.seed.knowledge[0].id===config.selectedKnowledgeId,'selected knowledge provenance mismatch');
    check(!JSON.stringify(preview).includes(config.unselected)&&!JSON.stringify(preview).includes(config.canary),'unselected knowledge or authority copied');
    check($('village-create').disabled&&!$('village-preview-reviewed').checked,'preview bypassed explicit create review');
    $('village-preview-reviewed').click();await waitFor(()=>!$('village-create').disabled,'explicit create control');$('village-create').click();
    await waitFor(()=>status()==='prepared','new bundle prepared without launch');
    check((await metrics()).childCount===0,'create launched a child');check(!state().runtime,'create initialized A/B before launch');snapshot('created-not-launched');
    await act('launch',()=>status()==='running','first-child-running');
    const first=state();check(first.runtime.pid&&first.runtime.pid!==config.parentPid,'no independent child PID');
    check(first.runtime.transport.ships.B.count===1&&first.runtime.transport.ships.B.messages[0].body===config.sourceBody,'selected source observation was not materialized exactly once');
    change('village-message',config.message);await act('send',()=>state()?.runtime?.transport?.ships?.B?.messages?.some(m=>m.body===config.message),'child-A-to-B-delivered');
    const delivered=state();check(delivered.runtime.transport.ships.B.count===2&&delivered.runtime.transport.ships.A.count===2,'seed plus explicit A/B delivery or acknowledgment duplicated');
    check(delivered.runtime.modelCalls===0,'local delivery called a model');
    await act('stop',()=>status()==='stopped','first-child-closed');check(state().bundle.launch.terminationConfirmed===true,'first child close unconfirmed');
    await act('launch',()=>status()==='running','same-bundle-relaunched');
    const second=state();check(second.runtime.pid!==first.runtime.pid,'relaunch reused the same child');
    check(second.bundle.seedDigest===first.bundle.seedDigest,'relaunch changed inheritance');
    check(second.runtime.transport.ships.B.count===2&&second.runtime.transport.ships.B.messages.some(m=>m.body===config.message),'relaunch failed durable message readback or duplicated seed');
    await act('stop',()=>status()==='stopped','second-child-closed');check(state().bundle.launch.terminationConfirmed===true,'second child close unconfirmed');
    const m=await metrics();check(m.childCount===0&&m.readyPlans===0,'village operations prepared a project or retained child');
    check(!JSON.stringify([sessionStorage,localStorage]).includes(config.operator),'owner key stored in browser storage');
    await finish(true);
  }catch(error){await finish(false,error.stack||String(error));}
}

async function bodyBytes(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>512000)throw Error('Test receipt limit');chunks.push(chunk);}return Buffer.concat(chunks);}
async function harness(app,config){
  const requests=[],assets=[],barriers=new Set(),origin=new URL(app.url);let report=null;
  const proxy=createServer(async(req,res)=>{
    try{
      const local='http://127.0.0.1:'+proxy.address().port;
      if(req.headers.host!==new URL(local).host||(req.headers.origin&&req.headers.origin!==local)){res.writeHead(403);res.end('Loopback origin required');return;}
      const path=new URL(req.url,local).pathname;
      if(path==='/__village-browser/driver.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end('('+browserDriver.toString()+')('+JSON.stringify(config)+');');return;}
      if(path==='/__village-browser/barrier.svg'){
        const finish=()=>{res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');};
        if(report)finish();else{barriers.add(finish);res.once('close',()=>barriers.delete(finish));}return;
      }
      if(path==='/__village-browser/metrics'){
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({childCount:app.villageBootstrap?.children.size??0,readyPlans:app.work.projectSessions.plans.size}));return;
      }
      const body=req.method==='POST'?await bodyBytes(req):Buffer.alloc(0);
      if(path==='/__village-browser/complete'){
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
          const sent=html?Buffer.from(original.toString('utf8').replace('</body>','<img hidden alt="" src="/__village-browser/barrier.svg"><script type="module" src="/__village-browser/driver.js"></script></body>')):original;
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

async function runScenario(scenario,t){
  const evidenceParent=process.env.METRON_VILLAGE_BROWSER_EVIDENCE_DIR||tmpdir(),tempParent=process.env.TEMP||tmpdir();
  mkdirSync(evidenceParent,{recursive:true});mkdirSync(tempParent,{recursive:true});
  const root=mkdtempSync(join(tempParent,'mvb-')),evidence=mkdtempSync(join(evidenceParent,'actual-browser-'));
  let app,proxy;const stageResults=[];
  try{
    const slot=setupFixture(root),data=join(root,'parent-data'),baseRoot=join(root,'children');
    const options={root:data,port:0,projectOperatorToken:OPERATOR,projectSetupSlots:[slot],villageBootstrapOptions:scenario==='village'?{baseRoot,maxRunMs:120000}:null,workOptions:{runnerOptions:{env:{}}}};
    app=await createMiniServer(options);const source=scenario==='village'?sourceFixture(app):{},before=sourceManifest(data);
    const config={scenario,operator:OPERATOR,slotId:slot.id,parentPid:process.pid,villageId:'browser-new-village',directory:'browser-new-home',
      purpose:'An independently saved synthetic local village.',message:'A real local A-to-B message in the new village.',canary:CANARY,...source};
    for(const phase of ['exercise','restored']){
      const phaseDir=join(evidence,phase);mkdirSync(phaseDir);proxy=await harness(app,{...config,phase});
      const args=['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--disable-extensions',
        '--user-data-dir='+join(root,'browser-'+phase),'--window-size=1440,1100','--screenshot='+join(phaseDir,'page.png'),'--dump-dom',proxy.url+'/experience'];
      if(process.getuid?.()===0)args.unshift('--no-sandbox');
      let stdout='',stderr='';
      const browserEnv=Object.fromEntries(['PATH','SystemRoot','WINDIR','COMSPEC','LOCALAPPDATA','ProgramFiles','ProgramFiles(x86)'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));
      try{({stdout,stderr}=await execute(chromium(),args,{timeout:105000,maxBuffer:12*1024*1024,windowsHide:true,env:{...browserEnv,TEMP:tempParent,TMP:tempParent}}));}
      catch(error){stdout=error.stdout||'';stderr=error.stderr||'';throw error;}
      finally{
        writeFileSync(join(phaseDir,'dom.html'),stdout);writeFileSync(join(phaseDir,'browser-stderr.log'),stderr);
        writeFileSync(join(phaseDir,'requests.json'),JSON.stringify(proxy.requests,null,2));writeFileSync(join(phaseDir,'served-assets.json'),JSON.stringify(proxy.assets,null,2));
        writeFileSync(join(phaseDir,'receipt.json'),JSON.stringify(proxy.report(),null,2));
      }
      const report=proxy.report();assert.ok(report,'Browser completion receipt missing: '+stderr.slice(-1000));assert.equal(report.ok,true,report.error);
      assert.match(stdout,/<pre id="village-browser-verification" data-result="pass">/);
      for(const path of ASSETS)assert.ok(proxy.assets.some(a=>a.path===path&&a.status===200),'Missing real served asset '+path);
      for(const a of proxy.assets.filter(a=>!a.htmlDriverInjected))assert.equal(a.productionSha256,a.browserSha256,'Product asset changed in proxy');
      const mutations=proxy.requests.filter(r=>r.method==='POST');
      assert.ok(mutations.every(r=>r.operatorHeaderPresent),'DOM omitted owner capability');
      if(phase==='exercise'){
        const actions=mutations.filter(r=>r.path==='/api/village/action').map(r=>r.body.action);
        assert.deepEqual(actions,scenario==='village'?['create','launch','send-local','stop','launch','stop']:[]);
        assert.equal(mutations.filter(r=>r.path==='/api/village/preview').length,scenario==='village'?1:0);
        assert.equal(mutations.filter(r=>r.path==='/api/project/setup/prepare').length,scenario==='setup'?1:0);
      }else assert.equal(mutations.length,0,'Parent restart/browser GET must not create, launch, send or prepare');
      const state=scenario==='village'?app.villageBootstrap.state({newVillageId:config.villageId}):null;
      if(state){assert.equal(state.bundle.status,'stopped');assert.equal(app.villageBootstrap.children.size,0);assert.ok(state.runtime.transport.ships.B.messages.some(m=>m.body===config.message));assert.equal(state.runtime.modelCalls,0);}
      stageResults.push({phase,report,mutations:mutations.length,bundle:state?.bundle??null,runtime:state?.runtime??null});
      await proxy.close();proxy=null;
      if(phase==='exercise'){await app.close();app=null;app=await createMiniServer(options);assert.equal(app.villageBootstrap?.children.size??0,0);}
    }
    const after=sourceManifest(data);assert.deepEqual(after,before,'Existing source village/work/knowledge files changed');
    let seed=null,project=null;
    if(scenario==='village'){
      const state=app.villageBootstrap.state({newVillageId:config.villageId});seed=JSON.parse(readFileSync(join(state.bundle.destination,'seed.json'),'utf8'));
      assert.equal(seed.inheritedGoal.text,source.sourceGoal);assert.equal(seed.sourceMessage.text,source.sourceBody);
      assert.deepEqual(seed.knowledge.map(k=>k.id),[source.selectedKnowledgeId]);
      const serialized=JSON.stringify(seed);for(const forbidden of [source.unselectedKnowledgeId,source.unselected,CANARY,OPERATOR,'allowExternalCalls','allowApply','dispatchToken','OPENAI_API_KEY'])assert.equal(serialized.includes(forbidden),false,forbidden);
      assert.equal(app.work.projectSessions.plans.size,0);assert.equal(git(slot.repositoryRoot,['worktree','list','--porcelain']).split('\n').filter(l=>l.startsWith('worktree ')).length,1);
    }else{
      assert.equal(app.projectSetup.state({slotId:slot.id}).job.status,'ready');assert.equal(app.work.projectSessions.plans.size,1);
      const plan=app.work.projectSessions.plans.get(slot.id);for(const name of ['baselineRoot','candidateRoot','applyRoot']){
        assert.equal(git(plan[name],['rev-parse','HEAD']),slot.baseCommit);assert.equal(git(plan[name],['branch','--show-current']),'');assert.equal(git(plan[name],['status','--porcelain']),'');
      }
      assert.equal(git(slot.repositoryRoot,['worktree','list','--porcelain']).split('\n').filter(l=>l.startsWith('worktree ')).length,4);
      project={id:slot.id,baseCommit:slot.baseCommit,planDigest:plan.planDigest,threeDetachedWorktrees:true};
    }
    writeFileSync(join(evidence,'browser-evidence.json'),JSON.stringify({label:'REAL_ISOLATED_CHROMIUM_'+scenario.toUpperCase()+'_NO_AI',modelCalls:0,testSourceSha256:TEST_SHA,
      sourceBefore:before,sourceAfter:after,sourceFilesUnchanged:true,seed,stageResults,project,
      boundaries:{hostFixturePreseedOnly:true,mutationsThroughProductionDomOnly:true,proxyOperatorInjection:false,normalUserBrowser:false,remoteTransport:false}},null,2));
    t.diagnostic('Saved actual browser evidence: '+evidence);
  }finally{
    if(proxy)await proxy.close();if(app)await app.close();
    if(!process.env.METRON_VILLAGE_BROWSER_EVIDENCE_DIR){for(const path of [root,evidence]){
      const parent=path===root?tempParent:evidenceParent,rel=relative(resolve(parent),resolve(path));assert.ok(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));rmSync(path,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }}
  }
}

test('real Chromium setup-only DOM prepares three Git worktrees and GET restores its catalog without work',
  {skip:!chromium(),timeout:240000},t=>runScenario('setup',t));
// Deliberate opt-in keeps the child-launch lane paused until the owner clears it.
test('real Chromium village DOM creates, launches, delivers A/B and restores the same bundle',
  {skip:!chromium()||process.env.METRON_RUN_VILLAGE_BROWSER!=='1',timeout:240000},t=>runScenario('village',t));
