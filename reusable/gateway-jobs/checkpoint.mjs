/**
 * Small, single-writer filesystem checkpoint adapter for the portable Gateway
 * reference queue/memory. No external dependencies; Node.js only.
 *
 * Atomic rename protects against partially written JSON in ordinary process
 * interruptions. This is NOT a transaction across workers or a distributed lock.
 */
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync,
  renameSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";

export function writeAtomicJson(file, value) {
  if (typeof file !== "string" || !file) throw new Error("checkpoint path required");
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string") throw new Error("checkpoint must be JSON-serializable");
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const temporary = join(dir, "." + basename(file) + "." + randomUUID() + ".tmp");
  let handle;
  try {
    handle = openSync(temporary, "wx", 0o600);
    writeFileSync(handle, encoded, "utf8");
    fsyncSync(handle);
    closeSync(handle);
    handle = undefined;
    renameSync(temporary, file);
    // Best-effort metadata durability on filesystems supporting directory fsync.
    try {
      const directoryFd = openSync(dir, "r");
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    } catch { /* Not all operating systems allow directory fsync. */ }
  } catch (error) {
    if (handle !== undefined) closeSync(handle);
    try { unlinkSync(temporary); } catch { /* Temporary file may have been renamed. */ }
    throw error;
  }
}

export function readCheckpoint(file) {
  if (typeof file !== "string" || !file) throw new Error("checkpoint path required");
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error; // Corrupt checkpoint must not be interpreted as an empty queue.
  }
}
