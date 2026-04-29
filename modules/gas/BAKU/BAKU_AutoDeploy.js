/**
 * 🚀 BAKU v8.0 — Auto Deployment Engine
 * - Periodically scans `baku:deploy_queue:` from Gateway Long Memory
 * - Executes GAS deployments asynchronously to prevent blocking Gateway POST requests
 * - Cleans up old deployments (keeping only the recent ones)
 * - Sends feedback to MotherShip App_Registry when deployment completes
 */

var BAKU_AutoDeploy = {

    processDeployQueue: function () {
        console.log("🚀 BAKU Auto Deploy: Scanning deployment queue...");
        try {
            // Fetch queue items from Gateway Long Memory
            var res = BAKU_GATEWAY.postGateway_("gateway_memory_search", {
                query: "baku:deploy_queue:",
                limit: 5 // Process a few at a time to avoid timeout
            });

            if (!res || res.status !== "ok" || !res.rows || res.rows.length === 0) {
                console.log("No deployment items in queue.");
                return 0;
            }

            var processedCount = 0;

            for (var i = 0; i < res.rows.length; i++) {
                var row = res.rows[i];
                var key = row.key;
                var payloadStr = row.value;

                try {
                    var payload = JSON.parse(payloadStr);
                    var success = this.deployAppScript_(payload.scriptId, payload.resultContent, payload.traceId);

                    if (success) {
                        console.log("🚀 Successfully deployed: " + payload.scriptId);
                        // Notify MotherShip of successful deployment
                        this.notifyMotherShip_(payload.scriptId);
                    } else {
                        console.warn("⚠️ Failed to deploy: " + payload.scriptId);
                    }

                    // Remove processed item from queue (Memory Delete not explicitly in API, so we overwrite with empty/expire or just let it TTL if set. Assuming gateway_memory_put with empty value clears it or we can just leave it if TTL handles it. For now, we overwrite with an empty value to mark as processed.)
                    BAKU_GATEWAY.postGateway_("gateway_memory_put", {
                        key: key,
                        value: "",
                        source: "baku_autodeploy",
                        tags: '["processed"]'
                    });

                } catch (pe) {
                    console.warn("Failed to parse/process queue payload: " + pe.message);
                }

                processedCount++;
            }

            return processedCount;
        } catch (e) {
            console.warn("🚀 BAKU Auto Deploy Error: " + e.message);
            return 0;
        }
    },

    deployAppScript_: function (targetScriptId, resultText, traceId) {
        try {
            var token = ScriptApp.getOAuthToken();
            if (!token) {
                console.warn("No OAuth Token available for deployment.");
                return false;
            }

            var files = [];
            var fileRegex = /---\s*FILE:\s*([a-zA-Z0-9_\-\.]+)\s*---\s*```[a-z]*\n([\s\S]*?)\n```/g;
            var match;
            while ((match = fileRegex.exec(resultText)) !== null) {
                var fileName = match[1].trim();
                var fileContent = match[2];
                var nameParts = fileName.split('.');
                if (nameParts.length < 2) continue;
                var typeStr = nameParts[nameParts.length - 1].toLowerCase();
                var fileType = "SERVER_JS";
                if (typeStr === 'html') fileType = "HTML";
                else if (typeStr === 'json') fileType = "JSON";

                files.push({
                    name: nameParts.slice(0, -1).join('.'),
                    type: fileType,
                    source: fileContent
                });
            }

            if (files.length === 0) {
                console.warn("No valid files found for deployment.");
                return false;
            }

            var contentUrl = "https://script.googleapis.com/v1/projects/" + targetScriptId + "/content";
            var fetchContentRes = UrlFetchApp.fetch(contentUrl, {
                method: "get",
                headers: { Authorization: "Bearer " + token },
                muteHttpExceptions: true
            });

            var existingFiles = [];
            if (fetchContentRes.getResponseCode() === 200) {
                var contentData = JSON.parse(fetchContentRes.getContentText());
                existingFiles = contentData.files || [];
            }

            var hasManifest = files.some(function (f) { return f.name === 'appsscript'; });
            if (!hasManifest) {
                var existingManifest = existingFiles.find(function (f) { return f.name === 'appsscript'; });
                if (existingManifest) {
                    files.push(existingManifest);
                }
            }

            var putPayload = { files: files };
            var putRes = UrlFetchApp.fetch(contentUrl, {
                method: "put",
                contentType: "application/json",
                headers: { Authorization: "Bearer " + token },
                payload: JSON.stringify(putPayload),
                muteHttpExceptions: true
            });

            if (putRes.getResponseCode() >= 300) {
                console.warn("Failed to PUT code: " + putRes.getContentText());
                return false;
            }

            var versionsUrl = "https://script.googleapis.com/v1/projects/" + targetScriptId + "/versions";
            var verRes = UrlFetchApp.fetch(versionsUrl, {
                method: "post",
                contentType: "application/json",
                headers: { Authorization: "Bearer " + token },
                payload: JSON.stringify({ description: "Auto-deployed by BAKU at " + new Date().toISOString() }),
                muteHttpExceptions: true
            });

            if (verRes.getResponseCode() >= 300) {
                console.warn("Failed to create Version: " + verRes.getContentText());
                return false;
            }

            var versionData = JSON.parse(verRes.getContentText());
            var versionNumber = versionData.versionNumber;

            var deploymentsUrl = "https://script.googleapis.com/v1/projects/" + targetScriptId + "/deployments";
            var depsRes = UrlFetchApp.fetch(deploymentsUrl, {
                method: "get",
                headers: { Authorization: "Bearer " + token },
                muteHttpExceptions: true
            });

            var currentDeploymentId = null;
            var deploymentsList = [];
            if (depsRes.getResponseCode() === 200) {
                var dData = JSON.parse(depsRes.getContentText());
                deploymentsList = dData.deployments || [];
                var existingWebDep = deploymentsList.find(function (d) { return d.deploymentConfig && d.deploymentConfig.versionNumber; });
                if (existingWebDep) {
                    currentDeploymentId = existingWebDep.deploymentId;
                }
            }

            if (currentDeploymentId) {
                var updateUrl = "https://script.googleapis.com/v1/projects/" + targetScriptId + "/deployments/" + currentDeploymentId;
                var updatePayload = {
                    deploymentConfig: {
                        versionNumber: versionNumber,
                        description: "Auto-deployed by BAKU at " + new Date().toISOString()
                    }
                };
                var updateRes = UrlFetchApp.fetch(updateUrl, {
                    method: "put",
                    contentType: "application/json",
                    headers: { Authorization: "Bearer " + token },
                    payload: JSON.stringify(updatePayload),
                    muteHttpExceptions: true
                });
                if (updateRes.getResponseCode() >= 300) {
                    console.warn("Failed to update deployment: " + updateRes.getContentText());
                }
            } else {
                var createPayload = {
                    versionNumber: versionNumber,
                    description: "Initial Auto-deploy by BAKU"
                };
                var createRes = UrlFetchApp.fetch(deploymentsUrl, {
                    method: "post",
                    contentType: "application/json",
                    headers: { Authorization: "Bearer " + token },
                    payload: JSON.stringify(createPayload),
                    muteHttpExceptions: true
                });
                if (createRes.getResponseCode() >= 300) {
                    console.warn("Failed to create deployment: " + createRes.getContentText());
                } else {
                    var newData = JSON.parse(createRes.getContentText());
                    currentDeploymentId = newData.deploymentId;
                }
            }

            // Cleanup old versions
            var verListRes = UrlFetchApp.fetch(versionsUrl, {
                method: "get",
                headers: { Authorization: "Bearer " + token },
                muteHttpExceptions: true
            });

            if (verListRes.getResponseCode() === 200) {
                var vData = JSON.parse(verListRes.getContentText());
                var allVersions = vData.versions || [];
                if (allVersions.length > 20) {
                    allVersions.sort(function (a, b) { return a.versionNumber - b.versionNumber; });
                    var toDelete = allVersions.slice(0, allVersions.length - 20);
                    var deleteRequests = [];
                    for (var i = 0; i < toDelete.length; i++) {
                        var v = toDelete[i];
                        var delUrl = "https://script.googleapis.com/v1/projects/" + targetScriptId + "/versions/" + v.versionNumber;
                        deleteRequests.push({
                            url: delUrl,
                            method: "delete",
                            headers: { Authorization: "Bearer " + token },
                            muteHttpExceptions: true
                        });
                    }

                    var deletedCount = 0;
                    if (deleteRequests.length > 0) {
                        var deleteResponses = UrlFetchApp.fetchAll(deleteRequests);
                        for (var j = 0; j < deleteResponses.length; j++) {
                            if (deleteResponses[j].getResponseCode() < 300) {
                                deletedCount++;
                            }
                        }
                    }
                    console.log("Deleted " + deletedCount + " old versions.");
                }
            }

            return true;
        } catch (e) {
            console.warn("Deployment Exception: " + e.toString());
            return false;
        }
    },

    notifyMotherShip_: function (scriptId) {
        // Find the Web App URL if possible, or just send a success status
        var webAppUrl = "https://script.google.com/macros/s/" + scriptId + "/exec"; // Approximation if we don't have deploymentId handy in this exact scope

        // Use MotherShip queue to notify
        BAKU_GATEWAY.postGateway_("mothership_submit", {
            user: "baku_autodeploy",
            content: "[@metron] DEPLOY_COMPLETE " + scriptId + " " + webAppUrl
        });
    }
};

function BAKU_RunAutoDeploy() {
    BAKU_AutoDeploy.processDeployQueue();
}
