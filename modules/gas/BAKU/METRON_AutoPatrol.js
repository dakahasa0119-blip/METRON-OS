/**
 * 🌐 METRON Auto Patrol Loop — v8.0 完全統合版
 * Drive 全域サルベージ → DNA_INSTALL → Rebuild → EVO → Patrol
 * すべてを 1 本のループで自動実行する
 */

function METRON_AutoPatrol() {
  console.log("🌐 AutoPatrol: 開始");

  // Universe 情報
  const universe = BAKU.getUniverse_();
  const ss = SpreadsheetApp.openById(universe.registry);
  const sheet = ss.getSheetByName("BAKU_DNA_VAULT");

  // Vault の既存行数（更新判定に使う）
  const beforeCount = sheet.getLastRow();

  // ----------------------------------------
  // 1. Drive 全域サルベージ（DNA 抽出）
  // ----------------------------------------
  console.log("🔍 Step1: Drive 全域サルベージ");
  const newDNA = BAKU.fullScan();   // v8.0: fullScan は DNA 配列を返す

  // ----------------------------------------
  // 2. DNA_INSTALL（Vault へ書き込み）
  // ----------------------------------------
  console.log("🧬 Step2: DNA_INSTALL");
  METRON_DNA_INSTALL(newDNA);

  // Vault 更新判定
  const afterCount = sheet.getLastRow();
  const added = afterCount - beforeCount;

  if (added > 0) {
    console.log(`🟩 新しいDNAを ${added} 個インストール`);
  } else {
    console.log("🟦 新しいDNAなし（Vault更新なし）");
  }

  // ----------------------------------------
  // 3. Rebuild（OS コア再生成）
  //    ※ v8.0 では METRON_EVO.SelfRebuild.selfRebuildOS()
  // ----------------------------------------
  if (added > 0) {
    console.log("⚙️ Step3: SelfRebuild（METRON_CORE 再生成）");

    const rebuild = METRON_EVO.SelfRebuild.selfRebuildOS();
    if (rebuild.success) {
      console.log(`🚀 SelfRebuild 成功 → 世代 ${rebuild.generation}`);
    } else {
      console.warn("⚠️ SelfRebuild 失敗:", rebuild.error);
    }
  } else {
    console.log("🟦 Rebuild スキップ（DNA 変化なし）");
  }

  // ----------------------------------------
  // 4. EVO（進化ループ）
  //    ※ v8.0 の正しい順番は EVO → Patrol
  // ----------------------------------------
  console.log("🧩 Step4: AUTO_EVO（進化ループ）");
  if (typeof METRON_AUTO_EVO !== "undefined" &&
      typeof METRON_AUTO_EVO.patrol === "function") {
    METRON_AUTO_EVO.patrol();
  } else {
    console.warn("⚠️ METRON_AUTO_EVO.patrol が見つからないためスキップ");
  }

  // ----------------------------------------
  // 5. Patrol（監視ループ）
  // ----------------------------------------
  console.log("🛰 Step5: METRON_Patrol（監視）");
  if (typeof METRON_Patrol === "function") {
    METRON_Patrol();
  } else {
    console.warn("⚠️ METRON_Patrol が見つからないためスキップ");
  }

  console.log("🌐 AutoPatrol: 完了");
}