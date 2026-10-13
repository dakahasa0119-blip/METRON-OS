/**
 * Pure synthetic MotherShip mailbox reference (NO transport).
 *
 * Each mailbox belongs to one node. Caller is responsible for durable
 * storage, authentication, writer exclusion and authorization to deliver.
 * This is a new reference, NOT evidence about the historical GAS deployment.
 */
const ID=/^[A-Za-z0-9_-]{1,64}$/;
const valid = x => typeof x==="string" && ID.test(x);
export function newMailbox(owner) {
  if (!valid(owner)) throw new Error("invalid_mailbox_owner");
  return { schemaVersion:1, owner, messages:[] };
}
function validateState(state) {
  if (!state || state.schemaVersion!==1 || !valid(state.owner) ||
      !Array.isArray(state.messages) || state.messages.length>1000)
    throw new Error("invalid_mailbox_state");
  const seen=new Set();
  for(const item of state.messages) {
    if (!valid(item?.id) || !valid(item?.sender) || item.recipient!==state.owner ||
        !valid(item.type) || typeof item.body!=="string" ||
        typeof item.traceId!=="string" || seen.has(item.id))
      throw new Error("corrupt_mailbox_record");
    seen.add(item.id);
  }
}
function validateEnvelope(e) {
  return !!e && valid(e.id) && valid(e.sender) && valid(e.recipient) &&
    valid(e.type) && typeof e.body==="string" && e.body.length<=4096 &&
    typeof e.traceId==="string" && valid(e.traceId);
}
/**
 * Returns a fresh immutable-style snapshot; original caller data is unchanged.
 * Message IDs are unique within recipient mailbox. Conflicting replays fail.
 */
export function receiveMailboxMessage(state, envelope) {
  validateState(state);
  if (!validateEnvelope(envelope)) return { status:"blocked", reason:"invalid_envelope" };
  if (envelope.recipient!==state.owner)
    return { status:"blocked", reason:"wrong_recipient" };
  const message={
    id:envelope.id,sender:envelope.sender,recipient:envelope.recipient,
    type:envelope.type,body:envelope.body,traceId:envelope.traceId
  };
  const prior=state.messages.find(m=>m.id===envelope.id);
  if(prior) {
    const same=Object.keys(message).every(k=>prior[k]===message[k]);
    return { status:same?"duplicate":"blocked",
      reason:same?"already_delivered":"message_id_conflict",
      mailbox:state };
  }
  if(state.messages.length>=1000) return {status:"blocked",reason:"mailbox_full"};
  return { status:"accepted", reason:"new_message",
    mailbox:{ schemaVersion:1,owner:state.owner,messages:[...state.messages,message] } };
}
