function createGatewayBakuExternalCodeModule(ctx) {
  const c = ctx || {};

  const autoIngestManifest = (mem) => {
    const m = mem && typeof mem === "object" ? mem : {};
    const key = c.norm(m.key);
    const val = c.norm(m.value);
    const source = c.norm(m.source || "gateway_memory_put");
    const tags = c.parseTagList(m.tags);
    const namespaceOk = c.hasTag(tags, "namespace:baku_external_code_return");
    const typeManifest = c.hasTag(tags, "type:manifest") || (key.indexOf("baku:external_code_return:") === 0 && key.indexOf(":manifest") >= 0);
    if (!namespaceOk || !typeManifest) return { status: "skip", reason: "not_external_code_manifest" };
    if (!val) return { status: "error", error: "manifest_value_empty" };

    let manifest = {};
    try { manifest = JSON.parse(val); } catch (_) { return { status: "error", error: "manifest_parse_failed" }; }
    const returnId = c.norm(manifest.return_id);
    const candidateId = c.norm(manifest.candidate_id);
    const correlationId = c.norm(manifest.correlation_id);
    const outcome = c.norm(manifest.outcome);
    const chunkKeys = Array.isArray(manifest.chunk_keys) ? manifest.chunk_keys.map((x) => c.norm(x)).filter((x) => !!x) : [];
    if (!returnId) return { status: "error", error: "manifest_return_id_missing" };
    if (chunkKeys.length <= 0) return { status: "error", error: "manifest_chunk_keys_missing", return_id: returnId };

    let rebuilt = "";
    let found = 0;
    for (let i = 0; i < chunkKeys.length; i++) {
      const rows = c.getGatewayLongMemory(chunkKeys[i], 1);
      if (!rows || !rows[0]) continue;
      rebuilt += c.norm(rows[0].value);
      found++;
    }
    const expected = chunkKeys.length;
    const ingestStatus = found === expected ? "ok" : "partial";
    const note = ingestStatus === "ok" ? "manifest_ingested" : ("chunk_missing " + found + "/" + expected);
    const codeHash = rebuilt ? c.digestHex(rebuilt) : "";
    const codeCell = rebuilt.slice(0, 50000);

    const sh = c.sheets.bakuExternalCodeInbox;
    const recent = c.readRecentRows(sh, 14, 1200);
    let rowIndex = -1;
    for (let i = recent.rows.length - 1; i >= 0; i--) {
      if (c.norm(recent.rows[i][1]) !== returnId) continue;
      rowIndex = recent.startRow + i;
      break;
    }
    const row = [
      new Date(),
      returnId,
      candidateId,
      correlationId,
      outcome,
      source,
      key,
      expected,
      found,
      rebuilt.length,
      codeHash,
      ingestStatus,
      note,
      codeCell
    ];
    if (rowIndex > 0) sh.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);

    c.addAudit(c.norm(m.trace_id), "BAKU_EXTERNAL_CODE_INGEST", candidateId || returnId, c.norm(m.worker_id), ingestStatus, note);
    return {
      status: "ok",
      return_id: returnId,
      candidate_id: candidateId,
      correlation_id: correlationId,
      ingest_status: ingestStatus,
      chunk_count_expected: expected,
      chunk_count_found: found,
      code_chars: rebuilt.length,
      code_hash: codeHash
    };
  };

  const listInbox = (limitRaw, returnIdRaw) => {
    const n = c.clamp(c.parseIntSafe(limitRaw, 20), 1, 200);
    const rid = c.norm(returnIdRaw);
    const rows = c.readRecentRows(c.sheets.bakuExternalCodeInbox, 14, 1500).rows;
    const out = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const item = {
        timestamp: r[0],
        return_id: c.norm(r[1]),
        candidate_id: c.norm(r[2]),
        correlation_id: c.norm(r[3]),
        outcome: c.norm(r[4]),
        source: c.norm(r[5]),
        manifest_key: c.norm(r[6]),
        chunk_expected: c.parseIntSafe(r[7], 0),
        chunk_found: c.parseIntSafe(r[8], 0),
        code_chars: c.parseIntSafe(r[9], 0),
        code_hash: c.norm(r[10]),
        ingest_status: c.norm(r[11]),
        note: c.norm(r[12])
      };
      if (rid && item.return_id !== rid) continue;
      out.push(item);
      if (out.length >= n) break;
    }
    return { status: "ok", count: out.length, items: out };
  };

  const getExternalCodeReturn = (manifestKeyRaw, returnIdRaw, limitRaw) => {
    const limit = c.clamp(c.parseIntSafe(limitRaw, 1), 1, 3);
    const manifestKey = c.norm(manifestKeyRaw).slice(0, c.MAX_MEMORY_KEY);
    const returnId = c.norm(returnIdRaw).slice(0, 40);
    let manifestRow = null;

    if (manifestKey) {
      const rows = c.getGatewayLongMemory(manifestKey, 1);
      if (rows && rows[0]) manifestRow = rows[0];
    } else if (returnId) {
      const q = "namespace:baku_external_code_return type:manifest return_id:" + returnId;
      const rows = c.searchGatewayLongMemory(q, { limit: limit, scan: 1200 });
      if (rows && rows[0]) manifestRow = rows[0];
    } else {
      return { ok: false, error: "manifest_key_or_return_id_required" };
    }

    if (!manifestRow) return { ok: false, error: "manifest_not_found" };

    let manifest = {};
    try { manifest = JSON.parse(c.norm(manifestRow.value || "{}")); } catch (_) { manifest = {}; }
    const chunkKeys = Array.isArray(manifest.chunk_keys) ? manifest.chunk_keys.map((x) => c.norm(x)).filter((x) => !!x) : [];
    const chunks = [];
    let rebuilt = "";
    for (let i = 0; i < chunkKeys.length; i++) {
      const k = chunkKeys[i];
      const rows = c.getGatewayLongMemory(k, 1);
      const item = rows && rows[0] ? rows[0] : null;
      const text = item ? String(item.value || "") : "";
      chunks.push({
        key: k,
        index: i + 1,
        found: !!item,
        chars: text.length
      });
      if (item) rebuilt += text;
    }

    return {
      ok: true,
      manifest_key: String(manifestRow.key || manifestKey),
      manifest: manifest,
      chunk_count_expected: chunkKeys.length,
      chunk_count_found: chunks.filter((x) => x.found).length,
      chunks: chunks,
      repaired_code: rebuilt
    };
  };

  return {
    autoIngestManifest: autoIngestManifest,
    listInbox: listInbox,
    getExternalCodeReturn: getExternalCodeReturn
  };
}
