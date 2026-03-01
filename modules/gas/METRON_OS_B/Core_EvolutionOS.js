/******************************************************
 * METRON OS - Core Evolution OS
 * 本物の AI OS を目指す中核モジュール
 * - UserProfile 管理（個人 / 業務）
 * - Drive 構造の統合
 * - 進化案 / 進化記録の統合
 * - 自律改善 v2（文脈対応）
 * - SystemGuardian（仕様変更監視の土台）
 * - AppForge（アプリ排出の入口）
 *
 * 既存の母艦（SystemLog, Injection_Slot など）と連携し、
 * initializeMotherShip / runMidnightEvolution から呼び出す想定。
 ******************************************************/


/******************************************************
 * 0. 共通定数・シート定義
 ******************************************************/

// プロファイル関連
const USER_PROFILE_SHEET = "User_Profiles";
const USER_PROFILE_HEADER = [
  "ProfileID",
  "表示名",
  "種別",        // 個人 / 業務
  "会社名",
  "所属",
  "業種タグ",
  "メモ",
  "有効フラグ"
];

const SYSTEM_CONFIG_SHEET = "System_Config";
const SYSTEM_CONFIG_HEADER = ["キー", "値"];

const CONFIG_KEY_ACTIVE_PROFILE_ID = "ACTIVE_PROFILE_ID";

// SystemLog（既に母艦に存在している前提）
const SYSTEM_LOG_SHEET = "SystemLog";
const SYSTEM_LOG_HEADER = ["記録日時", "種別", "活動内容"];

// Injection_Slot（進化案ストア）
const INJECTION_SLOT_NAME = "Injection_Slot";
const INJECTION_SLOT_HEADER = ["記録日時", "ターゲット", "ファイル名", "ソースコード", "状態"];

// 進化記録
const EVOLUTION_LOG_SHEET = "Evolution_Log";
const EVOLUTION_LOG_HEADER = [
  "記録日時",
  "種別",          // PATCH / DOC / CONFIG / APP など
  "概要",
  "関連ターゲット",
  "関連ファイルURL",
  "状態",          // APPLIED / ROLLED_BACK / ARCHIVED など
  "メモ"
];


/******************************************************
 * 1. DriveRootManager（配布先でも破綻しない Drive 構造）
 ******************************************************/

const METRON_DRIVE_CONFIG = {
  ROOT_FOLDER_NAME: "METRON_ROOT",
  SUB_FOLDERS: {
    PROPOSALS: "Evolution_Proposals",      // 進化案（Injection_Slot連携）
    LOGS: "Evolution_Logs",                // 適用済み進化ログ
    SELF_IMPROVEMENT: "Self_Improvement",  // 自律改善の企画書
    FORGE: "Forge",                        // 生成コード・排出APP関連
    BACKUPS: "Backups",                    // バックアップ
    HISTORY: "History"                     // 古い企画書や過去ログ
  }
};

/**
 * METRON_ROOT とサブフォルダ一式を安全に用意する。
 * - スプレッドシート単位で1セット
 * - 配布先のユーザー環境ごとに自分の Drive に構築される
 */
function ensureMetronDriveStructure() {
  const root = getOrCreateMetronRoot_();
  const subFolders = {};

  Object.keys(METRON_DRIVE_CONFIG.SUB_FOLDERS).forEach(key => {
    subFolders[key] = getOrCreateSubFolder_(root, METRON_DRIVE_CONFIG.SUB_FOLDERS[key]);
  });

  announce("METRON_ROOT および進化関連フォルダ構造を確認しました。", "SYSTEM");
  return {
    root,
    subFolders
  };
}

function getOrCreateMetronRoot_() {
  const name = METRON_DRIVE_CONFIG.ROOT_FOLDER_NAME;
  const it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();

  const folder = DriveApp.createFolder(name);
  announce("METRON_ROOT フォルダを新規作成しました。", "SYSTEM");
  return folder;
}

function getOrCreateSubFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  const folder = parent.createFolder(name);
  announce(`METRON_ROOT 配下にサブフォルダ ${name} を新規作成しました。`, "SYSTEM");
  return folder;
}


/******************************************************
 * 2. シート安全取得ユーティリティ
 ******************************************************/

function getSheetSafe_(name, headerRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headerRow && headerRow.length > 0) {
      sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow])
        .setBackground("#f3f3f3")
        .setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
    announce(`シート ${name} を新規作成しました。`, "SYSTEM");
  }
  return sheet;
}

function getConfigValue_(key) {
  const sheet = getSheetSafe_(SYSTEM_CONFIG_SHEET, SYSTEM_CONFIG_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if ((values[i][0] || "").toString() === key) {
      return values[i][1] || null;
    }
  }
  return null;
}

