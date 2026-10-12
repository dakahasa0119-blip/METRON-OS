import test from "node:test";
import assert from "node:assert/strict";
import { extractCards, inspectCard, composeCards, findMatchingBrace } from "../baku-dna/code-cards.mjs";

test("extracts nested function body without cutting at first brace", () => {
  const code = 'function greet(name) { if (name) { return "Hi " + name; } return "Hi"; }\nfunction next() { return 2; }';
  const cards = extractCards(code, { sourceName: "demo" });
  assert.equal(cards.length, 2);
  assert.equal(cards[0].name, "greet");
  assert.equal(cards[1].name, "next");
  assert.match(cards[0].code, /return "Hi";/);
  assert.equal(cards[0].sourceName, "demo");
});

test("handles braces inside quotes and comments", () => {
  const s = 'function example() { const a = "}"; /* } */ return { ok: true }; }';
  const cards = extractCards(s);
  assert.equal(cards.length, 1);
  assert.equal(findMatchingBrace(s, s.indexOf("{")), s.length - 1);
});

test("risky API use is flagged for human review", () => {
  const card = { name: "load", code: 'function load(){ return UrlFetchApp.fetch("https://example.org"); }' };
  assert.deepEqual(inspectCard(card).flags, ["network-access"]);
  assert.equal(inspectCard(card).reviewRequired, true);
});

test("composition honors dependencies and rejects cycles", () => {
  const a = { name: "alpha", code: "function alpha() {}" };
  const b = { name: "beta", code: "function beta() {}" };
  assert.deepEqual(composeCards([b, a], { beta: ["alpha"] }).order, ["alpha", "beta"]);
  assert.throws(() => composeCards([a, b], { alpha: ["beta"], beta: ["alpha"] }), /cycle/);
  assert.throws(() => composeCards([a], { alpha: ["missing"] }), /missing dependency/);
});
