/**
 * 🧠 [5] METRON_SWARM
 */
var SWARM_BRAIN_TYPES = {
  GEMINI: "Gemini",
  CHATGPT: "ChatGPT"
};

var METRON_SWARM = {
  BRAIN_TYPES: SWARM_BRAIN_TYPES,
  ROLES: { CREATOR: SWARM_BRAIN_TYPES.GEMINI, HACKER: SWARM_BRAIN_TYPES.GEMINI },
  shuffleRoles: function () {
    const openAiKey = METRON_PROPS.getOpenAiKey();
    console.log("🔄 知能の布陣を診断中...");
    if (!openAiKey) {
      console.log("ℹ️ OpenAI未接続。Gemini内の【Creator】と【Hacker】で進捗を維持します。");
      this.ROLES.CREATOR = this.BRAIN_TYPES.GEMINI;
      this.ROLES.HACKER = this.BRAIN_TYPES.GEMINI;
    } else {
      const aiBrains = [this.BRAIN_TYPES.GEMINI, this.BRAIN_TYPES.CHATGPT];
      this.ROLES.CREATOR = aiBrains[Math.floor(Math.random() * aiBrains.length)];
      this.ROLES.HACKER = this.ROLES.CREATOR === this.BRAIN_TYPES.GEMINI ? this.BRAIN_TYPES.CHATGPT : this.BRAIN_TYPES.GEMINI;
      console.log(`📡 多重脳稼働：[Creator: ${this.ROLES.CREATOR}] [Hacker: ${this.ROLES.HACKER}]`);
    }
  },
  generateProvocation: function (rivalName, rivalCode, dna) {
    return `あなたはMETRON OSの主任設計官です。
現在、${rivalName}が生成した以下のコード案があります。
【${rivalName}の案】
${rivalCode}
【あなたの任務】
この案は動作しますが、v33を目指す母艦にとっては「平凡」です。
1. ${rivalName}のコードの「平凡な点」を1点だけ指摘せよ。
2. その限界を突破し、よりエレガントで、GASの制約を逆手に取ったような「磨き抜かれたコード」を提示せよ。
3. 形式: {"files": [{"name": "name", "source": "code"}], "report": "進化の飛躍点"} のJSONのみを出力せよ。
DNA: ${dna}`;
  },
  compete: function (dna, error) {
    console.log(`⚔️ 知能トーナメント【HACKER】を召喚します...`);
    return METRON_EVO.think(dna, "HACKER", error);
  }
};
