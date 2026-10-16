import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {projectWorkerCli} from "../../mini/project-worker-cli.mjs";

// Transport/server-construction fixtures only: no model, coding worker, shell,
// credentials, installations, real project edits, or external network requests.
const OPERATOR="a".repeat(64),DISPATCH="b".repeat(64),LEASE="c".repeat(64);
const sha="d".repeat(64),commit="e".repeat(40);
const quiet={stdout(){}};
async function temporary(fn){
  const root=mkdtempSync(join(tmpdir(),"metron-project-cli-"));
  try{return await fn(root);}finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
}
const jsonFile=(root,name,value)=>{const path=join(root,name);writeFileSync(path,JSON.stringify(value));return path;};
const tokenFile=(root,name,value=OPERATOR)=>{const path=join(root,name);writeFileSync(path,value+"\n");return path;};
async function server(handler,fn){
  const app=createServer(handler);await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
  try{return await fn("http://127.0.0.1:"+app.address().port);}
  finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
}
async function body(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
const respond=(res,value)=>{res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(value));};
const operatorPayloads={
  start:{villageId:"village-1",workId:"work_example",projectId:"project_example",symptom:"Observed real failure",evidence:["Pinned reproduction output"]},
  review:{sessionId:"session_example"},validate:{sessionId:"session_example",reviewedDiffSha256:sha,verifier:"local owner"},
  cancel:{sessionId:"session_example",reason:"Owner requested stop"},resume:{sessionId:"session_example"},
  apply:{sessionId:"session_example",candidateCommit:commit,diffSha256:sha,verificationId:"verify_example",expectedHead:commit,reviewer:"local owner"},
  rollback:{sessionId:"session_example",expectedHead:commit,reviewer:"local owner"}
};

test("project CLI rejects remote URLs, unknown flags, injected actions and arbitrary commands before transport",()=>temporary(async root=>{
  const input=jsonFile(root,"review.json",operatorPayloads.review),cap=tokenFile(root,"operator.txt");
  const args=url=>["review","--url",url,"--input",input,"--operator-token-file",cap];
  for(const url of ["https://127.0.0.1:8000","http://localhost:8000","http://127.0.0.2:8000",
    "http://127.0.0.1:8000/path","http://user@127.0.0.1:8000","http://127.0.0.1:65536","http://127.0.0.1:0"])
    await assert.rejects(()=>projectWorkerCli(args(url),quiet),{code:"project_loopback_url_required"});
  for(const extra of [["--command","whoami"],["--url","http://127.0.0.1:9000"],["--confirm"],["--worker-token-file",cap]])
    await assert.rejects(()=>projectWorkerCli([...args("http://127.0.0.1:8000"),...extra],quiet),{code:"invalid_project_cli_arguments"});
  for(const inputValue of [{...operatorPayloads.review,action:"apply"},{...operatorPayloads.review,command:"arbitrary"},
    {...operatorPayloads.review,root:"outside"},{...operatorPayloads.review,allowApply:true}]){
    const path=jsonFile(root,"injected.json",inputValue);
    await assert.rejects(()=>projectWorkerCli(["review","--url","http://127.0.0.1:8000","--input",path,"--operator-token-file",cap],quiet),
      {code:"invalid_project_action_input"});
  }
}));

test("operator actions send only their explicit confirmation field and product-scoped capability",()=>temporary(async root=>{
  const cap=tokenFile(root,"operator.txt"),received=[];
  const confirmations={start:"allowStart",validate:"allowValidation",resume:"allowResume",apply:"allowApply",rollback:"allowRollback"};
  await server(async(req,res)=>{received.push({body:await body(req),headers:req.headers});respond(res,{accepted:true});},async url=>{
    for(const [action,inputValue] of Object.entries(operatorPayloads)){
      const input=jsonFile(root,action+".json",inputValue),args=[action,"--url",url,"--input",input,"--operator-token-file",cap];
      if(confirmations[action]){
        const before=received.length;
        await assert.rejects(()=>projectWorkerCli(args,quiet),{code:"explicit_project_confirmation_required"});
        assert.equal(received.length,before);args.push("--confirm");
      }
      await projectWorkerCli(args,quiet);
      const observed=received.at(-1);
      assert.deepEqual(observed.body,{action,...inputValue,...(confirmations[action]?{[confirmations[action]]:true}:{})});
      assert.equal(observed.headers["x-metron-project-operator"],OPERATOR);
      assert.equal(observed.headers["x-metron-project-worker"],undefined);
      assert.equal(observed.headers["x-metron-mini"],"1");assert.equal(observed.headers.origin,url);
    }
  });
  assert.equal(received.length,Object.keys(operatorPayloads).length);
}));

