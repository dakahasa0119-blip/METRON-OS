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

  function buildResultSelectors(sel) {
    const sels = [];
    if (sel && sel !== "null") sels.push(sel);
    sels.push(
      '[data-message-author-role="assistant"]',
      'div[data-testid*="assistant"]',
      'div[data-testid*="message"]',
      '.model-response-text',
      '.markdown',
      '.prose',
      '[class*="assistant"]',
      '[class*="claude"]',
      'article'
    );
    return sels;
  }

  function logTrace(event, detail) {
    try {
      const msg = detail ? String(detail) : "";
      console.log("[ARC_RESULT_TRACE] " + event + (msg ? " / " + msg : ""));
    } catch (_) {}
  }

  return {
    __lastPostedResult: "",
    __resultBaseline: "",
    __pendingResult: "",
    __pendingCount: 0,
    __lastExtractSignature: "",
    __lastGeminiErrorMark: "",
    __lastGeminiErrorAt: 0,
    __geminiErrorObserverArmed: false,
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
            logTrace("fill_fail", sel);
            return false;
        }
        el.focus(); forceValueSync(el, txt);
        const preview = String(txt || "").slice(0, 20).replace(/\s+/g, " ");
        logTrace("fill_ok", "sel=" + buildStableSelector(el) + ",len=" + String((txt || "").length) + ",preview=" + preview);
        return true;
    },
    performSend: (sel) => {
        let btn = deepQuerySelector(document, sel) ||
                  Array.from(document.querySelectorAll('button, [role="button"]'))
                  .find(e => {
                    const label = (e.innerText || e.getAttribute('aria-label') || "").toLowerCase();
                    return (label.includes("送") || label.includes("send") || label.includes("enter")) && isOperable(e);
                  });
        if (btn && !btn.disabled) {
          btn.click();
          logTrace("send_ok", "sel=" + buildStableSelector(btn));
          return true;
        }
        if (window.AndroidBridge) {
          AndroidBridge.domError("SEND_FAIL_REPORT:" + sel, JSON.stringify(getElementContext(sel)));
        }
        logTrace("send_fail", sel);
        return false;
    },
    armResultBaseline: (sel) => {
        const collectCandidates = () => {
          const sels = buildResultSelectors(sel);
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
            logTrace("baseline_set", "len=" + String(txt.length));
            return txt;
          }
        }
        window.arc.__resultBaseline = "";
        window.arc.__lastPostedResult = "";
        window.arc.__pendingResult = "";
        window.arc.__pendingCount = 0;
        logTrace("baseline_clear", "");
        return "";
    },
    extractCleanResult: (sel) => {
        const sels = buildResultSelectors(sel);

        const nodes = [];
        const seen = new Set();
        sels.forEach((s) => {
          document.querySelectorAll(s).forEach((el) => {
            if (!el || seen.has(el)) return;
            seen.add(el);
            nodes.push(el);
          });
        });
        if (!nodes.length) {
          logTrace("extract_nodes_empty", sels.join(","));
          return "";
        }

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
        if (!txt) {
          logTrace("extract_text_empty", "nodes=" + String(nodes.length));
          return "";
        }

        const baseline = window.arc.__resultBaseline || "";
        const lastPosted = window.arc.__lastPostedResult || "";
        if (txt === baseline || txt === lastPosted) {
          const sig = "same:" + String(txt.length);
          if (window.arc.__lastExtractSignature !== sig) {
            window.arc.__lastExtractSignature = sig;
            logTrace("extract_same_as_history", sig);
          }
          return txt;
        }

        const generating = !!document.querySelector('[aria-label*="停止" i], [aria-label*="Stop" i], button[data-testid*="stop" i], [data-is-streaming="true"], .result-streaming, .generating, [class*="stream" i], [class*="typing" i]');
        if (txt !== window.arc.__pendingResult) {
          window.arc.__pendingResult = txt;
          window.arc.__pendingCount = 1;
          const sig = "pending_new:" + String(txt.length);
          if (window.arc.__lastExtractSignature !== sig) {
            window.arc.__lastExtractSignature = sig;
            logTrace("extract_pending_new", sig);
          }
          return txt;
        } else {
          window.arc.__pendingCount = (window.arc.__pendingCount || 0) + 1;
          const sig = "pending_same:" + String(window.arc.__pendingCount) + ":" + String(txt.length);
          if (window.arc.__lastExtractSignature !== sig) {
            window.arc.__lastExtractSignature = sig;
            logTrace("extract_pending_same", sig);
          }
        }
        // 生成中は送信しない。停止後に同一テキストを2回連続確認してから確定送信。
        if (generating || window.arc.__pendingCount < 2) return txt;

        window.arc.__lastPostedResult = txt;
        window.arc.__pendingResult = "";
        window.arc.__pendingCount = 0;
        if (window.AndroidBridge) {
          logTrace("post_message", "len=" + String(txt.length));
          AndroidBridge.postMessage(txt);
        }
        return txt;
    },
    getAutoDomData: () => ({ meta: getMetaInfo(), uiMap: Array.from(document.querySelectorAll('button, input, textarea')).map(e => ({ tag: e.tagName, text: (e.innerText || e.placeholder || "").substring(0,20), selector: buildStableSelector(e) })).filter(i => i.selector !== "") }),
    buildStableSelector,
    getElementContext
  };
})();
try {
  if (window.arc && !window.arc.__geminiErrorObserverArmed) {
    window.arc.__geminiErrorObserverArmed = true;
    const codeRegexes = [
      /エラーが発生しました\s*[（(]\s*(\d+)\s*[)）]/,
      /error\s*occurred\s*[（(]\s*(\d+)\s*[)）]/i
    ];
    const genericMarks = [
      "something went wrong",
      "problem generating response",
      "try again",
      "temporarily unavailable",
      "network error"
    ];
    const updateGeminiErrorState = () => {
      try {
        const u = (window.location.href || "").toLowerCase();
        if (!u.includes("gemini.google.com")) return;
        const text = ((document.body && document.body.innerText) || "").trim();
        if (!text) return;
        for (const re of codeRegexes) {
          const m = text.match(re);
          if (m && m[1]) {
            window.arc.__lastGeminiErrorMark = "code:" + String(m[1]);
            window.arc.__lastGeminiErrorAt = Date.now();
            return;
          }
        }
        const lower = text.toLowerCase();
        for (const mk of genericMarks) {
          if (lower.includes(mk)) {
            window.arc.__lastGeminiErrorMark = "generic:" + mk;
            window.arc.__lastGeminiErrorAt = Date.now();
            return;
          }
        }
      } catch (_) {}
    };
    updateGeminiErrorState();
    const mo = new MutationObserver(() => updateGeminiErrorState());
    mo.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      characterData: true
    });
  }
} catch (_) {}
console.log("Arc Core v10.4 Ready.");
} else {
console.log("Arc Core already loaded.");
}
