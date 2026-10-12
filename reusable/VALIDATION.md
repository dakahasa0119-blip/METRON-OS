# Reusable toolkit validation — 2026-10-13

## Reproducible commands

```sh
node --test reusable/tests/*.test.mjs
npm pack --dry-run ./reusable/arc-dom
npm pack --dry-run ./reusable/baku-dna
npm pack --dry-run ./reusable/gateway-jobs
npm pack --dry-run ./reusable/mothership
```

Verified locally on Windows with Node.js v24.18.0, npm CLI and installed Google Chrome (new headless mode), using a **separate temporary checkout** rather than changing production sources:

| Evidence | Result | Meaning |
| --- | --- | --- |
| Node tests | **17 passed, 0 failed, 0 skipped** (prior validation round) | Current isolated reference methods behave as the included tests require |
| Chromium DOM picker integration | **Passed** | A real browser selected an element in an open Shadow Root and returned its selector; click interception, Escape and manual lock behaved as expected |
| Historical BAKU extraction fixtures | **Passed** | Extractor recovered ten preselected named fragments from two published legacy BAKU JavaScript files |
| Synthetic BAKU review labels | **Passed** | Eight manually labelled simple examples matched expected pattern flags |
| npm package dry-run | **4 / 4 succeeded** | Packages include entrypoint, `package.json`, `README.md`, `LICENSE` |
| Actual npm tarball installation | **4 / 4 succeeded** | Four `.tgz` packages installed in a separate temporary consumer folder and imported by their package names |
| Android device/E2E | **Not tested** | `adb devices` showed no connected devices; old ARC application's picker routing has not been proven end-to-end |
| Historic BAKU autonomous repair precision | **Not measured** | Script/source examples and synthetic pattern matching do not establish repair success on unseen failures |

## Limitations of the metrics

The ten historical BAKU names were selected from readable, known functions in `modules/gas/BAKU/BAKU_SessionSalvager.js` and `modules/gas/BAKU/DNA_ANALYST.js`. Recovering those names is **coverage on selected expected fragments**. It is not unbiased recall or precision across the full BAKU codebase, nor evidence that the fragments can be run independently.

The eight review examples are synthetic and simple. Regex-based flagging can miss obfuscated/dynamic behavior and can flag innocuous comments or string literals. The extractor is not a parser or a security audit.

The browser test uses a local, synthetic page in a **real desktop Chromium** instance, without authentication, third-party service access or CAPTCHA interaction. It does **not** prove compatibility with current ChatGPT/Gemini/Claude UIs or the old Android WebView app.

The existing Gateway state machine is single-process and in-memory. Its state transitions do not provide distributed exactly-once execution, crash-safe persistence or cryptographic authorization.

## Installation

Each `reusable/<package>/` directory is independently npm-packable and contains the same scoped MIT permission for its files. No npm registry publishing is claimed. The rest of the historical repository remains outside the new license scope.

## Follow-up experiments, not yet accomplished

1. Connect an authorized Android test device or isolated emulator and measure the original WebView + picker path with screenshots, regression cases and explicit selector-role mapping.
2. Build a labelled set of historical BAKU failures and expected safe outcomes. Evaluate false positives, false negatives, quarantine behavior and rollback **without touching production GAS**.
3. Persist Gateway state in a durable store, then test lease expiry, worker crashes, idempotency and restart recovery across two processes.

## 2026-10-13: robustness regression round

- **23 / 23 tests passed, with 0 failed and 0 skipped** on the GitHub Actions Linux runner, including the real Chromium picker test and all four independent package installation checks. See the pull request and its exact workflow run for reproducibility.
- ARC `findDeep` now evaluates all matches instead of allowing a hidden first match to conceal visible alternatives; Shadow DOM traversal remains supported. The picker now recognizes the relevant ancestor for its `input`, `send`, or `response` role, so a click on a nested icon can choose the containing button. Captured pointer-down and click events are suppressed during picking.
- BAKU's lightweight extractor masks strings and comments before finding named fragments and matching braces. The simple review-pattern detector also ignores comments and quoted literal text. Regression tests cover phantom declarations, quoted braces, real code calls, truncated fragments and existing historical-source expectations.
- **Limits:** This is still a best-effort scanner, not a complete JS parser. Regex literals, complex template interpolation, unusual syntax and dynamic behavior can defeat parsing or review flags. There is no measured precision for autonomous code repair. No Android device-level test was run in this round. A registry package publication is not claimed.
