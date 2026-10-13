# Gateway source preservation gap — 2026-10-14 (read-only)

## Why this matters

The public historical GAS tree is not necessarily a complete export of the latest saved cloud Apps Script project. Missing modules must be inventoried before claiming complete publication or interpreting the absence of a relay function as proof it never existed.

A verified local archive, obtained on **2026-09-28**, includes an Apps Script source snapshot for a project recorded as `スマホgateway`. Its saved comparison against a historical Git commit reports **15 cloud project files**: four exactly identical, five with different bytes, and **six cloud-only** files. These are **snapshot-vs-historical-commit counts**, not a comparison against every subsequent repository edit. The archived manifest also records source SHA-256 verification.

## Six archived cloud-only modules

| Archived source file | Approximate source characters | Observed high-level interface |
| --- | ---: | --- |
| `gateway_admin_module.gs` | 2,715 | `createGatewayAdminModule` |
| `gateway_baku_external_code_module.gs` | 6,035 | `createGatewayBakuExternalCodeModule` |
| `gateway_baku_intake_module.gs` | 27,416 | `createGatewayBakuIntakeModule` |
| `gateway_mediation_module.gs` | 3,655 | `createGatewayMediationModule` |
| `gateway_queue_modules.gs` | 12,142 | `createGatewayRoutingQueueModule`, `createGatewayLeaseQueueModule` |
| `gateway_result_error_module.gs` | 2,982 | `createGatewayResultErrorModule` |

The scans were performed on the preserved UTF-8 local copies, without executing any project functions. None of these six files contains an explicit `SpreadsheetApp.openById` occurrence or the literal strings `MotherShip` / `MOTHERSHIP`; this **does not exclude** indirect cross-file calls through delegates, other files, configured destinations or historical revisions. In the inspected six, one `UrlFetchApp.fetch` occurrence is in the BAKU intake module.

The archive's `code.gs` (not cloud-only; a differently sized counterpart exists in the public repository) includes an `ACTIVE_MOTHERSHIP_ID` target switch and uses `SpreadsheetApp.openById` on a configured target in multiple locations. This supports **target selection/read/write capability**, not proof of an A-to-B conversation relay.

## Publication and security approach

- **Preserve first:** the complete cloud snapshot, comparison metadata and per-file hashes remain in the authorized local archive, separate from the public repository. No private logs or credentials were copied to GitHub in this audit.
- **Review before publishing historical code:** inspect the six modules for private URLs, tokens, user messages, embedded code or third-party material. A source archive should not be silently treated as a safe, fully licensed package.
- **Publish reusable concepts separately:** selected queue/mediation/intake methods can be distilled to dependency-free reference code with synthetic tests and explicit license scope, as done in `reusable/`.
- **Do not conflate versions:** the static Git snapshot, the September cloud snapshot, and historical January MotherShip conversations may describe different stages. None alone establishes end-to-end integration.

## Limits and next proof target

This inventory identifies a preservation gap and narrows the plausible locations for future investigation. It is **not** a functional test, source release, secret scan, or independent proof of deployed behavior. Establishing actual MotherShip A/B cross-file communication still requires a grounded route from source spreadsheet -> sending operation -> destination spreadsheet -> destination log/ACK (preferably with a unique message identifier).
