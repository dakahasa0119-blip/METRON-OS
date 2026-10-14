/**
 * Actual black-box behavioral repair for a restricted subset of JavaScript:
 * one pure function returning a single arithmetic/boolean/ternary expression.
 *
 * NO correct baseline is given. Mutations are discovered from development
 * failures only; an independent holdout gate is evaluated after selection.
 * Source never executes: a minimal arithmetic expression evaluator is used.
 * No arbitrary JS, unknown production bugs or self-application is supported.
 */
import { createHash } from "node:crypto";
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sha=s=>createHash("sha256").update(s,"utf8").digest("hex");
const fail=reason=>Object.assign(new Error(reason),{code:reason});
const NAME=/^[A-Za-z_$][\w$]*$/;
const BANNED=new Set(["this","constructor","prototype","__proto__","process",
  "global","globalThis","window","eval","Function","require","import",
  "new","await","yield"]);
const PREC=new Map([
  ["||",1],["&&",2],["===",3],["!==",3],["<",4],["<=",4],
  [">",4],[">=",4],["+",5],["-",5],["*",6],["/",6],["%",6]
]);
const SWAPS=new Map([
  [">",[">=","<","<=","==="]],["<",["<=",">",">=","==="]],
  [">=", [">","<=","<"]],["<=",["<",">=",">"]],
  ["===",["!==","<=",">="]],["!==",["==="]],
  ["+",["-","*","/"]],["-",["+","*","/"]],
  ["*",["/","+","-"]],["/",["*","+","-"]],["%",["/","*"]],
  ["&&",["||"]],["||",["&&"]]
]);
const primitive=x=>x===null||(typeof x==="number"&&Number.isFinite(x))||
  (typeof x==="string"&&x.length<=100)||typeof x==="boolean";

