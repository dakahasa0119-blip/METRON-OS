/**
 * Single-writer persisted replay ledger for signed test receipt bundles.
 *
 * A verified signature is not acceptance until the challenge is durably
 * checkpointed. No inter-process locking or remote consensus is provided.
 * Use ONE authorized verifier process per ledger file.
 */
import { readCheckpoint, writeAtomicJson } from "./checkpoint.mjs";
import { verifyCheckBundle } from "./signed-receipts.mjs";

const LIMIT = 10000;
const blocked = reason => ({
  status: "blocked",reason,
  approved:false,canApply:false,canDeploy:false
});
function readState(raw) {
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.consumed) ||
      raw.consumed.length > LIMIT) throw new Error("invalid_replay_ledger");
  const known = new Set();
  for (const value of raw.consumed) {
    if (typeof value !== "string" || value.length > 300 ||
        !/^[A-Za-z0-9_.:-]+$/.test(value) || known.has(value))
      throw new Error("invalid_replay_ledger_entry");
    known.add(value);
  }
  return known;
}

export class PersistentReceiptVerifier {
  constructor(file) {
    if (typeof file !== "string" || !file.trim())
      throw new Error("ledger_file_required");
    this.file = file;
    const restored = readCheckpoint(file);
    this.used = restored ? readState(restored) : new Set();
    if (!restored) writeAtomicJson(file,{schemaVersion:1,consumed:[]});
  }
  get consumedCount() { return this.used.size; }

  verifyOnce(receipts, trust) {
    if (this.used.size >= LIMIT) return blocked("replay_ledger_full");
    const pending = new Set(this.used);
    const checked=verifyCheckBundle(receipts,{
      ...trust,
      consumedNonces:pending
    });
    if (checked.status !== "verified") return checked;
    try {
      writeAtomicJson(this.file,{
        schemaVersion:1,consumed:[...pending].sort()
      });
    } catch {
      return blocked("replay_ledger_persist_failed");
    }
    this.used = pending;
    return {...checked,durableReplayRecorded:true};
  }
}
