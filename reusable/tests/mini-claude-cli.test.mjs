import test from "node:test";
import assert from "node:assert/strict";
import {claudeCliReasoner} from "../../mini/claude-cli.mjs";
import {createMiniServer} from "../../mini/server.mjs";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

test("CLI invocation disables both built-in and MCP tools and redacts API key environment",async()=>{
  const result=await claudeCliReasoner("Inspect local fault",{
    env:{
      HOME:"/tmp/dummy",PATH:"/usr/bin",
      ANTHROPIC_API_KEY:"never-expose-this-key",
      OPENAI_API_KEY:"also-private"
    },
    executor:async(exe,args,opts)=>{
      assert.equal(exe,"claude");
      assert.deepEqual(args.slice(0,2),["-p","Inspect local fault"]);
      assert.ok(args.includes("--tools"));
      assert.equal(args[args.indexOf("--tools")+1],"");
      assert.ok(args.includes("--disallowedTools"));
      assert.equal(args[args.indexOf("--disallowedTools")+1],"mcp__*");
      assert.equal(args[args.indexOf("--permission-mode")+1],"plan");
      assert.ok(args.includes("--no-session-persistence"));
      assert.equal(opts.env.ANTHROPIC_API_KEY,undefined);
      assert.equal(opts.env.OPENAI_API_KEY,undefined);
      return {stdout:JSON.stringify({
        is_error:false,
        result:JSON.stringify({
          diagnosis:"A genuinely authorized CLI would provide this result",
          changes:[{
            path:"src/pricing.mjs",
            content:"export function unitPrice(a,b){ return a-b; }"
          }]
        })
      })};
    }
  });
  assert.match(result,/unitPrice/);
});
test("signed-out CLI fails closed; does not produce a fake AI response",async()=>{
  await assert.rejects(()=>claudeCliReasoner("Inspect real fault",{
    executor:async()=>{throw Error("not logged in");}
  }),/claude_cli_not_authenticated_or_unavailable/);
  await assert.rejects(()=>claudeCliReasoner("Inspect real fault",{
    executor:async()=>({stdout:JSON.stringify({is_error:true,result:""})})
  }),/claude_cli_no_usable_model_response/);
});
test("public Mini API demands explicit consent for no-key Claude account session",async()=>{
  const root=mkdtempSync(join(tmpdir(),"mini-claude-cli-http-"));
  const app=await createMiniServer({root,port:0});
  try{
    const response=await fetch(app.url+"/api/agent/run",{
      method:"POST",
      headers:{
        "Content-Type":"application/json","X-Metron-Mini":"1"
      },body:JSON.stringify({
        provider:"claude-cli",
        goal:"Fix discounted multi-file invoice"
      })
    });
    assert.equal(response.status,403);
    assert.equal((await response.json()).error,"remote_ai_requires_explicit_consent");
    const html=await fetch(app.url+"/experience").then(r=>r.text());
    assert.match(html,/value="claude-cli"/);
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
