# ARC ordinary-login browser adapter (first bounded step)

The original ARC uses the **ordinary signed-in ChatGPT browser UI**, not
a CLI or API replacement. This directory contains a Manifest V3 extension
that the user may manually load as an unpacked extension in a Chromium
browser. Click its toolbar icon on an already logged-in `chatgpt.com` tab.

It activates a user-driven DOM picker for three targets: input, send and
response. It does not send a prompt, read chat content, inspect cookies,
read credentials, bypass login/CAPTCHA, or call a model API. The picked
selectors remain only in the current tab's ephemeral page state.

This is an actual extension and DOM inspection surface, **not yet the
complete ARC**. Automatic reply capture, resilient AutoDOM recovery,
Gateway message transport, and supported browser interaction with
other AI sites are still unfinished. Do not claim otherwise.

Install manually via the browser's extension management page (developer
mode → Load unpacked → `mini/arc-browser`). Do not upload any extension
to a store or request broad website permissions without user approval.
