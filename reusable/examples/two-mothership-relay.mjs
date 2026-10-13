/**
 * LOCAL SYNTHETIC two-MotherShip relay with three DISTINCT checkpoint files.
 * Neither historical spreadsheets nor external AI/GAS/ARC are contacted.
 *
 * In the historical source, similarly named tabs exist inside both physical
 * Sheets files; this new demo does not prove how/if those sheets exchanged data.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PersistentGateway } from "../gateway-jobs/persistent-gateway.mjs";
import { readCheckpoint, writeAtomicJson } from "../gateway-jobs/checkpoint.mjs";
import { newMailbox, receiveMailboxMessage } from "../mothership/mailbox.mjs";

export function runTwoMothershipRelayDemo() {
  const dir=mkdtempSync(join(tmpdir(),"metron-two-ships-"));
  try {
    let now=1000;
    const pathA=join(dir,"mother-A.json"),pathB=join(dir,"mother-B.json");
    const gatewayFile=join(dir,"gateway.json");
    const opts={now:()=>now,queueOptions:{leaseMs:10,backoffMs:0,maxRetries:2}};
    let gateway=new PersistentGateway(gatewayFile,opts);
    // Synthetic independent local mailboxes (files, NOT Google spreadsheets).
    writeAtomicJson(pathA,newMailbox("A"));
    writeAtomicJson(pathB,newMailbox("B"));
    const inboxPaths={A:pathA,B:pathB};

    function deliverNext(worker){
      const lease=gateway.claim(worker);
      assert.ok(lease,"missing expected pending job");
      const envelope=lease.payload;
      assert.ok(Object.hasOwn(inboxPaths,envelope.recipient),"unknown destination");
      const file=inboxPaths[envelope.recipient];
      const mailbox=readCheckpoint(file);
      const delivered=receiveMailboxMessage(mailbox,envelope);
      assert.ok(["accepted","duplicate"].includes(delivered.status),delivered.reason);
      if(delivered.status==="accepted") writeAtomicJson(file,delivered.mailbox);
      return {lease,disposition:delivered.status};
    }

    gateway.enqueue("M1",{
      id:"M1",sender:"A",recipient:"B",type:"OBSERVE",
      body:"hello from A",traceId:"trace-m1"
    });
    const first=deliverNext("relay-before-crash");
    assert.equal(first.disposition,"accepted");
    // Simulate crash between destination persistence and Gateway ACK.
    // The Gateway will reclaim the expired lease and retry.
    now=1011;
    gateway=new PersistentGateway(gatewayFile,opts);
    assert.equal(gateway.getJob("M1").state,"pending");
    const retried=deliverNext("relay-after-crash");
    assert.equal(retried.disposition,"duplicate");
    assert.equal(retried.lease.lease.version,2);
    assert.equal(gateway.complete("M1",retried.lease.lease,{receipt:"stored"}),true);
    assert.equal(gateway.complete("M1",first.lease.lease,"stale"),false);

    gateway.enqueue("M2",{
      id:"M2",sender:"B",recipient:"A",type:"ACK",
      body:"received",traceId:"trace-m1"
    });
    const ack=deliverNext("relay-after-crash");
    assert.equal(ack.disposition,"accepted");
    assert.equal(gateway.complete("M2",ack.lease.lease,{receipt:"stored"}),true);

    const a=readCheckpoint(pathA),b=readCheckpoint(pathB);
    assert.deepEqual(a.messages.map(x=>x.id),["M2"]);
    assert.deepEqual(b.messages.map(x=>x.id),["M1"]);
    assert.equal(gateway.getJob("M1").state,"done");
    assert.equal(gateway.getJob("M2").state,"done");
    return {
      result:"LOCAL_TWO_MOTHERSHIP_PASS",
      separateMailboxFiles:2,
      gatewayCheckpointFiles:1,
      deliveryAttempts:3,
      acceptedUniqueMessages:2,
      duplicateAfterCrash:1,
      staleGatewayAckRejected:true,
      historicalCrossSpreadsheetLinkVerified:false
    };
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(runTwoMothershipRelayDemo(),null,2));
