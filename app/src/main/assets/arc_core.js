// ===============================
// Arc AutoDom v10.4 (Assistant-Only Extraction Guard)
// ===============================

if (!window.arc || typeof window.arc.performFill !== 'function') {
window.arc = (() => {

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

  function collectDeepNodes(root, selector, out) {
    if (!root || !selector) return;
    root.querySelectorAll(selector).forEach((n) => out.push(n));
    const hosts = Array.from(root.querySelectorAll('*')).filter(e => e.shadowRoot);
    for (const host of hosts) {
      collectDeepNodes(host.shadowRoot, selector, out);
    }
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
    __lastPostedResult: "",
    __resultBaseline: "",
    __pendingResult: "",
    __pendingCount: 0,
    isLikelyUserNode: (node) => {
        if (!node) return false;
        const selfRole = (node.getAttribute && node.getAttribute('data-message-author-role')) || "";
        const parentRoleEl = node.closest && node.closest('[data-message-author-role]');
        const parentRole = parentRoleEl ? (parentRoleEl.getAttribute('data-message-author-role') || "") : "";
        const role = (selfRole || parentRole).toLowerCase();
        if (role === "user") return true;
        const cls = (String(node.className || "") + " " + String((node.closest && node.closest('[class]') && node.closest('[class]').className) || "")).toLowerCase();
        if (cls.includes("user-message") || cls.includes("from-user")) return true;
        return false;
    },
    isPromptEcho: (txt) => {
        const t = (txt || "").trim();
        if (!t) return false;
        return t.startsWith("依頼:") || t.startsWith("@arc ");
    },
    deepQuerySelector,
    performFill: (sel, txt) => {
        let el = deepQuerySelector(document, sel);
        if (!el) {
            const candidates = [];
            collectDeepNodes(document, 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]', candidates);
            el = candidates.find(e => {
                if (!isOperable(e)) return false;
                const hint = (
                  e.placeholder ||
                  e.getAttribute('aria-label') ||
                  e.getAttribute('data-testid') ||
                  e.getAttribute('name') ||
                  e.getAttribute('id') ||
                  ''
                ).toLowerCase();
                return (
                  hint.includes("message") ||
                  hint.includes("chatgpt") ||
                  hint.includes("ask") ||
                  hint.includes("prompt") ||
                  hint.includes("メッセージ") ||
                  hint.includes("入力")
                );
            }) || candidates.find(e => isOperable(e));
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
    armResultBaseline: (sel) => {
        const collectCandidates = () => {
          const sels = [];
          if (sel && sel !== "null") sels.push(sel);
          sels.push('[data-message-author-role="assistant"]', '.model-response-text', '.markdown', 'article');
          const out = [];
          const seen = new Set();
          sels.forEach((s) => {
            document.querySelectorAll(s).forEach((el) => {
              if (!el || seen.has(el)) return;
              seen.add(el);
              out.push(el);
            });
          });
          return out;
        };
        const nodes = collectCandidates();
        for (let i = nodes.length - 1; i >= 0; i--) {
          if (window.arc.isLikelyUserNode(nodes[i])) continue;
          const clone = nodes[i].cloneNode(true);
          clone.querySelectorAll('button, style, script, .sr-only').forEach(el => el.remove());
          const txt = (clone.innerText || clone.textContent || "").trim();
          if (txt.length > 5 && !window.arc.isPromptEcho(txt)) {
            window.arc.__resultBaseline = txt;
            window.arc.__lastPostedResult = txt;
            window.arc.__pendingResult = "";
            window.arc.__pendingCount = 0;
            return txt;
          }
        }
        window.arc.__resultBaseline = "";
        window.arc.__lastPostedResult = "";
        window.arc.__pendingResult = "";
        window.arc.__pendingCount = 0;
        return "";
    },
    extractCleanResult: (sel) => {
        const sels = [];
        if (sel && sel !== "null") sels.push(sel);
        sels.push('[data-message-author-role="assistant"]', '.model-response-text', '.markdown', 'article');

        const nodes = [];
        const seen = new Set();
        sels.forEach((s) => {
          document.querySelectorAll(s).forEach((el) => {
            if (!el || seen.has(el)) return;
            seen.add(el);
            nodes.push(el);
          });
        });
        if (!nodes.length) return "";

        let txt = "";
        for (let i = nodes.length - 1; i >= 0; i--) {
          const node = nodes[i];
          if (window.arc.isLikelyUserNode(node)) continue;
          const clone = node.cloneNode(true);
          clone.querySelectorAll('button, style, script, .sr-only').forEach(el => el.remove());
          const candidate = (clone.innerText || clone.textContent || "").trim();
          if (candidate.length > 5 && !window.arc.isPromptEcho(candidate)) {
            txt = candidate;
            break;
          }
        }
        if (!txt) return "";

        const baseline = window.arc.__resultBaseline || "";
        const lastPosted = window.arc.__lastPostedResult || "";
        if (txt === baseline || txt === lastPosted) return txt;

        const generating = !!document.querySelector('[aria-label*="停止"], [aria-label*="Stop"], .result-streaming, .generating');
        if (txt !== window.arc.__pendingResult) {
          window.arc.__pendingResult = txt;
          window.arc.__pendingCount = 1;
          return txt;
        } else {
          window.arc.__pendingCount = (window.arc.__pendingCount || 0) + 1;
        }
        // 生成中は送信しない。停止後に同一テキストを2回連続確認してから確定送信。
        if (generating || window.arc.__pendingCount < 2) return txt;

        window.arc.__lastPostedResult = txt;
        window.arc.__pendingResult = "";
        window.arc.__pendingCount = 0;
        if (window.AndroidBridge) AndroidBridge.postMessage(txt);
        return txt;
    },
    getAutoDomData: () => ({ meta: getMetaInfo(), uiMap: Array.from(document.querySelectorAll('button, input, textarea')).map(e => ({ tag: e.tagName, text: (e.innerText || e.placeholder || "").substring(0,20), selector: buildStableSelector(e) })).filter(i => i.selector !== "") }),
    buildStableSelector,
    getElementContext
  };
})();
console.log("Arc Core v10.4 Ready.");
} else {
console.log("Arc Core already loaded.");
}
