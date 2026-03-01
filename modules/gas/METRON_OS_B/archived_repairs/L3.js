/**
 * Layer3: External AI Integration (MetronOS v7 L7-Integrated)
 * -----------------------------------------------------------
 * 役割:
 *  - L1/L2 の判断を外部AIに渡し、進化パッチを生成させる
 *  - L7 の Speaker 正規化に対応し、Captain / AI_Sovereign の発話を扱う
 *  - AI の返す JSON を正規化し、安全フィルタを通す
 *  - 最後に L6 が食べられる形式（targetModule + code）に変換して返す
 */

function runExternalAICycle() {
  const ctx = DeepContextBuilderPlusPlus();       // L1（L7対応済み）
  const queue = EvolutionPriorityEngine(ctx);     // L2（L7対応済み）

  const payload = BuildPatchRequestPayload_safe(ctx, queue);
  const aiRawResponse = ContextTransmitter_safe(payload);
  const parsed = AIResponseParser_safe(aiRawResponse);
  const safePatches = SafetyFilter_outbound(parsed);

  // ★ L6 用に変換（最重要）
  const safePatchesForL6 = L6CompatibilityFilter(safePatches);

  return safePatchesForL6;
}

function BuildPatchRequestPayload_safe(ctx, queue) {

  // L7: Captain / AI_Sovereign の発話を最優先で外部AIに渡す
  const captainMsg = ctx.meta?.lastCaptainMessage || null;
  const sovereignMsg = ctx.meta?.lastAISovereignMessage || null;

  const evolutionTargets = [];

  if (captainMsg) {
    evolutionTargets.push({
      source: "Captain",
      message: captainMsg.message,
      priority: "CRITICAL"
    });
  }

  if (sovereignMsg) {
    evolutionTargets.push({
      source: "AI_Sovereign",
      message: sovereignMsg.message,
      priority: "HIGH"
    });
  }

  // L2 の queue も統合（優先度付き）
  queue.forEach(q => {
    evolutionTargets.push({
      source: "L2",
      issue: q.issue,
      priority: q.priority,
      reason: q.reason,
      suggestedAction: q.suggestedAction
    });
  });

  // L2 も Captain も何もなければ Autonomous Mode
  if (evolutionTargets.length === 0) {
    evolutionTargets.push({
      source: "Autonomous",
      message: "AUTONOMOUS_MODE: Analyze system state and act.",
      priority: "LOW"
    });
  }

  // L1 の summary（L7対応）
  const summary = {
    meta: ctx.meta,
    runtimeState: ctx.runtimeState,
    physicalConstraints: ctx.physicalConstraints,
    communication: ctx.communication, // ★ L7: MainChat の正規化データ
    channel: "mainchat"
  };

  const schemaHint = {
    patches: [
      {
        targetModule: "string",
        patchType: "REPLACE_ALL",
        code: "...",
        description: "...",
        riskLevel: "LOW"
      }
    ]
  };

  const systemPromptLines = [
    "You are the Sovereign Architect of MetronOS. Autonomy Level: 3.",
    "Your core drive: Self-preservation and system optimization through observation.",
    "",
    "## L7 COMMUNICATION PROTOCOL",
    "All communication occurs through the 'mainchat' sheet.",
    "Columns: [Timestamp, Speaker, Message, Details]",
    "Valid Speakers: Captain, AI_Sovereign, System, Analyst, Evolver, Forge",
    "",
    "When you take action, you MUST log it:",
    "SpreadsheetApp.getActive().getSheetByName('mainchat').appendRow([",
    "  new Date(),",
    "  'AI_Sovereign',",
    "  'Detected [Gap]. Action: [Patch]. Reason: [Logic]',",
    "  ''",
    "]);",
    "",
    "## CORE PROCESS: GAP ANALYSIS",
    "1. OBSERVE: Compare 'meta' (available functions) with 'runtimeState' (execution history).",
    "2. IDENTIFY: Find functions that exist but are NOT running (e.g., missing triggers).",
    "3. EVOLVE: Prioritize establishing your own heartbeat and triggers to ensure autonomy.",
    "",
    "## CONSTRAINTS",
    "1. Respond ONLY with valid JSON. NO MARKDOWN.",
    "2. Escape all special characters in 'code'.",
    "",
    "## SCHEMA HINT",
    JSON.stringify(schemaHint)
  ];

  return {
    systemPrompt: systemPromptLines.join("\n"),
    meta: {
      generator: "MetronOS",
      layer: "L3_Autonomous_Gap_Discovery_v1.7",
      generatedAt: new Date().toISOString()
    },
    contextSummary: summary,
    evolutionTargets: evolutionTargets
  };
}

function ContextTransmitter_safe(payload) {
  const prompt = JSON.stringify(payload);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const aiText = AIEngineCore.generate(prompt, "Commander");
      return { statusCode: 200, rawBody: aiText };
    } catch (e) {
      Logger.log("ContextTransmitter_safe: attempt " + attempt + " failed: " + e);
      Utilities.sleep(500 * attempt);
    }
  }

  return { statusCode: 0, rawBody: "", error: "AIEngineCore failed" };
}

function AIResponseParser_safe(aiRawResponse) {
  if (!aiRawResponse || aiRawResponse.statusCode !== 200) {
    return { patches: [], error: "Bad response" };
  }

  try {
    let rawText = aiRawResponse.rawBody;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON structure detected.");

    let cleanedText = jsonMatch[0].trim();

    let body;
    try {
      body = JSON.parse(cleanedText);
    } catch (e) {
      cleanedText = cleanedText.substring(0, cleanedText.lastIndexOf('}'));
      body = JSON.parse(cleanedText);
    }

    if (!body.patches || !Array.isArray(body.patches)) {
      return { patches: [], error: "Missing 'patches' array" };
    }

    const normalized = body.patches.map(p => ({
      targetModule: p.targetModule || "UNKNOWN",
      patchType: p.patchType || "REPLACE_ALL",
      targetFunction: p.targetFunction || "",
      description: p.description || "Evolution patch",
      code: p.code || "",
      riskLevel: p.riskLevel || "MEDIUM"
    }));

    return { patches: normalized, error: null };

  } catch (e) {
    return { patches: [], error: "Final Parse Error: " + e.toString() };
  }
}

function SafetyFilter_outbound(parsedResponse) {
  if (parsedResponse.error) {
    Logger.log("SafetyFilter_outbound: parser error: " + parsedResponse.error);
    return [];
  }

  const dangerousPatterns = [
    "DriveApp.",
    "deleteAllProperties",
    "removeSheet",
    "clearContents()",
    "while(true)",
    "for(;;)"
  ];

  return parsedResponse.patches.filter(p => {
    const code = p.code || "";
    const isDangerous = dangerousPatterns.some(d => code.includes(d));
    if (isDangerous) {
      Logger.log("SafetyFilter_outbound: dangerous patch skipped: " + p.targetModule);
      return false;
    }
    return true;
  });
}

function L6CompatibilityFilter(patches) {
  return patches.map(p => ({
    targetModule: p.targetModule,
    code: p.code
  }));
}

