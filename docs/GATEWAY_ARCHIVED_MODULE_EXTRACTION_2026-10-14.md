# Gateway archived-module review and portable extraction — 2026-10-14

## Sources and boundaries

Six GAS modules existed in the verified 2026-09-28 cloud-source archive but were absent from the earlier public Git snapshot (see [source-gap inventory](GATEWAY_CLOUD_SOURCE_GAP_2026-10-14.md)). This review used read-only local archived source files. No private source contents, credentials, user messages, sheet rows, endpoints or authentication details were copied into the new public modules. The new code was separately written as **minimal Node.js reference implementations**.

| Archived module | Observed responsibility | Treatment in portable toolkit |
| --- | --- | --- |
| `gateway_admin_module.gs` | Recent-window job/error/audit summaries, stale lease indicators | Keep as historical reference; production metric validity requires normalized denominators and audit evidence |
| `gateway_baku_external_code_module.gs` | Manifest-triggered multi-chunk BAKU source reconstruction and code inbox | **New:** independent all-or-nothing chunk envelope with SHA-256 and byte checks |
| `gateway_baku_intake_module.gs` | External repair-intake constraints, preserve/prohibit rules, critical-scope signals, candidate submission | Future research: isolated policy validator; no live repair/deploy or auth duplication |
| `gateway_mediation_module.gs` | Intent keyword classification and route recommendations | **New:** advisory-only classifier, with no execution or grant of authorization |
| `gateway_queue_modules.gs` | Enqueue/dedupe, chat routing cursor, worker lease, control-first dispatch, maintenance | Existing `JobQueue`/`PersistentGateway` implement related generic mechanisms; archived GAS behavior not ported unchanged |
| `gateway_result_error_module.gs` | Error retry policy, worker pinning, retry backoff, marking terminal | Existing `JobQueue` already covers retry/backoff/dead-letter primitives; no direct source transplant |

## Why two functions were selected

1. The old BAKU external-code intake counted present chunks and marked absent chunks as `partial`, but also produced a reconstructed string and a limited code excerpt for the inbox. It computed a digest **after** assembly rather than validating the result against an independently supplied expected digest. The new `chunk-envelope.mjs` instead requires an exact versioned manifest, byte count, ordered keys and SHA-256, returning **no artifact** if any check fails. It uses Base64 for UTF-8 safe byte chunking. This is not wire-compatible with the historical GAS envelope and must not be silently enabled on live sources.
2. The archived mediation helper could **recommend** ARC for uncategorized chat, and flag `repair` before review/strategy intent if both occurred. Its reply already had a confirmation hint, but a hint is not an authorization boundary. The new `mediation-advice.mjs` has no executor or network calls, returns `executionAuthorized: false` for every classification, and chooses analysis-only for uncategorized chat. Keywords are intentionally non-authoritative.

## Testable scope

- `createChunkedArtifact` + `verifyChunkedArtifact`: deterministic synthetic round-trip with Japanese/emoji text; missing/reordered/duplicated chunks; bytes, digest and budget mismatches; malformed metadata; canonical Base64.
- `adviseGatewayRoute`: repair/execute suggestions require explicit confirmation by a **separate trusted application**; strategy/review/chat remain analysis-only; ambiguous combined keywords never automatically grant permission.
- The existing rest of the METRON reusable toolkit remains independent of the original GAS runtime. All tests run without exposing code to an external AI service.

## Threat model and limitations

A self-declared SHA-256 checksum detects mismatches against that manifest, not malicious replacement of both manifest and payload. Production use needs an authenticated, uniquely bound manifest, replay prevention, confidential storage, sender/receiver permissions, exact-once side-effect protection, independent functional verification and rollback. No such system-level guarantees are claimed here.

The archived code and cloud-vs-Git comparison reflect historical snapshots at different dates. Neither this review nor these new reference modules proves the complete legacy METRON OS–Gateway–BAKU–ARC pipeline operated end-to-end. Original GAS projects, private Google Sheets and Android deployments were not modified.
