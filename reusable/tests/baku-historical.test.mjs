import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractCards, inspectCard } from "../baku-dna/code-cards.mjs";

const sources = [
  {
    source: new URL("../../modules/gas/BAKU/BAKU_SessionSalvager.js", import.meta.url),
    expected: ["processDeadJobs", "handleSingleJob_", "isTransient_", "isSystemError_", "storeLesson_", "BAKU_RunDeadJobSalvage"]
  },
  {
    source: new URL("../../modules/gas/BAKU/DNA_ANALYST.js", import.meta.url),
    expected: ["evaluate", "containsDangerousPatterns_", "estimateDependencyScore_", "estimateQuality_"]
  }
];

test("BAKU historical source fixtures: known named fragments can be recovered", () => {
  for (const { source, expected } of sources) {
    const text = readFileSync(source, "utf8");
    const cards = extractCards(text, { sourceName: source.pathname.split("/").pop() });
    const names = new Set(cards.map(x => x.name));
    const missing = expected.filter(name => !names.has(name));
    assert.deepEqual(missing, [], "missing named cards in " + source.pathname);
    assert.equal(cards.every(c => c.code && c.start >= 0 && c.end > c.start), true);
  }
});

test("BAKU extraction preserves function and object-method source ranges", () => {
  const text = readFileSync(sources[0].source, "utf8");
  const cards = extractCards(text);
  const method = cards.find(c => c.name === "handleSingleJob_");
  assert.equal(method.kind, "object-method");
  assert.match(method.code, /^handleSingleJob_:\s*function\s*\(/);
  assert.equal(text.slice(method.start, method.end), method.code);
  assert.ok(method.code.includes("this.storeLesson_"));
});

test("BAKU review pattern labels on a synthetic, reproducible corpus", () => {
  const samples = [
    { code: 'function f(){return fetch("https://example.com");}', flags: ["network-access"] },
    { code: 'function f(){ return UrlFetchApp.fetch("https://example.com"); }', flags: ["network-access"] },
    { code: 'function f(){ return new Function("return 1")(); }', flags: ["dynamic-evaluation"] },
    { code: 'function f(){ return eval("1+1"); }', flags: ["dynamic-evaluation"] },
    { code: 'function f(){ return DriveApp.getFiles(); }', flags: ["drive-mutation"] },
    { code: 'function f(){ ScriptApp.deleteTrigger(t); }', flags: ["script-mutation"] },
    { code: 'function f(){ return PropertiesService.getScriptProperties(); }', flags: ["property-access"] },
    { code: 'function f(){ return 2 + 2; }', flags: [] }
  ];
  for (const sample of samples) {
    const result = inspectCard({ name: "fixture", code: sample.code });
    assert.deepEqual(result.flags, sample.flags, sample.code);
    assert.equal(result.reviewRequired, sample.flags.length > 0);
  }
});
