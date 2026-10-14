import test from "node:test";
import assert from "node:assert/strict";
import { repairUnknownPureFunction,repairDisposableSource }
  from "../../mini/behavioral-repair.mjs";

const challenge=(source,developmentTests,holdoutTests)=>({
  source,developmentTests,holdoutTests
});
const vector=(args,expected)=>({args,expected});
const hiddenScenarios=[
  challenge("function remaining(total,used){return total + used;}",[
    vector([10,3],7),vector([6,4],2),vector([0,0],0)
  ],[vector([17,2],15),vector([3,9],-6)]),
  challenge("function threshold(age){return age > 18;}",[
    vector([17],false),vector([18],true),vector([21],true)
  ],[vector([16],false),vector([22],true)]),
  challenge("function permissive(owner,approved){return owner && approved;}",[
    vector([true,false],true),vector([false,true],true),vector([false,false],false)
  ],[vector([true,true],true),vector([false,false],false)]),
  challenge("function increment(x){return x + 2;}",[
    vector([0],1),vector([5],6),vector([-2],-1)
  ],[vector([10],11),vector([20],21)]),
  challenge("function minimum(a,b){return a > b ? a : b;}",[
    vector([4,2],2),vector([1,3],1),vector([5,5],5)
  ],[vector([-2,-5],-5),vector([20,100],20)])
];
test("novel fault 1: synthesize a behavioral arithmetic patch without a supplied good version",()=>{
  const result=repairDisposableSource(hiddenScenarios[0]);
  assert.equal(result.status,"behavioral_patch_verified");
  assert.equal(result.diskReadbackVerified,true);
  assert.match(result.candidateSource,/total - used/);
  assert.equal(result.holdoutPassed,2);
  assert.notEqual(result.beforeSha256,result.afterSha256);
  assert.equal(result.applyAllowed,false);
});
test("novel fault 2: infer a missing boundary case from behavioral examples",()=>{
  const result=repairUnknownPureFunction(hiddenScenarios[1]);
  assert.equal(result.status,"behavioral_patch_verified");
  assert.match(result.candidateSource,/age >= 18/);
});
test("novel fault 3: infer Boolean conjunction versus disjunction",()=>{
  const result=repairUnknownPureFunction(hiddenScenarios[2]);
  assert.equal(result.status,"behavioral_patch_verified");
  assert.match(result.candidateSource,/owner \|\| approved/);
});
test("novel fault 4: infer wrong numeric literal without a known-good source",()=>{
  const result=repairUnknownPureFunction(hiddenScenarios[3]);
  assert.equal(result.status,"behavioral_patch_verified");
  assert.match(result.candidateSource,/x \+ 1/);
});
test("novel fault 5: repair an unknown conditional comparator and preserve hidden behavior",()=>{
  const result=repairUnknownPureFunction(hiddenScenarios[4]);
  assert.equal(result.status,"behavioral_patch_verified");
  assert.match(result.candidateSource,/a < b \? a : b/);
});
test("a candidate passing development vectors but breaking holdout is REJECTED",()=>{
  const prob=challenge("function offset(n){return n + 1;}",[
    vector([1],0),vector([2],1)
  ],[vector([10],10),vector([20],20)]);
  const result=repairUnknownPureFunction(prob);
  assert.equal(result.status,"rejected_by_holdout");
  assert.equal(result.candidateSource,null);
  assert.equal(result.applyAllowed,false);
});
test("unrepairable within declared grammar has explicit unresolved result",()=>{
  const prob=challenge("function broken(n){return n * n;}",[
    vector([2],100),vector([3],100)
  ],[vector([4],100),vector([5],100)]);
  const result=repairUnknownPureFunction(prob);
  assert.equal(result.status,"unresolved");
  assert.equal(result.candidateSource,null);
});
test("an already passing function does not get arbitrarily rewritten",()=>{
  const p=challenge("function sum(a,b){return a + b;}",[
    vector([2,3],5),vector([0,1],1)
  ],[vector([4,7],11),vector([10,5],15)]);
  const r=repairUnknownPureFunction(p);
  assert.equal(r.status,"not_reproduced");
  assert.equal(r.candidateSource,null);
});
test("syntactic eval/loops/process access cannot be executed or interpreted",()=>{
  const bad=[
    "function evil(a){return process.exit(0);}",
    "function evil(a){return eval(a);}",
    "function evil(a){while(true){}return a;}",
    "function evil(a){return a.constructor;}"
  ];
  for(const source of bad){
    assert.throws(()=>repairUnknownPureFunction(challenge(source,[
      vector([1],2),vector([2],3)
    ],[vector([3],4),vector([4],5)])),/unsupported|unknown|pure_single_return/);
  }
});
test("holdout cannot overlap development or omit expected behaviors",()=>{
  const p=hiddenScenarios[0];
  assert.throws(()=>repairUnknownPureFunction({
    ...p,holdoutTests:[p.developmentTests[0],p.holdoutTests[0]]
  }),/holdout_leakage/);
  assert.throws(()=>repairUnknownPureFunction({
    ...p,holdoutTests:[{args:[4]},p.holdoutTests[1]]
  }),/invalid_holdout_case/);
});
test("test fixtures cannot mutate the original source or test vectors",()=>{
  const p=structuredClone(hiddenScenarios[0]);
  const before=JSON.stringify(p);
  const output=repairDisposableSource(p);
  assert.equal(output.status,"behavioral_patch_verified");
  assert.equal(JSON.stringify(p),before);
  assert.equal(output.sourceExecuted,false);
  assert.equal(output.productionVerified,false);
});
