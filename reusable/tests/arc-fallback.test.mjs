import test from "node:test";
import assert from "node:assert/strict";
import { findDeep, startPicker } from "../arc-dom/selector-kit.mjs";

function fakeElement(tagName, id, { hidden = false, matches = () => false } = {}) {
  const obj = {
    tagName, id, matches, classList: [],
    getAttribute: () => null,
    ownerDocument: { defaultView: { getComputedStyle: () => ({
      display: hidden ? "none" : "block", visibility: "visible", opacity: "1"
    }) } },
    getBoundingClientRect: () => ({ width: 20, height: 10 }),
    getRootNode: () => ({ querySelectorAll: () => [obj] })
  };
  return obj;
}

test("findDeep skips first hidden match and returns visible sibling", () => {
  const hidden = fakeElement("INPUT", "first", { hidden: true });
  const visible = fakeElement("INPUT", "second");
  const root = {
    querySelectorAll: s => s === ".editable" ? [hidden, visible] : [hidden, visible]
  };
  assert.equal(findDeep(root, ".editable"), visible);
  assert.equal(findDeep(root, ".editable", { operableOnly: false }), hidden);
});

test("role-specific picker returns ancestor button when inner icon is clicked", () => {
  const icon = fakeElement("SVG", "");
  const button = fakeElement("BUTTON", "send-action", {
    matches: s => s.includes("button")
  });
  const listeners = new Map();
  const doc = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type)
  };
  let chosen = null;
  const picker = startPicker(doc, { role: "send", onPick: x => { chosen = x; } });
  assert.equal(listeners.has("pointerdown"), true);
  let prevented = 0;
  const event = {
    cancelable: true,
    composedPath: () => [icon, button],
    preventDefault: () => prevented++,
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
  listeners.get("pointerdown")(event);
  listeners.get("click")(event);
  assert.equal(chosen?.role, "send");
  assert.equal(chosen?.selector, "#send-action");
  assert.equal(chosen?.element, button);
  assert.equal(prevented, 2);
  assert.equal(picker.active, false);
  assert.equal(listeners.size, 0);
});
