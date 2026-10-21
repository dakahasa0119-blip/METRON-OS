/**
 * BAKU_UI_Server.js
 * BAKU Universal Salvage & Evolution Dashboard Backend
 */

function doGet(e) {
    var template = HtmlService.createTemplateFromFile('BAKU_Dashboard');
    return template.evaluate()
        .setTitle('BAKU Universal Salvage Engine')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * 共通デザインのインクルード用
 */
function includeFile(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Dead Jobs / Deploy Queue 件数の取得
 */
function getQueueStats() {
    try {
        var res = BAKU_GATEWAY.postGateway_("gateway_memory_search", {
            query: "baku:deploy_queue:",
            limit: 100
        });

        var jobsRes = BAKU_GATEWAY.fetchDeadJobs_(100);

        return {
            status: "ok",
            deployQueue: (res && res.rows) ? res.rows.length : 0,
            deadJobs: (jobsRes && jobsRes.jobs) ? jobsRes.jobs.length : 0
        };
    } catch (e) {
        return { status: "error", error: e.message };
    }
}

/**
 * DNA Vault の総取得件数と一部リストを取得
 */
function getDNAStats() {
    try {
        var installed = BAKU.getInstalledDNA_() || [];
        var knownFunctions = BAKU.knownFunctions ? Array.from(BAKU.knownFunctions.keys()) : [];

        return {
            status: "ok",
            installedCount: installed.length,
            knownTotalCount: knownFunctions.length,
            recent: installed.slice(0, 10)
        };
    } catch (e) {
        return { status: "error", error: e.message };
    }
}

/**
 * METRON_EVO 世代情報と最新履歴
 */
function getEvolutionStats() {
    try {
        var currentGen = METRON_GENERATIONS ? METRON_GENERATIONS.getCurrentGeneration() : 1;
        var history = METRON_GENERATIONS ? METRON_GENERATIONS.getGenerationHistory() : [];

        return {
            status: "ok",
            currentGeneration: currentGen,
            historyCount: history.length,
            recentHistory: history.slice(-5)
        };
    } catch (e) {
        return { status: "error", error: e.message };
    }
}

/**
 * UIからの手動抽出指令（Target URL入力による直接DNA解析）
 * Gateway非依存の独立機能
 */
function manualTargetExtract(targetUrl) {
    try {
        if (!targetUrl) return { status: "error", error: "No URL provided." };

        // Driveフォルダか、GASスクリプトIDかを簡易判定
        var extractId = targetUrl.match(/[-\w]{25,}/);
        if (!extractId) return { status: "error", error: "Invalid URL format." };
        var targetId = extractId[0];

        // BAKU SalvageEngine に流し込む（1ファイルのみ直接解析としてラップ）
        // 通常の Drive.Files.list() ではなく直接指定
        var fileRes = DriveApp.getFileById(targetId);
        var mime = fileRes.getMimeType();

        BAKU.knownKeys = BAKU.loadMemory_(BAKU.TARGET_ID);
        BAKU.processFileWithStreaming_({
            id: targetId,
            version: "manual_" + Date.now(),
            mimeType: mime,
            name: fileRes.getName()
        });

        return { status: "ok", message: "Extracted Target ID: " + targetId + " [" + fileRes.getName() + "]" };
    } catch (e) {
        return { status: "error", error: e.message };
    }
}

/**
 * UIからの手動修復トリガー
 */
function manualProcessDeadJobs() {
    try {
        if (typeof BAKU_SessionSalvager !== "undefined") {
            BAKU_SessionSalvager.processDeadJobs();
            return { status: "ok", message: "Dead Job Salvage Process triggered successfully." };
        } else {
            return { status: "error", error: "BAKU_SessionSalvager is undefined." };
        }
    } catch (e) {
        return { status: "error", error: e.message };
    }
}

/**
 * UIからの手動進化/自己再構築トリガー
 */
function manualTriggerEvolution() {
    try {
        if (typeof METRON_EVO !== "undefined" && typeof METRON_EVO.SelfRebuild !== "undefined") {
            var res = METRON_EVO.SelfRebuild.selfRebuildOS("CREATOR");
            return { status: "ok", result: res };
        } else {
            return { status: "error", error: "METRON_EVO SelfRebuild engine is missing." };
        }
    } catch (e) {
        return { status: "error", error: e.message };
    }
}
