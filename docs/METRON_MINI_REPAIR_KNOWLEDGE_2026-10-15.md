# Verified repair knowledge between Mini villages

This connects a verified village work result to a reviewed Rumor, the other
village's explicit adoption and a later work's saved context. It addresses
completion criteria D10/D11. It does not establish signed-in ChatGPT ARC E2E,
an embedded general-purpose coding agent, live model substitution, safe
production application or completion of METRON Mini as a whole.

## Explicit operations

1. Open a saved work with a verified candidate. Its existing sharing draft
   is private to that village's work ledger.
2. Review the public body, cause, applicability and limitations. Save these
   three summary fields to prepare a `metron-rumor-v2` draft. The server binds
   its candidate and verification fingerprints to the saved verified result.
   Saving a body alone retains the older private V1 draft; it cannot be
   published through the repair-publication action.
3. Inspect the complete prepared JSON and explicitly approve publication to
   the local Village Square. The operation names the exact reviewed SHA-256.
   This consent is separate from model-call consent. No Internet publication
   or model invocation occurs.
4. The other village explicitly receives the actual JSON file through its
   own Gateway. Its status is pending; reception does not adopt knowledge.
   Review the sender's evidence and choose adopt or quarantine.
5. Only adopted knowledge is selectable for a later work. The work preserves
   the origin village, parent Rumor, Rumor digest and repair evidence in its
   incident context. A later Rumor may retain the parent ID.
   If selected evidence exceeds the runner's 12 KiB context budget, select
   fewer records. Work creation rejects the excess instead of truncating
   provenance or saving a work that cannot be run.

The publication action is `POST /api/work/action` with `action: "publish-share"`,
the village/work IDs, `reviewedRumorSha256` and `allowPublish: true`. Existing
loopback, same-origin, JSON and explicit-request-header restrictions apply.
The request cannot supply its own candidate commit, validation result or
public evidence record. `prepare-share` accepts the separately reviewed
`repairSummary: {diagnosis, applicability, limitations}`.

## Durable publication and privacy boundary

The exact prepared Rumor and publication intent are saved before the shared
file is written. Publication retains that Rumor's ID and digest. A repeated
request checks the saved bytes and does not create another Rumor or Gateway
job. A stop before/after the shared write leaves an explicit continuation;
restarting only reads the intent. The user must review and repeat the same
request to resolve an uncertain outcome. A started publication freezes its
draft so it cannot silently change while an outcome is unknown.

The public record contains the reviewed summary, candidate fingerprints,
verification-output fingerprints, scope, model provenance and the statement
that no production application occurred. Private source answers, goals,
work/run identifiers, source code, raw logs and invocation histories are not
copied automatically. Human-entered prose still requires review: this is
an explicit field boundary, not a content-redaction or data-loss-prevention
system. The separate private work record retains the publication mapping.

## Format and trust

Existing nine-field `metron-rumor-v1` records remain supported unchanged.
V2 adds a strict, bounded `repairEvidence` object and includes it in the
content digest. Receipts and adopted knowledge retain the same evidence.
Evidence removal/substitution, digest conflicts and changed origin/content
are rejected when receiving, adopting or binding knowledge to work.
The shared proof must remain available for these checks. A missing or changed
file returns an unavailable-evidence response; it must not terminate the
local HTTP server or be replaced with an invented successful claim.

SHA-256 provides content consistency, not publisher authentication. A sender's
verified-result claim is not an independent verification by the receiving
village. A labelled injected test reasoner stays labelled in shared evidence;
it must never become a claim of real AI reasoning. Generic V1 text publication
does not acquire a repair-verification claim.

The deployment remains one trusted PC, separate village stores, a local shared
folder and one writer. It does not provide hostile multi-user isolation,
remote exactly-once side effects or authenticated P2P.

## Verification

`reusable/tests/mini-work-sharing.test.mjs` exercises real local HTTP, Gateway
delivery, Node test subprocesses, file readback, explicit consent, exact-hash
review, publication idempotency, interruption before/after the shared write,
restart, quarantine/adoption and provenance in the other village's next work.
Its model response is explicitly injected. Protocol and UI tests cover
strict format/tampering and publication controls separately. These are control
plane tests, not evidence of a normally logged-in external AI.

See the authoritative [Mini completion criteria](METRON_MINI_COMPLETION_CRITERIA_2026-10-14.md)
and [BAKU repair contract](BAKU_AGENTIC_REPAIR_CONTRACT_2026-10-14.md).
