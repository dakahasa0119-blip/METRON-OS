import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { LockedGateway } from "../gateway-jobs/locked-gateway.mjs";

function runChild(source, file, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      ["--input-type=module", "-e", source, file, label],
      { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) reject(new Error("child=" + label + " code=" + code + " " + stderr));
      else resolve(stdout.trim());
    });
  });
}

test("three independent Node processes enqueue without losing writes", { timeout: 25000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "metron-multiprocess-"));
  try {
    const file = join(dir, "gateway.json");
    const source = [
      'import { LockedGateway } from ' + JSON.stringify(
        new URL("../gateway-jobs/locked-gateway.mjs", import.meta.url).href) + ';',
      'const [file,label] = process.argv.slice(1);',
      'const gateway = new LockedGateway(file, { maxWaitMs: 18000, retryMs: 5 });',
      'for(let i = 0; i < 12; i++) {',
      '  await gateway.enqueue(label+"-"+i, { label, i });',
      '}',
      'console.log("ENQUEUED");'
    ].join("\n");

    const responses = await Promise.all(["A", "B", "C"].map(x => runChild(source, file, x)));
    assert.deepEqual(responses, ["ENQUEUED", "ENQUEUED", "ENQUEUED"]);
    const gateway = new LockedGateway(file);
    const snapshot = await gateway.snapshot();
    assert.equal(snapshot.jobs.jobs.length, 36);
    const ids = new Set(snapshot.jobs.jobs.map(job => job.id));
    assert.equal(ids.size, 36);
    for (const who of ["A", "B", "C"]) {
      for (let i = 0; i < 12; i++) {
        assert.deepEqual((await gateway.getJob(who + "-" + i)).payload, { label: who, i });
      }
    }
    // No contender may leave a write-lock directory after orderly exit.
    assert.equal((await gateway.enqueue("after", {})).state, "pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent worker processes claim each queued job only once", { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "metron-claim-lock-"));
  try {
    const file = join(dir, "gateway.json");
    await new LockedGateway(file).enqueue("one", { kind: "work" });
    const source = [
      'import { LockedGateway } from ' + JSON.stringify(
        new URL("../gateway-jobs/locked-gateway.mjs", import.meta.url).href) + ';',
      'const [file,label] = process.argv.slice(1);',
      'const gateway = new LockedGateway(file, { maxWaitMs: 10000, retryMs: 5 });',
      'const claim = await gateway.claim(label);',
      'console.log(claim ? claim.id + ":" + label : "NONE");'
    ].join("\n");
    const values = await Promise.all(["A", "B", "C"].map(x => runChild(source, file, x)));
    assert.equal(values.filter(x => x.startsWith("one:")).length, 1);
    assert.equal(values.filter(x => x === "NONE").length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("abandoned lock fails closed rather than silently discarding state", { timeout: 5000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "metron-lock-failclosed-"));
  try {
    const file = join(dir, "gateway.json");
    const gw = new LockedGateway(file, { maxWaitMs: 70, retryMs: 5 });
    await gw.enqueue("saved", {});
    mkdirSync(gw.lockPath);
    await assert.rejects(() => gw.enqueue("lost", {}), error => error.code === "LOCK_TIMEOUT");
    rmdirSync(gw.lockPath);
    assert.equal((await gw.getJob("saved")).state, "pending");
    assert.equal(await gw.getJob("lost"), null);
    await gw.enqueue("recovered", {});
    assert.equal((await gw.getJob("recovered")).state, "pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expired lease and late completion remain fenced after separate coordinator loads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "metron-lock-retry-"));
  try {
    const file = join(dir, "gateway.json");
    let now = 10;
    const options = { now: () => now, queueOptions: { leaseMs: 10, backoffMs: 5 } };
    const a = new LockedGateway(file, options);
    await a.enqueue("retry-job");
    const lease = await a.claim("old-worker");
    now = 21;
    const b = new LockedGateway(file, options);
    assert.equal(await b.complete("retry-job", lease.lease, "late"), false);
    assert.equal((await b.getJob("retry-job")).state, "pending");
    now = 26;
    const newLease = await b.claim("new-worker");
    assert.equal(newLease.lease.version, 2);
    assert.equal(await a.complete("retry-job", lease.lease, "late-again"), false);
    assert.equal(await b.complete("retry-job", newLease.lease, "good"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
