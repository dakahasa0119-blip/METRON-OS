function OPS_ApplyGatewayRecommendedDefaults() {
  const p = PropertiesService.getScriptProperties();
  const defaults = {
    ARC_DEFAULT_ROUTE: "ARC",
    ARC_DEFAULT_EXECUTOR: "AUTO",
    ARC_DEFAULT_TARGET: "chatgpt",
    ARC_REPAIR_EXECUTOR: "BAKU",
    ARC_LEASE_TIMEOUT_SEC: "300",
    ARC_MAX_RETRY: "2",
    ARC_RETRY_BACKOFF_SEC: "30",
    ARC_AUDIT_RETENTION_DAYS: "14",
    ARC_ENABLE_BAKU_FOLLOWUP: "true",
    ARC_AUTONOMY_PAUSED: "false",
    ARC_DEAD_JOB_ALERT_THRESHOLD: "20",
    ARC_LEASED_ALERT_THRESHOLD: "50",
    ARC_REQUIRE_SIGNATURE: "false",
    ARC_SIGNATURE_WINDOW_SEC: "180",
    ARC_NONCE_TTL_SEC: "300"
  };

  // Keep existing secrets untouched.
  const secretKeys = ["ARC_AUTH_KEY", "SUBMIT_AUTH_KEY", "ARC_WORKER_AUTH_MAP", "MOTHERSHIP_WORKER_AUTH_MAP"];
  const before = p.getProperties();
  Object.keys(defaults).forEach((k) => p.setProperty(k, defaults[k]));

  const after = p.getProperties();
  return {
    status: "ok",
    updated_keys: Object.keys(defaults).sort(),
    untouched_secret_keys: secretKeys,
    applied: Object.keys(defaults).reduce((acc, k) => { acc[k] = after[k] || ""; return acc; }, {})
  };
}
