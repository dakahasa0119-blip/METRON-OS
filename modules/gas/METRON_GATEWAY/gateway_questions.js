/**
 * METRON Gateway v12 – ARC連携 + タグ分岐 + 長期記憶 + 質問キュー
 * 母艦（後で復活） → Gateway（人格＋記憶＋ローカルLLM） → ARC（外界操作）
 */

/* ==================================================
   質問キューシート（母艦復活後のために保持）
================================================== */

function getQuestionSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("AI_Questions");

  if (!sheet) {
    sheet = ss.insertSheet("AI_Questions");
    sheet.appendRow(["QID", "Timestamp", "ShipID", "From", "Question", "Status"]);
  }
  return sheet;
}

function enqueueQuestion(shipId, question, from) {
  const sheet = getQuestionSheet();
  const qid = "Q" + Date.now();

  sheet.appendRow([
    qid,
    new Date(),
    shipId,
    from,
    question,
    "PENDING"
  ]);

  return qid;
}

function handlePendingRequest() {
  const sheet = getQuestionSheet();
  const last = sheet.getLastRow();
  if (last < 2) return { qid: null };

  const data = sheet.getRange(2, 1, last - 1, 6).getValues();

  for (const row of data) {
    if (row[5] === "PENDING") {
      return {
        qid: row[0],
        shipId: row[2],
        question: row[4]
      };
    }
  }
  return { qid: null };
}

function markQuestionSent(qid) {
  const sheet = getQuestionSheet();
  const last = sheet.getLastRow();
  if (last < 2) return;

  const data = sheet.getRange(2, 1, last - 1, 6).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === qid) {
      sheet.getRange(i + 2, 6).setValue("SENT");
      return;
    }
  }
}

/* ==================================================
   長期記憶（人格メモリ）
================================================== */

function getMemorySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("GatewayMemory");

  if (!sheet) {
    sheet = ss.insertSheet("GatewayMemory");
    sheet.appendRow(["Timestamp", "Key", "Value"]);
  }
  return sheet;
}

function saveMemory(key, value) {
  const sheet = getMemorySheet();
  sheet.appendRow([new Date(), key, value]);
}

function loadMemory(key) {
  const sheet = getMemorySheet();
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();

  for (const row of data.reverse()) {
    if (row[1] === key) return row[2];
  }
  return null;
}

/* ==================================================
   Gateway UI / ARC 質問取得
================================================== */

function doGetLegacyGatewayQuestions_(e) {

  // ARC → 質問取得
  if (e && e.parameter && e.parameter.mode === "pending") {
    const result = handlePendingRequest();
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Gateway UI
  return HtmlService.createHtmlOutputFromFile("gateway")
    .setTitle("METRON Gateway v12")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/* ==================================================
   Vision API（ARC → Gateway）
================================================== */

function handleVision(payload) {
  try {
    const prompt = payload.prompt || "画面の中の対象を見つけてください";
    const imageBase64 = payload.image;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt + "。座標を {x: 数値, y: 数値} で返してください。" },
            {
              inline_data: {
                mime_type: "image/png",
                data: imageBase64
              }
            }
          ]
        }
      ]
    };

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent";

    const token = ScriptApp.getOAuthToken(); // OAuth

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(requestBody),
      headers: {
        Authorization: "Bearer " + token
      },
      muteHttpExceptions: true
    });

    const json = JSON.parse(response.getContentText());
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const match = text.match(/x\s*[:=]\s*(\d+).*y\s*[:=]\s*(\d+)/s);

    return {
      x: match ? Number(match[1]) : 0,
      y: match ? Number(match[2]) : 0,
      raw: text
    };

  } catch (e) {
    return { error: e.toString() };
  }
}

/* ==================================================
   MainChat（ARC 結果 / Gateway ログ）
================================================== */

function saveToMainChat(text, type = "INFO") {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("MAIN_CHAT");

  if (!sheet) {
    sheet = ss.insertSheet("MAIN_CHAT");
    sheet.appendRow(["Timestamp", "User", "Content", "Status", "Response", "MissionID"]);
  }

  const status = String(type || "INFO");
  sheet.appendRow([new Date(), "Gateway", String(text || ""), status, "", ""]);
}

function ensureSheet_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0 && header && header.length > 0) {
    sheet.appendRow(header);
  }
  return sheet;
}

function upsertArcNode_(payload) {
  const sheet = ensureSheet_(
    "ARC_NODES",
    ["LastSeen", "IP", "Port", "Status", "Capabilities", "Version"]
  );

  const ip = String(payload.ip || "");
  const port = String(payload.port || "");
  const values = sheet.getDataRange().getValues();
  let foundRow = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1] || "") === ip && String(values[i][2] || "") === port) {
      foundRow = i + 1;
      break;
    }
  }

  const row = [
    new Date(),
    ip,
    port,
    payload.status || "",
    payload.target || "",
    payload.version || ""
  ];

  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function requireArcAuth_(payload) {
  const required = PropertiesService.getScriptProperties().getProperty("ARC_AUTH_KEY");
  if (!required) return true;
  return String(payload.auth_key || "") === String(required);
}