function setConfigValue_(key, value) {
  const sheet = getSheetSafe_(SYSTEM_CONFIG_SHEET, SYSTEM_CONFIG_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    sheet.appendRow([key, value]);
    return;
  }
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if ((values[i][0] || "").toString() === key) {
      sheet.getRange(2 + i, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}


/******************************************************
 * 3. UserProfileManager（個人 / 業務用プロファイル）
 ******************************************************/

/**
 * プロファイルを新規作成
 * type: "個人" or "業務"
 */
function createUserProfile(profile) {
  const sheet = getSheetSafe_(USER_PROFILE_SHEET, USER_PROFILE_HEADER);
  const profileId = Utilities.getUuid();
  const row = [
    profileId,
    profile.displayName || "",
    profile.type || "個人",
    profile.companyName || "",
    profile.department || "",
    profile.industryTag || "",
    profile.memo || "",
    true
  ];
  sheet.appendRow(row);

  // 作成直後のプロファイルをアクティブにするオプション
  if (profile.setActive) {
    setConfigValue_(CONFIG_KEY_ACTIVE_PROFILE_ID, profileId);
    announce(`新しいプロファイルを作成し、アクティブに設定しました。（${row[1]}）`, "SYSTEM");
  } else {
    announce(`新しいプロファイルを作成しました。（${row[1]}）`, "SYSTEM");
  }

  return profileId;
}

/**
 * 現在のアクティブプロファイル情報を取得
 */
function getActiveUserProfile() {
  const activeId = getConfigValue_(CONFIG_KEY_ACTIVE_PROFILE_ID);
  if (!activeId) return null;

  const sheet = getSheetSafe_(USER_PROFILE_SHEET, USER_PROFILE_HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, USER_PROFILE_HEADER.length).getValues();
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if ((row[0] || "").toString() === activeId && row[7] === true) {
      return {
        profileId: row[0],
        displayName: row[1],
        type: row[2],         // 個人 / 業務
        companyName: row[3],
        department: row[4],
        industryTag: row[5],
        memo: row[6]
      };
    }
  }
  return null;
}

/**
 * アクティブプロファイルを切り替え
 */
function switchActiveUserProfile(profileId) {
  setConfigValue_(CONFIG_KEY_ACTIVE_PROFILE_ID, profileId);
  announce(`アクティブプロファイルを切り替えました。（${profileId}）`, "SYSTEM");
}

/**
 * UI からの呼び出し想定：
 * 初期設定画面で「個人 / 業務」＋ 会社名などを入れてプロファイル作成
 */
function uiCreateInitialProfile(type, companyName, department, displayName, industryTag) {
  const name =
    displayName ||
    (type === "業務"
      ? `${companyName || "未設定"} ${department || ""}`.trim()
      : "個人利用");

  const id = createUserProfile({
    displayName: name,
    type: type,
    companyName: companyName || "",
    department: department || "",
    industryTag: industryTag || "",
    memo: "",
    setActive: true
  });

  return id;
}


/******************************************************
 * 4. ProposalOrchestrator（進化案統合）
 ******************************************************/

/**
 * 進化案を Injection_Slot に登録
 * - プロファイル込みで重複抑制
 *
 * proposal = {
 *   target: "どのモジュールか",
 *   fileName: "提案ドキュメントやコード名",
 *   sourceCode: "コード or 要約テキスト",
 *   status: "NEW" など
 * }
 */
function registerEvolutionProposal(proposal) {
  const sheet = getSheetSafe_(INJECTION_SLOT_NAME, INJECTION_SLOT_HEADER);
  const lastRow = sheet.getLastRow();
  const data = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, INJECTION_SLOT_HEADER.length).getValues()
    : [];

  const activeProfile = getActiveUserProfile();
  const profileKey = activeProfile ? activeProfile.profileId : "GLOBAL";

  const key = buildProposalKey_(proposal, profileKey);

  const exists = data.some(row => {
    const rowTarget = row[1] || "";
    const rowFileName = row[2] || "";
    const rowSource = row[3] || "";
    const rowKey = buildProposalKey_(
      {
        target: rowTarget,
        fileName: rowFileName,
        sourceCode: rowSource
      },
      profileKey
    );
    return rowKey === key;
  });

  if (exists) {
    announce(`進化案は既に存在するため、新規登録をスキップしました。（${proposal.target} / ${proposal.fileName}）`, "SYSTEM");
    return;
  }

  const now = new Date();
  const row = [
    now,
    `[${profileKey}] ${proposal.target || ""}`,
    proposal.fileName || "",
    proposal.sourceCode || "",
    proposal.status || "NEW"
  ];
  sheet.appendRow(row);
  announce(`進化案を Injection_Slot に登録しました。（${proposal.target} / ${proposal.fileName} / ${profileKey}）`, "SYSTEM");
}

