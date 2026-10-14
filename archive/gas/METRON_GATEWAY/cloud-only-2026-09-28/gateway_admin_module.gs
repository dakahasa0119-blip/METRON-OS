function createGatewayAdminModule(ctx) {
  const c = ctx || {};

  const buildGatewayOpsMetrics = () => {
    const recentJobs = c.readRecentRows(c.sheets.jobs, 7, 400).rows;
    const recentMain = c.readRecentRows(c.sheets.main, 6, 300).rows;
    const recentErrors = c.readRecentRows(c.sheets.errors, 4, 200).rows;
    const recentAudit = c.readRecentRows(c.sheets.audit, 7, 300).rows;

    const doneOrErrRows = recentMain.filter((r) => {
      const st = c.lower(r[3]);
      return st === "arc_done" || st === "arc_error";
    });
    let doneCount = 0;
    let errorCount = 0;
    for (let i = 0; i < doneOrErrRows.length; i++) {
      const st = c.lower(doneOrErrRows[i][3]);
      if (st === "arc_done") doneCount++;
      else if (st === "arc_error") errorCount++;
    }
    const totalTerminated = doneCount + errorCount;
    const doneRate = totalTerminated > 0 ? Number((doneCount / totalTerminated).toFixed(3)) : null;

    let timeoutErr = 0;
    for (let i = 0; i < recentErrors.length; i++) {
      const typeTxt = c.upper(recentErrors[i][2]);
      const dataTxt = c.upper(recentErrors[i][3]);
      if (
        typeTxt.indexOf("LEASE_EXPIRE_MAX") >= 0 ||
        typeTxt.indexOf("PENDING_TIMEOUT") >= 0 ||
        dataTxt.indexOf("LEASE_EXPIRE_MAX") >= 0 ||
        dataTxt.indexOf("PENDING_TIMEOUT") >= 0
      ) {
        timeoutErr++;
      }
    }
    const timeoutRate = totalTerminated > 0 ? Number((timeoutErr / totalTerminated).toFixed(3)) : null;

    let compactAuditExtra = 0;
    let compactErrorExtra = 0;
    for (let i = 0; i < recentAudit.length; i++) {
      const rep = c.parseRepeatCount(recentAudit[i][6]);
      if (rep > 1) compactAuditExtra += (rep - 1);
    }
    for (let i = 0; i < recentErrors.length; i++) {
      const rep = c.parseRepeatCount(recentErrors[i][3]);
      if (rep > 1) compactErrorExtra += (rep - 1);
    }

    let staleLeasedCount = 0;
    const nowMs = Date.now();
    for (let i = 0; i < recentJobs.length; i++) {
      const row = recentJobs[i];
      if (c.lower(row[5]) !== "leased") continue;
      const leaseTs = c.toMs(row[6] || row[0]);
      if (!Number.isFinite(leaseTs)) continue;
      if (nowMs - leaseTs >= c.leaseTimeoutMs) staleLeasedCount++;
    }

    return {
      sample_main_terminal: totalTerminated,
      done_rate_recent: doneRate,
      timeout_error_count_recent: timeoutErr,
      timeout_rate_recent: timeoutRate,
      compact_saved_rows_recent: compactAuditExtra + compactErrorExtra,
      compact_saved_audit_recent: compactAuditExtra,
      compact_saved_error_recent: compactErrorExtra,
      stale_leased_recent: staleLeasedCount
    };
  };

  return {
    buildGatewayOpsMetrics: buildGatewayOpsMetrics
  };
}
