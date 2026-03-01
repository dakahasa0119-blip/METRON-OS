/**
 * レイヤー2: 意思決定エンジン（L7整合版）
 * - L7 の Speaker 正規化に対応
 * - Captain（人間）の命令を最優先で扱う
 * - AI_Sovereign の自己進化要求を HIGH で扱う
 * - 従来の diffInsights / runtimeState / anomalyProfile も統合
 */

function EvolutionPriorityEngine(ctx) {

  const queue = [];

  // ============================================================
  // 0. L7: Captain（人間）の命令を最優先で扱う
  // ============================================================
  if (ctx.meta?.lastCaptainMessage) {
    queue.push({
      target: "Human_Command",
      issue: "CAPTAIN_REQUEST",
      priority: "CRITICAL",
      reason: "Captain issued a direct instruction",
      message: ctx.meta.lastCaptainMessage.message,
      suggestedAction: "L3 should interpret and execute"
    });
  }

  // ============================================================
  // 1. L7: AI_Sovereign の自己進化要求を HIGH で扱う
  // ============================================================
  if (ctx.meta?.lastAISovereignMessage) {
    queue.push({
      target: "AI_Sovereign",
      issue: "AI_SELF_DIRECTED_TASK",
      priority: "HIGH",
      reason: "AI_Sovereign proposed a self-evolution task",
      message: ctx.meta.lastAISovereignMessage.message,
      suggestedAction: "L3 should evaluate feasibility"
    });
  }

  // ============================================================
  // 2. FATAL: System Crash
  // ============================================================
  if (ctx.runtimeState?.lastError?.fatal) {
    queue.push({
      target: "System_Core",
      issue: "FATAL_CRASH",
      priority: "CRITICAL",
      reason: "致命的エラー検出: " + ctx.runtimeState.lastError.message,
      suggestedAction: "緊急修正またはロールバック"
    });
  }

  // ============================================================
  // 3. Time Limit Risk (GAS 360秒)
  // ============================================================
  const MAX_EXEC = 360;
  const MARGIN = 0.8;

  if (ctx.runtimeState?.executionTime > MAX_EXEC * MARGIN) {
    queue.push({
      target: "Performance_Tuner",
      issue: "TIME_LIMIT_RISK",
      priority: "CRITICAL",
      reason:
        "実行時間が限界の " +
        (ctx.runtimeState.executionTime / MAX_EXEC * 100).toFixed(1) + "%",
      suggestedAction: "処理分割・遅延実行化"
    });
  }

  // ============================================================
  // 4. Context Overflow（L3 のトークン破産対策）
  // ============================================================
  try {
    const tokens = JSON.stringify(ctx).length / 4;
    const TOKEN_LIMIT = 100000;

    if (tokens > TOKEN_LIMIT) {
      queue.push({
        target: "DCBPP_Core",
        issue: "CONTEXT_OVERFLOW",
        priority: "CRITICAL",
        reason: "コンテキストサイズ過大 (" + Math.round(tokens) + " tokens)",
        suggestedAction: "要約強化・古いログの切り捨て"
      });
    }
  } catch (e) {
    queue.push({
      target: "DCBPP_Core",
      issue: "CONTEXT_SIZE_CHECK_ERROR",
      priority: "HIGH",
      reason: "サイズ計測失敗: " + e.toString(),
      suggestedAction: "JSON構造の検証"
    });
  }

  // ============================================================
  // 5. Pending Overflow
  // ============================================================
  if (ctx.runtimeState?.pendingEvolutions > 10) {
    queue.push({
      target: "Forge_Staging",
      issue: "PENDING_OVERFLOW",
      priority: "HIGH",
      reason: "pending が閾値を超過",
      suggestedAction: "承認フローの最適化"
    });
  }

  // ============================================================
  // 6. Trigger Delay（L5 が治せる → LOW）
  // ============================================================
  if (ctx.runtimeState?.heartbeats) {
    Object.keys(ctx.runtimeState.heartbeats).forEach(handler => {
      const hb = ctx.runtimeState.heartbeats[handler];
      if (hb?.jitterSeconds > hb.expectedIntervalSeconds * 2) {
        queue.push({
          target: handler,
          issue: "TRIGGER_DELAY",
          priority: "LOW",
          reason: "心拍遅延（L5で復旧可能）",
          suggestedAction: "負荷分散または処理分割"
        });
      }
    });
  }

  // ============================================================
  // 7. diffInsights（強化版）
  // ============================================================
  if (ctx.diffInsights?.code) {
    ctx.diffInsights.code.forEach(diff => {

      if (diff.interpretation === "MODULE_TOO_LARGE") {
        queue.push({
          target: diff.module,
          issue: "MODULE_BLOAT",
          priority: "HIGH",
          reason: "行数が期待値の1.5倍以上",
          suggestedAction: "モジュール分割"
        });
      }

      if (diff.interpretation === "UNUSED_CODE") {
        queue.push({
          target: diff.module,
          issue: "UNUSED_CODE",
          priority: "MEDIUM",
          reason: "未使用コードの存在",
          suggestedAction: "削除または整理"
        });
      }

      if (diff.interpretation === "DEAD_BRANCH") {
        queue.push({
          target: diff.module,
          issue: "DEAD_BRANCH",
          priority: "MEDIUM",
          reason: "到達不能コード",
          suggestedAction: "削除または整理"
        });
      }

      if (diff.interpretation === "HIGH_COMPLEXITY") {
        queue.push({
          target: diff.module,
          issue: "HIGH_COMPLEXITY",
          priority: "HIGH",
          reason: "複雑度が高すぎる",
          suggestedAction: "関数分割・リファクタリング"
        });
      }
    });
  }

  // ============================================================
  // 8. Unnatural Silence（L5 が拾える → LOW）
  // ============================================================
  if (ctx.anomalyProfile?.entropyAnalysis) {
    Object.keys(ctx.anomalyProfile.entropyAnalysis).forEach(key => {
      const e = ctx.anomalyProfile.entropyAnalysis[key];
      if (e?.interpretation === "UNNATURAL_SILENCE") {
        queue.push({
          target: key,
          issue: "UNNATURAL_SILENCE",
          priority: "LOW",
          reason: "エントロピー低下（L5で検知可能）",
          suggestedAction: "ログ出力の見直し"
        });
      }
    });
  }

  // ============================================================
  // 9. L0（物理層）で触ってはいけない領域を除外
  // ============================================================
  const forbidden = [
    "runEvolutionKernel",
    "runHealingKernel",
    "initializeMetronOS",
    "Kernel"
  ];

  const filtered = queue.filter(q => !forbidden.includes(q.target));

  // ============================================================
  // 10. 優先度順にソート
  // ============================================================
  const priorityMap = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

  return filtered.sort((a, b) => priorityMap[a.priority] - priorityMap[b.priority]);
}
