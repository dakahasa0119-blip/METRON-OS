/**
 * 🚀 METRON OS Launcher
 * GAS の「実行」メニューに表示される入口関数
 */

/** OS 自己再構築モードを実行 */
function METRON_Rebuild() {
  const result = METRON_EVO.selfRebuildOS();
  Logger.log(result);
}

/** 自律進化ループを実行 */
function METRON_Patrol() {
  METRON_AUTO_EVO.patrol();
}

/** システム地図を生成してログに出す */
function METRON_Map() {
  const map = METRON_ARCHITECT.generateSystemMap();
  Logger.log(map);
}

/** BAKU のフルスキャンを実行（サルベージ） */
function BAKU_FullScan() {
  BAKU.fullScan();
}

/** Gatewayへのheartbeat確認 */
function BAKU_GatewayHeartbeat_Launcher() {
  return BAKU_GatewayHeartbeat();
}

/** Gatewayジョブを1件処理 */
function BAKU_ProcessGatewayJob_Launcher() {
  return BAKU_ProcessGatewayJob();
}

/** Gatewayジョブをまとめて処理 */
function BAKU_RunGatewayLoop_Launcher() {
  return BAKU_RunGatewayLoop();
}

/** Gateway連携の1分トリガーを再作成 */
function BAKU_SetupGatewayTrigger_Launcher() {
  return BAKU_SetupGatewayTrigger();
}
