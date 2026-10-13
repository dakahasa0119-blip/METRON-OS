import test from "node:test";
import assert from "node:assert/strict";
import { newMailbox, receiveMailboxMessage } from "../mothership/mailbox.mjs";

const message = () => ({
  id:"message-01",sender:"A",recipient:"B",type:"OBSERVE",
  body:"hello",traceId:"trace-01"
});
test("different node mailbox accepts a message without mutating source",()=>{
  const b=newMailbox("B");
  const r=receiveMailboxMessage(b,message());
  assert.equal(r.status,"accepted");
  assert.equal(b.messages.length,0);
  assert.equal(r.mailbox.messages.length,1);
  assert.equal(r.mailbox.owner,"B");
});
test("retry after lost ACK is deduplicated, not a second conversation",()=>{
  const b=receiveMailboxMessage(newMailbox("B"),message()).mailbox;
  const again=receiveMailboxMessage(b,message());
  assert.equal(again.status,"duplicate");
  assert.equal(again.mailbox.messages.length,1);
});
test("same message id with altered text is blocked",()=>{
  const b=receiveMailboxMessage(newMailbox("B"),message()).mailbox;
  const r=receiveMailboxMessage(b,{...message(),body:"unauthorized replacement"});
  assert.equal(r.status,"blocked");
  assert.equal(r.reason,"message_id_conflict");
  assert.equal(b.messages[0].body,"hello");
});
test("wrong recipient and missing IDs cannot modify mailbox",()=>{
  const b=newMailbox("B");
  assert.equal(receiveMailboxMessage(b,{...message(),recipient:"A"}).reason,"wrong_recipient");
  assert.equal(receiveMailboxMessage(b,{...message(),id:""}).reason,"invalid_envelope");
  assert.equal(b.messages.length,0);
});
test("invalid persisted state is not interpreted as empty mailbox",()=>{
  const b=newMailbox("B");
  b.messages=[{...message()},{...message()}];
  assert.throws(()=>receiveMailboxMessage(b,message()),/corrupt_mailbox_record/);
});
