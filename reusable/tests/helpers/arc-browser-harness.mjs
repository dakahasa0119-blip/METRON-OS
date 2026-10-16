// Synthetic provider DOM + actual isolated Chromium + unchanged ARC scripts.
// The runtime/permission API is a fixture, not an installed extension. This does
// not verify permission UX, isolated worlds, a user profile or live ChatGPT.
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';

const execute=promisify(execFile);
const ASSETS=new URL('../../../mini/arc-browser/',import.meta.url);
const EXTENSION_ORIGIN='chrome-extension://'+'a'.repeat(32);
const SENDER={tab:{id:1},frameId:0,url:'https://chatgpt.com/c/arc-synthetic'};
const sha=text=>createHash('sha256').update(text).digest('hex');
const jsonHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const ownedHarnesses=new Map();
const trustedIds=new Set(['provider-input','provider-send','provider-seed','provider-answer','provider-stop',
  ...['prompt','send','capture','forward','retry','status','new-record','resume','reselect','stop',
    'completion-reviewed'].map(id=>'metron-arc-'+id)]);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Only the new profile's own DevTools endpoint and exact synthetic page target
// are used. There is no arbitrary JavaScript/CDP command HTTP route.
async function ownedChromeInput({profile,url,finished,simulateDomRaceOnce=false,simulateSlowDomOnce=false,onDiagnostic=()=>{}}){
  const preparationMethods=new Set(['DOM.getDocument','DOM.querySelector','DOM.scrollIntoViewIfNeeded',
    'DOM.getContentQuads','Page.getLayoutMetrics']);
  const cleanDetail=value=>String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim()
    .replace(/(?:https?|wss?):\/\/[^ ]+/gi,'[redacted-url]')
    .replace(/\b[a-f0-9]{48}\b/gi,'[redacted-session-token]').slice(0,200);
  function protocolError(method,code,detail,source='observed'){
    const protocol={method,code:Number.isInteger(code)?code:null,detail:cleanDetail(detail),source};
    onDiagnostic({kind:'protocol-error',protocol,preparation:preparationMethods.has(method)});
    return Object.assign(Error('synthetic_native_cdp_'+String(code).replace(/[^0-9-]/g,'')),{protocol});
  }
  function retryablePreparation(error){
    if(['synthetic_native_element_missing','synthetic_native_element_outside_viewport'].includes(error.message))return true;
    const p=error.protocol;
    return p?.code===-32000&&preparationMethods.has(p.method)&&
      /^(?:Could not find node with given id|No node with given id found|Node does not have a layout object|Could not compute content quads|Node is detached from document)\.?$/i.test(p.detail);
  }
  let injectedDomRace=false,injectedSlowDom=false;
  const deadline=Date.now()+15000;let endpoint;
  while(Date.now()<deadline){
    if(finished())throw Error('synthetic_native_chrome_already_closed');
    const file=join(profile,'DevToolsActivePort');
    let content;
    try{content=readFileSync(file,'utf8');}
    catch(error){
      if(!['EBUSY','ENOENT'].includes(error.code))throw error;
      await delay(35);continue;
    }
    const lines=content.trim().split(/\r?\n/);
    if(lines.length<2){await delay(35);continue;}
    const [port,path]=lines;
    if(lines.length!==2||!/^\d{1,5}$/.test(port)||Number(port)<1||Number(port)>65535||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(path))
      throw Error('synthetic_native_invalid_owned_endpoint');
    endpoint='ws://127.0.0.1:'+port+path;break;
  }
  if(!endpoint)throw Error('synthetic_native_owned_endpoint_timeout');
  const socket=new WebSocket(endpoint),pending=new Map();let sequence=0,stopped=false;
  const rejectPending=()=>{for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(Error('synthetic_native_socket_closed'));}pending.clear();};
  socket.addEventListener('message',event=>{
    let message;try{message=JSON.parse(event.data);}catch{return;}
    const task=pending.get(message.id);if(!task)return;
    pending.delete(message.id);clearTimeout(task.timer);
    if(message.error)task.reject(protocolError(task.method,message.error.code,message.error.message));
    else task.resolve(message.result);
  });
  socket.addEventListener('close',rejectPending);
  socket.addEventListener('error',rejectPending);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.close();reject(Error('synthetic_native_socket_timeout'));},5000);
    socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
    socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('synthetic_native_socket_failed'));},{once:true});
  });
  function command(method,params={},sessionId,preparationDeadline=null){
    if(stopped||socket.readyState!==WebSocket.OPEN)return Promise.reject(Error('synthetic_native_socket_closed'));
    // Every preparation command shares the same ten-second budget. A late
    // read-only response is ignored; a command timeout never retries input.
    const remaining=preparationDeadline===null?5000:preparationDeadline-Date.now();
    const timeoutError=()=>{
      onDiagnostic({kind:'command-timeout',method,source:'observed'});
      const category=preparationDeadline===null?'synthetic_native_command_timeout':'synthetic_native_dom_preparation_timeout';
      return Error(category+'_'+method.toLowerCase().replace(/[^a-z0-9_]/g,'_'));
    };
    if(remaining<=0)return Promise.reject(timeoutError());
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        pending.delete(id);
        reject(timeoutError());
      },Math.min(5000,remaining));
      pending.set(id,{resolve,reject,timer,method});
      socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  const close=()=>{stopped=true;rejectPending();socket.close();};
  try{
    let target;
    while(Date.now()<deadline){
      const {targetInfos}=await command('Target.getTargets');
      const matches=targetInfos.filter(info=>info.type==='page'&&info.url===url);
      if(matches.length>1)throw Error('synthetic_native_ambiguous_owned_target');
      if(matches.length===1){target=matches[0];break;}
      if(finished())throw Error('synthetic_native_chrome_already_closed');
      await delay(35);
    }
    if(!target)throw Error('synthetic_native_fixture_target_timeout');
    const {sessionId}=await command('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    let queue=Promise.resolve();
    async function assertFixture(preparationDeadline=null){
      const {targetInfo}=await command('Target.getTargetInfo',{targetId:target.targetId},undefined,preparationDeadline);
      if(targetInfo.type!=='page'||targetInfo.url!==url)throw Error('synthetic_native_target_left_fixture');
    }
    async function preparePoint(id,preparationDeadline){
      await assertFixture(preparationDeadline);
      const read=(method,params={})=>command(method,params,sessionId,preparationDeadline);
      const {root}=await read('DOM.getDocument',{depth:0,pierce:false});
      const {nodeId}=await read('DOM.querySelector',{nodeId:root.nodeId,selector:'#'+id});
      if(!nodeId)throw Error('synthetic_native_element_missing');
      // Exercise a cold renderer taking longer than the former two-second
      // budget. This test-only delay is before every Input command and is
      // consumed by the same bounded deadline, including the stale-DOM retry.
      if(simulateSlowDomOnce&&!injectedSlowDom){
        injectedSlowDom=true;onDiagnostic({kind:'dom-delay',milliseconds:2500});
        await delay(2500);
      }
      // Test-only fault, after a real target/document/query and before ANY
      // Input command. No page/HTTP option can enable it or choose a command.
      if(simulateDomRaceOnce&&!injectedDomRace){
        injectedDomRace=true;
        throw protocolError('DOM.scrollIntoViewIfNeeded',-32000,'Could not find node with given id','injected');
      }
      await read('DOM.scrollIntoViewIfNeeded',{nodeId});
      const {quads}=await read('DOM.getContentQuads',{nodeId});
      const layout=await read('Page.getLayoutMetrics');
      const viewport=layout.cssVisualViewport||layout.visualViewport;
      let point;
      for(const quad of quads){
        const left=Math.max(0,Math.min(quad[0],quad[2],quad[4],quad[6]));
        const right=Math.min(viewport.clientWidth,Math.max(quad[0],quad[2],quad[4],quad[6]));
        const top=Math.max(0,Math.min(quad[1],quad[3],quad[5],quad[7]));
        const bottom=Math.min(viewport.clientHeight,Math.max(quad[1],quad[3],quad[5],quad[7]));
        if(right>left&&bottom>top){point={x:(left+right)/2,y:(top+bottom)/2};break;}
      }
      if(!point)throw Error('synthetic_native_element_outside_viewport');
      if(Date.now()>=preparationDeadline)throw Error('synthetic_native_dom_preparation_timeout');
      return point;
    }
    async function click(id){
      if(!trustedIds.has(id))throw Error('synthetic_native_id_not_allowed');
      const preparationDeadline=Date.now()+10000;let point;
      for(let attempt=0;attempt<8;attempt++){
        try{point=await preparePoint(id,preparationDeadline);break;}
        catch(error){
          if(attempt===7||!retryablePreparation(error)||Date.now()>=preparationDeadline)throw error;
          await delay(Math.min(50,preparationDeadline-Date.now()));
          if(Date.now()>=preparationDeadline)throw error;
          onDiagnostic({kind:'dom-retry'});
        }
      }
      // Never replay Input, including mouseMoved. Once a press is attempted,
      // failure of either press/release leaves an explicit uncertain outcome.
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point},sessionId);
      onDiagnostic({kind:'press-attempt'});let inputCompleted=false;
      try{
        await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point},sessionId);
        await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point},sessionId);
        inputCompleted=true;
      }finally{if(!inputCompleted)onDiagnostic({kind:'uncertain-input'});}
      return {clicked:true};
    }
    return {click:id=>{
      const result=queue.then(()=>click(id));queue=result.catch(()=>{});return result;
    },snapshot:async()=>{
      await queue;await assertFixture();
      const {root}=await command('DOM.getDocument',{depth:0,pierce:false},sessionId);
      const {outerHTML}=await command('DOM.getOuterHTML',{nodeId:root.nodeId},sessionId);
      return outerHTML;
    },shutdown:async()=>{
      await queue;
      // Browser.close addresses only the browser WebSocket read from this
      // newly created profile. A socket closing before its reply is expected;
      // the native child exit is checked separately by runArcChromium.
      try{await command('Browser.close');}
      catch(error){if(error.message!=='synthetic_native_socket_closed')throw error;}
    },close};
  }catch(error){close();throw error;}
}

