function openMotherShipAdmin() {
  const html = HtmlService.createHtmlOutputFromFile("MotherShip_Admin")
    .setTitle("METRON MotherShip Admin");
  SpreadsheetApp.getUi().showSidebar(html);
}

function getAppRegistryList() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Registry");
  const values = sheet.getDataRange().getValues();
  const list = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    list.push({
      row: i + 1,
      name: row[1],
      mode: row[4],
      version: row[5],
      flag: row[7]
    });
  }
  return list;
}
/**
 * ============================================================
 *  updateAppFromRegistry(rowIndex)
 *  App_Registry の指定行の排出APPを最新テンプレートで再構成する
 * ============================================================
 * @param {number} rowIndex - App_Registry の行番号（ヘッダを1として、2行目なら2）
 */
function updateAppFromRegistry(rowIndex) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Registry");
  const row = sheet.getRange(rowIndex, 1, 1, 8).getValues()[0];

  const appName = row[1];       // B列: アプリ名
  const appId = row[2];       // C列: スプレッドシートID
  const level = row[3];       // D列: テンプレートレベル
  const mode = row[4];       // E列: モード

  // 最新テンプレートを取得
  const TEMPLATE_CORE = getTemplate("TEMPLATE_CORE");
  const TEMPLATE_DATA = getTemplate("TEMPLATE_DATA");
  const TEMPLATE_UI = getTemplate("TEMPLATE_UI");
  const TEMPLATE_CSS = getTemplate("TEMPLATE_CSS");
  const TEMPLATE_INTEGRATION = getTemplate("TEMPLATE_INTEGRATION");
  const TEMPLATE_STANDALONE = getTemplate("TEMPLATE_STANDALONE");
  const configContent = buildConfig(appName, level, mode); // AppForgeから流用

  // ARC (手足) に実体化を依頼するプロンプトを構築
  const arcPrompt = `
スプレッドシート [ ${appId} ] にバインドされた Apps Script プロジェクトを最新テンプレートで上書き更新せよ。
コードの内容は必ず下記で指定された内容をそのまま一言一句変えずに使用すること。

【ファイル仕様】
--- FILE: App_Config.gs ---
\`\`\`javascript
${configContent}
\`\`\`

--- FILE: App_Core.gs ---
\`\`\`javascript
${TEMPLATE_CORE}
\`\`\`

--- FILE: App_Data.gs ---
\`\`\`javascript
${TEMPLATE_DATA}
\`\`\`

--- FILE: App_Integration.gs ---
\`\`\`javascript
${TEMPLATE_INTEGRATION}
\`\`\`

--- FILE: App_Standalone.gs ---
\`\`\`javascript
${TEMPLATE_STANDALONE}
\`\`\`

--- FILE: App_UI.html ---
\`\`\`html
${TEMPLATE_UI}
\`\`\`

--- FILE: App_Styles.css ---
\`\`\`css
${TEMPLATE_CSS}
\`\`\`
`;

  try {
    if (typeof METRON_GATEWAY_BRIDGE !== 'undefined') {
      METRON_GATEWAY_BRIDGE.enqueueArcJob("gemini", arcPrompt, "", "request_app_deployment");
      announce(`MotherShip: [${appName}] のアップデートジョブをARC(Phase 6 Pipeline)に委譲しました。SSID: ${appId}`, "SYSTEM");

      // ジョブ投下成功時にフラグを暫定クリアする
      sheet.getRange(rowIndex, 6).setValue(getTemplateVersion()); // F列: VERSION
      sheet.getRange(rowIndex, 8).setValue("");                   // H列: UPDATE_FLAG クリア
    } else {
      announce(`MotherShip: ARCへの委譲に失敗。ブリッジが存在しません。`, "ERROR");
    }
  } catch (e) {
    announce(`MotherShip: ARC委譲エラー: ${e.message}`, "ERROR");
  }
}
function updateAllApps() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Registry");
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    const flag = values[i][7];
    if (flag === "UPDATE_AVAILABLE") {
      updateAppFromRegistry(i + 1);
    }
  }
}
function getMotherShipLogs() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Logs");
  const values = sheet.getDataRange().getValues();
  const list = [];

  for (let i = 1; i < values.length; i++) {
    list.push({
      time: values[i][0],
      app: values[i][1],
      msg: values[i][2]
    });
  }
  return list;
}