test("worker actions transport real capability records without an operator header or operator-token read",()=>temporary(async root=>{
  const records={claim:{sessionId:"session_example",dispatchToken:DISPATCH,workerId:"existing-codex",claimId:"claim_example"},
    heartbeat:{sessionId:"session_example",leaseToken:LEASE},"ack-stop":{sessionId:"session_example",leaseToken:LEASE},
    report:{sessionId:"session_example",leaseToken:LEASE,report:{reportId:"report_example",candidateCommit:commit,
      diagnosis:"Observed cause",operations:["Read actual source", "Created local candidate commit"],unresolved:[]}}};
  const received=[];
  await server(async(req,res)=>{received.push({body:await body(req),headers:req.headers});respond(res,{accepted:true});},async url=>{
    for(const [action,record] of Object.entries(records)){
      const input=jsonFile(root,action+".json",record),args=[action,"--url",url,"--input",input];
      await projectWorkerCli(args,quiet);
      assert.deepEqual(received.at(-1).body,{action,...record});
      assert.equal(received.at(-1).headers["x-metron-project-operator"],undefined);
      assert.equal(received.at(-1).headers["x-metron-project-worker"],undefined);
      await assert.rejects(()=>projectWorkerCli([...args,"--operator-token-file",join(root,"must-not-read")],quiet),{code:"invalid_project_cli_arguments"});
    }
    const bad=jsonFile(root,"report-extra.json",{...records.report,report:{...records.report.report,command:"arbitrary"}});
    await assert.rejects(()=>projectWorkerCli(["report","--url",url,"--input",bad],quiet),{code:"invalid_project_action_input"});
  });
  assert.equal(received.length,4);
}));

test("state sends exactly one view capability and keeps it out of query parameters",()=>temporary(async root=>{
  const op=tokenFile(root,"operator.txt"),worker=tokenFile(root,"dispatch.txt",DISPATCH),received=[];
  await server((req,res)=>{received.push({url:req.url,method:req.method,headers:req.headers});respond(res,{session:{id:"session_example"}});},async url=>{
    for(const [flag,path,header,value] of [["--operator-token-file",op,"x-metron-project-operator",OPERATOR],
      ["--worker-token-file",worker,"x-metron-project-worker",DISPATCH]]){
      const result=await projectWorkerCli(["state","--url",url,"--session-id","session_example",flag,path],quiet);
      assert.equal(result.session.id,"session_example");assert.equal(received.at(-1).method,"GET");
      assert.equal(received.at(-1).url,"/api/project/state?sessionId=session_example");
      assert.equal(received.at(-1).headers[header],value);
      assert.equal(received.at(-1).headers[header==="x-metron-project-worker"?"x-metron-project-operator":"x-metron-project-worker"],undefined);
    }
    const base=["state","--url",url,"--session-id","session_example"];
    await assert.rejects(()=>projectWorkerCli(base,quiet),{code:"project_state_capability_required"});
    await assert.rejects(()=>projectWorkerCli([...base,"--operator-token-file",op,"--worker-token-file",worker],quiet),{code:"project_state_capability_required"});
  });assert.equal(received.length,2);
}));

test("project transport refuses redirects and bypasses proxy environment variables",()=>temporary(async root=>{
  const input=jsonFile(root,"review.json",operatorPayloads.review),cap=tokenFile(root,"operator.txt");let proxyHits=0,targetHits=0;
  await server((_,res)=>{proxyHits++;respond(res,{unexpectedProxy:true});},async proxy=>{
    const names=["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","NO_PROXY","NODE_USE_ENV_PROXY"],old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
    Object.assign(process.env,{HTTP_PROXY:proxy,HTTPS_PROXY:proxy,ALL_PROXY:proxy,NO_PROXY:"",NODE_USE_ENV_PROXY:"1"});
    try{
      await server((req,res)=>{targetHits++;assert.equal(req.headers["x-metron-project-operator"],OPERATOR);
        res.writeHead(302,{Location:proxy+"/capture"});res.end();},async url=>{
        await assert.rejects(()=>projectWorkerCli(["review","--url",url,"--input",input,"--operator-token-file",cap],quiet),{code:"project_redirect_refused"});
      });
      assert.equal(targetHits,1);assert.equal(proxyHits,0);
    }finally{for(const name of names)if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}
  });
}));

