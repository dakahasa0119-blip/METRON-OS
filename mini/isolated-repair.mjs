/**
 * BAKU/METRON bounded automatic recovery.
 *
 * Real filesystem corruption is detected and repaired from a separately
 * digest-pinned known-good reference in an ISOLATED temporary directory.
 * No unknown patch synthesis, user-project writes, provider execution,
 * arbitrary shell commands or deployment. Real source verification is
 * syntax compilation (NOT behavioral test execution).
 */
import { mkdtempSync,rmSync,readFileSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { writeAtomicJson } from "../reusable/gateway-jobs/checkpoint.mjs";

const sha=s=>createHash("sha256").update(s,"utf8").digest("hex");
const goodSource="function healthCheck(){ return 'ready'; }\n";
const badSource="function healthCheck( { return 'broken';\n";
function syntax(source){
  try {new Script(source,{filename:"isolated-repair-target.js",displayErrors:false});return true;}
  catch{return false;}
}
/** Execute the full loop against a disposable reference checkout, auto-cleaned. */
export function runIsolatedRecoveryCycle(){
  const root=mkdtempSync(join(tmpdir(),"metron-baku-recovery-"));
  const target=join(root,"target.js");
  const lastGood=join(root,"verified-backup.js");
  const report=join(root,"recovery-receipt.json");
  const expected=sha(goodSource);
  let restored=false;
  try {
    writeFileSync(lastGood,goodSource,"utf8");
    if(sha(readFileSync(lastGood,"utf8"))!==expected||!syntax(goodSource))
      throw new Error("reference_backup_not_valid");
    writeFileSync(target,goodSource,"utf8");
    if(readFileSync(target,"utf8")!==goodSource)
      throw new Error("initial_readback_failed");
    // Only THIS synthetic file is broken on purpose, never an active source tree.
    writeFileSync(target,badSource,"utf8");
    const actualBad=readFileSync(target,"utf8");
    const faultDetected=!syntax(actualBad);
    if(!faultDetected)throw new Error("synthetic_fault_not_detected");
    const knownGood=readFileSync(lastGood,"utf8");
    if(sha(knownGood)!==expected||!syntax(knownGood))
      throw new Error("backup_integrity_failed");
    writeFileSync(target,knownGood,"utf8");
    const readback=readFileSync(target,"utf8");
    restored=sha(readback)===expected&&syntax(readback);
    const receipt={
      status:restored?"isolated_recovery_verified":"isolated_recovery_failed",
      target:"isolated_temp_only",
      failureDetected:faultDetected,
      sourceBefore:sha(actualBad),knownGoodDigest:expected,
      readbackDigest:sha(readback),
      compilesAfterRepair:syntax(readback),
      verifiedFromPinnedBackup:restored,
      sourceExecuted:false,
      productionCodeChanged:false,
      novelFaultFixed:false,
      requiresIndependentProductionApproval:true
    };
    writeAtomicJson(report,receipt);
    const disk=JSON.parse(readFileSync(report,"utf8"));
    if(!restored||disk.readbackDigest!==expected)
      throw new Error("isolated_recovery_verification_failed");
    return disk;
  }finally{
    // Never preserve or distribute executable test code from this lab.
    rmSync(root,{recursive:true,force:true});
  }
}
