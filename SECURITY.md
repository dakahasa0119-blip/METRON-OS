# Security and publication scope

This repository contains **legacy experimental code** (Android WebView, Apps Script, Gateway, BAKU). It was not audited or hardened as a production service. The historical repository was already public before these documentation changes.

## Reuse with care

- Never paste active API tokens, OAuth secrets, cookies, private files or user conversations into bug reports.
- Historic paths, spreadsheet/project identifiers and hosted script URLs may be obsolete. Treat them as references, not safe deployment defaults.
- ARC's legacy browser automation includes code related to browser fingerprint and bot-detection behavior. This is **not part of the new `reusable/arc-dom` package**. Do not use the historical code to evade platform access controls or violate providers' terms.
- Running AI-generated code via dynamic evaluation, generic script deploy endpoints or arbitrary WebView JavaScript is hazardous. Build a sandbox, narrow execution capabilities, protect credentials, and validate operations independently.
- New `reusable/` components do **not** supply cryptographic authentication, secure distributed consensus, an isolated sandbox, audited parser or production-grade runtime.
- The isolated selector picker is for automation on pages you own or are authorized to inspect and operate.

## Vulnerability reports

Please use GitHub's private vulnerability reporting feature if enabled for this repository, rather than posting secrets or exploitable details in a public issue. If private reporting is unavailable, open a public issue without sensitive payloads and ask for a secure contact path.

## Licensing scope

Only `reusable/` is explicitly MIT licensed by the newly added license. Do not assume licensing rights for third-party, legacy or platform SDK code elsewhere in this repository.
