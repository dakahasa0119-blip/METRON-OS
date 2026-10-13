# Legacy ARC Android picker: static routing fix (2026-10-14)

## Original source path gaps

The preserved Android \`SettingsActivity.setupPickerButtons()\` returned a \`PICKER_MODE\` value, but \`MainActivity\` launched Settings with \`startActivity\` rather than an Activity Result callback. Consequently, the returned mode had no consumer in the checked MainActivity snapshot. The existing \`savePickedSelector\` callback selected only the **input** preference by current target, even when the Settings buttons requested the **send** or **response** selector.

The Android JavaScript bridge had an \`onPicked\` callback and WebViewManager connected it, but no checked picker entrypoint was wired to the result from Settings. These are concrete source-code gaps, not proof of user-visible runtime failure on any particular historic APK.

## Proposed source-only fix

- Replace the Settings launch with an Activity Result launcher and validate its returned picker mode against the nine documented target/role combinations.
- Arm an explicit user-initiated picker on the appropriate WebView page, after target switching/page load when needed.
- Introduce local \`selector_picker.js\` with temporary DOM event interception; it sends a CSS selector to the existing \`AndroidBridge.onPicked\`, suppresses the page click action during selection and returns an empty cancellation result on Escape.
- Save the returned selector into the **correct** input/send/response preference for Gemini, ChatGPT or Claude/Copilot. Clear the pending role before saving, ignore unsolicited callbacks, bound selector length, and update UI state on the Android UI thread.
- No network calls, account access, AI-provider login, CAPTCHA interaction or production GAS code are added.

## Verification boundary

A real desktop Chromium test uses a local synthetic HTML page to validate choosing an ancestor send button from a nested Shadow DOM icon, selecting input/response elements, suppressing website clicks, and cancelling on Escape. Passing this test does **not** establish successful Android WebView-to-Kotlin navigation, configuration persistence after process death, authenticated login pages or production AI UI compatibility. A Kotlin compile check and Android emulator/device test are separate milestones; the original code path should not be called fully verified until those results exist.

The user's real installed Android app was not updated. This PR updates only the public legacy Android source snapshot and adds regression coverage.
