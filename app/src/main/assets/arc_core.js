// ===============================
// Arc AutoDom v10.1 (Field Mastery & Semantic Recon - Typo Fixed)
// ===============================

const arc = (() => {

  function isOperable(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function deepQuerySelector(root, selector) {
    if (!selector || selector === "" || selector === "null") return null;
    if (!root) root = document;
    const el = root.querySelector(selector);
    if (el && isOperable(el)) return el;

    const hosts = Array.from(root.querySelectorAll('*')).filter(e => e.shadowRoot);
    for (const host of hosts) {
      const found = deepQuerySelector(host.shadowRoot, selector);
      if (found) return found;
    }
    return null;
  }

  function buildStableSelector(el) {
    if (!el) return "";
    if (el.id && !el.id.match(/\d{4,}/) && el.id.length < 30) return "#" + el.id;

    let tag = el.tagName.toLowerCase();
    const semanticAttrs = ['aria-label', 'placeholder', 'name', 'data-testid', 'role', 'title'];
    for (let attr of semanticAttrs) {
      const val = el.getAttribute(attr);
      if (val && val.length < 50) return `${tag}[${attr}="${val}"]`;
    }

    const stableClasses = Array.from(el.classList).filter(c =>
      !c.match(/\d/) && !c.match(/^(m|p|t|b|l|r|w|h|flex|grid|bg|text)-/) && c.length > 3
    );
    if (stableClasses.length > 0) return `${tag}.${stableClasses.join('.')}`;

    return tag;
  }

  function getElementContext(selector) {
    const el = deepQuerySelector(document, selector);
    if (!el) return { snippet: "Element not found or not operable", path: selector };
    let contextEl = el;
    for (let i = 0; i < 3; i++) { if (contextEl.parentElement) contextEl = contextEl.parentElement; }
    const clone = contextEl.cloneNode(true);
    clone.querySelectorAll('script, style, svg, link, iframe').forEach(n => n.remove());
    return { snippet: clone.outerHTML.substring(0, 3000), path: buildStableSelector(el), meta: getMetaInfo() };
  }

  function forceValueSync(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    if (el.tagName === 'INPUT') nativeInputValueSetter.call(el, value);
    else if (el.tagName === 'TEXTAREA') nativeTextAreaValueSetter.call(el, value);
    else el.innerText = value;
    ['input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true, composed: true })));
  }

  function getMetaInfo() {
    const generating = !!document.querySelector('[aria-label*="停止"], [aria-label*="Stop"], .result-streaming, .generating');
    return {
      engine: window.location.href.includes("gemini") ? "gemini" : (window.location.href.includes("chatgpt") ? "chatgpt" : "copilot"),
      status: generating ? "generating" : "ready",
      title: document.title,
      url: window.location.href
    };
  }

  return {
    deepQuerySelector,
    performFill: (sel, txt) => {
        let el = deepQuerySelector(document, sel);
        if (!el) {
            el = Array.from(document.querySelectorAll('textarea, input, [contenteditable="true"]'))
                 .find(e => {
                    const label = (e.placeholder || e.getAttribute('aria-label') || "").toLowerCase();
                    return label.includes("ask") || label.includes("prompt") || label.includes("メッセージ");
                 });
        }
        if (!el) {
            if (window.AndroidBridge) AndroidBridge.domError("FILL_FAIL_REPORT:" + sel, JSON.stringify(getElementContext(sel)));
            return false;
        }
        el.focus(); forceValueSync(el, txt);
        return true;
    },
    performSend: (sel) => {
        let btn = deepQuerySelector(document, sel) ||
                  Array.from(document.querySelectorAll('button, [role="button"]'))
                  .find(e => {
                    const label = (e.innerText || e.getAttribute('aria-label') || "").toLowerCase();
                    return (label.includes("送") || label.includes("send") || label.includes("enter")) && isOperable(e);
                  });
        if (btn && !btn.disabled) { btn.click(); return true; }
        if (window.AndroidBridge) {
          AndroidBridge.domError("SEND_FAIL_REPORT:" + sel, JSON.stringify(getElementContext(sel)));
        }
        return false;
    },
    extractCleanResult: (sel) => {
        let target = deepQuerySelector(document, sel) || document.querySelector('article, .markdown, [data-message-author-role="assistant"]');
        if (!target) return "";
        const clone = target.cloneNode(true);
        clone.querySelectorAll('button, style, script, .sr-only').forEach(el => el.remove());
        const txt = (clone.innerText || clone.textContent).trim();
        if (window.AndroidBridge && txt.length > 5) AndroidBridge.postMessage(txt);
        return txt;
    },
    getAutoDomData: () => ({ meta: getMetaInfo(), uiMap: Array.from(document.querySelectorAll('button, input, textarea')).map(e => ({ tag: e.tagName, text: (e.innerText || e.placeholder || "").substring(0,20), selector: buildStableSelector(e) })).filter(i => i.selector !== "") }),
    buildStableSelector,
    getElementContext
  };
})();
console.log("Arc Core v10.1 Ready.");
