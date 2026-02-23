#!/usr/bin/env node
'use strict';

const norm = (v) => String(v || '').trim();
const lower = (v) => norm(v).toLowerCase();
const upper = (v) => norm(v).toUpperCase();

function claimNextInstruction(rows, workerId, consumer) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowWorker = norm(row.worker);
    const rowMode = norm(row.mode) || 'request_arc';
    const status = lower(row.status);
    if (status !== 'pending') continue;

    if (rowWorker && (!workerId || rowWorker !== workerId)) continue;

    let payload = {};
    try {
      payload = row.payload || {};
    } catch (_) {
      payload = { raw: String(row.payload || '') };
    }
    const wanted = upper(payload.executor || 'AUTO');
    const mine = upper(consumer || 'ARC');
    if (wanted !== 'AUTO' && wanted !== mine) continue;

    row.status = 'leased';
    row.leasedAt = 'now';
    if (!rowWorker && workerId) row.worker = workerId;
    return { mode: rowMode, job_id: norm(row.jobId), ...payload };
  }
  return null;
}

function assertEq(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name}: expected=${expected} actual=${actual}`);
  }
}

(function run() {
  const rows = [
    { jobId: 'J1', worker: '', mode: 'request_arc', status: 'pending', payload: { executor: 'BAKU' } },
    { jobId: 'J2', worker: '', mode: 'request_arc', status: 'pending', payload: { executor: 'ARC' } },
    { jobId: 'J3', worker: '', mode: 'request_arc', status: 'pending', payload: { executor: 'AUTO' } },
    { jobId: 'J4', worker: 'baku-node-02', mode: 'request_arc', status: 'pending', payload: { executor: 'BAKU' } },
  ];

  const arcLease = claimNextInstruction(rows, 'arc-node-01', 'ARC');
  assertEq('ARC first lease should not steal BAKU job', arcLease.job_id, 'J2');

  const bakuLease = claimNextInstruction(rows, 'baku-node-01', 'BAKU');
  assertEq('BAKU should receive BAKU job', bakuLease.job_id, 'J1');

  const bakuPinnedMismatch = claimNextInstruction(rows, 'baku-node-01', 'BAKU');
  assertEq('BAKU should receive AUTO before mismatched pinned worker', bakuPinnedMismatch.job_id, 'J3');

  const bakuPinnedMatch = claimNextInstruction(rows, 'baku-node-02', 'BAKU');
  assertEq('Pinned BAKU worker should receive its own job', bakuPinnedMatch.job_id, 'J4');

  const none = claimNextInstruction(rows, 'arc-node-01', 'ARC');
  assertEq('No pending jobs remain', none, null);

  console.log('PASS: gateway claimNextInstruction routing checks');
})();
