/**
 * METRON Mini OS — real, local, interactive reference integration.
 *
 * Distinct MotherShip A/B mailboxes, durable Gateway queue and ephemeral
 * BAKU code inspection. ARC operates in the same-page browser client.
 * No AI provider calls, GAS deployment, code execution or remote transport.
 * ONE Node.js process/writer per data directory; 127.0.0.1 only.
 */
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { PersistentGateway } from "../reusable/gateway-jobs/persistent-gateway.mjs";
import { readCheckpoint, writeAtomicJson } from "../reusable/gateway-jobs/checkpoint.mjs";
import { newMailbox, receiveMailboxMessage } from "../reusable/mothership/mailbox.mjs";
import { classifyWork } from "../reusable/mothership/workflow.mjs";
import { extractCards, inspectCard } from "../reusable/baku-dna/code-cards.mjs";

const NAME = /^[A-Za-z0-9_-]{1,45}$/;
const allowedShip = value => value === "A" || value === "B";
const fail = (code, message) => Object.assign(new Error(message), {code});
const jsonSafe = value => JSON.parse(JSON.stringify(value));
function miniBakuScan(code) {
  if (typeof code !== "string" || code.length > 4000)
    throw fail("invalid_code","code excerpt must be at most 4,000 characters");
  if (!code.trim()) return { inspected:false, cards:[], disclaimer:"no_code_supplied" };
  const cards = extractCards(code,{sourceName:"user_input"});
  if (cards.length > 24) throw fail("too_many_cards","too many fragments");
  return {
    inspected:true,
    cards:cards.map(card=>{
      const risk=inspectCard(card);
      return { name:risk.name.slice(0,70),kind:card.kind,
        flags:risk.flags,reviewRequired:risk.reviewRequired };
    }),
    disclaimer:"static_heuristic_only_no_execution"
  };
}
export class MetronMiniRuntime {
  constructor(root,{now=()=>Date.now(),leaseMs=5000}={}) {
    if (typeof root!=="string" || !root.trim()) throw fail("invalid_root","data root required");
    this.root=resolve(root);
    mkdirSync(this.root,{recursive:true});
    this.gateway=new PersistentGateway(join(this.root,"gateway.json"),{
      now,queueOptions:{leaseMs,maxRetries:4,backoffMs:0}
    });
    this.shipFiles={A:join(this.root,"mother-A.json"),B:join(this.root,"mother-B.json")};
    for(const name of ["A","B"]){
      if(!readCheckpoint(this.shipFiles[name]))
        writeAtomicJson(this.shipFiles[name],newMailbox(name));
    }
  }
  mailbox(name) {
    if(!allowedShip(name)) throw fail("invalid_ship","unknown MotherShip");
    const saved=readCheckpoint(this.shipFiles[name]);
    if(!saved) throw fail("missing_mailbox","MotherShip checkpoint missing");
    // Validate without inserting synthetic messages or reserving real IDs.
    if(saved.schemaVersion!==1||saved.owner!==name||
       !Array.isArray(saved.messages)||saved.messages.length>1000)
      throw fail("invalid_mailbox","MotherShip invalid");
    const seen=new Set();
    for(const message of saved.messages){
      if(!message||!NAME.test(message.id)||!NAME.test(message.sender)||
         message.recipient!==name||!NAME.test(message.type)||
         typeof message.body!=="string"||typeof message.traceId!=="string"||
         seen.has(message.id))throw fail("invalid_mailbox","MotherShip record invalid");
      seen.add(message.id);
    }
    return saved;
  }
  submit(input) {
    if(!input || typeof input!=="object" || Array.isArray(input))
      throw fail("invalid_mission","mission object required");
    const from=input.from,to=input.to;
    if(!allowedShip(from)||!allowedShip(to)||from===to)
      throw fail("invalid_route","choose two different MotherShips");
    if(typeof input.message!=="string" || !input.message.trim() ||
       input.message.length>1024)
      throw fail("invalid_message","message length must be 1-1024");
    const id=input.messageId??("m_"+randomUUID().replace(/-/g,""));
    if(typeof id!=="string"||!NAME.test(id))
      throw fail("invalid_message_id","messageId must be 1-45 letters, numbers, dash or underscore");
    // Hash ephemeral code solely for idempotency; never persist the source.
    const codeText=input.code??"";
    if(typeof codeText!=="string"||codeText.length>4000)
      throw fail("invalid_code","code excerpt must be at most 4,000 characters");
    const codeDigest=createHash("sha256").update(codeText,"utf8").digest("hex");
    const prior=this.gateway.getJob(id);
    // Never interpret a conflicting replay as the same message.
    if(prior){
      const old=prior.payload?.envelope;
      if(old?.sender!==from||old?.recipient!==to||old?.body!==input.message||
         old?.type!=="OBSERVE"||prior.payload?.meta?.codeDigest!==codeDigest)
        throw fail("message_id_conflict","messageId has different content");
      this.drain();
      return {messageId:id,deduplicated:true,job:this.gateway.getJob(id),state:this.state()};
    }
    // BAKU inspects transient text, but only the names/risk flags are stored.
    const baku=miniBakuScan(codeText);
    const arc=input.arc?.selectorsChecked===true;
    const envelope={id,sender:from,recipient:to,type:"OBSERVE",
      body:input.message,traceId:"trace_"+id};
    this.gateway.enqueue(id,{
      envelope,
      meta:{
        workClass:(()=>{
          const traits=classifyWork(input.message);
          return traits.evolution?"repair_review":
            traits.multiFile?"structural":traits.code?"code_related":"general";
        })(),
        codeDigest,baku,
        arc:{selectorsChecked:arc,origin:"local_browser_claim"}
      }
    });
    this.drain();
    return {messageId:id,deduplicated:false,job:this.gateway.getJob(id),state:this.state()};
  }
  drain(max=100) {
    let count=0;
    while(count<max) {
      const lease=this.gateway.claim("mini-local-worker");
      if(!lease) break;
      count++;
      const {envelope,meta}=lease.payload||{};
      try {
        if(!envelope || !allowedShip(envelope.recipient))
          throw new Error("invalid queued recipient");
        const file=this.shipFiles[envelope.recipient];
        const old=this.mailbox(envelope.recipient);
        const received=receiveMailboxMessage(old,envelope);
        if(received.status==="blocked") throw new Error(received.reason);
        if(received.status==="accepted")
          writeAtomicJson(file,received.mailbox);
        // A separate independent ACK message B -> A, not a self-reply loop.
        if(envelope.type==="OBSERVE"){
          const ackId="ack_"+envelope.id;
          this.gateway.enqueue(ackId,{
            envelope:{
              id:ackId,sender:envelope.recipient,recipient:envelope.sender,
              type:"ACK",body:"Delivered "+envelope.id,
              traceId:envelope.traceId
            },
            meta:{workClass:"acknowledgement",baku:{inspected:false,cards:[]},
              arc:{selectorsChecked:false,origin:"system"}}
          });
        }
        const ok=this.gateway.complete(lease.id,lease.lease,{
          delivery:received.status,meta
        });
        if(!ok) throw new Error("lease completion rejected");
      }catch(error){
        this.gateway.fail(lease.id,lease.lease,"delivery_failed");
        throw fail("delivery_failed","local message delivery could not be completed");
      }
    }
    return count;
  }
  state(){
    const jobs=this.gateway.queue.snapshot().jobs;
    const shipments={};
    for(const ship of ["A","B"]){
      const m=this.mailbox(ship);
      shipments[ship]={
        owner:ship,count:m.messages.length,
        messages:m.messages.slice(-20).map(x=>jsonSafe(x))
      };
    }
    return {
      version:"mini-0.1",mode:"offline_local",
      ships:shipments,
      gateway:{
        jobs:jobs.length,
        byState:jobs.reduce((a,j)=>(a[j.state]=(a[j.state]||0)+1,a),{}),
        recent:jobs.slice(-20).map(j=>({
          id:j.id,state:j.state,attempts:j.attempts,
          from:j.payload?.envelope?.sender,to:j.payload?.envelope?.recipient,
          type:j.payload?.envelope?.type,
          meta:j.state==="done"?j.result?.meta:null
        }))
      },
      note:"No AI provider, Apps Script or third-party page is contacted."
    };
  }
}
