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
  function escapeAttr(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      .replace(/[\r\n\f]/g, " ");
  }
  function allMatches(selector, root, depth, output) {
    if (depth > 12 || !root || typeof root.querySelectorAll !== "function") return;
    var direct;
    try { direct = root.querySelectorAll(selector); } catch (_) { return; }
    for (var j = 0; j < direct.length; j++) output.push(direct[j]);
    var hosts = root.querySelectorAll("*");
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].shadowRoot) allMatches(selector, hosts[i].shadowRoot, depth + 1, output);
    }
  }
  // Round-trip through ARC's open-Shadow-DOM traversal, not document.querySelector
  // alone. Reject candidates that are ambiguous anywhere on the current page.
  function uniquelyResolves(element, selector) {
    if (!selector || selector.length > 240) return false;
    var matches = [];
    allMatches(selector, document, 0, matches);
    return matches.length === 1 && matches[0] === element;
  }
  function stableSelector(el) {
    if (!el || !el.tagName) return "";
    var tag = el.tagName.toLowerCase();
    var candidates = [];
    if (el.id && el.id.length <= 64) candidates.push("#" + escapeSelector(el.id));
    for (var i = 0; i < 5; i++) {
      var attr = ["data-testid", "aria-label", "name", "placeholder", "title"][i];
      var value = el.getAttribute(attr);
      if (value && value.length <= 80)
        candidates.push(tag + "[" + attr + '="' + escapeAttr(value) + '"]');
    }
    // Build a fallback *inside the same CSS root*. A composed path crossing a
    // shadow boundary cannot be joined with > and remain valid CSS.
    var path = [];
    for (var node = el, depth = 0; node && depth < 12;
         node = node.parentElement, depth++) {
      var piece = node.tagName.toLowerCase();
      if (node.id && node.id.length <= 64) {
        path.unshift("#" + escapeSelector(node.id));
        candidates.push(path.join(" > "));
        break;
      }
      var siblings = node.parentElement
        ? Array.prototype.filter.call(node.parentElement.children, function (x) {
            return x.tagName === node.tagName;
          })
        : [];
      if (siblings.length > 1)
        piece += ":nth-of-type(" +
          (siblings.indexOf(node) + 1) + ")";
      path.unshift(piece);
      candidates.push(path.join(" > "));
    }
    for (var k = 0; k < candidates.length; k++) {
      if (uniquelyResolves(el, candidates[k])) return candidates[k];
    }
    return "";
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
      if (!selector) return; // retain active picker; do not save broken selector
      cancel();
      if (global.AndroidBridge &&
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
