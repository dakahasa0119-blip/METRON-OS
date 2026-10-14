/**
 * PoUC - Proof of Useful Computation.
 *
 * An actual constrained piece of useful work: independent validation of a
 * proposed source patch by compiling it without execution, extracting cards
 * and checking risks. Credits are recorded ONLY after full recomputation.
 * No money/token/currency, no untrusted program execution, and no mining
 * participation without independently verified work.
 */
import { Script } from "node:vm";
import { createHash,randomUUID } from "node:crypto";
import { join } from "node:path";
import { readCheckpoint,writeAtomicJson } from "../reusable/gateway-jobs/checkpoint.mjs";
import { extractCards, inspectCard } from "../reusable/baku-dna/code-cards.mjs";

const digest=s=>createHash("sha256").update(s,"utf8").digest("hex");
const fail=(code)=>Object.assign(new Error(code),{code});
function safeSource(s){
  if(typeof s!=="string"||s.length<1||s.length>4096)
    throw fail("bounded_source_required");
}
function analyze(s){
  safeSource(s);
  let compiles=false;
  try{new Script(s,{filename:"pouc-candidate.js",displayErrors:false});compiles=true;}
  catch{ /* A failed compile is useful evidence, not a successful fix. */ }
  const cards=extractCards(s,{sourceName:"anonymous_source"});
  if(cards.length>24)throw fail("too_many_cards");
  const risks=[...new Set(cards.flatMap(c=>inspectCard(c).flags))].sort();
  return {
    sha256:digest(s),compiles,
    cardCount:cards.length,cardNames:cards.map(c=>c.name.slice(0,70)),
    riskFlags:risks
  };
}
export function performUsefulComputation({baseline,candidate}={}){
  const original=analyze(baseline),updated=analyze(candidate);
  if(original.sha256===updated.sha256)
    throw fail("no_distinct_candidate");
  const improvement=!original.compiles&&updated.compiles;
  const reviewRequired=updated.riskFlags.length>0||!updated.compiles;
  const proof={
    schemaVersion:1,workType:"safe_source_compile_and_dna_audit",
    baseline:original,candidate:updated,compileImproved:improvement,
    requiresIndependentReview:reviewRequired,
    codeExecuted:false,testsRun:false,
    productionRepairVerified:false
  };
  const proofDigest=digest(JSON.stringify(proof));
  return {...proof,proofDigest};
}
export function verifyUsefulComputation(input,claimed){
  const actual=performUsefulComputation(input);
  if(!claimed||actual.proofDigest!==claimed.proofDigest||
     JSON.stringify(actual)!==JSON.stringify(claimed))
    throw fail("contribution_verification_failed");
  return {verified:true,proofDigest:actual.proofDigest,
    compileImproved:actual.compileImproved,
    productionRepairVerified:false};
}
export class PoUCLedger {
  constructor(root){
    this.file=join(root,"pouc-ledger.json");
    const saved=readCheckpoint(this.file);
    if(saved===null){
      this.entries=[];
      writeAtomicJson(this.file,{schemaVersion:1,entries:[]});
    }else{
      if(saved.schemaVersion!==1||!Array.isArray(saved.entries)||
        saved.entries.length>1000||
        saved.entries.some(e=>typeof e?.proofDigest!=="string"||
          !/^[0-9a-f]{64}$/.test(e.proofDigest)))
        throw fail("invalid_pouc_checkpoint");
      this.entries=saved.entries;
    }
  }
  contribute(input,claim){
    const verified=verifyUsefulComputation(input,claim);
    if(this.entries.some(e=>e.proofDigest===verified.proofDigest))
      return {deduplicated:true,verified,credits:this.entries.length};
    if(this.entries.length>=1000)throw fail("pouc_ledger_full");
    const next=[...this.entries,{
      id:"p_"+randomUUID().replaceAll("-",""),proofDigest:verified.proofDigest,
      workType:"safe_source_compile_and_dna_audit",
      compileImproved:verified.compileImproved
    }];
    writeAtomicJson(this.file,{schemaVersion:1,entries:next});
    this.entries=next;
    return {deduplicated:false,verified,credits:next.length};
  }
  status(){return {status:"local_verified_work_only",contributions:this.entries.length,
    tokensMinted:0,payments:0,distributedMining:false};}
}