export function availableChromium(){
  return [process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
    '/usr/bin/chromium','/usr/bin/chromium-browser',
    process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,'Google','Chrome','Application','chrome.exe'),
    process.env['PROGRAMFILES(X86)']&&join(process.env['PROGRAMFILES(X86)'],'Microsoft','Edge','Application','msedge.exe')
  ].filter(Boolean).find(existsSync)||null;
}

function loopbackURL(value){
  const url=new URL(value);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.hash)
    throw Error('Harness requires an exact HTTP 127.0.0.1 origin');
  return url;
}
async function bodyOf(req){
  const chunks=[];let bytes=0;
  for await(const chunk of req){
    bytes+=chunk.length;if(bytes>2*1024*1024)throw Error('Harness body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function safeId(value){return typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,200}$/.test(value)?value:undefined;}
function safeSha(value){return typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value)?value:undefined;}
function resultSummary(value,status){
  const result={httpStatus:status};
  for(const key of ['accepted','submitted','uncertain','found','duplicate','deduplicated','conflict'])
    if(typeof value?.[key]==='boolean')result[key]=value[key];
  for(const key of ['jobState','ackState','deliveryState','state','status','error'])
    if(typeof value?.[key]==='string'&&/^[a-zA-Z0-9_:-]{1,100}$/.test(value[key]))result[key]=value[key];
  if(safeId(value?.messageId))result.messageId=value.messageId;
  for(const key of ['sha256','receiptHash'])if(safeSha(value?.[key]))result[key]=value[key];
  return result;
}
function callSummary(body){
  const call={action:safeId(body.action)||'unknown'};
  if(safeId(body.messageId))call.messageId=body.messageId;
  if(safeSha(body.sha256))call.sha256=body.sha256;
  if(typeof body.text==='string'){
    call.bytes=Buffer.byteLength(body.text,'utf8');
    call.sha256??=sha(body.text);
  }else if(Number.isSafeInteger(body.totalBytes)&&body.totalBytes>=0)call.bytes=body.totalBytes;
  // An intent may contain reply text in future protocols; retain only identity.
  if(body.intent&&typeof body.intent==='object'){
    const intent={};
    if(safeId(body.intent.messageId))intent.messageId=body.intent.messageId;
    if(safeSha(body.intent.sha256))intent.sha256=body.intent.sha256;
    if(Object.keys(intent).length)call.intent=intent;
  }
  return call;
}

function reportSummary(report){
  if(!report||typeof report!=='object')return null;
  const result={};
  for(const key of ['ok','explicitRecovery','stopped','productBrowserStorageUsed'])
    if(typeof report[key]==='boolean')result[key]=report[key];
  for(const key of ['firstId','secondId'])if(safeId(report[key]))result[key]=report[key];
  if(Number.isSafeInteger(report.providerCallsAfterReload))result.providerCallsAfterReload=report.providerCallsAfterReload;
  if(typeof report.error==='string')result.error=report.error.split('\n')[0].slice(0,500)
    .replace(/\b[a-f0-9]{48}\b/gi,'[redacted-session-token]');
  return result;
}

export async function createArcBrowserHarness({app,html,driver,config={},dropDeliverAckOnce=false}){
  const appOrigin=loopbackURL(app?.url);
  if(appOrigin.pathname!=='/'||appOrigin.search)throw Error('Harness requires the Mini server origin');
  if(typeof html!=='string'||typeof driver!=='function')throw Error('Synthetic HTML and driver are required');
  const sources=Object.fromEntries(['reply-state.js','content.js','background.js'].map(name=>
    [name,readFileSync(new URL(name,ASSETS),'utf8')]));
  const calls=[],barriers=new Set(),controllers=new Set(),generations=new Set(),nativeDiagnostics=[];
  const counts={starts:0,delivers:0,statuses:0,permissionRequests:0,permissionRemoves:0,currentVMgeneration:0,ackLosses:0,nativeClicks:0,
    domRetries:0,injectedDomRaces:0,injectedDomDelays:0,observedDomErrors:0,pressAttempts:0,uncertainInput:false,
    domRaceInjectionEnabled:false,domDelayInjectionEnabled:false};
  let report=null,closed=false,background,resetting=Promise.resolve();
  let evidenceDirectory=null,reportReady;
  const completed=new Promise(resolve=>{reportReady=resolve;});
  let input=null;let inputReady;
  const inputAttached=new Promise(resolve=>{inputReady=resolve;});
  const metrics=()=>({...counts});
  const saveDiagnostics=phase=>{
    if(!evidenceDirectory)return;
    writeFileSync(join(evidenceDirectory,'arc-browser-driver-diagnostics.json'),JSON.stringify({
      label:'SYNTHETIC_OWNED_CHROMIUM_ARC_DIAGNOSTICS',phase,
      report:reportSummary(report),metrics:metrics(),calls,nativeDiagnostics
    },null,2)+'\n');
  };

  function makeBackground(){
    const generation=++counts.currentVMgeneration,listeners=[],pending=new Set(),timers=new Set();
    const timer=(fn,ms,...args)=>{const id=setTimeout(()=>{timers.delete(id);fn(...args);},ms);timers.add(id);return id;};
    const clearTimer=id=>{clearTimeout(id);timers.delete(id);};
    const permissions=async(kind,details)=>{
      if(!Array.isArray(details?.origins)||details.origins.length!==1||details.origins[0]!=='http://127.0.0.1/*'||
        Object.keys(details).some(key=>key!=='origins'))throw Error('synthetic_harness_permission_not_allowed');
      counts[kind==='request'?'permissionRequests':'permissionRemoves']++;
      return true;
    };
    const fetchHandoff=async(input,init={})=>{
      if(closed)throw Error('synthetic_harness_closed');
      const target=new URL(typeof input==='string'?input:input.url);
      if(target.origin!==appOrigin.origin||target.pathname!=='/api/arc/handoff'||target.search||
        target.hash||target.username||target.password||(init.method||'GET').toUpperCase()!=='POST')
        throw Error('synthetic_harness_fetch_outside_arc');
      const body=JSON.parse(init.body),call=callSummary(body);
      calls.push(call);
      const counter={start:'starts',deliver:'delivers',status:'statuses'}[body.action];
      if(counter)counts[counter]++;
      const headers=new Headers(init.headers);headers.set('Origin',EXTENSION_ORIGIN);
      const controller=new AbortController();controllers.add(controller);
      try{
        const response=await fetch(target,{...init,headers,signal:controller.signal,redirect:'error'});
        // Consume the actual server response before simulating a lost ACK. The
        // Mini server has completed its persistence before this boundary.
        const bytes=await response.arrayBuffer();
        let result;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{}
        call.result=resultSummary(result,response.status);
        if(dropDeliverAckOnce&&body.action==='deliver'&&response.ok&&result?.submitted===true&&!counts.ackLosses){
          counts.ackLosses++;call.result.ackLost=true;throw Error('synthetic_ack_lost');
        }
        return new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
      }finally{controllers.delete(controller);}
    };
    const chrome={
      action:{onClicked:{addListener(){}}},
      scripting:{executeScript:async()=>{throw Error('synthetic_harness_unexpected_script_injection');}},
      permissions:{request:details=>permissions('request',details),remove:details=>permissions('remove',details)},
      runtime:{onMessage:{addListener:listener=>listeners.push(listener)}}
    };
    let context;
    context=createContext({chrome,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,
      URL,URLSearchParams,Headers,Request,Response,AbortController,fetch:fetchHandoff,
      btoa,atob,setTimeout:timer,clearTimeout:clearTimer,
      // No product reply, session token or provider text is logged by the VM.
      console:{log(){},warn(){},error(){}},
      importScripts:(...names)=>{
        for(const name of names){
          if(name!=='reply-state.js')throw Error('synthetic_harness_import_not_allowed');
          runInContext(sources[name],context,{filename:'mini/arc-browser/'+name,timeout:2000});
        }
      }});
    runInContext(sources['background.js'],context,{filename:'mini/arc-browser/background.js',timeout:2000});
    const worker={generation,pending,
      async invoke(message){
        let resolveResult,rejectResult;
        const job=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});
        pending.add(job);let done=false;
        const timeout=timer(()=>finish(Error('synthetic_background_response_timeout')),30000);
        function finish(error,value){
          if(done)return;done=true;clearTimer(timeout);
          if(error)rejectResult(error);else resolveResult(value);
        }
        try{
          let handled=false;
          for(const listener of listeners){
            const keep=listener(message,structuredClone(SENDER),value=>finish(null,value));
            if(done||keep===true){handled=true;break;}
          }
          if(!handled)finish(Error('synthetic_background_message_unhandled'));
        }catch(error){finish(error);}
        try{return await job;}finally{pending.delete(job);}
      },
      async idle(){while(pending.size)await Promise.allSettled([...pending]);},
      dispose(){for(const id of timers)clearTimeout(id);timers.clear();}
    };
    generations.add(worker);return worker;
  }
  background=makeBackground();

  const runtimeStub=`(()=>{const runtime={sendMessage(message,callback){
    fetch('/__arc/bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)})
      .then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error||'synthetic_bridge_failed');return value;})
      .then(value=>callback(value),()=>{runtime.lastError={message:'synthetic_bridge_failed'};
        try{callback();}finally{delete runtime.lastError;}});
  }};window.chrome={runtime};window.arcTestTrustedClick=async id=>{
    const response=await fetch('/__arc/trusted-click',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
    const value=await response.json();if(!response.ok)throw Error(value.error||'synthetic_native_click_failed');return value;
  };})();`;
  const injection='<img hidden alt="" src="/__arc/barrier.svg">'+
    ['chrome-runtime.js','reply-state.js','content.js','driver.js'].map(name=>
      '<script src="/__arc/'+name+'"></script>').join('');
  const fixtureHTML=/<\/body>/i.test(html)?html.replace(/<\/body>/i,injection+'</body>'):
    '<!doctype html><html><head><meta charset="utf-8"></head><body>'+html+injection+'</body></html>';
  const scripts={'chrome-runtime.js':runtimeStub,'reply-state.js':sources['reply-state.js'],'content.js':sources['content.js'],
    'driver.js':'('+driver.toString()+')('+JSON.stringify(config)+');'};
  const releaseBarriers=()=>{for(const complete of barriers)complete();barriers.clear();};
  const server=createServer(async(req,res)=>{
    try{
      const origin='http://127.0.0.1:'+server.address().port;
      if(closed||req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)){
        res.writeHead(403);res.end('Harness loopback origin required');return;
      }
      const target=new URL(req.url,origin);
      if(target.origin!==origin||target.search){res.writeHead(404);res.end();return;}
      const path=target.pathname;
      if(path==='/'&&req.method==='GET'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(fixtureHTML);return;
      }
      const script=path.startsWith('/__arc/')?scripts[path.slice('/__arc/'.length)]:undefined;
      if(typeof script==='string'&&req.method==='GET'){
        res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(script);return;
      }
      if(path==='/__arc/barrier.svg'&&req.method==='GET'){
        const complete=()=>{if(res.destroyed||res.writableEnded)return;res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'});res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');};
        if(report!==null)complete();else{barriers.add(complete);res.once('close',()=>barriers.delete(complete));}return;
      }
      if(path==='/__arc/metrics'&&req.method==='GET'){
        res.writeHead(200,jsonHeaders);res.end(JSON.stringify(metrics()));return;
      }
      if(req.method!=='POST'){res.writeHead(404);res.end();return;}
      const body=await bodyOf(req);
      if(path==='/__arc/trusted-click'){
        const request=JSON.parse(body);
        if(Object.keys(request).length!==1||!trustedIds.has(request.id))throw Error('synthetic_native_id_not_allowed');
        if(!input)await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error('synthetic_native_attach_timeout')),15000);
          inputAttached.then(()=>{clearTimeout(timer);resolve();});
        });
        const result=await input.click(request.id);counts.nativeClicks++;
        res.writeHead(200,jsonHeaders);res.end(JSON.stringify(result));return;
      }
      if(path==='/__arc/complete'){
        report=JSON.parse(body);saveDiagnostics('driver-complete');
        res.writeHead(200,jsonHeaders);res.end('{"received":true}');
        reportReady();releaseBarriers();return;
      }
      if(path==='/__arc/reset-background'){
        resetting=resetting.then(async()=>{await background.idle();background.dispose();background=makeBackground();});
        await resetting;res.writeHead(200,jsonHeaders);res.end(JSON.stringify(metrics()));return;
      }
      if(path==='/__arc/bridge'){
        await resetting;const result=await background.invoke(JSON.parse(body));
        res.writeHead(200,jsonHeaders);res.end(JSON.stringify(result));return;
      }
      res.writeHead(404);res.end();
    }catch(error){
      if(!res.headersSent)res.writeHead(500,jsonHeaders);
      const code=/^synthetic_[a-z0-9_-]+$/.test(error.message)?error.message:'synthetic_harness_route_failed';
      res.end(JSON.stringify({error:code}));
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  const owner={completed,saveDiagnostics,
    configureNative:({simulateDomRaceOnce,simulateSlowDomOnce})=>{
      counts.domRaceInjectionEnabled=simulateDomRaceOnce;counts.domDelayInjectionEnabled=simulateSlowDomOnce;},
    nativeDiagnostic:event=>{
      if(event.kind==='dom-retry')counts.domRetries++;
      if(event.kind==='dom-delay')counts.injectedDomDelays++;
      if(event.kind==='press-attempt')counts.pressAttempts++;
      if(event.kind==='uncertain-input')counts.uncertainInput=true;
      if(event.kind==='protocol-error'){
        if(event.protocol.source==='injected')counts.injectedDomRaces++;
        else if(event.preparation)counts.observedDomErrors++;
      }
      if(event.kind!=='press-attempt'&&nativeDiagnostics.length<100)nativeDiagnostics.push(event);
      saveDiagnostics('native-input-diagnostic');
    },
    evidence:directory=>{evidenceDirectory=directory;saveDiagnostics('browser-starting');},
    attach:native=>{if(input)throw Error('synthetic_native_already_attached');input=native;inputReady();}};
  ownedHarnesses.set(origin,owner);
  return {url:origin,report:()=>report,metrics,calls,
    close:async()=>{
      if(closed)return;closed=true;releaseBarriers();
      ownedHarnesses.delete(origin);input?.close();
      for(const controller of controllers)controller.abort();
      for(const worker of generations)worker.dispose();
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    }};
}

