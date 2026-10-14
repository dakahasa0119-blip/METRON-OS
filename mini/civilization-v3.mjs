/**
 * Faithful METRON Mini civilization protocol (offline deployment adapter).
 *
 * Each USER VILLAGE owns a paired MotherShip A/B, its own Gateway and its
 * own knowledge ledger. Village Square exchanges versioned Rumor JSON files.
 * ARC remains a stateless local UI agent, and BAKU only performs real static
 * salvage on user-supplied source. This does not impersonate AI cognition,
 * real P2P networking, or Local-LLM consensus.
 */
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { readCheckpoint, writeAtomicJson } from "../reusable/gateway-jobs/checkpoint.mjs";
import { extractCards, inspectCard } from "../reusable/baku-dna/code-cards.mjs";
import { runTwoMothershipRelayDemo } from "../reusable/examples/two-mothership-relay.mjs";
import { MetronMiniRuntime } from "./runtime.mjs";
import { createRumor, FileVillageSquare } from "./rumor-protocol.mjs";

const IDS=["village-1","village-2"];
const isVillage=id=>IDS.includes(id);
const validRumorId=id=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(id);
const error=(code,message)=>Object.assign(new Error(message),{code});
const fresh=(id)=>({
  schemaVersion:1,id,
  name:id==="village-1"?"第一の村":"第二の村",
  motherShips:["A","B"],
  gatewayFilterLevel:1,
  knowledge:[{
    id:"origin_"+id,
    text:id==="village-1"?"目標と作業履歴の継承を重視する":
      "受信した情報はユーザー判断で検証する",
    sourceVillage:id,parentRumorId:null
  }],
  incoming:[],events:[]
});
function validateLocal(data,id){
  if(!data||data.schemaVersion!==1||data.id!==id||
     !Array.isArray(data.motherShips)||data.motherShips.join(",")!=="A,B"||
     ![0,1,2].includes(data.gatewayFilterLevel)||
     !Array.isArray(data.knowledge)||data.knowledge.length>120||
     !Array.isArray(data.incoming)||data.incoming.length>120||
     !Array.isArray(data.events)||data.events.length>150)
    throw error("invalid_village_checkpoint","Village checkpoint invalid");
  const unique=new Set();
  for(const entry of data.incoming){
    if(!entry||!validRumorId(entry.rumorId)||
       !["pending","adopted","quarantined"].includes(entry.status)||
       !isVillage(entry.sourceVillage)||entry.sourceVillage===id||
       unique.has(entry.rumorId))
      throw error("invalid_village_receipt","Village receipt invalid");
    unique.add(entry.rumorId);
  }
  return data;
}
function noiseSignals(rumor,level){
  if(level===0)return [];
  // Example heuristic only. User retains final authority and visibility.
  const notes=[];
  if(rumor.body.length<15)notes.push("short_message");
  if(level===2&&rumor.body.length>180)notes.push("long_unverified_message");
  if(level===2&&/(.)\1{9}/u.test(rumor.body))notes.push("repetitive_text");
  return notes;
}
export class CivilizationExperienceV3 {
  constructor(root,homeRuntime){
    if(typeof root!=="string"||!homeRuntime?.submit)
      throw error("invalid_root_or_runtime","Authorized Mini runtime required");
    this.root=root;
    this.square=new FileVillageSquare(root);
    this.runtimes={
      "village-1":homeRuntime,
      "village-2":new MetronMiniRuntime(join(root,"village-2"))
    };
    this.files=Object.fromEntries(IDS.map(id=>[id,join(root,id+"-knowledge.json")]));
    this.villages={};
    for(const id of IDS){
      const saved=readCheckpoint(this.files[id]);
      this.villages[id]=saved===null?fresh(id):validateLocal(saved,id);
      if(saved===null)writeAtomicJson(this.files[id],this.villages[id]);
    }
    // Do NOT rewrite or reinterpret legacy civilization.json (incorrect A/B-as-villages model).
  }
  #write(id,next,event){
    if(event) {
      next.events.push({kind:event.kind,detail:event.detail,
        rumorId:event.rumorId??null});
      next.events=next.events.slice(-120);
    }
    validateLocal(next,id);
    writeAtomicJson(this.files[id],next);
    this.villages[id]=next;
  }
  state(){
    const villageInfo={};
    for(const id of IDS){
      const snapshot=validateLocal(this.villages[id],id);
      const transport=this.runtimes[id].state();
      villageInfo[id]={
        id,name:snapshot.name,motherShips:["A","B"],
        gatewayFilterLevel:snapshot.gatewayFilterLevel,
        knowledge:snapshot.knowledge.slice(-30),
        incoming:snapshot.incoming.slice(-40),
        events:snapshot.events.slice(-30),
        transport:{
          motherAInbox:transport.ships.A.count,
          motherBInbox:transport.ships.B.count,
          gatewayJobs:transport.gateway.jobs
        }
      };
    }
    return {
      version:"civilization-0.3",
      topology:"village_contains_A_and_B",
      mode:"original_rumor_protocol_local_folder_adapter",
      villages:villageInfo,
      square:this.square.list().slice(-50),
      limits:{
        aiConsensus:"not_connected",
        localLlmFinalDecision:"not_connected",
        multiHostP2p:"not_connected",
        selfRepair:"not_connected",
        finalRumorDecision:"human"
      }
    };
  }
  publish({from="village-1",text,parentRumorId=null}={}){
    if(!isVillage(from))throw error("invalid_village","Unknown publishing village");
    const rumor=createRumor({
      originVillage:from,originCore:"A",body:text,parentRumorId
    });
    // Each village acts internally through its own A/B cores and Gateway.
    const inside=this.runtimes[from].submit({
      from:"A",to:"B",messageId:"m_"+randomUUID().replaceAll("-",""),
      message:"[村内: Rumor公開準備] "+rumor.id,code:""
    });
    if(inside.job.state!=="done")
      throw error("local_gateway_not_done","Local village did not complete the preparation");
    this.square.publish(rumor);
    const next=structuredClone(this.villages[from]);
    this.#write(from,next,{
      kind:"rumor_published",rumorId:rumor.id,
      detail:"村内Gatewayの確認後、Village SquareへRumor JSONを公開"
    });
    return {rumor,state:this.state()};
  }
  setFilter({villageId,level}={}){
    if(!isVillage(villageId)||!Number.isInteger(level)||level<0||level>2)
      throw error("invalid_filter","Gateway filter level must be 0, 1 or 2");
    const next=structuredClone(this.villages[villageId]);
    next.gatewayFilterLevel=level;
    this.#write(villageId,next,{kind:"filter_changed",
      detail:"ユーザーがRumorノイズ検査の強度を"+level+"に変更"});
    return {state:this.state()};
  }
  receive({villageId="village-2",rumorId}={}){
    if(!isVillage(villageId)||!validRumorId(rumorId))
      throw error("invalid_receive","Village and Rumor ID required");
    // Parse the actual separate JSON file, not an invented direct A/B P2P call.
    const rumor=this.square.read(rumorId);
    if(rumor.originVillage===villageId)
      throw error("own_rumor","Origin village may not import its own Rumor");
    const old=this.villages[villageId];
    const prior=old.incoming.find(x=>x.rumorId===rumorId);
    if(prior)return {deduplicated:true,receipt:prior,state:this.state()};
    if(old.incoming.length>=120)
      throw error("inbox_full","Village pending Rumors limit reached");
    const flags=noiseSignals(rumor,old.gatewayFilterLevel);
    const delivery=this.runtimes[villageId].submit({
      from:"B",to:"A",
      messageId:"m_"+createHash("sha256").update(villageId+":"+rumorId).digest("hex").slice(0,32),
      message:"[Village Square Rumor "+rumorId+" from "+rumor.originVillage+"] "+rumor.body,
      code:""
    });
    if(delivery.job.state!=="done")
      throw error("gateway_delivery_failed","Recipient's own Gateway delivery incomplete");
    const receipt={
      rumorId,sourceVillage:rumor.originVillage,status:"pending",
      noiseFlags:flags,filterLevelAtReceipt:old.gatewayFilterLevel
    };
    const next=structuredClone(old);
    next.incoming.push(receipt);
    this.#write(villageId,next,{
      kind:"rumor_received",rumorId,
      detail:"Village SquareのRumor JSONを自身のGatewayで受信。採用は未決定"
    });
    return {deduplicated:false,receipt,state:this.state()};
  }
  review({villageId="village-2",rumorId,decision}={}){
    if(!isVillage(villageId)||!validRumorId(rumorId)||
       !["adopt","quarantine"].includes(decision))
      throw error("invalid_review","Human decision must be adopt or quarantine");
    const record=this.villages[villageId].incoming.find(r=>r.rumorId===rumorId);
    if(!record)throw error("rumor_not_received","Import a Rumor before reviewing");
    if(record.status!=="pending")
      throw error("rumor_already_reviewed","Rumor was already reviewed");
    const rumor=this.square.read(rumorId);
    if(rumor.originVillage!==record.sourceVillage)
      throw error("rumor_provenance_changed","Rumor source changed");
    const next=structuredClone(this.villages[villageId]);
    const item=next.incoming.find(r=>r.rumorId===rumorId);
    if(decision==="adopt"){
      if(next.knowledge.length>=120)throw error("knowledge_full","Village knowledge limit");
      next.knowledge.push({
        id:"knowledge_"+rumorId,text:rumor.body,
        sourceVillage:rumor.originVillage,
        parentRumorId:rumorId
      });
    }
    item.status=decision==="adopt"?"adopted":"quarantined";
    this.#write(villageId,next,{
      kind:item.status,rumorId,
      detail:"村の利用者が外部Rumorを"+(decision==="adopt"?"採用":"隔離")
    });
    return {receipt:item,state:this.state()};
  }
  salvage({code}={}){
    if(typeof code!=="string"||!code.trim()||code.length>4000)
      throw error("invalid_salvage_source","BAKU needs code text up to 4000 characters");
    const cards=extractCards(code,{sourceName:"local_salvage"}).slice(0,24)
      .map(c=>({...inspectCard(c),kind:c.kind}));
    return {
      artifact:{state:"quarantined_for_review",cards,executed:false,
        sourceDigest:createHash("sha256").update(code).digest("hex"),
        sourceStored:false},
      state:this.state()
    };
  }
  recoveryDemo(){
    const check=runTwoMothershipRelayDemo();
    if(check.result!=="LOCAL_TWO_MOTHERSHIP_PASS")
      throw error("recovery_failed","Gateway local crash test failed");
    return {check,state:this.state()};
  }
}
