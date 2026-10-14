/**
 * METRON Civilization Experience v2 — village boundary corrected.
 *
 * A and B are two MotherShip cores INSIDE ONE village. Each village has its
 * own pair of persisted A/B inboxes and its own Gateway job checkpoint.
 * Village Square is a separate local knowledge proposal ledger.
 *
 * Human review and deterministic example derivation, NOT autonomous AI,
 * network federation, distributed atomic commit, or historical P2P proof.
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readCheckpoint, writeAtomicJson } from "../reusable/gateway-jobs/checkpoint.mjs";
import { extractCards, inspectCard } from "../reusable/baku-dna/code-cards.mjs";
import { runTwoMothershipRelayDemo } from "../reusable/examples/two-mothership-relay.mjs";
import { MetronMiniRuntime } from "./runtime.mjs";

const HOME="village-1",NEIGHBOR="village-2";
const VILLAGES=[HOME,NEIGHBOR];
const VALID_ID=/^[A-Za-z0-9_-]{1,64}$/;
const validId=x=>typeof x==="string"&&VALID_ID.test(x);
const err=(code,message)=>Object.assign(new Error(message),{code});
const newId=prefix=>prefix+randomUUID().replaceAll("-","");
const freshVillage=(id,name,policy,knowledgeText)=>({
  id,name,policy,cores:{
    A:{name:"母艦A",role:"村の記録・文脈"},
    B:{name:"母艦B",role:"村内の作業・検討"}
  },
  knowledge:[{id:"origin_"+id,text:knowledgeText,sourceVillage:id,
    sourceCore:"A",parentRumorId:null}]
});
const fresh=()=>({
  schemaVersion:2,
  villages:{
    [HOME]:freshVillage(HOME,"第一の村","継承と保全",
      "この村の母艦A/Bは、目的と作業記録を共有しながら継続する"),
    [NEIGHBOR]:freshVillage(NEIGHBOR,"第二の村","探索と検証",
      "外から届いた知識は、村の方針で評価してから取り入れる")
  },
  square:[],salvage:[],events:[]
});
function validated(data) {
  if(!data||data.schemaVersion!==2||!data.villages||
    !Array.isArray(data.square)||data.square.length>120||
    !Array.isArray(data.salvage)||data.salvage.length>40||
    !Array.isArray(data.events)||data.events.length>300)
    throw err("invalid_civilization_checkpoint","Civilization V2 checkpoint invalid");
  for(const id of VILLAGES){
    const v=data.villages[id];
    if(!v||v.id!==id||!v.cores?.A||!v.cores?.B||
      !Array.isArray(v.knowledge)||v.knowledge.length>120)
      throw err("invalid_village","Village identity or knowledge invalid");
  }
  const seen=new Set();
  for(const rumor of data.square){
    if(!rumor||!validId(rumor.id)||
      !VILLAGES.includes(rumor.from)||!VILLAGES.includes(rumor.to)||
      rumor.from===rumor.to||typeof rumor.text!=="string"||
      rumor.text.length>320||seen.has(rumor.id)||
      !["awaiting_review","adopted","quarantined"].includes(rumor.status)||
      !rumor.deliveries||!validId(rumor.deliveries.insideSource)||
      !validId(rumor.deliveries.insideDestination))
      throw err("invalid_square_entry","Invalid Village Square entry");
    seen.add(rumor.id);
  }
  return data;
}
export class CivilizationExperienceV2 {
  constructor(root,firstVillageRuntime){
    if(!firstVillageRuntime?.submit||!firstVillageRuntime?.state)
      throw err("invalid_runtime","Local first-village runtime required");
    this.root=root;
    this.file=join(root,"civilization-v2.json");
    this.legacyFile=join(root,"civilization.json"); // preserved, never migrated or overwritten
    this.runtimes={
      [HOME]:firstVillageRuntime,
      [NEIGHBOR]:new MetronMiniRuntime(join(root,"village-2"))
    };
    const saved=readCheckpoint(this.file);
    if(saved===null){
      this.data=fresh();
      writeAtomicJson(this.file,this.data);
    }else this.data=validated(saved);
  }
  #commit(next,event) {
    next.events.push({id:newId("event_"),...event});
    next.events=next.events.slice(-150);
    validated(next);
    writeAtomicJson(this.file,next);
    this.data=next;
  }
  state(){
    const d=validated(this.data);
    const runtimeState=Object.fromEntries(VILLAGES.map(id=>{
      const s=this.runtimes[id].state();
      return [id,{
        motherAInbox:s.ships.A.count,motherBInbox:s.ships.B.count,
        gatewayJobs:s.gateway.jobs,
        // Separate persistence roots for both villages, not one shared A/B pair.
        independentStore:true
      }];
    }));
    return {
      version:"civilization-0.2",
      mode:"deterministic_experience_not_autonomous_ai",
      topology:"A_B_same_village",
      villages:d.villages,
      square:d.square.slice(-40),
      salvage:d.salvage.slice(-15),
      events:d.events.slice(-40),
      transport:{
        villages:runtimeState,
        gatewayJobs:VILLAGES.reduce((n,id)=>n+runtimeState[id].gatewayJobs,0)
      },
      historicV1Data:"retained_separately_not_reinterpreted"
    };
  }
  publish({from=HOME,text,parentId=null}={}){
    if(!VILLAGES.includes(from)||typeof text!=="string"||
      !text.trim()||text.length>320)
      throw err("invalid_rumor","Select a village and enter a short idea (up to 320 characters)");
    if(this.data.square.length>=120)
      throw err("square_full","Village Square capacity reached");
    const to=from===HOME?NEIGHBOR:HOME;
    if(parentId!==null&&!this.data.square.some(x=>x.id===parentId))
      throw err("invalid_parent","Unknown parent proposal");
    const id=newId("rumor_");
    const deliveryIds={
      insideSource:newId("m_"),
      insideDestination:newId("m_")
    };
    const body="[Village Square "+id+" / "+from+" → "+to+"] "+text.trim();
    // A→B is INNER-VILLAGE coordination, not inter-village transmission.
    const origin=this.runtimes[from].submit({
      from:"A",to:"B",messageId:deliveryIds.insideSource,
      message:"[村内の共有準備] "+body,code:""
    });
    if(origin.job.state!=="done")
      throw err("source_delivery_incomplete","Source village's internal delivery incomplete");
    // Village Square's local adapter introduces the proposal into another
    // village through its OWN Gateway. B→A is a LOCAL bridge endpoint,
    // not a claim of remote P2P network transport.
    const dest=this.runtimes[to].submit({
      from:"B",to:"A",messageId:deliveryIds.insideDestination,
      message:"[広場からの受信 / 送信元 "+from+"] "+body,code:""
    });
    if(dest.job.state!=="done")
      throw err("target_delivery_incomplete","Destination village's internal delivery incomplete");
    const next=structuredClone(this.data);
    const rumor={
      id,from,to,sourceCore:"A",receivingCore:"A",text:text.trim(),
      status:"awaiting_review",source:parentId?"rule_based_derivation":"human_input",
      parentId,deliveries:deliveryIds
    };
    next.square.push(rumor);
    this.#commit(next,{
      kind:"shared",rumorId:id,
      detail:from+"の内部A→B連携後、Village Square経由で"+to+
        "のGatewayから母艦Aに到達。採用は未決定。"
    });
    return {rumor,state:this.state()};
  }
  review({rumorId,decision}={}){
    if(!validId(rumorId)||!["adopt","quarantine"].includes(decision))
      throw err("invalid_review","Choose adopt or quarantine");
    const original=this.data.square.find(x=>x.id===rumorId);
    if(!original)throw err("rumor_not_found","Unknown Village Square proposal");
    if(original.status!=="awaiting_review")
      throw err("already_reviewed","Proposal was already reviewed");
    const next=structuredClone(this.data);
    const rumor=next.square.find(x=>x.id===rumorId);
    if(decision==="adopt"){
      const dst=next.villages[rumor.to];
      if(dst.knowledge.length>=120)throw err("village_full","Village memory full");
      dst.knowledge.push({
        id:"knowledge_"+rumor.id,text:rumor.text,
        sourceVillage:rumor.from,sourceCore:rumor.sourceCore,
        parentRumorId:rumor.id
      });
    }
    rumor.status=decision==="adopt"?"adopted":"quarantined";
    this.#commit(next,{
      kind:rumor.status,rumorId,
      detail:rumor.to+"が"+(decision==="adopt"?"外部知識を採用":"未検証の外部知識を隔離")+"。"
    });
    return {rumor,state:this.state()};
  }
  derive({rumorId}={}){
    const original=this.data.square.find(x=>x.id===rumorId);
    if(!original||original.from!==HOME||original.to!==NEIGHBOR||
      original.status!=="adopted")
      throw err("not_adopted_by_village_2","Second village must first adopt the original");
    if(this.data.square.some(x=>x.parentId===rumorId))
      throw err("derived_already","Knowledge already has a derived proposal");
    return this.publish({
      from:NEIGHBOR,parentId:rumorId,
      text:"【第二の村の固定検証ルール】「"+original.text.slice(0,210)+
        "」の根拠を確認し、障害復旧の検査結果とともに返す。"
    });
  }
  salvage(){
    if(this.data.salvage.length>=40)throw err("salvage_full","BAKU example limit");
    const source="function unstable(){ return eval('untrusted'); }";
    const cards=extractCards(source,{sourceName:"synthetic_fault"}).map(c=>({
      name:c.name,kind:c.kind,flags:inspectCard(c).flags
    }));
    const artifact={
      id:newId("dna_"),state:"quarantined",source:"synthetic_fault",
      executed:false,cards,
      note:"BAKUが架空コードを静的に抽出・隔離しました。修復や実行は行いません。"
    };
    const next=structuredClone(this.data);
    next.salvage.push(artifact);
    this.#commit(next,{
      kind:"salvaged",rumorId:null,
      detail:"BAKUが村内の故障を模した断片を隔離・保管。"
    });
    return {artifact,state:this.state()};
  }
  recoveryDemo(){
    const check=runTwoMothershipRelayDemo();
    if(check.result!=="LOCAL_TWO_MOTHERSHIP_PASS")
      throw err("recovery_failed","Isolated Gateway recovery test failed");
    this.#commit(structuredClone(this.data),{
      kind:"recovered",rumorId:null,
      detail:"1つの村に属する母艦A/B間でGateway障害とACK消失を再現。"
    });
    return {check,state:this.state()};
  }
}