/**
 * BAKUからのデプロイ完了通知(DEPLOY_COMPLETE)をログから読み取り、
 * App_Registry の該当アプリを Active に更新する。
 * MotherShip_Admin 上のポーリング等で定期的に呼び出される想定。
 */
function checkDeploymentsFromLogs() {
  const ss = SpreadsheetApp.getActive();
  const logSheet = ss.getSheetByName("App_Logs");
  const regSheet = ss.getSheetByName("App_Registry");

  if (!logSheet || !regSheet) return { status: "error", error: "sheets_missing" };

  const logs = logSheet.getDataRange().getValues();
  const registry = regSheet.getDataRange().getValues();
  let updatedCount = 0;

  // 最近のログを逆順にスキャン（最新100件程度）
  const scanLimit = Math.max(1, logs.length - 100);
  for (let i = logs.length - 1; i >= scanLimit; i--) {
    const msg = String(logs[i][2] || "");
    if (msg.indexOf("DEPLOY_COMPLETE") >= 0) {
      // expected format: "[@metron] DEPLOY_COMPLETE <scriptId> <webAppUrl>"
      const parts = msg.split(" ");
      const scriptId = parts[2];
      const webAppUrl = parts[3] || "";

      if (scriptId) {
        // App_Registry から該当する scriptId を探す (C列: index 2)
        for (let r = 1; r < registry.length; r++) {
          if (String(registry[r][2]) === scriptId) {
            // 現在のフラグ(H列: index 7)を確認し、UPDATE_AVAILABLE などの場合はクリア(稼働中扱い)し、URLを記録する。
            const currentFlag = registry[r][7];
            if (currentFlag !== "Active") {
              regSheet.getRange(r + 1, 8).setValue("Active"); // H列: FLAG
              // I列（必要に応じてURL保存列を追加している場合）にWebAPPのURLを保存することも可
              if (regSheet.getMaxColumns() >= 9) {
                regSheet.getRange(r + 1, 9).setValue(webAppUrl); // I列: URL
              }
              updatedCount++;
            }
          }
        }
      }
    }
  }
  return { status: "ok", updated: updatedCount };
}

/**
 * 指定アプリのプロファイルを返す
 */
function getProfileForApp(appName) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Profiles");
  const values = sheet.getDataRange().getValues();

  const profile = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const key = row[0];
    const value = row[1];
    profile[key] = value;
  }

  return profile;
}
function getAllProfiles() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Profiles");
  const values = sheet.getDataRange().getValues();
  const list = [];

  for (let i = 1; i < values.length; i++) {
    list.push({
      key: values[i][0],
      value: values[i][1]
    });
  }
  return list;
}

function addProfile(key, value) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Profiles");
  sheet.appendRow([key, value]);
}

function deleteProfile(key) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("App_Profiles");
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}
function getMotherShipStats() {
  const ss = SpreadsheetApp.getActive();

  // App_Registry
  const reg = ss.getSheetByName("App_Registry");
  const regValues = reg.getDataRange().getValues();
  const appCount = regValues.length - 1;

  let connected = 0;
  let standalone = 0;
  let updateAvailable = 0;

  for (let i = 1; i < regValues.length; i++) {
    const row = regValues[i];
    if (row[4] === "CONNECTED") connected++;
    if (row[4] === "STANDALONE") standalone++;
    if (row[7] === "UPDATE_AVAILABLE") updateAvailable++;
  }

  // Logs
  const logs = ss.getSheetByName("App_Logs");
  const logCount = logs.getLastRow() - 1;

  // Profiles
  const profiles = ss.getSheetByName("App_Profiles");
  const profileCount = profiles.getLastRow() - 1;

  return {
    appCount,
    connected,
    standalone,
    updateAvailable,
    templateVersion: getTemplateVersion(),
    motherShipVersion: getMotherShipVersion(),
    logCount,
    profileCount
  };
}
/**
 * バックアップ排出先（METRON_History）を取得
 * なければ自動作成する
 */
