import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync,existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createMiniServer } from "../../mini/server.mjs";

const program={
  source:"function remaining(total,used){return total + used;}",
  developmentTests:[
    {args:[10,3],expected:7},{args:[6,4],expected:2},{args:[0,0],expected:0}
  ],
  holdoutTests:[
    {args:[17,2],expected:15},{args:[3,9],expected:-6}
  ]
};
async function isolated(fn){
  const root=mkdtempSync(join(tmpdir(),"metron-unknown-http-"));
  try{return await fn(root);}
  finally{rmSync(root,{recursive:true,force:true});}
}
test("HTTP Mini repairs an unregistered error only in disposable workspace",()=>isolated(async root=>{
  const server=await createMiniServer({root,port:0});
  try{
    const response=await fetch(server.url+"/api/advanced/action",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
      body:JSON.stringify({action:"discover-repair",...program})
    });
    assert.equal(response.status,200);
    const x=await response.json();
    assert.equal(x.result.status,"behavioral_patch_verified");
    assert.equal(x.result.diskReadbackVerified,true);
    assert.equal(x.result.holdoutPassed,2);
    assert.equal(x.productionSourceUpdated,false);
    assert.equal(x.result.applyAllowed,false);
  }finally{await server.close();}
}));
test("HTTP rejects code outside the restricted safe expression grammar",()=>isolated(async root=>{
  const server=await createMiniServer({root,port:0});
  try{
    const result=await fetch(server.url+"/api/advanced/action",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Metron-Mini":"1"},
      body:JSON.stringify({action:"discover-repair",...program,
        source:"function bad(a){return globalThis.process.exit(0);}"})
    });
    assert.equal(result.status,400);
    const x=await result.json();
    assert.equal(x.error,"unsafe_or_unsupported_identifier");
  }finally{await server.close();}
}));
function chromium(){
  return [
    process.env.CHROME_BIN,"/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
    "/usr/bin/chromium","/usr/bin/chromium-browser",
    process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,"Google","Chrome","Application","chrome.exe"),
    process.env["PROGRAMFILES(X86)"]&&join(process.env["PROGRAMFILES(X86)"],"Microsoft","Edge","Application","msedge.exe")
  ].filter(Boolean).find(existsSync);
}
const execute=promisify(execFile);
test("real Chromium displays unknown-bug input and holdout controls",{
  skip:!chromium()
},()=>isolated(async root=>{
  const server=await createMiniServer({root,port:0});
  try{
    const args=["--headless=new","--disable-gpu","--disable-background-networking",
      "--no-first-run","--disable-extensions","--virtual-time-budget=5000",
      "--user-data-dir="+join(root,"chrome"),"--dump-dom",
      server.url+"/experience"];
    if(process.getuid?.()===0)args.unshift("--no-sandbox");
    const {stdout}=await execute(chromium(),args,{
      timeout:30000,maxBuffer:8*1024*1024,windowsHide:true
    });
    assert.match(stdout,/id="try-unknown-repair"/);
    assert.match(stdout,/id="unknown-code"/);
    assert.match(stdout,/id="unknown-holdout-tests"/);
  }finally{await server.close();}
}));
