/**
 * METRON OS - Gateway Bridge
 * 
 * Provides communication utilities for METRON OS to interact with the Gateway, 
 * primarily to dispatch ARC (PROXY-HAND) jobs for physical execution.
 */

var METRON_GATEWAY_BRIDGE = {

    getProps_: function () {
        return PropertiesService.getScriptProperties();
    },

    getGatewayUrl_: function () {
        return String(this.getProps_().getProperty("GATEWAY_WEBAPP_URL") || "").trim();
    },

    getAuthKey_: function () {
        return String(this.getProps_().getProperty("ARC_AUTH_KEY") || "").trim();
    },

    postGateway_: function (mode, payload) {
        var url = this.getGatewayUrl_();
        var auth = this.getAuthKey_();
        if (!url) throw new Error("GATEWAY_WEBAPP_URL is empty");
        if (!auth) throw new Error("ARC_AUTH_KEY is empty");

        var body = Object.assign({}, payload || {}, {
            mode: mode,
            auth_key: auth,
            worker_id: "METRON_OS_CORE"
        });

        try {
            var res = UrlFetchApp.fetch(url, {
                method: "post",
                contentType: "application/json",
                muteHttpExceptions: true,
                payload: JSON.stringify(body)
            });

            var code = res.getResponseCode();
            var text = res.getContentText() || "";
            var json = {};
            try {
                json = JSON.parse(text);
            } catch (_) {
                json = { raw: text };
            }

            if (code < 200 || code >= 300) {
                throw new Error("Gateway HTTP " + code + ": " + text.slice(0, 500));
            }

            if (json && json.status === "error") {
                throw new Error("Gateway API error: " + JSON.stringify(json));
            }

            return json;

        } catch (e) {
            console.error("METRON_GATEWAY_BRIDGE postGateway_ failed: " + e.message);
            throw e;
        }
    },

    /**
     * Enqueues an ARC job into the Gateway's METRON_QUEUE via metron_enqueue_arc
     */
    enqueueArcJob: function (target, prompt, script, arcMode) {
        return this.postGateway_("metron_enqueue_arc", {
            target: target || "gemini",
            prompt: prompt,
            script: script || "",
            arc_mode: arcMode || "request_arc",
            user: "metron_os_core"
        });
    }
};