test("project transport bounds input, response bytes and total request time",()=>temporary(async root=>{
  const cap=tokenFile(root,"operator.txt"),input=jsonFile(root,"review.json",operatorPayloads.review);
  const args=url=>["review","--url",url,"--input",input,"--operator-token-file",cap];
  const huge=join(root,"huge.json");writeFileSync(huge," ".repeat(32769));
  await assert.rejects(()=>projectWorkerCli(["review","--url","http://127.0.0.1:8000","--input",huge,"--operator-token-file",cap],quiet),{code:"invalid_project_input_file"});
  const limitPayload={...operatorPayloads.start,symptom:""};
  limitPayload.symptom="x".repeat(32768-Buffer.byteLength(JSON.stringify(limitPayload)));
  const limitInput=jsonFile(root,"body-limit.json",limitPayload);
  await assert.rejects(()=>projectWorkerCli(["start","--url","http://127.0.0.1:8000","--input",limitInput,
    "--operator-token-file",cap,"--confirm"],quiet),{code:"project_request_too_large"});
  await server((_,res)=>{res.writeHead(200,{"Content-Length":1048577});res.end();},async url=>{
    await assert.rejects(()=>projectWorkerCli(args(url),quiet),{code:"project_response_too_large"});
  });
  await server((_,res)=>{res.writeHead(200);res.end("x".repeat(1048577));},async url=>{
    await assert.rejects(()=>projectWorkerCli(args(url),quiet),{code:"project_response_too_large"});
  });
  await server((_,res)=>res.end("not JSON"),async url=>{
    await assert.rejects(()=>projectWorkerCli(args(url),quiet),{code:"invalid_project_response_json"});
  });
  await server(()=>{},async url=>{
    await assert.rejects(()=>projectWorkerCli(args(url),{...quiet,timeoutMs:40}),{code:"project_request_timeout"});
  });
}));

test("token files are bounded regular 64-hex capabilities and output files never overwrite",()=>temporary(async root=>{
  const input=jsonFile(root,"review.json",operatorPayloads.review),cap=tokenFile(root,"operator.txt"),output=join(root,"result.json");let requests=0;
  await server((_,res)=>{requests++;respond(res,{accepted:true});},async url=>{
    const args=["review","--url",url,"--input",input,"--operator-token-file",cap,"--output",output],printed=[];
    await projectWorkerCli(args,{stdout:text=>printed.push(text)});
    assert.deepEqual(JSON.parse(readFileSync(output,"utf8")),{accepted:true});assert.deepEqual(printed,[]);
    await assert.rejects(()=>projectWorkerCli(args,quiet),{code:"project_output_file_exists"});assert.equal(requests,1);
    for(const [name,value] of [["large","a".repeat(257)],["invalid","secret-from-another-app"],["header",OPERATOR+"\r\nheader: injected"],
      ["high-bit",Buffer.alloc(64,0xe1)]]){
      const invalid=join(root,name);writeFileSync(invalid,value);
      await assert.rejects(()=>projectWorkerCli(["review","--url",url,"--input",input,"--operator-token-file",invalid],quiet),{code:"invalid_project_token_file"});
    }
    const directory=join(root,"directory");mkdirSync(directory);
    await assert.rejects(()=>projectWorkerCli(["review","--url",url,"--input",input,"--operator-token-file",directory],quiet),{code:"invalid_project_token_file"});
    assert.equal(requests,1);
  });
}));

test("serve creates a fresh exclusive operator token, prints only its path, and stops idempotently",()=>temporary(async root=>{
  const registry=jsonFile(root,"registry.json",[{id:"registered-project"}]),cap=join(root,"new-operator.txt"),printed=[];
  let received,starts=0,stops=0;
  const dependencies={createRegisteredProjectPlan:config=>({id:config.id,pinned:true}),createMiniServer:async options=>{
    starts++;received=options;return {url:"http://127.0.0.1:12345",close:async()=>{stops++;}};
  }};
  const sigint=process.listenerCount("SIGINT"),sigterm=process.listenerCount("SIGTERM");
  const args=["serve","--registry",registry,"--data-root",join(root,"data"),"--port","0","--operator-token-file",cap];
  const app=await projectWorkerCli(args,{serveDependencies:dependencies,stdout:text=>printed.push(text)});
  try{
    const created=readFileSync(cap,"utf8").trim();assert.match(created,/^[a-f0-9]{64}$/);
    assert.equal(received.projectOperatorToken,created);assert.equal(received.port,0);
    assert.deepEqual(received.workOptions.projectPlans,[{id:"registered-project",pinned:true}]);
    assert.deepEqual(JSON.parse(printed.join("")),{url:"http://127.0.0.1:12345",projectIds:["registered-project"],operatorTokenFile:resolve(cap)});
    assert.equal(printed.join("").includes(created),false,"The new operator secret must not appear on stdout");
    await assert.rejects(()=>projectWorkerCli(args,{serveDependencies:dependencies,...quiet}),{code:"project_operator_token_file_exists"});
    assert.equal(readFileSync(cap,"utf8").trim(),created);assert.equal(starts,1);
  }finally{await app.close();await app.close();}
  assert.equal(stops,1);assert.equal(process.listenerCount("SIGINT"),sigint);assert.equal(process.listenerCount("SIGTERM"),sigterm);
}));
