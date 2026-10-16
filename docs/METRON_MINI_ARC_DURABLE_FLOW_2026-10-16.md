# ARC durable handoff and reply-state flow (local work, 2026-10-16)

This local change follows the
[Mini completion criteria](METRON_MINI_COMPLETION_CRITERIA_2026-10-14.md):
ARC is an ordinary signed-in external AI UI boundary, while Gateway and
MotherShip own durable context. A successful synthetic test is not a
successful authenticated ChatGPT experiment or completion of METRON.

## Existing assets checked before implementation

- app/src/main/assets/selector_picker.js and the documented Android picker
  round-trip retain a strong unique-target/open-shadow-root contract. This
  change preserves the current explicit Mini picker and sensitive-field
  exclusions; it does not claim new Android or closed-shadow support.
- app/src/main/assets/arc_core.js (baseline, generating markers, repeated
  observations) and AutoDom.kt (manual lock, repeated selector observation)
  supply bounded observation ideas. A pause or two equal samples is not
  adopted as proof of answer completion. AndroidBridge auto-posting and
  broad whole-page fallback selection are not imported.
- The old GatewayClient ACK accepts ok/retry strings, and the legacy GAS
  intake appends result rows. Those are not adopted as confirmed durable
  delivery or content-conflict semantics.
- reusable/gateway-jobs/persistent-gateway.mjs,
  reusable/mothership/mailbox.mjs, checkpoint.mjs and the Mini's existing
  same-ID conflict checks remain the persistence and delivery foundation.
- reusable/gateway-jobs/chunk-envelope.mjs is reused for ordered Base64 UTF-8,
  declared byte count, complete-chunk verification and SHA-256. Its Node
  implementation is not copied into the browser.
- The owned Chromium/loopback/load-barrier pattern in
  mini-work-browser.test.mjs is extracted for the new synthetic ARC harness.

Historical source references include picker work 0136bb1/da80a13/e337e40
and the checked chunk extraction 33b4e74. The historical files are preserved.

## Protocol and receiver authority

Protocol v2 delivers an explicit messageId with the full raw text, UTF-8 byte
count and digest. An ephemeral session/token still authorizes each individual
local request; it is not the logical identity. The ID is fixed before the
first delivery and must be reused after a lost ACK. A different ID remains a
different message even when the text is identical.

The receiver validates all metadata and uses the existing Gateway job as
the durable submission. The complete checked artifact is saved for B before
its mailbox reference and matching A ACK. A prior job cannot be silently
reused with different content. Accepted means persisted delivery and ACK
checks agree, rather than just a job ID or a successful HTTP exchange.

The normal mission/message limit is not relaxed. Long replies use an artifact
with a 256 KiB UTF-8 limit, 4096-byte chunks and a maximum of 64 chunks.
The ARC route has a bounded 2 MiB JSON request limit; unrelated routes retain
their existing limits. Data is rejected explicitly on size/Unicode/hash
failure, never silently shortened. Partial or corrupt artifacts are not
acknowledged as complete replies.

Receiver APIs are submitArc, arcStatus and arcArtifact on MetronMiniRuntime.
Status does not drain or mutate persisted state. The B-owned artifact is
arc-artifacts/B/<messageId>.json. A short mailbox reference fits the ordinary
envelope. The artifact, reference, job and matching A ACK are checked before
accepted is true. A crash can leave an unreferenced artifact, but not a
confirmed incomplete reply.

Legacy protocol remains compatible. The v2 contract is single-writer and
local; it does not add distributed trust, provider authentication or
external-side-effect exactly-once.

## Human control and response states

The input/send/response picks, login boundary, explicit send, capture,
forward and stop remain separate. Observers inspect only selected response
state and bounded UI signals; they never send to an AI or Gateway.

Known generation blocks capture. UI transitions may yield a completion
candidate only when generation, send readiness, baseline and text observation
agree. When the evidence is ambiguous, manual completion review is required.
The real-service detector is unverified and must be described that way.
A new send, reselection or content change revokes review and the snapshot.
Choosing a new record or resuming a recovery ID also revokes that capture.
The shared page DOM is not an authority to send: ARC action handlers reject
untrusted synthetic events. Native user input is required for picks, sends,
manual confirmation, capture, status, retry and stop. This is not protection
against a compromised browser or deceptive content around a real user click.

ARC has no persistent browser memory. An explicit new record obtains a new
ID; after overlay/page reload the user enters the receiver-owned recovery ID
to query or retry. Transparent automatic turn recovery is not claimed.
Stopping the overlay removes observers and prevents automatic activity; it
cannot recall a request already submitted to Mini.

The existing Gateway retry budget is retained. A dead original or ACK job
is reported as a terminal failure, with its stage and the same recovery ID;
ARC does not invite indefinite retries or invent a new identity. A supported
operator operation to revive a dead job after repairing its cause remains
unimplemented. Ordinary pending delivery, lost ACK and reload recovery do
not require such a revival.

## Reproducible local checks and remaining boundary

Relevant tests include the ARC handoff HTTP/VM suites, the durable delivery
suite and mini-arc-durable-browser.test.mjs. The latter runs actual ARC code
against synthetic DOM in a new owned Chromium profile, a test-only Chrome
API/background VM bridge, native trusted input into that owned browser,
and real isolated Mini persistence. It exercises
a paused partial response, long Unicode text, lost ACK, page/background
reload, explicit same-ID retry, same-text/different-ID delivery, content
conflict and stop.
Page-script forged picks/send/forward are also rejected. The input harness
attaches only to its newly spawned browser and exact loopback fixture; it
does not expose arbitrary browser commands or the user's browser session.

The harness does not install an extension, request actual browser permissions,
touch the user's profile, call an AI service, use CUA, or restart user apps.
A test-only bridge is not proof of real Chrome permission UX or isolated worlds.
Fixture reconstruction is not a whole-PC or live-service restart result.

The next live steps remain user confirmation of the installed ARC source,
applicable approval for any installation/reload, temporary localhost access
and harmless real-service test sends, then visible real reply/capture/receipt
and B readback. Host/PC restart continuity and real alternate-AI or general
unknown-fault repair are separate, still-unverified milestones.
