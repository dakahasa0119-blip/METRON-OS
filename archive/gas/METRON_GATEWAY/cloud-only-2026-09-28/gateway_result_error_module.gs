function createGatewayResultErrorModule(ctx) {
  const c = ctx || {};

  const tryScheduleRetry = (jobId, traceId, errorType, errorData, failedWorker) => {
    const found = c.findJobRowById(jobId);
    if (!found) return { retried: false, reason: "job_not_found" };

    const row = found.row;
    const payload = found.payload;
    const target = c.lower(payload.target || "");
    const errType = c.upper(errorType || "");
    const loginNoRetry = errType.indexOf("LOGIN_REQUIRED") >= 0;
    if (loginNoRetry) {
      return { retried: false, reason: "login_required_no_retry", retry_count: Number(parseInt(c.norm(payload.retry_count) || "0", 10) || 0) };
    }
    const allPipelineNoRetry =
      target === "all" &&
      errType.indexOf("ALL_PIPELINE_FAILED") >= 0;
    if (allPipelineNoRetry) {
      return { retried: false, reason: "all_pipeline_failed_no_retry", retry_count: Number(parseInt(c.norm(payload.retry_count) || "0", 10) || 0) };
    }
    const retryCountRaw = parseInt(c.norm(payload.retry_count) || "0", 10);
    const retryCount = Number.isFinite(retryCountRaw) && retryCountRaw >= 0 ? retryCountRaw : 0;

    if (retryCount >= c.maxRetry) {
      c.markDeadJob(jobId, traceId, failedWorker, errorType, errorData, "retry_exhausted");
      return { retried: false, reason: "retry_exhausted", retry_count: retryCount };
    }

    const nextRetryAt = new Date(Date.now() + c.retryBackoffSec * 1000).toISOString();
    payload.retry_count = retryCount + 1;
    payload.last_error = c.norm(errorType);
    payload.last_error_data = c.norm(errorData).slice(0, 1200);
    payload.next_retry_at = nextRetryAt;

    const retryExec = c.resolveRetryExecutor();
    payload.executor = retryExec.executor;

    const keepWorker = c.lower(payload.pin_worker) === "true";
    c.sheets.jobs.getRange(found.rowIndex, 5).setValue(JSON.stringify(payload));
    c.sheets.jobs.getRange(found.rowIndex, 6).setValue("pending");
    c.sheets.jobs.getRange(found.rowIndex, 7).setValue("");
    if (!keepWorker) c.sheets.jobs.getRange(found.rowIndex, 3).setValue("");

    c.addAudit(
      c.norm(traceId) || c.norm(payload.trace_id),
      "JOB_RETRY_SCHEDULED",
      c.norm(jobId),
      c.norm(failedWorker),
      "pending",
      "retry=" + payload.retry_count + ",executor=" + payload.executor + ",reason=" + retryExec.reason
    );
    return { retried: true, retry_count: payload.retry_count, next_retry_at: nextRetryAt, executor: payload.executor };
  };

  const completeArcJob = (missionId, status) => {
    const found = c.findJobRowById(missionId);
    if (!found) return;
    const row = found.row;
    c.sheets.jobs.getRange(found.rowIndex, 6).setValue(status);
    if (!c.norm(row[6])) c.sheets.jobs.getRange(found.rowIndex, 7).setValue(new Date());
    c.addAudit(c.norm(found.payload.trace_id), "JOB_COMPLETED", c.norm(missionId), c.norm(row[2]), status, "");
  };

  return {
    tryScheduleRetry: tryScheduleRetry,
    completeArcJob: completeArcJob
  };
}
