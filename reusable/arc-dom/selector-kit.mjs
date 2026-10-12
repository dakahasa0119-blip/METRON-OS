/**
 * ARC selector discovery & human picker — standalone, dependency-free reference.
 * Extracted/reworked from AutoDom.kt and arc_core.js, without service-specific automation.
 * Only open shadow roots are traversable; no cross-origin frames are accessed.
 */

export function isOperable(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return false;
  const view = element.ownerDocument?.defaultView;
  const style = view?.getComputedStyle?.(element);
  if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function findDeep(root, selector, { operableOnly = true, maxDepth = 12 } = {}) {
  if (!root || !selector || typeof root.querySelector !== "function") return null;
  const seen = new Set();
  function search(node, depth) {
    if (!node || depth > maxDepth || seen.has(node)) return null;
    seen.add(node);
    let direct;
    try { direct = node.querySelector(selector); } catch { return null; }
    if (direct && (!operableOnly || isOperable(direct))) return direct;
    let elements;
    try { elements = node.querySelectorAll("*"); } catch { return null; }
    for (const element of elements) {
      if (element.shadowRoot) {
        const found = search(element.shadowRoot, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  return search(root, 0);
}

function escapeAttr(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n|\r/g, " ");
}

function uniqueWithinRoot(element, selector) {
  const root = element.getRootNode?.() ?? element.ownerDocument;
  if (!root || typeof root.querySelectorAll !== "function") return true;
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === element;
  } catch { return false; }
}

/** Favor semantic attributes rather than positional CSS selectors. Returns "" if ambiguous. */
export function stableSelector(element) {
  if (!element || !element.tagName) return "";
  const tag = element.tagName.toLowerCase();
  const id = element.id || "";
  if (/^[A-Za-z_][A-Za-z0-9_-]{1,60}$/.test(id)) {
    const candidate = "#" + id;
    if (uniqueWithinRoot(element, candidate)) return candidate;
  }
  for (const attr of ["data-testid", "aria-label", "name", "placeholder", "role", "title"]) {
    const value = element.getAttribute?.(attr);
    if (!value || value.length > 80) continue;
    const candidate = `${tag}[${attr}="${escapeAttr(value)}"]`;
    if (uniqueWithinRoot(element, candidate)) return candidate;
  }
  const classNames = Array.from(element.classList || []).filter(
    value => /^[A-Za-z_][A-Za-z0-9_-]{3,40}$/.test(value) &&
      !/\d/.test(value) && !/^(?:flex|grid|text|bg|w|h|p|m)-/.test(value)
  );
  for (const className of classNames) {
    const candidate = tag + "." + className;
    if (uniqueWithinRoot(element, candidate)) return candidate;
  }
  return "";
}

/** A selector must repeat before it can replace an existing learned value. */
export class SelectorMemory {
  constructor({ confirmations = 2, ttlMs = 120000, now = () => Date.now() } = {}) {
    if (!Number.isInteger(confirmations) || confirmations < 1) throw new Error("invalid confirmations");
    this.confirmations = confirmations;
    this.ttlMs = ttlMs;
    this.now = now;
    this.pending = new Map();
    this.committed = new Map();
    this.locked = new Set();
  }
  key(site, role) { return String(site) + "::" + String(role); }
  setLocked(site, role, locked = true) {
    const k = this.key(site, role);
    if (locked) this.locked.add(k);
    else this.locked.delete(k);
  }
  observe(site, role, selector) {
    const k = this.key(site, role);
    if (this.locked.has(k) || typeof selector !== "string" || !selector.trim() || selector.length > 180) {
      return { committed: false, reason: this.locked.has(k) ? "locked" : "invalid" };
    }
    const at = this.now();
    const old = this.pending.get(k);
    const hits = old && old.selector === selector && at - old.time <= this.ttlMs ? old.hits + 1 : 1;
    if (hits >= this.confirmations) {
      this.pending.delete(k);
      this.committed.set(k, selector);
      return { committed: true, selector };
    }
    this.pending.set(k, { selector, hits, time: at });
    return { committed: false, reason: "awaiting_confirmation", hits };
  }
  get(site, role) { return this.committed.get(this.key(site, role)) || ""; }
  setManual(site, role, selector, { lock = true } = {}) {
    if (!selector) throw new Error("empty selector");
    const k = this.key(site, role);
    this.pending.delete(k);
    this.committed.set(k, selector);
    this.setLocked(site, role, lock);
  }
}

/**
 * Start a one-click element picker in an authorized page.
 * Intercepts the selected click so the page's original action is not triggered.
 * Returns a cancel handle; Escape cancels. Does not inject into third-party frames.
 */
export function startPicker(doc, { role = "input", onPick, onCancel = () => {} } = {}) {
  if (!doc?.addEventListener || typeof onPick !== "function") throw new Error("document and onPick required");
  let active = true;
  const stop = () => {
    if (!active) return;
    active = false;
    doc.removeEventListener("click", click, true);
    doc.removeEventListener("keydown", keydown, true);
  };
  const click = event => {
    const element = event.composedPath?.()[0] || event.target;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    const selector = stableSelector(element);
    if (!selector) return; // keep picker active so user can try another element
    stop();
    onPick({ selector, role, element });
  };
  const keydown = event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    stop();
    onCancel();
  };
  doc.addEventListener("click", click, true);
  doc.addEventListener("keydown", keydown, true);
  return { cancel: () => { if (active) { stop(); onCancel(); } }, get active() { return active; } };
}
