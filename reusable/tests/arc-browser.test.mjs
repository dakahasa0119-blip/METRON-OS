import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find(x => existsSync(x)) || "";
}

test("ARC picker works in real Chromium DOM and open Shadow DOM", { skip: !findChrome() }, () => {
  const dir = mkdtempSync(join(tmpdir(), "metron-arc-browser-"));
  try {
    const source = readFileSync(new URL("../arc-dom/selector-kit.mjs", import.meta.url), "utf8");
    const script = source.replace(/^export /gm, "");
    function browserAssertions() {
      const assert = (condition, label) => { if (!condition) throw new Error(label); };
      const host = document.getElementById("host");
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = "<button id='send-button' aria-label='Send message'><svg><circle id='icon' r='2'></circle></svg>Send</button>" +
         "<input class='test-query' style='display:none' /><input class='test-query' />";
      const button = shadow.querySelector("button");
      assert(findDeep(document, "#send-button") === button, "cannot traverse Shadow DOM");
      assert(stableSelector(button) === "#send-button", "selector for Shadow DOM button");
      assert(findDeep(document, ".test-query") === shadow.querySelectorAll(".test-query")[1], "hidden match must not mask visible later match");
      const notes = [];
      button.addEventListener("click", () => notes.push("site-action"));
      let picked = null;
      startPicker(document, { role: "send", onPick: p => { picked = p; } });
      const icon = shadow.getElementById("icon");
      icon.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true }));
      icon.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
      assert(picked && picked.selector === "#send-button" && picked.role === "send", "picker result");
      assert(notes.length === 0, "site action not intercepted");
      let cancelled = false;
      startPicker(document, { onPick() {}, onCancel: () => { cancelled = true; } });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      assert(cancelled, "Escape cancellation");
      const learned = new SelectorMemory({ confirmations: 2 });
      assert(!learned.observe("sample", "send", "#send-button").committed, "first observation");
      assert(learned.observe("sample", "send", "#send-button").committed, "second observation");
      learned.setManual("sample", "send", "#send-button");
      assert(learned.observe("sample", "send", "#other").reason === "locked", "manual lock");
    }
    const html = "<!doctype html><html><head><meta charset='utf-8'></head><body><div id='host'></div><pre id='result'>WAIT</pre><script>" +
      script +
      "\ntry { (" + browserAssertions.toString() + ")(); document.getElementById('result').textContent = 'METRON_BROWSER_PASS'; }" +
      "catch (error) { document.getElementById('result').textContent = 'METRON_BROWSER_FAIL:' + error.message; }" +
      "</script></body></html>";
    const page = join(dir, "picker.html");
    writeFileSync(page, html, "utf8");
    const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--disable-sync", "--disable-extensions",
      "--user-data-dir=" + join(dir, "chrome-profile"), "--virtual-time-budget=1500",
      "--dump-dom", pathToFileURL(page).href];
    if (process.getuid?.() === 0) args.unshift("--no-sandbox");
    // Cold Chromium startup on Windows CI can exceed 25 seconds. Keep a
    // bounded process deadline without retrying the browser or its assertions.
    const out = execFileSync(findChrome(), args, { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "ignore"] });
    assert.match(out, /<pre id="result">METRON_BROWSER_PASS<\/pre>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
