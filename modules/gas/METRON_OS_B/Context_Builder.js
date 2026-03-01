/**
 * MotherShip Context Builder (Strategic Enhanced Edition + Cache)
 * 母艦の状態を集約し、戦略参謀（Analyst_Eye / System_Evolver）が
 * 高精度の判断を行えるように最適化されたコンテキストを返す。
 *
 * キャッシュ有効期限：5分
 */
function buildMotherShipContext(forceRefresh = false) {
  const props = PropertiesService.getScriptProperties();
  const CACHE_KEY = "MOTHERSHIP_CONTEXT_CACHE";
  const CACHE_TIME_KEY = "MOTHERSHIP_CONTEXT_CACHE_TIME";
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5分

  // -----------------------------
  // 0. キャッシュが使えるか確認
  // -----------------------------
  try {
    if (!forceRefresh) {
      const cached = props.getProperty(CACHE_KEY);
      const cachedTime = Number(props.getProperty(CACHE_TIME_KEY) || 0);

      if (cached && cachedTime && (Date.now() - cachedTime < CACHE_TTL_MS)) {
        return JSON.parse(cached);
      }
    }
  } catch (e) {
    // キャッシュ破損時は無視して再構築
  }

  // -----------------------------
  // 1. キャッシュが無いので再構築
  // -----------------------------
  const ctx = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. SystemLog
  try {
    const logSheet = ss.getSheetByName("SystemLog");
    if (logSheet) {
      const values = logSheet.getDataRange().getValues();
      const last = values.slice(-100);
      ctx.systemLog = last.map(r => ({
        time: r[0],
        type: r[1],
        message: r[2]
      }));
    } else ctx.systemLog = [];
  } catch (e) {
    ctx.systemLog = [{ error: "SystemLog 読み込み失敗: " + e.message }];
  }

  // 2. MainChat
  try {
    const chatSheet = ss.getSheetByName("MainChat");
    if (chatSheet && chatSheet.getLastRow() > 1) {
      const lastRow = chatSheet.getLastRow();
      const count = Math.min(80, lastRow - 1);
      const data = chatSheet.getRange(lastRow - count + 1, 1, count, 3).getValues();
      ctx.chatLog = data.map(r => ({
        time: r[0],
        role: r[1],
        text: r[2]
      }));
    } else ctx.chatLog = [];
  } catch (e) {
    ctx.chatLog = [{ error: "MainChat 読み込み失敗: " + e.message }];
  }

  // 3. Forge_Staging
  try {
    const forgeSheet = ss.getSheetByName("Forge_Staging");
    if (forgeSheet && forgeSheet.getLastRow() > 1) {
      const data = forgeSheet.getDataRange().getValues();
      const last = data.slice(-30);
      ctx.latestProposals = last.map(r => ({
        time: r[0],
        appName: r[1],
        description: r[2],
        code: r[3],
        status: r[4],
        docUrl: r[5]
      }));
    } else ctx.latestProposals = [];
  } catch (e) {
    ctx.latestProposals = [{ error: "Forge_Staging 読み込み失敗: " + e.message }];
  }

  // 4. Injection_Slot
  try {
    const slotSheet = ss.getSheetByName("Injection_Slot");
    if (slotSheet && slotSheet.getLastRow() > 1) {
      const data = slotSheet.getDataRange().getValues();
      const last = data.slice(-20);
      ctx.injectionSlot = last.map(r => ({
        time: r[0],
        filename: r[1],
        description: r[2],
        code: r[3],
        status: r[4],
        docUrl: r[5]
      }));
    } else ctx.injectionSlot = [];
  } catch (e) {
    ctx.injectionSlot = [{ error: "Injection_Slot 読み込み失敗: " + e.message }];
  }

  // 5. PatchSlots
  try {
    const patchSheet = ss.getSheetByName("PatchSlots");
    if (patchSheet && patchSheet.getLastRow() > 1) {
      const data = patchSheet.getDataRange().getValues();
      const last = data.slice(-50);
      ctx.patchSlots = last.map(r => ({
        time: r[0],
        filename: r[1],
        description: r[2],
        code: r[3],
        status: r[4]
      }));
    } else ctx.patchSlots = [];
  } catch (e) {
    ctx.patchSlots = [{ error: "PatchSlots 読み込み失敗: " + e.message }];
  }

  // 6. Evolution 状態
  try {
    const p = PropertiesService.getScriptProperties();
    ctx.evolution = {
      persona: p.getProperty("SYSTEM_PERSONA") || "Active Mode",
      evolutionCount: Number(p.getProperty("EVOLUTION_COUNT") || 0),
      lastEvolutionDate: p.getProperty("LAST_EVOLUTION_DATE") || "",
      pendingEvolutionName: p.getProperty("PENDING_EVOLUTION_NAME") || "",
      hasPendingEvolution: !!p.getProperty("PENDING_EVOLUTION_CODE")
    };
  } catch (e) {
    ctx.evolution = { error: "進化状態の取得失敗: " + e.message };
  }

  // 7. Triggers
  try {
    const triggers = ScriptApp.getProjectTriggers();
    ctx.triggers = triggers.map(t => ({
      func: t.getHandlerFunction(),
      type: t.getEventType && t.getEventType().toString()
    }));
  } catch (e) {
    ctx.triggers = [{ error: "トリガー取得失敗: " + e.message }];
  }

  // 8. Evolution_Priority
  try {
    const prSheet = ss.getSheetByName("Evolution_Priority");
    if (prSheet && prSheet.getLastRow() > 1) {
      const data = prSheet.getDataRange().getValues().slice(1);
      ctx.evolutionPriority = data.map(r => ({
        time: r[0],
        appName: r[1],
        modules: r[2],
        risk: r[3],
        score: r[4],
        result: r[5]
      }));
    } else ctx.evolutionPriority = [];
  } catch (e) {
    ctx.evolutionPriority = [{ error: "Evolution_Priority 読み込み失敗: " + e.message }];
  }

  // 9. moduleWeights
  try {
    const weights = {};
    ctx.evolutionPriority.forEach(row => {
      const mods = row.modules.split(",").map(s => s.trim());
      mods.forEach(m => {
        if (!weights[m]) weights[m] = { success: 0, fail: 0 };
        if (row.result === "SUCCESS") weights[m].success++;
        if (row.result === "FAIL") weights[m].fail++;
      });
    });
    ctx.moduleWeights = weights;
  } catch (e) {
    ctx.moduleWeights = { error: "moduleWeights 計算失敗: " + e.message };
  }

  // 10. health
  try {
    const errorCount = ctx.systemLog.filter(l => l.type && l.type.includes("ERROR")).length;
    const pendingCount = ctx.latestProposals.filter(p => !p.status || p.status === "PENDING").length;

    ctx.health = {
      errorCount,
      pendingCount,
      triggerCount: ctx.triggers.length,
      score: 100 - (errorCount * 2 + pendingCount)
    };
  } catch (e) {
    ctx.health = { error: "health 計算失敗: " + e.message };
  }

  // 11. External Messages（P2P通信 Inbox）
  try {
    const motherShips = ["METRON-A", "METRON-B", "METRON-C"];
    ctx.externalMessages = {};

    motherShips.forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (!sheet) return;

      const data = sheet.getDataRange().getValues();
      const inbox = [];

      for (let i = 1; i < data.length; i++) {
        if (data[i][4] === "UNPROCESSED") {
          inbox.push({
            from: data[i][0],
            type: data[i][1],
            payload: data[i][2],
            timestamp: data[i][3]
          });
        }
      }

      ctx.externalMessages[name] = inbox;
    });

  } catch (e) {
    ctx.externalMessages = { error: "externalMessages 読み込み失敗: " + e.message };
  }


  // -----------------------------
  // 11. キャッシュ保存
  // -----------------------------
  try {
    props.setProperty(CACHE_KEY, JSON.stringify(ctx));
    props.setProperty(CACHE_TIME_KEY, Date.now().toString());
  } catch (e) {
    // キャッシュ保存失敗は無視
  }

  return ctx;
}　