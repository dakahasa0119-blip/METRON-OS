/**
 * Faithful METRON Mini civilization protocol (offline deployment adapter).
 *
 * Each USER VILLAGE owns a paired MotherShip A/B, its own Gateway and its
 * own knowledge ledger. Village Square exchanges versioned Rumor JSON files.
 * ARC remains a stateless local UI agent, and BAKU only performs real static
 * salvage on user-supplied source. This does not impersonate AI cognition,
 * real P2P networking, or Local-LLM consensus.
 */
import { join, resolve, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { readCheckpoint, writeAtomicJson } from "../reusable/gateway-jobs/checkpoint.mjs";
import { extractCards, inspectCard } from "../reusable/baku-dna/code-cards.mjs";
import { runTwoMothershipRelayDemo } from "../reusable/examples/two-mothership-relay.mjs";
import { MetronMiniRuntime } from "./runtime.mjs";
import { createRumor, verifyRumor, validateRepairEvidence, FileVillageSquare } from "./rumor-protocol.mjs";

const IDS=["village-1","village-2"];
const validRumorId=id=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,64}$/.test(id);
const validDigest=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const stable=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==="object"&&!Array.isArray(entry)?
  Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
const error=(code,message)=>Object.assign(new Error(message),{code});

const sha=value=>createHash("sha256").update(value).digest("hex");
const villageIdValid=id=>typeof id==="string"&&/^[a-z][a-z0-9_-]{0,47}$/.test(id);
const bounded=(value,max,empty=false)=>typeof value==="string"&&value.length<=max&&
  (empty||value.length>0)&&value===value.trim();
const exact=(value,required,optional=[])=>value&&typeof value==="object"&&!Array.isArray(value)&&
  required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...required,...optional].includes(key));