function buildProposalKey_(proposal, profileKey) {
  return [
    profileKey || "GLOBAL",
    (proposal.target || "").trim(),
    (proposal.fileName || "").trim(),
    (proposal.sourceCode || "").trim()
  ].join("::");
}


/******************************************************
 * 5. EvolutionLogManager（進化記録統合）
 ******************************************************/

function logEvolutionEvent(event) {
  const sheet = getSheetSafe_(EVOLUTION_LOG_SHEET, EVOLUTION_LOG_HEADER);
  const now = new Date();
  const activeProfile = getActiveUserProfile();
  const profileTag = activeProfile ? `[${activeProfile.profileId}]` : "[GLOBAL]";

  const row = [
    now,
    event.type || "",
    profileTag + " " + (event.summary || ""),
    event.target || "",
    event.fileUrl || "",
    event.status || "",
    event.note || ""
  ];
  sheet.appendRow(row);
  announce(`進化記録を Evolution_Log に追加しました。（${event.type} / ${event.summary}）`, "SYSTEM");
}


/******************************************************
 * 6. SelfImprovementEngine_v2（自律改善 × 文脈対応）
 ******************************************************/

/**
 * 自律改善エントリポイント
 * - SystemLog を見て「エラー傾向 × プロファイル文脈」から提案を1件だけ生成
 */
function runSelfImprovementV2() {
  const folders = ensureMetronDriveStructure();
  const selfImprovementFolder = folders.subFolders.SELF_IMPROVEMENT;

  const sysSheet = getSheetSafe_(SYSTEM_LOG_SHEET, SYSTEM_LOG_HEADER);
  const lastRow = sysSheet.getLastRow();
  if (lastRow <= 1) {
    announce("自律改善: SystemLog に十分なデータがないため、提案生成をスキップしました。", "SYSTEM");
    return;
  }

  const N = 80;
  const startRow = Math.max(2, lastRow - N + 1);
  const numRows = lastRow - startRow + 1;
  const logs = sysSheet.getRange(startRow, 1, numRows, SYSTEM_LOG_HEADER.length).getValues();

  // エラー / 異常 系だけを抽出（新しい順）
  const errorLogs = logs.filter(row => {
    const type = (row[1] || "").toString();
    return type.indexOf("ERROR") !== -1 || type.indexOf("異常") !== -1;
  });

  if (errorLogs.length === 0) {
    announce("自律改善: 新たなエラー傾向が見つからなかったため、提案生成をスキップしました。", "SYSTEM");
    return;
  }

  const pick = errorLogs[errorLogs.length - 1];
  const issueSummary = (pick[2] || "").toString().slice(0, 300);

  const activeProfile = getActiveUserProfile();
  const profileContext = buildProfileContextText_(activeProfile);

  const proposal = {
    target: "SelfImprovementEngine_v2",
    fileName: `自律改善提案_${formatDateForFileName_(new Date())}`,
    sourceCode:
      "【プロファイル文脈】\n" +
      profileContext +
      "\n\n【SystemLog における最近の異常傾向】\n" +
      issueSummary +
      "\n\n【タスク】\n" +
      "上記の文脈を踏まえ、この環境に最適化された改善案と、必要であればコードレベルの修正案を設計すること。",
    status: "NEW"
  };

  registerEvolutionProposal(proposal);

  const doc = getOrCreateImprovementDoc_(selfImprovementFolder, proposal.fileName);
  doc.getBody().appendParagraph(
    Utilities.formatString(
      "[%s] 自律改善提案\n\n【プロファイル文脈】\n%s\n\n【Issue 概要】\n%s\n\n【次のステップ】\n- Auditor: 原因分析と設計\n- Engineer: 対策モジュールの実装案\n- Orchestrator: 適用と Evolution_Log への記録\n",
      new Date(),
      profileContext,
      issueSummary
    )
  );

  logEvolutionEvent({
    type: "DOC",
    summary: "自律改善提案ドキュメントを生成",
    target: proposal.target,
    fileUrl: doc.getUrl(),
    status: "APPLIED",
    note: proposal.fileName
  });

  announce("自律改善エンジンv2: 新しい提案を生成しました。", "SYSTEM");
}