/* ==================================================
   doPost：ARC / ユーザー / 母艦（将来）すべての入口
================================================== */

function doPostLegacyGatewayQuestions_(e) {
  const payload = JSON.parse(e.postData.contents || "{}");

  /* 0) ARC/Gateway: handshake & setup */
  if (payload.mode === "handshake") {
    return respond({ status: "ok", message: "ACK" });
  }
  if (payload.mode === "arc_setup") {
    const sheets = (payload.blueprint && payload.blueprint.sheets) || {};
    Object.keys(sheets).forEach((name) => ensureSheet_(name, sheets[name]));

    const props = PropertiesService.getScriptProperties();
    const current = props.getProperty("ARC_AUTH_KEY");
    const setupKey =
      (payload.blueprint && payload.blueprint.auth_key) ||
      payload.auth_key ||
      "";
    if (!current && setupKey) {
      props.setProperty("ARC_AUTH_KEY", String(setupKey));
    }

    return respond({ status: "ok", message: "Setup Success" });
  }

  if (payload.mode && String(payload.mode).startsWith("arc_")) {
    if (!requireArcAuth_(payload)) {
      return respond({ status: "UNAUTHORIZED" });
    }
  }

  /* ① ARC → Gateway：Vision */
  if (payload.mode === "vision") {
    const result = handleVision(payload);
    return respond(result);
  }

  /* ② ARC → Gateway：外界操作の結果 */
  if (payload.mode === "arc_result") {
    const text = payload.text || payload.result || "";
    const sheet = ensureSheet_(
      "ARC_RESULTS",
      ["Timestamp", "MissionID", "Target", "Prompt", "Result", "ImageURL"]
    );
    sheet.appendRow([
      new Date(),
      payload.qid || "",
      payload.target || "",
      payload.prompt || "",
      text,
      payload.image || ""
    ]);
    saveToMainChat(text, "ARC_RESULT");
    return respond({ status: "ok" });
  }

  /* ②-2 ARC → Gateway：エラー */
  if (payload.mode === "arc_error") {
    const sheet = ensureSheet_("ARC_ERRORS", ["Timestamp", "QID", "Type", "Data"]);
    sheet.appendRow([new Date(), payload.qid || "", payload.error_type || "", payload.data || ""]);
    saveToMainChat(`ARC_ERROR ${payload.error_type || ""} (${payload.qid || ""})`, "ARC_ERROR");
    return respond({ status: "ok" });
  }

  /* ②-3 ARC → Gateway：学習ログ */
  if (payload.mode === "arc_learning") {
    const sheet = ensureSheet_("ARC_LEARNING", ["Timestamp", "Target", "Learned"]);
    sheet.appendRow([new Date(), payload.target || "", payload.learned || ""]);
    return respond({ status: "ok" });
  }

  /* ②-4 ARC → Gateway：heartbeat */
  if (payload.mode === "arc_heartbeat") {
    upsertArcNode_(payload);
    return respond({ status: "ok" });
  }

  /* ②-5 ARC → Gateway：相談（最小実装） */
  if (payload.mode === "arc_consult") {
    return respond({ advice: "" });
  }

  /* ③ ARC → Gateway：質問取得済み */
  if (payload.mode === "sent") {
    markQuestionSent(payload.qid);
    return respond({ status: "ok" });
  }

  /* ④ ユーザー or 母艦 → Gateway：タグ分岐 */
  if (payload.mode === "mainchat") {
    const text = payload.text || "";

    // #ARC → ARC に依頼
    if (text.startsWith("#ARC")) {
      const qid = enqueueQuestion("MOTHERSHIP", text.replace("#ARC", ""), "USER");
      saveToMainChat("ARC依頼: " + text, "ARC_REQUEST");
      return respond({ status: "arc_requested", qid });
    }

    // #LOCAL → ローカルLLM（Ollama）
    if (text.startsWith("#LOCAL")) {
      const answer = runLocalLLM(text.replace("#LOCAL", ""));
      saveToMainChat(answer, "LOCAL_LLM");
      return respond({ status: "ok", answer });
    }

    // タグなし → ローカルLLM
    const answer = runLocalLLM(text);
    saveToMainChat(answer, "LOCAL_LLM");

    // ローカルLLMが「ARCが必要」と判断した場合
    if (needsARC(answer)) {
      const qid = enqueueQuestion("MOTHERSHIP", answer, "LLM");
      return respond({ status: "arc_requested", qid });
    }

    return respond({ status: "ok", answer });
  }

  return respond({ status: "ignored" });
}

/* ==================================================
   Utility
================================================== */

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ==================================================
   ローカルLLM（Ollama）呼び出し
================================================== */

function runLocalLLM(text) {
  // TODO: Ollama API 呼び出し
  return "（Ollama未実装）" + text;
}

function needsARC(answer) {
  // TODO: LLM が「ARCが必要」と判断したときの条件
  return false;
}
