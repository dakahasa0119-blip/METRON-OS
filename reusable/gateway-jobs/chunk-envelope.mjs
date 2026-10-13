/**
 * Deterministic, offline BAKU/Gateway chunk envelope reference.
 * Reworked from the historical manifest/chunk handoff idea, not drop-in GAS.
 * No network, writes, execution, credential handling or authenticity guarantee.
 * SHA-256 checks accidental/corrupt content against the supplied manifest;
 * if an attacker can replace BOTH the manifest and chunks it is not a signature.
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const PREFIX = "baku:external_code_return";
const ENCODING = "base64-utf8";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const blocked = (reason, found = 0) => ({ status: "blocked", reason, foundChunks: found });

function validLimits({ maxBytes, maxChunks }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 ||
      !Number.isSafeInteger(maxChunks) || maxChunks <= 0 || maxChunks > 9999) {
    throw new RangeError("invalid artifact limits");
  }
}
function validId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
function keyOf(returnId, index) {
  return PREFIX + ":" + returnId + ":chunk:" + String(index).padStart(4, "0");
}

/**
 * Create a manifest and a Map of UTF-8-safe, base64-encoded chunks.
 * Preserve both as one immutable logical transfer; don't log contents.
 */
export function createChunkedArtifact(source, {
  returnId, chunkSizeBytes = 4096, maxBytes = 1_048_576, maxChunks = 256
} = {}) {
  validLimits({ maxBytes, maxChunks });
  if (!validId(returnId)) throw new TypeError("invalid returnId");
  if (typeof source !== "string") throw new TypeError("artifact must be UTF-8 text");
  if (!Number.isSafeInteger(chunkSizeBytes) || chunkSizeBytes <= 0 || chunkSizeBytes > maxBytes) {
    throw new RangeError("invalid chunk size");
  }
  const bytes = Buffer.from(source, "utf8");
  if (bytes.length > maxBytes) throw new RangeError("artifact exceeds byte limit");
  const count = Math.max(1, Math.ceil(bytes.length / chunkSizeBytes));
  if (count > maxChunks) throw new RangeError("artifact exceeds chunk limit");

  const chunks = new Map(), chunkKeys = [];
  for (let i = 0; i < count; i++) {
    const key = keyOf(returnId, i);
    chunkKeys.push(key);
    chunks.set(key, bytes.subarray(i * chunkSizeBytes, (i + 1) * chunkSizeBytes).toString("base64"));
  }
  return {
    manifest: {
      schemaVersion: 1, returnId, encoding: ENCODING,
      chunkKeys, totalBytes: bytes.length, sha256: hash(bytes)
    },
    chunks
  };
}

/**
 * Fail closed: no source is returned until all chunks, key order, exact size,
 * canonical Base64 and SHA-256 agree. Missing chunks never yield partial code.
 */
export function verifyChunkedArtifact(manifest, chunks, {
  maxBytes = 1_048_576, maxChunks = 256
} = {}) {
  validLimits({ maxBytes, maxChunks });
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      manifest.schemaVersion !== 1 || !validId(manifest.returnId) ||
      manifest.encoding !== ENCODING || !Array.isArray(manifest.chunkKeys) ||
      !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0 ||
      manifest.totalBytes > maxBytes || typeof manifest.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(manifest.sha256)) {
    return blocked("invalid_manifest");
  }
  if (manifest.chunkKeys.length < 1 || manifest.chunkKeys.length > maxChunks) {
    return blocked("invalid_chunk_count");
  }
  if (!(chunks instanceof Map)) return blocked("invalid_chunk_store");
  const buffers = [];
  let byteCount = 0;
  for (let i = 0; i < manifest.chunkKeys.length; i++) {
    const key = manifest.chunkKeys[i];
    if (typeof key !== "string" || key !== keyOf(manifest.returnId, i)) {
      return blocked("invalid_chunk_order", buffers.length);
    }
    if (!chunks.has(key)) return blocked("missing_chunk", buffers.length);
    const raw = chunks.get(key);
    if (typeof raw !== "string" || raw.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
        raw.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) {
      return blocked("invalid_chunk_encoding", buffers.length);
    }
    const decoded = Buffer.from(raw, "base64");
    if (decoded.toString("base64") !== raw) return blocked("noncanonical_chunk_encoding", buffers.length);
    byteCount += decoded.length;
    if (byteCount > maxBytes || byteCount > manifest.totalBytes) {
      return blocked("artifact_exceeds_declared_size", buffers.length);
    }
    buffers.push(decoded);
  }
  if (byteCount !== manifest.totalBytes) return blocked("byte_length_mismatch", buffers.length);
  const all = Buffer.concat(buffers, byteCount);
  if (hash(all) !== manifest.sha256) return blocked("digest_mismatch", buffers.length);
  // Reject malformed UTF-8 rather than returning replacement characters.
  const artifact = all.toString("utf8");
  if (!Buffer.from(artifact, "utf8").equals(all)) return blocked("invalid_utf8", buffers.length);
  return { status: "ok", returnId: manifest.returnId, bytes: byteCount,
    sha256: manifest.sha256, artifact };
}
