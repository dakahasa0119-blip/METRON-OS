# ARC ordinary-login browser adapter (first bounded step)

The original ARC uses the **ordinary signed-in ChatGPT browser UI**, not
a CLI or API replacement. This directory contains a Manifest V3 extension
that the user may manually load as an unpacked extension in a Chromium
browser. Click its toolbar icon on an already logged-in `chatgpt.com` tab.

It activates a user-driven DOM picker for three targets: input, send and
response. It does not automatically send a prompt or read chat content; explicit user buttons are required. It does not inspect cookies,
read credentials, bypass login/CAPTCHA, or call a model API. The picked
selectors remain only in the current tab's ephemeral page state.

This is an actual extension and DOM inspection surface, **not yet the
complete ARC**. Automatic reply capture, resilient AutoDOM recovery,
automatic Gateway delivery, and supported browser interaction with
other AI sites are still unfinished. Do not claim otherwise.

Install manually via the browser's extension management page (developer
mode → Load unpacked → `mini/arc-browser`). Do not upload any extension
to a store or request broad website permissions without user approval.

## Manual live prompt and response (v0.2)

After selecting input, send button and response element, the user may enter
text in the ARC overlay and click **この文章を送信**. ARC sets the selected input
and clicks the selected send button once. The user may separately click
**最後の回答を取得** to read up to 5000 characters of the chosen response
into the overlay. No polling, background prompts, login automation, cookie
access or automatic Gateway forwarding is performed. A change to ChatGPT's
DOM may require selecting elements again. This is not yet a complete
AutoDOM. Gateway forwarding is a separate explicit action below.

## Explicit ARC → Gateway transfer

After capturing a reply, click **選択した回答をGatewayへ渡す**. The extension
asks for optional localhost permission, and removes that grant when the transfer
finishes or fails. Enter the running Mini port in **Miniのポート** (default
8766); the host is always `127.0.0.1`. If approved, its background worker requests a
short-lived one-time session token from the local Mini and delivers the
captured text to the actual Gateway/MotherShip B mailbox. It reports the
message ID and distinguishes confirmed delivery from an accepted, pending job.
A pending job is not reported as delivered. Failed recapture clears the previous
answer; ambiguous selectors fail closed. Use **UIを選び直す** after DOM changes. Replies over 950
characters are refused, not silently truncated. No automatic transmission
of conversation history, cookies, credentials or hidden browser state.

The loopback Gateway accepts Chromium extension origins, its own localhost
origin, and local clients without an Origin header. All delivery requests need
a random one-time token and the explicit local-request header. **This does not authenticate the
identity of the human or AI provider**; any installed local extension
origin can request a new session if it has localhost network access. Do
not run the Mini endpoint on a public interface or with untrusted local
extensions. The transport is functional but needs live signed-in ChatGPT
and Chromium-extension end-to-end verification before a full ARC claim.

## Retry and validation limits

The current overlay suppresses repeat forwarding of an already submitted answer,
including after recapturing the same text. If the delivery response is lost, it
shows an **unconfirmed outcome** and blocks automatic retry of that capture:
check Mini before sending again. A durable enqueue followed by a server-side
error returns the existing job receipt where available. This is not durable,
cross-tab or cross-reload exactly-once delivery; closing/reopening the overlay
resets its duplicate guard. No receipt polling or automatic retry is performed.
If permission removal fails, a warning asks the user to remove localhost access
in the extension settings.

Executable browser-API/DOM fixtures exercise these failure paths, and server
tests use real local Gateway persistence and queue backlogs. These fixtures do
not establish successful authenticated ChatGPT usage or Chrome permission UX.
