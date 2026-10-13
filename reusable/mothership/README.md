# MotherShip workflow

A small reference for deterministic task classification and careful patch-state transitions. A patch submitted to a worker is **not** automatically considered installed.

```js
import { newPatch, transitionPatch } from 'metron-reference-mothership-workflow';
let patch = transitionPatch(newPatch('p-1', 'function test() {}'), 'stage');
patch = transitionPatch(patch, 'submit');
// Verification requires independently produced evidence before transition to 'verified'.
```

Model recommendation is heuristic, not measured AI quality. Evidence values are provided by the caller; this package does not perform independent readback or actual smoke tests.

## Isolated MotherShip mailbox state (synthetic)

The `mailbox` subpath implements deterministic, pure message acceptance
and duplicate-ID fencing for an individual node. It has no transport or
storage access:

```js
import { newMailbox, receiveMailboxMessage } from
  "metron-reference-mothership-workflow/mailbox";
const b = newMailbox("B");
const receipt = receiveMailboxMessage(b,{
  id:"M1",sender:"A",recipient:"B",type:"OBSERVE",
  body:"hello",traceId:"trace-M1"
});
console.log(receipt.status); // accepted
```

Replaying the same message ID and exact content returns `duplicate` without
adding another message. Reusing an ID with altered content returns
`message_id_conflict`. This is **not** authentication and an untrusted
sender can spoof sender or IDs unless a trusted host binds identities.

A [separate local relay demo](../examples/two-mothership-relay.mjs) combines
two independent JSON-backed mailboxes with the Gateway's persistent queue.
It simulates a crash after the destination persists a message but before
the Gateway ACK. Gateway re-lease, stale-ACK rejection and receiver-side
deduplication prevent duplicate inbox entries for the demo fixture.
It does not guarantee globally exactly-once external effects, nor does it
prove historical Google spreadsheet A/B transport.