function buildProfileContextText_(profile) {
  if (!profile) {
    return "プロファイル未設定（GLOBALモード）。個人 / 業務の区別なく、汎用的な改善を行う。";
  }
  if (profile.type === "個人") {
    return Utilities.formatString(
      "利用種別: 個人\n表示名: %s\nメモ: %s\n",
      profile.displayName || "未設定",
      profile.memo || ""
    );
  }
  return Utilities.formatString(
    "利用種別: 業務\n会社名: %s\n所属: %s\n業種タグ: %s\n表示名: %s\nメモ: %s\n",
    profile.companyName || "未設定",
    profile.department || "未設定",
    profile.industryTag || "未設定",
    profile.displayName || "",
    profile.memo || ""
  );
}

function getOrCreateImprovementDoc_(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  if (files.hasNext()) {
    return DocumentApp.openById(files.next().getId());
  }
  const doc = DocumentApp.create(fileName);
  const file = DriveApp.getFileById(doc.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  return doc;
}

function formatDateForFileName_(date) {
  const y = date.getFullYear();
  const m = ("0" + (date.getMonth() + 1)).slice(-2);
  const d = ("0" + date.getDate()).slice(-2);
  const h = ("0" + date.getHours()).slice(-2);
  const min = ("0" + date.getMinutes()).slice(-2);
  return `${y}${m}${d}_${h}${min}`;
}


/******************************************************
 * 7. SystemGuardian（仕様変更監視の土台）
 *   ※ ここはまず土台だけ。後で具体的なブラウジング戦略を一緒に詰める。
 ******************************************************/

function runSystemGuardianDaily() {
  // TODO: 実際には Web から GAS や Google API の変更情報を取得して解析する想定。
  // この段階では「フック」として SystemLog に記録だけしておく。
  logToSystem_(
    "CONTROL",
    "SystemGuardian: 仕様変更監視サイクルを実行（将来的にブラウジング＆解析をここに実装）"
  );
}

function logToSystem_(type, message) {
  const sheet = getSheetSafe_(SYSTEM_LOG_SHEET, SYSTEM_LOG_HEADER);
  const now = new Date();
  sheet.appendRow([now, `[${type}]`, message]);
}


/******************************************************
 * 8. AppForge（「◯◯のアプリ作って」の入口だけ）
 *   実際のテンプレ生成ロジックは、次のフェーズで一緒に設計する。
 ******************************************************/

/**
 * チャットから呼ばれる想定のエントリ：
 * requestText 例: 「在庫管理アプリ作って」「勤怠管理アプリ作って」
 */
function requestAppForge(requestText) {
  const folders = ensureMetronDriveStructure();
  const forgeFolder = folders.subFolders.FORGE;
  const activeProfile = getActiveUserProfile();
  const profileContext = buildProfileContextText_(activeProfile);

  const appName = deriveAppNameFromRequest_(requestText);

  // ここではまだ「設計ドキュメント」を出すだけ。
  // 実際のシート構造・Webアプリ生成は次のステップで詳細化する。
  const docName = `AppForge_設計_${appName}_${formatDateForFileName_(new Date())}`;
  const doc = getOrCreateForgeDoc_(forgeFolder, docName);
  doc.getBody().appendParagraph(
    Utilities.formatString(
      "[%s] AppForge 要求\n\n【リクエスト】\n%s\n\n【プロファイル文脈】\n%s\n\n【タスク】\n- 必要なデータ構造（シート構成）を設計\n- 必要な画面（UI）と Webアプリ機能を設計\n- 利用者の文脈（個人 / 業務 / 業種）に合わせて最適化\n",
      new Date(),
      requestText,
      profileContext
    )
  );

  logEvolutionEvent({
    type: "APP",
    summary: `AppForgeリクエスト: ${appName}`,
    target: "AppForge",
    fileUrl: doc.getUrl(),
    status: "NEW",
    note: requestText
  });

  announce(`AppForge リクエストを受理し、設計ドキュメントを生成しました。（${appName}）`, "SYSTEM");
}

function deriveAppNameFromRequest_(text) {
  if (!text) return "新規アプリ";
  return text.replace(/アプリ作って/g, "").replace(/作って/g, "").trim() || "新規アプリ";
}

function getOrCreateForgeDoc_(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  if (files.hasNext()) {
    return DocumentApp.openById(files.next().getId());
  }
  const doc = DocumentApp.create(fileName);
  const file = DriveApp.getFileById(doc.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  return doc;
}


/******************************************************
 * 9. EvolutionPipeline（全体統合の入口）
 ******************************************************/

function runEvolutionPipeline() {
  ensureMetronDriveStructure();
  runSelfImprovementV2();
  // 将来的には Proposal のマージや Forge 実行などをここに追加する
  announce("EvolutionPipeline の1サイクルを実行しました。", "SYSTEM");
}