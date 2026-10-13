import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runTwoMothershipRelayDemo } from "../examples/two-mothership-relay.mjs";

test("separate persisted mailboxes deliver A to B and B back to A without duplicate",()=>{
  const x=runTwoMothershipRelayDemo();
  assert.equal(x.result,"LOCAL_TWO_MOTHERSHIP_PASS");
  assert.equal(x.separateMailboxFiles,2);
  assert.equal(x.deliveryAttempts,3);
  assert.equal(x.acceptedUniqueMessages,2);
  assert.equal(x.duplicateAfterCrash,1);
  assert.equal(x.historicalCrossSpreadsheetLinkVerified,false);
});
test("two-MotherShip local relay demo runs as cross-platform standalone command",()=>{
  const path=fileURLToPath(new URL("../examples/two-mothership-relay.mjs",import.meta.url));
  const r=spawnSync(process.execPath,[path],{encoding:"utf8",timeout:12000});
  assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).result,"LOCAL_TWO_MOTHERSHIP_PASS");
});