function selectedSeed(seed,seedDigest){
  const invalid=()=>{throw error("invalid_village_inheritance","Owned selected seed or digest invalid");};
  if(!validDigest(seedDigest)||!exact(seed,["purpose","inheritedGoal","sourceMessage","knowledge","provenance"])||
     sha(stable(seed))!==seedDigest||!bounded(seed.purpose,500,true)||
     !exact(seed.provenance,["sourceVillageId","sourceWorkId"])||!villageIdValid(seed.provenance.sourceVillageId)||
     !(seed.provenance.sourceWorkId===null||/^work_[a-f0-9]{32}$/.test(seed.provenance.sourceWorkId))||
     !Array.isArray(seed.knowledge)||seed.knowledge.length>5)invalid();
  const source=seed.provenance,goal=seed.inheritedGoal,message=seed.sourceMessage;
  if(goal!==null&&(!exact(goal,["text","sha256","workId","runId","villageId"])||
     !bounded(goal.text,500)||goal.sha256!==sha(goal.text)||!/^work_[a-f0-9]{32}$/.test(goal.workId)||goal.workId!==source.sourceWorkId||
     !/^case_[a-f0-9]{32}$/.test(goal.runId)||goal.villageId!==source.sourceVillageId))invalid();
  if(message!==null&&(!exact(message,["id","text","sha256","sourceVillageId","sourceWorkId"])||
     !bounded(message.id,64)||!bounded(message.text,1024)||message.sha256!==sha(message.text)||
     message.sourceVillageId!==source.sourceVillageId||message.sourceWorkId!==source.sourceWorkId||
     source.sourceWorkId===null))invalid();
  const ids=new Set();
  for(const item of seed.knowledge){
    if(!exact(item,["id","text","sha256","sourceVillage","parentRumorId","rumorSha256","adoptedIn"],["repairProvenance"])||
       !bounded(item.id,64)||ids.has(item.id)||!bounded(item.text,320)||item.sha256!==sha(item.text)||
       !villageIdValid(item.sourceVillage)||!(item.parentRumorId===null||validRumorId(item.parentRumorId))||
       !(item.rumorSha256===null||validDigest(item.rumorSha256))||
       !(item.adoptedIn===null||villageIdValid(item.adoptedIn)))invalid();
    ids.add(item.id);
    if(Object.hasOwn(item,"repairProvenance")){
      const p=item.repairProvenance,keys=["candidateCommit","candidateDigest","diffSha256","verificationDigest"];
      if(!p||typeof p!=="object"||Array.isArray(p)||Object.keys(p).some(key=>!keys.includes(key)))invalid();
      for(const [key,value]of Object.entries(p))
        if(typeof value!=="string"||!new RegExp("^[a-f0-9]{"+(key==="candidateCommit"?40:64)+"}$").test(value))invalid();
    }
  }
  return structuredClone(seed);
}
function inheritedProjection(villageId,seed,seedDigest,item){
  return {id:"inherited_"+sha(item.id).slice(0,32),text:item.text,textSha256:item.sha256,
    sourceVillage:item.sourceVillage,parentRumorId:item.parentRumorId,rumorSha256:item.rumorSha256,adoptedIn:null,
    ...(item.repairProvenance?{repairProvenance:structuredClone(item.repairProvenance)}:{}),
    inheritance:{kind:"selected_reference",villageId,seedDigest,
      sourceVillageId:seed.provenance.sourceVillageId,sourceWorkId:seed.provenance.sourceWorkId,
      sourceKnowledgeId:item.id,sourceAdoptedIn:item.adoptedIn}};
}

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
  incoming:[],published:[],events:[]
});
function validateLocal(data,id){
  if(!data||data.schemaVersion!==1||data.id!==id||
     !Array.isArray(data.motherShips)||data.motherShips.join(",")!=="A,B"||
     ![0,1,2].includes(data.gatewayFilterLevel)||
     !Array.isArray(data.knowledge)||data.knowledge.length>120||
     !Array.isArray(data.incoming)||data.incoming.length>120||
     (data.published!==undefined&&(!Array.isArray(data.published)||data.published.length>120))||
     !Array.isArray(data.events)||data.events.length>150)
    throw error("invalid_village_checkpoint","Village checkpoint invalid");
  const unique=new Set();
  for(const entry of data.incoming){
    if(!entry||!validRumorId(entry.rumorId)||
       !["pending","adopted","quarantined"].includes(entry.status)||
       !villageIdValid(entry.sourceVillage)||entry.sourceVillage===id||
       unique.has(entry.rumorId))
      throw error("invalid_village_receipt","Village receipt invalid");
    unique.add(entry.rumorId);
    if(entry.rumorSha256!==undefined&&!validDigest(entry.rumorSha256))
      throw error("invalid_village_receipt","Village receipt digest invalid");
    if(Object.hasOwn(entry,"repairEvidence")){
      validateRepairEvidence(entry.repairEvidence);
      if(!validDigest(entry.rumorSha256))throw error("invalid_village_receipt","Repair receipt digest required");
    }
  }
  for(const entry of data.knowledge)if(Object.hasOwn(entry,"repairEvidence")){
    validateRepairEvidence(entry.repairEvidence);
    if(!validDigest(entry.rumorSha256))throw error("invalid_village_knowledge","Repair knowledge digest required");
  }
  const published=new Set();
  for(const entry of data.published||[]){
    if(!entry||!validRumorId(entry.rumorId)||!validDigest(entry.rumorSha256)||published.has(entry.rumorId))
      throw error("invalid_village_publication","Village publication record invalid");
    published.add(entry.rumorId);
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
    this.runtimes=Object.assign(Object.create(null),{
      "village-1":homeRuntime,
      "village-2":new MetronMiniRuntime(join(root,"village-2"))
    });
    this.files=Object.assign(Object.create(null),Object.fromEntries(IDS.map(id=>[id,join(root,id+"-knowledge.json")])));
    this.villages=Object.create(null);
    this.dynamic=Object.create(null);
    this.operations=new Map();
    for(const id of IDS){
      const saved=readCheckpoint(this.files[id]);
      this.villages[id]=saved===null?fresh(id):validateLocal(saved,id);
      if(saved===null)writeAtomicJson(this.files[id],this.villages[id]);
    }
    // Do NOT rewrite or reinterpret legacy civilization.json (incorrect A/B-as-villages model).
  }
  hasVillage(id){return villageIdValid(id)&&Object.hasOwn(this.villages,id);}
  isDynamic(id){return villageIdValid(id)&&Object.hasOwn(this.dynamic,id);}
  requireActive(id){
    if(!this.hasVillage(id))throw error("invalid_village","Unknown registered village");
    const runtime=this.runtimes[id];
    if(this.isDynamic(id))runtime.assertActive();
    return runtime;
  }
  #available(id){
    if(!this.isDynamic(id))return true;
    try{this.runtimes[id].assertActive();return true;}catch{return false;}
  }
  registerVillage({id,name,root,runtime,seed,seedDigest}={}){
    // Internal host interface: the caller has validated ownership and the bundle.
    // Only the child writes its Runtime; root is separate parent-owned participation.
    if(!villageIdValid(id)||IDS.includes(id)||!bounded(name,120)||typeof root!=="string"||
       !isAbsolute(root)||resolve(root)!==root||runtime?.root!==root||
       typeof runtime.submit!=="function"||typeof runtime.state!=="function"||typeof runtime.assertActive!=="function")
      throw error("invalid_village_registration","Owned village descriptor and runtime port required");
    const ownedSeed=selectedSeed(seed,seedDigest),prior=this.dynamic[id];
    if(this.hasVillage(id)){
      if(!prior||prior.root!==root||prior.name!==name||prior.seedDigest!==seedDigest||stable(prior.seed)!==stable(ownedSeed))
        throw error("village_registration_conflict","Registered village identity changed");
      this.#validateInheritance(id,this.villages[id]);
      this.runtimes[id]=runtime;
      return structuredClone(this.villages[id]);
    }
    if(Object.values(this.dynamic).some(item=>item.root.toLowerCase()===root.toLowerCase()))
      throw error("village_registration_conflict","Participation root already registered");
    const file=join(root,"knowledge.json"),saved=readCheckpoint(file);
    const initial={schemaVersion:1,id,name,motherShips:["A","B"],gatewayFilterLevel:1,seedDigest,
      knowledge:ownedSeed.knowledge.map(item=>inheritedProjection(id,ownedSeed,seedDigest,item)),
      incoming:[],published:[],events:[]};
    const value=saved===null?initial:validateLocal(saved,id);
    if(value.seedDigest!==seedDigest||value.name!==name)
      throw error("village_registration_conflict","Saved village seed or identity changed");
    const descriptor={root,name,seed:ownedSeed,seedDigest};
    this.dynamic[id]=descriptor;
    try{
      this.#validateInheritance(id,value);
      if(saved===null)writeAtomicJson(file,value);
    }catch(err){delete this.dynamic[id];throw err;}
    this.files[id]=file;this.runtimes[id]=runtime;this.villages[id]=value;
    return structuredClone(value);
  }
  #validateInheritance(id,snapshot){
    if(!this.isDynamic(id))return;
    const {seed,seedDigest}=this.dynamic[id];
    if(snapshot.seedDigest!==seedDigest||sha(stable(seed))!==seedDigest)
      throw error("village_inheritance_changed","Owned seed binding changed");
    const expected=seed.knowledge.map(item=>inheritedProjection(id,seed,seedDigest,item));
    const actual=snapshot.knowledge.filter(item=>Object.hasOwn(item,"inheritance"));
    if(actual.length!==expected.length||expected.some(item=>actual.filter(saved=>saved.id===item.id&&stable(saved)===stable(item)).length!==1))
      throw error("village_inheritance_changed","Selected inherited reference changed");
  }
  inheritedKnowledge(villageId,id){
    if(!this.isDynamic(villageId))throw error("invalid_village_inheritance","Dynamic village required");
    this.#validateInheritance(villageId,this.villages[villageId]);
    const descriptor=this.dynamic[villageId];
    const selected=descriptor.seed.knowledge.find(item=>"inherited_"+sha(item.id).slice(0,32)===id);
    if(!selected)throw error("inherited_knowledge_not_selected","Knowledge was not selected in the owned seed");
    return inheritedProjection(villageId,descriptor.seed,descriptor.seedDigest,selected);
  }
  #serial(id,operation){
    if(!this.isDynamic(id))return operation();
    const previous=this.operations.get(id)??Promise.resolve();
    const running=previous.catch(()=>{}).then(()=>{this.requireActive(id);return operation();});
    this.operations.set(id,running);
    const clear=()=>{if(this.operations.get(id)===running)this.operations.delete(id);};
    running.then(clear,clear);
    return running;
  }
  #write(id,next,event){
    if(event) {
      next.events.push({kind:event.kind,detail:event.detail,
        rumorId:event.rumorId??null});
      next.events=next.events.slice(-120);
    }
    validateLocal(next,id);
    this.#validateInheritance(id,next);
    writeAtomicJson(this.files[id],next);
    this.villages[id]=next;
  }
  #checkReceipt(record,rumor,snapshot){
    if(record.sourceVillage!==rumor.originVillage||
       (record.rumorSha256!==undefined&&record.rumorSha256!==rumor.sha256)||
       Object.hasOwn(record,"repairEvidence")!==Object.hasOwn(rumor,"repairEvidence")||
       (record.repairEvidence!==undefined&&stable(record.repairEvidence)!==stable(rumor.repairEvidence)))
      throw error("rumor_provenance_changed","Received Rumor content or evidence changed");
    if(record.repairEvidence!==undefined&&record.status==="adopted"){
      const knowledge=snapshot.knowledge.find(item=>item.id==="knowledge_"+rumor.id);
      if(!knowledge||knowledge.text!==rumor.body||knowledge.sourceVillage!==rumor.originVillage||
         knowledge.parentRumorId!==rumor.id||knowledge.rumorSha256!==rumor.sha256||
         stable(knowledge.repairEvidence)!==stable(rumor.repairEvidence))
        throw error("rumor_provenance_changed","Adopted repair knowledge changed");
    }
  }
  state(){
    const villageInfo=Object.create(null);
    for(const id of Object.keys(this.villages)){
      const snapshot=validateLocal(this.villages[id],id);
      this.#validateInheritance(id,snapshot);
      for(const record of snapshot.incoming)if(record.repairEvidence!==undefined)
        this.#checkReceipt(record,this.square.read(record.rumorId),snapshot);
      const transport=this.runtimes[id].state();
      villageInfo[id]={
        id,name:snapshot.name,motherShips:["A","B"],dynamic:this.isDynamic(id),available:this.#available(id),
        ...(this.isDynamic(id)?{inheritance:{purpose:this.dynamic[id].seed.purpose,
          inheritedGoal:structuredClone(this.dynamic[id].seed.inheritedGoal),
          sourceVillageId:this.dynamic[id].seed.provenance.sourceVillageId,
          sourceWorkId:this.dynamic[id].seed.provenance.sourceWorkId}}:{}),
        gatewayFilterLevel:snapshot.gatewayFilterLevel,
        knowledge:snapshot.knowledge.slice(-30),
        incoming:snapshot.incoming.slice(-40),
        published:(snapshot.published||[]).slice(-40),
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
    if(!this.hasVillage(from))throw error("invalid_village","Unknown publishing village");
    return this.publishPreparedRumor(createRumor({
      originVillage:from,originCore:"A",body:text,parentRumorId
    }));
  }

  publishPreparedRumor(prepared){
    // Internal code interface only. HTTP publication still creates plain V1.
    const rumor=verifyRumor(prepared),from=rumor.originVillage;
    if(!this.hasVillage(from))throw error("invalid_village","Unknown publishing village");
    return this.#serial(from,()=>{
      this.requireActive(from);
      this.#publicationContext(rumor);
      const inside=this.runtimes[from].submit({
        from:"A",to:"B",messageId:"m_"+createHash("sha256").update("rumor-publish:"+rumor.id).digest("hex").slice(0,32),
        message:"[村内: Rumor公開準備] "+rumor.id+" sha256:"+rumor.sha256,code:""
      });
      const complete=result=>{
        this.requireActive(from);
        if(result?.job?.state!=="done")
          throw error("local_gateway_not_done","Local village did not complete the preparation");
        // Another village may publish while IPC is pending. Re-read provenance
        // and shared capacity after the await before making a shared write.
        const {old,record,existing}=this.#publicationContext(rumor);
        if(!existing)this.square.publish(rumor);
        if(!record){
          const next=structuredClone(old);next.published??=[];
          next.published.push({rumorId:rumor.id,rumorSha256:rumor.sha256});
          const priorEvent=next.events.some(event=>event.kind==="rumor_published"&&event.rumorId===rumor.id);
          this.#write(from,next,priorEvent?null:{
            kind:"rumor_published",rumorId:rumor.id,detail:"Own Gateway completed Rumor publication preparation"
          });
        }
        return {rumor,duplicate:Boolean(existing||record),state:this.state()};
      };
      return inside&&typeof inside.then==="function"?inside.then(complete):complete(inside);
    });
  }
  #publicationContext(rumor){
    const old=this.villages[rumor.originVillage];
    const record=old.published?.find(item=>item.rumorId===rumor.id);
    if(record&&record.rumorSha256!==rumor.sha256)
      throw error("rumor_id_conflict","Published Rumor ID has different content");
    let existing;
    try{existing=this.square.read(rumor.id);}
    catch(err){if(err?.code!=="rumor_not_found")throw err;}
    if(existing&&existing.sha256!==rumor.sha256)
      throw error("rumor_id_conflict","Published Rumor ID has different content");
    if(!record&&(old.published||[]).length>=120)
      throw error("publication_limit_reached","Village publication limit reached");
    if(!existing&&this.square.list().length>=120)
      throw error("square_limit_reached","Village Square publication limit reached");
    return {old,record,existing};
  }
  setFilter({villageId,level}={}){
    if(!this.hasVillage(villageId)||!Number.isInteger(level)||level<0||level>2)
      throw error("invalid_filter","Gateway filter level must be 0, 1 or 2");
    this.requireActive(villageId);
    const next=structuredClone(this.villages[villageId]);
    next.gatewayFilterLevel=level;
    this.#write(villageId,next,{kind:"filter_changed",
      detail:"ユーザーがRumorノイズ検査の強度を"+level+"に変更"});
    return {state:this.state()};
  }

  receive({villageId="village-2",rumorId}={}){
    if(!this.hasVillage(villageId)||!validRumorId(rumorId))
      throw error("invalid_receive","Village and Rumor ID required");
    return this.#serial(villageId,()=>{
      this.requireActive(villageId);
      const first=this.#receiptContext(villageId,rumorId);
      if(first.prior)return {deduplicated:true,receipt:structuredClone(first.prior),state:this.state()};
      if(first.old.incoming.length>=120)
        throw error("inbox_full","Village pending Rumors limit reached");
      const rumor=first.rumor;
      const delivery=this.runtimes[villageId].submit({
        from:"B",to:"A",
        messageId:"m_"+createHash("sha256").update(villageId+":"+rumorId).digest("hex").slice(0,32),
        message:"[Village Square Rumor "+rumorId+" from "+rumor.originVillage+"] "+rumor.body,code:""
      });
      const complete=result=>{
        this.requireActive(villageId);
        if(result?.job?.state!=="done")
          throw error("gateway_delivery_failed","Recipient's own Gateway delivery incomplete");
        // Reload current ledger after IPC so concurrent filter/review changes
        // and other receives cannot be lost through an old snapshot.
        const {old,prior}=this.#receiptContext(villageId,rumorId,rumor);
        if(prior)return {deduplicated:true,receipt:structuredClone(prior),state:this.state()};
        if(old.incoming.length>=120)throw error("inbox_full","Village pending Rumors limit reached");
        const receipt={
          rumorId,sourceVillage:rumor.originVillage,status:"pending",
          noiseFlags:noiseSignals(rumor,old.gatewayFilterLevel),filterLevelAtReceipt:old.gatewayFilterLevel,
          rumorSha256:rumor.sha256,
          ...(rumor.repairEvidence===undefined?{}:{repairEvidence:structuredClone(rumor.repairEvidence)})
        };
        const next=structuredClone(old);next.incoming.push(receipt);
        this.#write(villageId,next,{kind:"rumor_received",rumorId,detail:"Received through own Gateway; adoption pending"});
        return {deduplicated:false,receipt:structuredClone(receipt),state:this.state()};
      };
      return delivery&&typeof delivery.then==="function"?delivery.then(complete):complete(delivery);
    });
  }
  #receiptContext(villageId,rumorId,expected){
    // A wire checksum is not membership or sender authentication.
    const rumor=this.square.read(rumorId);
    if(!this.hasVillage(rumor.originVillage))
      throw error("unregistered_rumor_origin","Rumor origin is not a registered village");
    if(rumor.originVillage===villageId)
      throw error("own_rumor","Origin village may not import its own Rumor");
    if(expected&&rumor.sha256!==expected.sha256)
      throw error("rumor_provenance_changed","Rumor changed while Gateway delivery was pending");
    const old=this.villages[villageId],prior=old.incoming.find(item=>item.rumorId===rumorId);
    if(prior)this.#checkReceipt(prior,rumor,old);
    return {rumor,old,prior};
  }
  review({villageId="village-2",rumorId,decision}={}){
    if(!this.hasVillage(villageId)||!validRumorId(rumorId)||
       !["adopt","quarantine"].includes(decision))
      throw error("invalid_review","Human decision must be adopt or quarantine");
    this.requireActive(villageId);
    const record=this.villages[villageId].incoming.find(r=>r.rumorId===rumorId);
    if(!record)throw error("rumor_not_received","Import a Rumor before reviewing");
    const rumor=this.square.read(rumorId);
    this.#checkReceipt(record,rumor,this.villages[villageId]);
    if(record.status!=="pending")
      throw error("rumor_already_reviewed","Rumor was already reviewed");
    const next=structuredClone(this.villages[villageId]);
    const item=next.incoming.find(r=>r.rumorId===rumorId);
    if(decision==="adopt"){
      if(next.knowledge.length>=120)throw error("knowledge_full","Village knowledge limit");
      next.knowledge.push({
        id:"knowledge_"+rumorId,text:rumor.body,
        sourceVillage:rumor.originVillage,
        parentRumorId:rumorId,
        ...(rumor.repairEvidence===undefined?{}:{rumorSha256:rumor.sha256,
          repairEvidence:structuredClone(rumor.repairEvidence)})
      });
    }
    item.status=decision==="adopt"?"adopted":"quarantined";
    this.#write(villageId,next,{
      kind:item.status,rumorId,
      detail:"村の利用者が外部Rumorを"+(decision==="adopt"?"採用":"隔離")
    });
    return {receipt:structuredClone(item),state:this.state()};
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
