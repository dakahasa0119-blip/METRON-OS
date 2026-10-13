# Signed Repair Test Receipt Prototype — 2026-10-14

## What changed

Previously, \`assessRepairEvidence\` checked only internally consistent, unsigned caller-provided test receipt JSON. The new portable \`signed-receipts.mjs\` introduces a strictly versioned **Ed25519** signature over a fixed canonical field set: key ID, runner ID, audience, single-use nonce, candidate SHA-256, suite SHA-256, one of four check kinds, counts, exit status and expiration timestamps. Any undeclared key, signature tampering, digest mismatch, expired time, unpinned key, mismatched runner/audience or duplicate check kind blocks the report.

A separate Node.js process signs test fixtures and the parent verifies with its independently supplied pinned public key in synthetic tests. No private keys are included in the repository. Successful signature checks are then reconciled with the existing conservative readback and rollback evidence checker; results remain \`review_required\`, **never authorized to deploy**.

## Trust boundaries and limitations

A signature validates only that the private key controlling the claimed runner identity signed the receipt. It does not force a real compiler or test suite to run. In particular:

- The isolated-process test deliberately uses ephemeral fixture keys handed to a local child over stdin. **This is not a secure production key-distribution pattern.**
- The verifier requires a verifier-generated nonce, but replay protection uses a caller-owned in-memory \`Set\`. A trusted single writer must persist that state durably before treating a bundle as accepted across restarts.
- Key authenticity and revocation, approved runner identities, immutable source checkout, suite provenance, signed test logs and real operation authorization are **outside this reference**.
- No old GAS script, BAKU repair worker, private Drive sheet, ARC WebView, actual hosted CI or other live application was changed or exercised.

## Next milestone

A trusted runner would hold the private key outside the repository, independently check a pinned worktree, launch a fixed allowlisted test suite, bind actual exit codes and cryptographic logs to the candidate digest, sign the result, and let a separate verifier check the immutable suite identity and replay ledger. Applying or deploying the patch would require an additional explicit user authorization and post-deploy readback.

This prototype supports issue #103 as a **cryptographic building block**; it does not close the end-to-end trusted attestation or approval issue.

## Follow-up: single-writer durable replay ledger

The `persistent-receipts` subpath checkpoints a consumed verifier challenge
before returning a verified status, failing closed on storage errors and
rejecting an already consumed challenge after a local process restart.
It uses the existing atomic JSON writer and explicitly supports only one
writer per checkpoint file. The signing-key lifecycle, trusted test runner,
multi-writer coordination and actual deployment approval remain unresolved.
