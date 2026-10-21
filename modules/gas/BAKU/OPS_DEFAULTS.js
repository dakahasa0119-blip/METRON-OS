function OPS_ApplyBakuRecommendedDefaults() {
  const p = PropertiesService.getScriptProperties();
  const defaults = {
    BAKU_WORKER_ID: p.getProperty("BAKU_WORKER_ID") || ("baku-node-" + Utilities.getUuid().slice(0, 8)),
    BAKU_USE_SIGNATURE: "false",
    BAKU_ALLOW_REBUILD: "false",
    BAKU_MAX_LOOP_JOBS: "6"
  };

  // Do not overwrite auth secrets.
  const secretKeys = ["ARC_AUTH_KEY", "BAKU_WORKER_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"];
  Object.keys(defaults).forEach((k) => {
    if (k === "GATEWAY_WEBAPP_URL" || k === "BAKU_WORKER_ID") {
      p.setProperty(k, defaults[k]);
      return;
    }
    if (!p.getProperty(k)) p.setProperty(k, defaults[k]);
  });

  const after = p.getProperties();
  return {
    status: "ok",
    updated_keys: ["BAKU_WORKER_ID", "BAKU_USE_SIGNATURE", "BAKU_ALLOW_REBUILD", "BAKU_MAX_LOOP_JOBS"],
    untouched_secret_keys: secretKeys,
    applied: {
      GATEWAY_WEBAPP_URL: after.GATEWAY_WEBAPP_URL || "",
      BAKU_WORKER_ID: after.BAKU_WORKER_ID || "",
      BAKU_USE_SIGNATURE: after.BAKU_USE_SIGNATURE || "",
      BAKU_ALLOW_REBUILD: after.BAKU_ALLOW_REBUILD || "",
      BAKU_MAX_LOOP_JOBS: after.BAKU_MAX_LOOP_JOBS || ""
    }
  };
}