function getHistoryFolder() {
  const folders = DriveApp.getFoldersByName("METRON_History");

  if (folders.hasNext()) {
    return folders.next();
  }

  // なければ自動作成
  return DriveApp.createFolder("METRON_History");
}
/**
 * 母艦全体をバックアップ（スナップショット）
 */
function backupMotherShip() {
  const ss = SpreadsheetApp.getActive();
  const version = getMotherShipVersion();
  const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd-HHmm");

  const backupName = `MotherShip Backup - ${timestamp} (v${version})`;

  // バックアップ先フォルダ
  const folder = getHistoryFolder();

  // スプレッドシートをコピー
  const file = DriveApp.getFileById(ss.getId());
  const backupFile = file.makeCopy(backupName, folder);

  // バックアップ一覧に記録
  recordBackup(backupName, backupFile.getId());

  return backupName;
}
/**
 * バックアップ一覧に記録
 */
function recordBackup(name, fileId) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName("MotherShip_Backups");

  if (!sheet) {
    sheet = ss.insertSheet("MotherShip_Backups");
    sheet.appendRow(["日時", "名前", "ファイルID"]);
  }

  sheet.appendRow([new Date(), name, fileId]);
}
function getBackupList() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("MotherShip_Backups");
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  const list = [];

  for (let i = 1; i < values.length; i++) {
    list.push({
      time: values[i][0],
      name: values[i][1],
      id: values[i][2]
    });
  }

  return list;
}
/**
 * 排出APPのコードを取得
 */
function getAppCode(appId, fileName) {
  const project = AppsScriptProject.openById(appId);
  const files = project.getFiles();

  for (const f of files) {
    if (f.name === fileName) {
      return f.getContent();
    }
  }
  return "";
}
/**
 * 差分を生成（行単位）
 */
function diffTemplate(appId, templateName, fileName) {
  const mother = getTemplate(templateName).split("\n");
  const app = getAppCode(appId, fileName).split("\n");

  const diffs = [];

  const max = Math.max(mother.length, app.length);

  for (let i = 0; i < max; i++) {
    const m = mother[i] || "";
    const a = app[i] || "";

    if (m !== a) {
      diffs.push({
        line: i + 1,
        mother: m,
        app: a
      });
    }
  }

  return diffs;
}
/**
 * 指定アプリの全テンプレート差分を返す
 */
function getAppDiff(appId) {
  return {
    core: diffTemplate(appId, "TEMPLATE_CORE", "App_Core.gs"),
    data: diffTemplate(appId, "TEMPLATE_DATA", "App_Data.gs"),
    ui: diffTemplate(appId, "TEMPLATE_UI", "App_UI.html"),
    integration: diffTemplate(appId, "TEMPLATE_INTEGRATION", "App_Integration.gs"),
    standalone: diffTemplate(appId, "TEMPLATE_STANDALONE", "App_Standalone.gs")
  };
}
/**
 * UI_Fields の定義を取得（UI 自動生成用）
 */
function getUIFields() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("UI_Fields");
  const values = sheet.getDataRange().getValues();

  const list = [];

  for (let i = 1; i < values.length; i++) {
    list.push({
      field_key: values[i][0],
      label: values[i][1],
      type: values[i][2],
      required: values[i][3],
      options: values[i][4] ? values[i][4].split(",") : [],
      order: values[i][5]
    });
  }

  // 並び順でソート
  list.sort((a, b) => a.order - b.order);

  return list;
}