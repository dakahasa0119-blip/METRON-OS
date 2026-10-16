# ARC ordinary-login browser adapter — explicit, recoverable handoff

ARC uses the ordinary signed-in ChatGPT browser UI. It is not replaced by
a CLI or a model API. This Manifest V3 source is loaded manually only with
the user's approval. No extension was installed by the local test harness.

The declared permissions remain activeTab and scripting. Only an explicit
delivery or status operation requests optional http://127.0.0.1/* access;
the background worker removes that grant when the operation finishes or
fails. It never reads cookies, credentials or browser storage. Only the
user-activated, top-level chatgpt.com tab is accepted.
ARC controls require trusted native input: page scripts cannot authorize
selection, AI sends, review, capture or Gateway actions by forging clicks.

## Select, send and capture

Click the toolbar icon on a harmless, normally logged-in ChatGPT test tab.
Select the input, send button and existing response element. Password and
one-time-code fields are excluded; selectors must resolve uniquely.

「この文章を送信」 performs one explicit send. It clears the old response
selection and creates a new delivery identity. Wait for the actual new reply,
then use 「UIを選び直す」 and select the new response. The unchanged pre-send
response remains refused; another turn may legitimately have identical text.

Generation observations reuse the old ARC baseline/stream-marker approach,
with stricter limits: a known generating indicator blocks capture, and text
remaining unchanged by itself never establishes completion. A witnessed
busy-to-idle UI transition, send readiness and stable selected text can
produce a completion candidate. This detector has NOT been validated on
the real signed-in service. When the UI evidence is insufficient, separately
confirm 「生成完了を目視確認」 before explicitly capturing the response.
Known generation cannot be overridden by that checkbox.

A new send, reselection or selected-text mutation clears completion review
and the captured snapshot. Text changed after capture cannot be forwarded as
the old snapshot. Ending ARC disconnects its observers and removes the UI.
It does not undo a delivery already begun on the receiver. No observer sends
a prompt, forwards a reply, polls a receipt or retries a request.

## Explicit new delivery or recovery

For a selected existing reply, explicitly choose a new delivery record,
or enter the existing recovery ID and choose 「このIDで再開」.
The identity is shown before delivery. Copy it from ARC or the Mini record
when handing work over. ARC keeps it only in the current overlay; the
Gateway and MotherShip keep the durable record.

After reload, enter that same ID to explicitly query status or resend the
same complete reply. Nothing resumes or transmits on page load. New sessions
and new one-use transport tokens do not change the logical message ID.

- Same ID and same text returns the existing delivery/ACK without inserting
  another B message.
- Same ID and different text is refused.
- The same text with a different, explicitly chosen ID is a different message.

Do not identify a turn by text or selector hash alone. The adapter has no
verified provider-turn identity for transparent automatic recovery.

## Complete long replies and delivery ACK

The former 950-character limit protected the ordinary 1024-character
Gateway envelope. Protocol v2 keeps that ordinary envelope limit and puts
the complete reply in a bounded artifact instead of removing the limit.

The client preserves the selected raw text, rejects invalid Unicode and
checks its UTF-8 byte count and SHA-256. The limit is 256 KiB of UTF-8.
The receiver reuses the checked Gateway chunk format: 4096-byte chunks,
at most 64 chunks, an ordered manifest, exact total bytes and SHA-256.
A missing, reordered or corrupt chunk never yields partial reply text.

The Gateway persists the manifest/chunks. The receiver verifies the full
artifact, saves it under arc-artifacts/B/<messageId>.json, and atomically
saves the short reference in mother-B.json before producing the A-side ACK.
The regular mailbox envelope remains bounded.

A confirmed receipt requires the original job, B reference, B artifact
and A's matching ACK to agree on the ID, digest and bytes. Submission or a
pending ACK is not confirmed delivery. A status request is read-only and
does not drain the queue or resend. A lost response is an unknown outcome:
use the same recovery ID for an explicit status check or retry.

If the existing Gateway retry budget is exhausted, ARC reports the failed
stage and keeps the same ID. Status remains available; retry is disabled.
Reviving a dead Gateway job after repairing its cause currently requires
an operator recovery feature that is not yet implemented. A new ID would
represent a new delivery and must not be used as an implicit workaround.

The raw reply digest is returned as receiptHash/sha256. Read back that digest,
byte count, ID, B artifact and matching ACK. Ordinary legacy handoffs remain
supported, but only protocol v2 provides this explicit recovery contract.

## Boundaries and evidence

This is a single trusted writer per Mini data directory. It is not a
distributed exactly-once guarantee or a power-loss durability guarantee.
The random, two-minute, one-use in-memory token does not authenticate a human
or an AI provider. The current UI remains ChatGPT-only; the reply observation
boundary is replaceable, but other AI sites are not implemented or certified.

The picker/manual controls and generating observations build on the preserved
ARC assets; the Gateway queue, mailbox conflict checks, atomic checkpoints
and checked chunk implementation are reused. See
[the design and validation scope](../../docs/METRON_MINI_ARC_DURABLE_FLOW_2026-10-16.md).

Synthetic Chromium coverage connects actual ARC scripts to a test-only
Chrome API/background VM bridge, trusted native input into the owned browser,
and a real isolated Mini. It can establish
DOM state, HTTP delivery and saved bytes. It does not establish a real
installed extension's permission UX, isolated-world behavior, normal ChatGPT
login, real streaming compatibility or successful real-service E2E.
The native browser-input test needs Chromium and Node 22+ WebSocket support;
the repository CI uses Node 24. Older Node runtimes skip that browser test
with an explicit reason; this does not change the reusable packages' runtime.

Automatic latest-turn selection, fully resilient AutoDOM, automatic forwarding,
other AI providers and the complete METRON continuity/repair scenario remain
outside the demonstrated result. Install/reload, real-service sends, permission
changes and application restarts require their own applicable authorization.
