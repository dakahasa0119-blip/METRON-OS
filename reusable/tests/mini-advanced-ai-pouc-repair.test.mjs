import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {modelAvailability,queryThreeProviders,localFinalVerdict,consultAndJudge}
  from "../../mini/ai-consensus.mjs";
import {performUsefulComputation,verifyUsefulComputation,PoUCLedger}
  from "../../mini/pouc.mjs";
import {runIsolatedRecoveryCycle} from "../../mini/isolated-repair.mjs";
import {createMiniServer} from "../../mini/server.mjs";

const fixtureEnv={
  OPENAI_API_KEY:"fixture-test-not-a-real-key",
  GEMINI_API_KEY:"fixture-test-not-a-real-key",
  ANTHROPIC_API_KEY:"fixture-test-not-a-real-key",
  METRON_OPENAI_MODEL:"fixture-o",METRON_GEMINI_MODEL:"fixture-g",
  METRON_CLAUDE_MODEL:"fixture-c"
};
function fakeProvider(url,init){
  const kind=String(url).includes("openai")?"openai":
    String(url).includes("generativelanguage")?"gemini":
      String(url).includes("anthropic")?"claude":"ollama";
  const answer={
    openai:{output_text:"実際のOpenAI APIを模したテスト応答"},
    gemini:{candidates:[{content:{parts:[{text:"実際のGemini APIを模したテスト応答"}]}}]},
    claude:{content:[{type:"text",text:"実際のClaude APIを模したテスト応答"}]},
    ollama:{response:"独立したローカルLLMを模した最終判断"}
  };
  return Promise.resolve(new Response(JSON.stringify(answer[kind]),{
    status:200,headers:{"Content-Type":"application/json"}
  }));
}
const question="独立した村の記憶を安全に引き継ぐ方法は？";
test("without genuine external credentials, consensus cannot be fabricated",async()=>{
  const r=await queryThreeProviders(question,{env:{}});
  assert.equal(r.status,"blocked");
  assert.equal(r.readyForLocalDecision,false);
  assert.equal(r.received.length,0);
  assert.deepEqual(modelAvailability({}).openai,false);
});
test("three real provider adapters receive separate independent fixture HTTP responses",async()=>{
  const called=[];
  const fetcher=async(url,init)=>{
    called.push({url,body:JSON.parse(init.body)});
    return fakeProvider(url,init);
  };
  const r=await queryThreeProviders(question,{env:fixtureEnv,fetcher});
  assert.equal(r.status,"consulted");
  assert.equal(r.received.length,3);
  assert.deepEqual(r.received.map(x=>x.provider),["openai","gemini","claude"]);
  assert.equal(new Set(called.map(x=>x.url)).size,3);
  assert.equal(r.readyForLocalDecision,true);
  assert.ok(r.received.every(x=>x.sha256?.length===64));
  assert.ok(called.every(x=>!JSON.stringify(x.body).includes("fixture-test-not-a-real-key")));
});
test("missing one model rejects final local decision",async()=>{
  const failed=async(url,init)=>{
    if(String(url).includes("anthropic"))
      return new Response("rejected",{status:503});
    return fakeProvider(url,init);
  };
  const result=await consultAndJudge(question,{
    env:fixtureEnv,fetcher:failed,model:"fixture-model"
  });
  assert.equal(result.status,"blocked");
  assert.equal(result.readyForLocalDecision,false);
  assert.equal(result.local.finalDecision,null);
});
test("local Ollama must actually answer; no substitute or fake rule",async()=>{
  const consultation=await queryThreeProviders(question,{
    env:fixtureEnv,fetcher:fakeProvider
  });
  const missing=await localFinalVerdict(question,consultation,{
    model:"",fetcher:fakeProvider
  });
  assert.equal(missing.status,"blocked");
  assert.equal(missing.finalDecision,null);
  const local=await localFinalVerdict(question,consultation,{
    model:"fixture-local",fetcher:fakeProvider
  });
  assert.equal(local.status,"local_judgment_recorded");
  assert.equal(local.consultationDigest.length,64);
  assert.equal(local.authorizedToApply,false);
  assert.match(local.finalDecision,/独立したローカルLLM/);
});
test("PoUC compiles sources without executing them, verifies and detects tampering",()=>{
  const input={
    baseline:"function example( { return false; }",
    candidate:"function example(){return true;}"
  };
  const work=performUsefulComputation(input);
  assert.equal(work.baseline.compiles,false);
  assert.equal(work.candidate.compiles,true);
  assert.equal(work.compileImproved,true);
  assert.equal(work.codeExecuted,false);
  assert.equal(work.productionRepairVerified,false);
  assert.equal(verifyUsefulComputation(input,work).verified,true);
  assert.throws(()=>verifyUsefulComputation(input,{...work,proofDigest:"0".repeat(64)}),
    /contribution_verification_failed/);
  assert.throws(()=>performUsefulComputation({
    baseline:"hello",candidate:"hello"
  }),/no_distinct_candidate/);
});
test("PoUC ledger persists proof and prevents claiming repeat work as new credit",()=>{
  const root=mkdtempSync(join(tmpdir(),"metron-pouc-test-"));
  try{
    const input={
      baseline:"function test( {",
      candidate:"function test(){return 5;}"
    },work=performUsefulComputation(input);
    let ledger=new PoUCLedger(root);
    const first=ledger.contribute(input,work);
    assert.equal(first.credits,1);
    ledger=new PoUCLedger(root);
    const again=ledger.contribute(input,work);
    assert.equal(again.deduplicated,true);
    assert.equal(again.credits,1);
    assert.equal(ledger.status().tokensMinted,0);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("BAKU truly corrupts a disposable source, detects, restores and verifies",()=>{
  const report=runIsolatedRecoveryCycle();
  assert.equal(report.status,"isolated_recovery_verified");
  assert.equal(report.failureDetected,true);
  assert.equal(report.compilesAfterRepair,true);
  assert.equal(report.verifiedFromPinnedBackup,true);
  assert.equal(report.knownGoodDigest,report.readbackDigest);
  assert.equal(report.productionCodeChanged,false);
  assert.equal(report.novelFaultFixed,false);
});
test("advanced HTTP routes enforce consent and run local PoUC/recovery",async()=>{
  const root=mkdtempSync(join(tmpdir(),"metron-advanced-http-"));
  const app=await createMiniServer({root,port:0});
  try{
    const status=await fetch(app.url+"/api/advanced/status").then(x=>x.json());
    assert.equal(status.mining.contributions,0);
    assert.equal(status.mining.tokensMinted,0);
    const call=async body=>fetch(app.url+"/api/advanced/action",{
      method:"POST",headers:{"Content-Type":"application/json",
        "X-Metron-Mini":"1"},body:JSON.stringify(body)
    });
    assert.equal((await call({action:"consult",question})).status,403);
    const mined=await call({action:"pouc",
      baseline:"function test( {",candidate:"function test(){return true;}"});
    assert.equal(mined.status,200);
    const result=await mined.json();
    assert.equal(result.contribution.verified.verified,true);
    assert.equal(result.credits.contributions,1);
    const recovered=await call({action:"repair"});
    assert.equal(recovered.status,200);
    assert.equal((await recovered.json()).appliedToProduction,false);
    assert.equal((await call({action:"undefined"})).status,400);
    const page=await fetch(app.url+"/experience").then(r=>r.text());
    assert.match(page,/PoUC/);
    assert.match(page,/ローカル最終判断/);
    assert.match(page,/隔離環境で自動復旧/);
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