function tokenize(expr){
  const result=[];
  for(let i=0;i<expr.length;){
    if(/\s/.test(expr[i])){i++;continue;}
    const match=/^(===|!==|<=|>=|&&|\|\||(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|[A-Za-z_$][\w$]*|[()?:+*\/%!<>-])/.exec(expr.slice(i));
    if(!match)throw fail("unsupported_expression_syntax");
    const value=match[0];
    if(BANNED.has(value))throw fail("unsafe_or_unsupported_identifier");
    result.push({value,start:i,end:i+value.length});
    if(result.length>100)throw fail("too_many_expression_tokens");
    i+=value.length;
  }
  return result;
}
function parseExpression(expr,params){
  const tokens=tokenize(expr);let index=0;
  const peek=()=>tokens[index]?.value;
  const take=()=>tokens[index++]?.value;
  function primary(){
    const x=take();
    if(x===undefined)throw fail("unexpected_end");
    if(x==="("){
      const inner=read(0);
      if(take()!==")")throw fail("unbalanced_expression");
      return inner;
    }
    if(["!","-","+"].includes(x))return {type:"unary",op:x,child:read(7)};
    if(x==="true"||x==="false")return {type:"literal",value:x==="true"};
    if(x==="null")return {type:"literal",value:null};
    if(/^\d/.test(x)){
      const number=Number(x);
      if(!Number.isFinite(number))throw fail("invalid_number");
      return {type:"literal",value:number};
    }
    if(params.includes(x))return {type:"parameter",name:x};
    throw fail("unknown_identifier_or_call");
  }
  function read(min){
    let lhs=primary();
    while(true){
      const op=peek();
      if(op==="?"&&min<=0){
        take();const yes=read(0);
        if(take()!==":")throw fail("conditional_colon_missing");
        const no=read(0);
        lhs={type:"conditional",condition:lhs,yes,no};
        continue;
      }
      const priority=PREC.get(op);
      if(priority===undefined||priority<min)break;
      take();
      lhs={type:"binary",op,left:lhs,right:read(priority+1)};
    }
    return lhs;
  }
  const tree=read(0);
  if(index!==tokens.length)throw fail("unexpected_expression_token");
  return {tree,tokens};
}
function parseSource(source){
  if(typeof source!=="string"||source.length<12||source.length>2200)
    throw fail("bounded_source_required");
  const match=/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{\s*return\s+([\s\S]+?)\s*;\s*\}\s*$/.exec(source);
  if(!match)throw fail("only_pure_single_return_functions_supported");
  const name=match[1];
  const params=match[2].trim()?match[2].split(",").map(x=>x.trim()):[];
  if(!NAME.test(name)||BANNED.has(name)||params.length>4||
     new Set(params).size!==params.length||
     params.some(x=>!NAME.test(x)||BANNED.has(x)))
    throw fail("invalid_function_signature");
  const expr=match[3],parsed=parseExpression(expr,params);
  const returnAt=match[0].indexOf("return");
  const expressionAt=match[0].indexOf(expr,returnAt+6);
  if(expressionAt<0)throw fail("invalid_return_expression");
  return {name,params,expr,expressionOffset:expressionAt,...parsed};
}
function interpret(node,values,step){
  if(--step.left<0)throw fail("evaluation_budget_exceeded");
  const go=n=>interpret(n,values,step);
  if(node.type==="literal")return node.value;
  if(node.type==="parameter")return values[node.name];
  if(node.type==="unary"){
    const x=go(node.child);
    return node.op==="!"?!x:node.op==="-"?-x:+x;
  }
  if(node.type==="conditional")return go(node.condition)?go(node.yes):go(node.no);
  if(node.type!=="binary")throw fail("unsupported_node");
  const a=go(node.left);
  if(node.op==="&&")return a&&go(node.right);
  if(node.op==="||")return a||go(node.right);
  const b=go(node.right);
  switch(node.op){
    case "===":return a===b;
    case "!==":return a!==b;
    case "<":return a<b;
    case "<=":return a<=b;
    case ">":return a>b;
    case ">=":return a>=b;
    case "+":return a+b;
    case "-":return a-b;
    case "*":return a*b;
    case "/":return a/b;
    case "%":return a%b;
    default:throw fail("unsupported_binary");
  }
}
function checkTests(tests,n,kind){
  if(!Array.isArray(tests)||tests.length<2||tests.length>40)
    throw fail("invalid_"+kind+"_tests");
  const seen=new Set();
  for(const test of tests){
    if(!test||!Array.isArray(test.args)||test.args.length!==n||
      !test.args.every(primitive)||!primitive(test.expected))
      throw fail("invalid_"+kind+"_case");
    const key=JSON.stringify(test.args);
    if(seen.has(key))throw fail("duplicate_"+kind+"_case");
    seen.add(key);
  }
}
function matches(parsed,tests){
  let hits=0;
  for(const test of tests){
    try{
      const vars=Object.fromEntries(parsed.params.map((name,i)=>[name,test.args[i]]));
      const actual=interpret(parsed.tree,vars,{left:200});
      if(primitive(actual)&&Object.is(actual,test.expected))hits++;
    }catch{/* unsupported candidate fails this example */}
  }
  return hits;
}
function* candidates(source,parsed){
  const seen=new Set();let total=0;
  for(const token of parsed.tokens){
    let replacements=SWAPS.get(token.value)||[];
    if(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token.value)){
      const n=Number(token.value);
      if(Math.abs(n)<=1e6)replacements=[String(n+1),String(n-1),String(-n)];
    }
    for(const to of replacements){
      if(total>=400)return;
      if(to===token.value)continue;
      const newExpr=parsed.expr.slice(0,token.start)+to+
        parsed.expr.slice(token.end);
      if(seen.has(newExpr))continue;
      seen.add(newExpr);total++;
      yield {source:source.slice(0,parsed.expressionOffset)+newExpr+
        source.slice(parsed.expressionOffset+parsed.expr.length),
        mutation:{from:token.value,to,offset:parsed.expressionOffset+token.start}};
    }
  }
}
/** Holdout is not used to generate, rank, or retry candidate repairs. */
export function repairUnknownPureFunction({source,developmentTests,holdoutTests}={}){
  const initial=parseSource(source);
  checkTests(developmentTests,initial.params.length,"development");
  checkTests(holdoutTests,initial.params.length,"holdout");
  const known=new Set(developmentTests.map(x=>JSON.stringify(x.args)));
  if(holdoutTests.some(x=>known.has(JSON.stringify(x.args))))
    throw fail("holdout_leakage");
  const beforePass=matches(initial,developmentTests);
  if(beforePass===developmentTests.length)
    return {status:"not_reproduced",baselinePassed:beforePass,candidateSource:null,applyAllowed:false};
  let searched=0,choice=null;
  for(const candidate of candidates(source,initial)){
    searched++;
    try{
      const parsed=parseSource(candidate.source);
      if(matches(parsed,developmentTests)===developmentTests.length){
        choice=candidate;
        break;
      }
    }catch{/* candidate syntax refused */}
  }
  if(!choice)return {status:"unresolved",reason:"no_supported_one_edit_patch",
    baselinePassed:beforePass,candidatesTried:searched,
    candidateSource:null,applyAllowed:false};
  const independent=matches(parseSource(choice.source),holdoutTests);
  if(independent!==holdoutTests.length)
    return {status:"rejected_by_holdout",reason:"behavioral_regression",
      candidatesTried:searched,holdoutPassed:independent,
      holdoutTotal:holdoutTests.length,candidateSource:null,applyAllowed:false};
  return {status:"behavioral_patch_verified",
    baselinePassed:beforePass,candidatesTried:searched,
    developmentPassed:developmentTests.length,
    holdoutPassed:independent,holdoutTotal:holdoutTests.length,
    beforeSha256:sha(source),afterSha256:sha(choice.source),
    mutation:choice.mutation,candidateSource:choice.source,
    proofLevel:"supplied_development_and_holdout_vectors",
    sourceExecuted:false,productionVerified:false,applyAllowed:false};
}
/** Writes the discovered candidate only in a temporary workspace. */
export function repairDisposableSource(problem){
  const root=mkdtempSync(join(tmpdir(),"metron-unknown-repair-"));
  const before=join(root,"before.js"),after=join(root,"candidate.js");
  try{
    writeFileSync(before,problem.source,"utf8");
    const result=repairUnknownPureFunction({
      ...problem,source:readFileSync(before,"utf8")
    });
    if(result.status!=="behavioral_patch_verified")
      return {...result,diskReadbackVerified:false};
    writeFileSync(after,result.candidateSource,"utf8");
    const bytes=readFileSync(after,"utf8");
    if(sha(bytes)!==result.afterSha256)
      throw fail("candidate_readback_mismatch");
    const fresh=repairUnknownPureFunction({
      ...problem,source:readFileSync(before,"utf8")
    });
    if(fresh.afterSha256!==sha(bytes))
      throw fail("independent_candidate_mismatch");
    return {...result,diskReadbackVerified:true,
      appliedToProduction:false,disposableOnly:true};
  }finally{rmSync(root,{recursive:true,force:true});}
}
