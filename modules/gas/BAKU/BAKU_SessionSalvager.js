/**
 * 🌊 BAKU v8.0 — Session Salvager
 * - Periodically scans ARC_DEAD_JOBS from Gateway
 * - Re-queues transient failures
 * - Extracts fatal flaws into GATEWAY_LONG_MEMORY (Civilization Knowledge)
 * - Dispatches ARC repair jobs for external system errors
 */

var BAKU_SessionSalvager = {

    processDeadJobs: function () {
        console.log("🌊 BAKU Session Salvager: Scanning dead jobs...");
        try {
            var res = BAKU_GATEWAY.fetchDeadJobs_(20);
            if (!res || res.status !== "ok" || !res.jobs || res.jobs.length === 0) {
                console.log("No dead jobs found.");
                return;
            }

            var jobsToArchive = [];
            var processedCount = 0;

            for (var i = 0; i < res.jobs.length; i++) {
                var job = res.jobs[i];
                this.handleSingleJob_(job);
                jobsToArchive.push(job.job_id);
                processedCount++;
            }

            if (jobsToArchive.length > 0) {
                var arcRes = BAKU_GATEWAY.archiveDeadJobs_(jobsToArchive);
                console.log("🌊 BAKU Session Salvager: Archived " + arcRes.archived + " dead jobs.");
            }

            return processedCount;
        } catch (e) {
            console.warn("🌊 BAKU Salvage Error: " + e.message);
        }
    },

    handleSingleJob_: function (job) {
        var errType = String(job.error_type || "").toUpperCase();
        var errData = String(job.error_data || "");
        var prompt = String(job.prompt || "");
        var target = String(job.target || "");
        var retryCount = Number(job.retry_count || 0);

        // 1. Transient Errors -> Requeue
        if (this.isTransient_(errType, errData) && retryCount < 2) {
            console.log("Re-queueing transient job: " + job.job_id);
            BAKU_GATEWAY.enqueueArcJob_({
                target: target,
                prompt: "[BAKU Salvage Retry] " + prompt,
                mode: "request_arc",
                user: "baku_salvage"
            });
            return;
        }

        // 2. External System Repair -> Enqueue Repair Job to ARC
        // If it's a script error or API failure, ARC needs to write a patch or fix the script
        if (this.isSystemError_(errType, errData)) {
            console.log("Dispatching ARC repair job for systemic failure: " + job.job_id);
            BAKU_GATEWAY.enqueueArcJob_({
                target: "gemini", // Use a smart default target for repair
                prompt: "The system encountered a fatal script or API error. Task: " + prompt + "\nError details: [" + errType + "] " + errData + "\nPlease analyze this failure and provide a remediation plan or code patch. Move, Don't Copy.",
                mode: "request_arc",
                user: "baku_repair"
            });

            // Also log to long memory
            this.storeLesson_(job, "external_repair_dispatched");
            return;
        }

        // 3. Fatal/Unrecoverable -> Long Memory Lesson
        console.log("Extracting failure lesson for: " + job.job_id);
        this.storeLesson_(job, "fatal_error");
    },

    isTransient_: function (type, data) {
        if (type.indexOf("TIMEOUT") >= 0) return true;
        if (type.indexOf("NETWORK") >= 0) return true;
        if (type.indexOf("TARGET_UNAVAILABLE") >= 0) return true;
        if (type.indexOf("LEASE_EXPIRE") >= 0) return true;
        if (data.indexOf("timeout") >= 0) return true;
        if (data.indexOf("502") >= 0 || data.indexOf("503") >= 0) return true;
        return false;
    },

    isSystemError_: function (type, data) {
        if (type.indexOf("SYNTAX_ERROR") >= 0) return true;
        if (type.indexOf("REFERENCE_ERROR") >= 0) return true;
        if (type.indexOf("JS_EXCEPTION") >= 0) return true;
        if (type.indexOf("API_ERROR") >= 0) return true;
        if (type.indexOf("APP_SCRIPT_ERROR") >= 0) return true;
        if (data.indexOf("is not defined") >= 0) return true;
        if (data.indexOf("Exception") >= 0) return true;
        if (data.indexOf("undefined") >= 0) return true;
        return false;
    },

    storeLesson_: function (job, category) {
        var key = "baku:lesson:" + category + ":" + job.job_id;
        var value = "Failed Task: " + job.prompt + "\nError: [" + job.error_type + "] " + job.error_data + "\nWorker: " + job.failed_worker;
        var tags = {
            domain: "baku_salvage",
            intent: "failure_analysis",
            outcome: category,
            target: job.target
        };
        try {
            BAKU_GATEWAY.putMemory_(key, value, tags, "baku_salvager");
        } catch (e) {
            console.warn("Failed to store lesson: " + e.message);
        }
    }
};

function BAKU_RunDeadJobSalvage() {
    BAKU_SessionSalvager.processDeadJobs();
}
