/**
 * METRON civilization concept experience, running on actual Mini primitives.
 *
 * A & B have separate knowledge, Village Square is an independent ledger,
 * Gateway really routes to the other Mother's mailbox, and BAKU inspects a
 * deliberately synthetic broken-system artifact without running code.
 *
 * This is a deterministic EDUCATIONAL scenario, not independent AI cognition.
 * No external accounts, network federation, GAS or deployed repair.
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readCheckpoint, writeAtomicJson } from "../reusable/gateway-jobs/checkpoint.mjs";
import { extractCards, inspectCard } from "../reusable/baku-dna/code-cards.mjs";
import { runTwoMothershipRelayDemo } from "../reusable/examples/two-mothership-relay.mjs";

const isShip = x => x === "A" || x === "B";
const idOk = x => typeof x === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x);
const error = (code, message) => Object.assign(new Error(message), { code });
const makeId = prefix => prefix + randomUUID().replaceAll("-", "");
const seed = () => ({
  schemaVersion: 1,
  villages: {
    A: { name:"母艦A · 保全の村",value:"記録と継承を重視",
      knowledge:[{id:"origin_A",text:"中断しても目標と作業履歴を保持する",origin:"original",parentId:null}] },
    B: { name:"母艦B · 探索の村",value:"検証と新しい試みを重視",
      knowledge:[{id:"origin_B",text:"新しい提案は根拠を確認してから採用する",origin:"original",parentId:null}] }
  },
  square: [],salvage:[],events:[]
});
const allowedDecision = x => ["adopt","quarantine"].includes(x);

export class CivilizationExperience {
  constructor(root, runtime) {
    if (!runtime?.submit || !runtime?.state) throw error("invalid_runtime","Mini runtime required");
    this.runtime=runtime;
    this.file=join(root,"civilization.json");
    const existing=readCheckpoint(this.file);
    if (existing===null) {
      this.data=seed();
      writeAtomicJson(this.file,this.data);
    } else {
      this.data=this.#validate(existing);
    }
  }
  #validate(value) {
    if(!value||value.schemaVersion!==1||
       !value.villages||!value.villages.A||!value.villages.B||
       !Array.isArray(value.square)||value.square.length>120||
       !Array.isArray(value.salvage)||value.salvage.length>40||
       !Array.isArray(value.events)||value.events.length>300)
      throw error("invalid_civilization_checkpoint","Experience checkpoint corrupt");
    for(const ship of ["A","B"]) {
      const village=value.villages[ship];
      if(!Array.isArray(village.knowledge)||village.knowledge.length>120)
        throw error("invalid_village_knowledge","Village knowledge corrupt");
    }
    const known = new Set();
    for(const r of value.square) {
      if(!r||!idOk(r.id)||!isShip(r.from)||!isShip(r.to)||
         r.from===r.to||typeof r.text!=="string"||
         r.text.length>320||!["awaiting_review","adopted","quarantined"].includes(r.status)||
         known.has(r.id)) throw error("invalid_rumor_record","Village Square invalid");
      known.add(r.id);
    }
    return value;
  }
  #commit(next,event) {
    next.events.push({id:makeId("event_"),...event});
    next.events=next.events.slice(-150);
    this.#validate(next);
    // Durable checkpoint first; in-memory state is not committed if disk fails.
    writeAtomicJson(this.file,next);
    this.data=next;
  }
  state() {
    const s=this.#validate(this.data);
    const ships=this.runtime.state().ships;
    // The Village Square and knowledge are distinct from raw transport inboxes.
    return {
      version:"civilization-0.1",
      mode:"deterministic_experience_not_autonomous_ai",
      villages:s.villages,
      square:s.square.slice(-40),
      salvage:s.salvage.slice(-15),
      events:s.events.slice(-40),
      transport:{
        A:ships.A.count,
        B:ships.B.count,
        gatewayJobs:this.runtime.state().gateway.jobs
      }
    };
  }
  publish({from="A",text,parentId=null}={}) {
    if(!isShip(from)||typeof text!=="string"||!text.trim()||
       text.length>320)throw error("invalid_rumor","Enter a short idea (up to 320 characters)");
    if(this.data.square.length>=120)throw error("square_full","Village Square history full");
    const to=from==="A"?"B":"A";
    const id=makeId("rumor_");
    const rumor={id,from,to,text:text.trim(),status:"awaiting_review",
      source:parentId?"rule_based_derivation":"human_input",
      parentId,deliveryId:"m_"+randomUUID().replaceAll("-", "")};
    // Commit actual Gateway and destination inbox first. If interrupted,
    // deterministic job ID guards duplicate message transport.
    const delivery=this.runtime.submit({
      messageId:rumor.deliveryId,from,to,
      message:"[Village Square · "+id+"] "+rumor.text,code:""
    });
    if(delivery.job.state!=="done")
      throw error("delivery_not_completed","Gateway did not finish delivery");
    const next=structuredClone(this.data);
    next.square.push(rumor);
    this.#commit(next,{
      kind:"shared",rumorId:id,
      detail:from+"から"+to+"へ知識の提案を配送。採用はまだ許可されていません。"
    });
    return {rumor,...{state:this.state()}};
  }
  review({rumorId,decision}={}) {
    if(!idOk(rumorId)||!allowedDecision(decision))
      throw error("invalid_review","Choose adopt or quarantine");
    const found=this.data.square.find(x=>x.id===rumorId);
    if(!found)throw error("rumor_not_found","Unknown Village Square proposal");
    if(found.status!=="awaiting_review")
      throw error("already_reviewed","The proposal was already reviewed");
    const next=structuredClone(this.data);
    const decided=next.square.find(x=>x.id===rumorId);
    const recipient=next.villages[decided.to];
    if(decision==="adopt"){
      if(recipient.knowledge.length>=120)throw error("village_full","Village memory full");
      recipient.knowledge.push({
        id:"knowledge_"+decided.id,text:decided.text,
        origin:decided.from,parentId:decided.id
      });
    }
    decided.status=decision==="adopt"?"adopted":"quarantined";
    this.#commit(next,{
      kind:decision==="adopt"?"adopted":"quarantined",
      rumorId,
      detail:decided.to+"が受信した情報を"+(decision==="adopt"?"記憶に採用":"隔離")+"しました。"
    });
    return {rumor:decided,state:this.state()};
  }
  derive({rumorId}={}) {
    const src=this.data.square.find(x=>x.id===rumorId);
    if(!src||src.from!=="A"||src.to!=="B"||src.status!=="adopted")
      throw error("not_adopted_in_B","B must adopt A's knowledge first");
    if(this.data.square.some(x=>x.parentId===src.id))
      throw error("derived_already","Already created a derived proposal");
    // Deterministic illustrative rule, NOT machine reasoning.
    return this.publish({
      from:"B",parentId:src.id,
      text:"【Bの検証規則に基づく継承案】「"+src.text.slice(0,210)+
        "」の根拠を確認し、失敗時の復元手順を添えて共有する。"
    });
  }
  salvage() {
    if(this.data.salvage.length>=40)throw error("salvage_full","Salvage demo full");
    const excerpt="function unstable(){ return eval('untrusted'); }";
    const inspected=extractCards(excerpt,{sourceName:"synthetic_failure"})
      .map(card=>({name:card.name,kind:card.kind,
        flags:inspectCard(card).flags}));
    const artifact={
      id:makeId("dna_"),state:"quarantined",source:"synthetic_failure_fixture",
      cards:inspected,executed:false,
      note:"損傷したコード断片を静的に回収し、危険な実行処理が見つかったため隔離しました。修復は実行していません。"
    };
    const next=structuredClone(this.data);
    next.salvage.push(artifact);
    this.#commit(next,{kind:"salvaged",rumorId:null,detail:"BAKUが検査可能なDNAカードを回収・隔離。"});
    return {artifact,state:this.state()};
  }
  recoveryDemo() {
    const result=runTwoMothershipRelayDemo();
    if(result.result!=="LOCAL_TWO_MOTHERSHIP_PASS")
      throw error("recovery_failed","Local scenario did not finish");
    this.#commit(structuredClone(this.data),{
      kind:"recovered",rumorId:null,
      detail:"Gatewayの障害を隔離環境で模擬。配送後のACK消失と再送重複排除を確認。"
    });
    return {check:result,state:this.state()};
  }
}
