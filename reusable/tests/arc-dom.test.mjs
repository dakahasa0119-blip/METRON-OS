import test from "node:test";
import assert from "node:assert/strict";
import { isOperable, findDeep, stableSelector, SelectorMemory, startPicker } from "../arc-dom/selector-kit.mjs";

function element({ id = "", role = "textbox", width = 40, hidden = false } = {}) {
  const el = {
    id, tagName: "DIV", classList: [], ownerDocument: { defaultView: {
      getComputedStyle: () => ({ display: hidden ? "none" : "block", visibility: "visible", opacity: "1" })
    }},
    getBoundingClientRect: () => ({ width, height: 20 }),
    getAttribute: k => k === "role" ? role : null,
    getRootNode() { return { querySelectorAll: () => [el] }; }
  };
  return el;
}

test("stable semantic selector and non-operable guard", () => {
  assert.equal(stableSelector(element({ id: "prompt-textarea" })), "#prompt-textarea");
  assert.equal(stableSelector(element()), 'div[role="textbox"]');
  assert.equal(isOperable(element({ hidden: true })), false);
});

test("findDeep traverses open shadow roots", () => {
  const input = element();
  const shadow = { querySelector: s => s === "#prompt" ? input : null, querySelectorAll: () => [] };
  const documentLike = { querySelector: () => null, querySelectorAll: () => [{ shadowRoot: shadow }] };
  assert.equal(findDeep(documentLike, "#prompt"), input);
});

test("candidate must repeat; lock protects user choice", () => {
  let now = 100;
  const memory = new SelectorMemory({ now: () => now, ttlMs: 1000 });
  assert.equal(memory.observe("site", "input", "#draft").committed, false);
  assert.equal(memory.observe("site", "input", "#draft").committed, true);
  assert.equal(memory.get("site", "input"), "#draft");
  memory.setManual("site", "input", "#manual");
  assert.equal(memory.observe("site", "input", "#new").reason, "locked");
  assert.equal(memory.get("site", "input"), "#manual");
  memory.setLocked("site", "input", false);
  now += 2000;
  assert.equal(memory.observe("site", "input", "#new").committed, false);
});

test("picker reports role; Escape cancels", () => {
  const handlers = new Map();
  const doc = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: name => handlers.delete(name)
  };
  let result = null;
  const picker = startPicker(doc, { role: "send", onPick: x => { result = x; } });
  let prevented = 0;
  handlers.get("click")({
    composedPath: () => [element({ id: "send-button" })],
    preventDefault: () => prevented++,
    stopImmediatePropagation: () => {}
  });
  assert.equal(result?.role, "send");
  assert.equal(result?.selector, "#send-button");
  assert.equal(prevented, 1);
  assert.equal(picker.active, false);
  let cancelled = false;
  startPicker(doc, { onPick() {}, onCancel: () => { cancelled = true; } });
  handlers.get("keydown")({ key: "Escape", preventDefault() {} });
  assert.equal(cancelled, true);
});
