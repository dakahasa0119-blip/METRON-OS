import test from "node:test";
import assert from "node:assert/strict";
import { createChunkedArtifact, verifyChunkedArtifact } from "../gateway-jobs/chunk-envelope.mjs";

const packet = (text = "日本語とemoji🎏を含む関数内容", opt = {}) =>
  createChunkedArtifact(text, { returnId: "return_01", chunkSizeBytes: 3, ...opt });

test("UTF-8 survives arbitrary byte boundary cuts and exact digest verification", () => {
  const p = packet();
  const verified = verifyChunkedArtifact(p.manifest, p.chunks);
  assert.equal(verified.status, "ok");
  assert.equal(verified.artifact, "日本語とemoji🎏を含む関数内容");
  assert.equal(verified.bytes, Buffer.byteLength(verified.artifact, "utf8"));
  assert.ok(p.manifest.chunkKeys.length > 1);
});

test("missing or reordered chunks never release partially assembled source", () => {
  const p = packet("abcdef");
  const missing = new Map(p.chunks);
  missing.delete(p.manifest.chunkKeys[1]);
  const v = verifyChunkedArtifact(p.manifest, missing);
  assert.equal(v.status, "blocked");
  assert.equal(v.reason, "missing_chunk");
  assert.ok(!Object.hasOwn(v, "artifact"));
  const reversed = { ...p.manifest, chunkKeys: [...p.manifest.chunkKeys].reverse() };
  assert.equal(verifyChunkedArtifact(reversed, p.chunks).reason, "invalid_chunk_order");
  const duplicate = { ...p.manifest, chunkKeys: [p.manifest.chunkKeys[0], p.manifest.chunkKeys[0]] };
  assert.equal(verifyChunkedArtifact(duplicate, p.chunks).reason, "invalid_chunk_order");
});

test("tampering or silent truncation fails digest or declared length", () => {
  const p = packet("abcdef");
  const changed = new Map(p.chunks);
  changed.set(p.manifest.chunkKeys[0], Buffer.from("xyz").toString("base64"));
  assert.equal(verifyChunkedArtifact(p.manifest, changed).reason, "digest_mismatch");
  const fewer = { ...p.manifest, totalBytes: 100 };
  assert.equal(verifyChunkedArtifact(fewer, p.chunks).reason, "byte_length_mismatch");
  const smaller = { ...p.manifest, totalBytes: 2 };
  assert.equal(verifyChunkedArtifact(smaller, p.chunks).reason, "artifact_exceeds_declared_size");
});

test("malformed metadata or non-canonical base64 fails closed", () => {
  const p = packet("abc");
  assert.equal(verifyChunkedArtifact({ ...p.manifest, schemaVersion: 0 }, p.chunks).reason, "invalid_manifest");
  assert.equal(verifyChunkedArtifact(p.manifest, {}).reason, "invalid_chunk_store");
  const invalid = new Map(p.chunks);
  invalid.set(p.manifest.chunkKeys[0], "abcd%");
  assert.equal(verifyChunkedArtifact(p.manifest, invalid).reason, "invalid_chunk_encoding");
  const malicious = { ...p.manifest, returnId: "../other" };
  assert.equal(verifyChunkedArtifact(malicious, p.chunks).reason, "invalid_manifest");
});

test("empty artifacts and strict byte/chunk budgets remain deterministic", () => {
  const p = packet("", { chunkSizeBytes: 1 });
  assert.equal(verifyChunkedArtifact(p.manifest, p.chunks).artifact, "");
  assert.throws(() => packet("ab", { maxBytes: 1, chunkSizeBytes: 1 }), /limit/);
  assert.throws(() => packet("abc", { chunkSizeBytes: 1, maxChunks: 2 }), /chunk limit/);
  const big = packet("hello");
  assert.equal(verifyChunkedArtifact(big.manifest, big.chunks, { maxBytes: 1 }).reason, "invalid_manifest");
});