export async function runArcChromium({url,evidenceRoot,timeoutMs=100000,simulateDomRaceOnce=false,simulateSlowDomOnce=false}){
  const fixture=loopbackURL(url),owner=ownedHarnesses.get(fixture.origin);
  if(!owner||fixture.pathname!=='/'||fixture.search)throw Error('Chromium requires this process owned ARC fixture');
  const browser=availableChromium();if(!browser)throw Error('No Chromium executable available');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw Error('Invalid Chromium timeout');
  if(typeof simulateDomRaceOnce!=='boolean'||typeof simulateSlowDomOnce!=='boolean')throw Error('Invalid synthetic DOM fault option');
  owner.configureNative({simulateDomRaceOnce,simulateSlowDomOnce});
  mkdirSync(evidenceRoot,{recursive:true});
  owner.evidence(evidenceRoot);
  const profile=mkdtempSync(join(evidenceRoot,'browser-profile-'));
  const temp=mkdtempSync(join(evidenceRoot,'browser-temp-'));
  const args=['--headless=new','--disable-gpu','--disable-background-networking','--disable-sync',
    '--disable-default-apps','--disable-component-update','--disable-domain-reliability',
    '--no-first-run','--no-default-browser-check','--disable-extensions','--window-size=1280,1600',
    '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,url];
  if(process.getuid?.()===0)args.unshift('--no-sandbox');
  const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','COMSPEC','LOCALAPPDATA','ProgramFiles','ProgramFiles(x86)']
    .filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));
  let stdout='',stderr='',finished=false,native,controlledClose=false,actualExitCode=null;
  const launched=execute(browser,args,{timeout:timeoutMs,maxBuffer:12*1024*1024,windowsHide:true,
    env:{...env,TEMP:temp,TMP:temp}});
  const execution=launched.then(value=>{finished=true;return value;},error=>{finished=true;throw error;});
  execution.catch(()=>{});
  try{
    native=await ownedChromeInput({profile,url,finished:()=>finished,simulateDomRaceOnce,simulateSlowDomOnce,onDiagnostic:owner.nativeDiagnostic});owner.attach(native);
    await Promise.race([owner.completed,execution.then(()=>{throw Error('synthetic_native_closed_before_driver_complete');})]);
    stdout=await native.snapshot();
    writeFileSync(join(evidenceRoot,'browser-dom.html'),stdout);
    await native.shutdown();controlledClose=true;
    const output=await execution;stderr=output.stderr;actualExitCode=0;
    owner.saveDiagnostics('browser-closed');
    return {stdout,stderr,browser};
  }catch(error){
    // Only this execFile child is stopped; existing user browser processes are
    // never enumerated, selected, reused or restarted.
    if(!finished&&native){try{await native.shutdown();controlledClose=true;}catch{}}
    if(!finished&&!controlledClose)launched.child?.kill();
    try{const output=await execution;stderr=output.stderr;actualExitCode=0;}
    catch(processError){stderr=processError.stderr||'';actualExitCode=typeof processError.code==='number'?processError.code:null;}
    owner.saveDiagnostics('browser-failed');
    error.browser=browser;throw error;
  }
  finally{
    native?.close();
    writeFileSync(join(evidenceRoot,'browser-dom.html'),stdout);
    writeFileSync(join(evidenceRoot,'browser-stderr.log'),stderr);
    writeFileSync(join(evidenceRoot,'browser-lifecycle.json'),JSON.stringify({
      ownedNewProfile:true,controlledClose,actualExitCode,
      snapshotMethod:'CDP DOM.getDocument/DOM.getOuterHTML',dumpDomFlag:false,
      incidentalBrowserRequestsVerified:false
    },null,2)+'\n');
  }
}
