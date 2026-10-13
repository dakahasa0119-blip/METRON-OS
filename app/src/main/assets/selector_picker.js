/*
 * Legacy ARC manual selector picker (user-initiated only).
 * No network requests, no credential reading, no automated page actions.
 * Injected into the current WebView after the Settings picker is selected.
 */
(function (global) {
  "use strict";
  if (global.MetronSelectorPicker) return;
  var active = null;

  function escapeSelector(value) {
    if (global.CSS && typeof global.CSS.escape === "function") return global.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return "\\" + c.codePointAt(0).toString(16) + " ";
    });
  }
  function parentElement(node) {
    if (node.parentElement) return node.parentElement;
    var root = node.getRootNode && node.getRootNode();
    return root && root.host instanceof Element ? root.host : null;
  }
  function stableSelector(el) {
    if (el.id) return "#" + escapeSelector(el.id);
    var testId = el.getAttribute("data-testid");
    if (testId) return '[data-testid="' + escapeSelector(testId) + '"]';
    var parts = [];
    for (var node = el, depth = 0; node && depth < 14; node = parentElement(node), depth++) {
      if (node.id) {
        parts.unshift("#" + escapeSelector(node.id));
        break;
      }
      var tag = node.tagName.toLowerCase();
      var siblings = node.parentElement
        ? Array.prototype.filter.call(node.parentElement.children, function (x) {
            return x.tagName === node.tagName;
          })
        : [];
      if (siblings.length > 1) tag += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      parts.unshift(tag);
    }
    return parts.join(" > ");
  }
  function selection(event, role) {
    var selector = role === "input"
      ? 'textarea,input,[contenteditable="true"],[role="textbox"]'
      : role === "send"
      ? 'button,[role="button"],input[type="submit"]'
      : 'article,[data-message-author-role="assistant"],[data-testid*="message"],.prose';
    var path = typeof event.composedPath === "function"
      ? event.composedPath() : [event.target];
    var elements = path.filter(function (node) { return node instanceof Element; });
    for (var i = 0; i < elements.length; i++) {
      if (elements[i].matches(selector)) return elements[i];
    }
    return elements[0] || null;
  }
  function suppress(event) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  }
  function cancel() {
    if (!active) return;
    document.removeEventListener("pointerdown", active.down, true);
    document.removeEventListener("click", active.click, true);
    document.removeEventListener("keydown", active.key, true);
    active = null;
  }
  function start(role) {
    if (["input","send","resp"].indexOf(role) < 0) return false;
    cancel();
    var down = function (event) { suppress(event); };
    var click = function (event) {
      suppress(event);
      var picked = selection(event, role);
      var selector = picked && stableSelector(picked);
      cancel();
      if (selector && global.AndroidBridge &&
          typeof global.AndroidBridge.onPicked === "function") {
        global.AndroidBridge.onPicked(selector);
      }
    };
    var key = function (event) {
      if (event.key === "Escape") {
        suppress(event);
        cancel();
        if (global.AndroidBridge &&
            typeof global.AndroidBridge.onPicked === "function") {
          global.AndroidBridge.onPicked("");
        }
      }
    };
    active = { down:down, click:click, key:key };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    return true;
  }
  global.MetronSelectorPicker = {start:start, cancel:cancel,
    get active() { return !!active; }};
})(window);
