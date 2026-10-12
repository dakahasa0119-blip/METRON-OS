import test from "node:test";
import assert from "node:assert/strict";
import { extractCards, inspectCard, findMatchingBrace } from "../baku-dna/code-cards.mjs";

test("source extraction ignores fake declarations in comments, strings and templates", () => {
  const code = [
    '// function invisible() { return 1; }',
    '/* class Fake { method() { return "not code"; } } */',
    'const info = "function phantom() { return true; }";',
    "const quote = 'class Phantom {}';",
    "const template = " + String.fromCharCode(96) + "function imaginary() { return false; }" + String.fromCharCode(96) + ";",
    'function actual() { const str = "}"; /* } */ return { pass: true }; }',
    'const arrow = (a) => { return a + 1; };',
    'const api = { run: function() { return 7; } };'
  ].join("\n");
  const cards = extractCards(code);
  assert.deepEqual(cards.map(x => x.name), ["actual", "arrow", "run"]);
  assert.deepEqual(cards.map(x => x.kind), ["function", "arrow-function", "object-method"]);
  assert.equal(cards.every(x => code.slice(x.start, x.end) === x.code), true);
  const brace = code.indexOf("{", code.indexOf("function actual"));
  assert.equal(code[findMatchingBrace(code, brace)], "}");
  assert.match(cards[0].code, /return \{ pass: true \};/);
});

test("review patterns are not triggered by quoted or commented suggestions", () => {
  const card = {
    name: "innocent",
    code: [
      'function innocent() {',
      'const documentation = "Do not call eval(x), DriveApp.openById(y) or fetch(z)";',
      '// UrlFetchApp.fetch(url);',
      '/* ScriptApp.deleteTrigger(t) */',
      'return documentation.length;',
      '}'
    ].join("\n")
  };
  assert.deepEqual(inspectCard(card).flags, []);
  assert.equal(inspectCard(card).reviewRequired, false);
});

test("live dangerous calls are still flagged after masking", () => {
  const card = {
    name: "dangerous",
    code: 'function dangerous() { return eval("1+2") + fetch("/api"); }'
  };
  assert.deepEqual(inspectCard(card).flags, ["dynamic-evaluation", "network-access"]);
});

test("truncated source does not fabricate a complete function", () => {
  const broken = 'function unfinished(a) { if (a) { return "hello"; }';
  assert.deepEqual(extractCards(broken), []);
});
