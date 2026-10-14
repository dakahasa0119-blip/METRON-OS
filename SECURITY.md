# Security and publication scope

This repository contains **legacy experimental code** (Android WebView, Apps Script, Gateway, BAKU). It was not audited or hardened as a production service. The historical repository was already public before these documentation changes.

## Reuse with care

- Never paste active API tokens, OAuth secrets, cookies, private files or user conversations into bug reports.
- Historic paths, spreadsheet/project identifiers and hosted script URLs may be obsolete. Treat them as references, not safe deployment defaults.
- ARC's legacy browser automation includes code related to browser fingerprint and bot-detection behavior. This is **not part of the new `reusable/arc-dom` package**. Do not use the historical code to evade platform access controls or violate providers' terms.
- Running AI-generated code via dynamic evaluation, generic script deploy endpoints or arbitrary WebView JavaScript is hazardous. Build a sandbox, narrow execution capabilities, protect credentials, and validate operations independently.
- New `reusable/` components do **not** supply cryptographic authentication, secure distributed consensus, an isolated sandbox, audited parser or production-grade runtime.
- The isolated selector picker is for automation on pages you own or are authorized to inspect and operate.

## METRON Mini local runtime

The runnable `mini/` integration intentionally binds only `127.0.0.1`.
It does not authenticate local processes or provide protection from users
sharing the same host. Messages and static inspection summaries persist
in a gitignored JSON directory; do not submit secrets or run two writer
processes using one data directory. Source snippets are not executed or saved,
but symbol names and risk flags are recorded. There is no external AI
access, automated code deployment or network-wide worker authorization.

## Vulnerability reports

Please use GitHub's private vulnerability reporting feature if enabled for this repository, rather than posting secrets or exploitable details in a public issue. If private reporting is unavailable, open a public issue without sensitive payloads and ask for a secure contact path.

## Licensing scope

First-party original METRON source is granted under Apache License 2.0 (root `LICENSE` and `NOTICE`), while `reusable/` is granted under MIT. See `LICENSING.md` for exceptions. This grant does not cover third-party bundled binaries, SDKs, other rightsholders' contributions, credentials, private logs or access to online services.

## Village Square concept experience

The `/experience` flow may store the user's supplied knowledge text in the
local `civilization.json` and in MotherShip/Gateway checkpoints. Avoid
secrets and sensitive material. Adoption is explicit; it is not automatic
instruction injection into a remote model. Generated inheritance proposals
are **deterministic fixtures**, not authenticated independent AI judgments.
The miniature Gateway and Village Square share one process and do not offer
multi-writer consistency or security boundaries against other local users.

## Village boundary correction

MotherShip A and B are internal cores of **one** user village, not two
villages. The corrected `civilization-v3.mjs` maintains separate village
checkpoint roots, and exchanges bounded Rumor JSON files through a
local shared-folder adapter. JSON SHA-256 does not authenticate external
senders. The owner configures the provisional noise filter level and makes
the final adopt/quarantine decision. Legacy `civilization.json` is retained
unaltered and not migrated into false village identities.

## Advanced Mini AI, PoUC and BAKU modes

Actual OpenAI, Gemini and Claude API requests require environment credentials,
model name, and **per-request explicit browser consent**. Real services may
charge the operator. No credentials are accepted in HTTP JSON bodies or
persisted by Mini. The only accepted local LLM endpoint is localhost Ollama
on port 11434; its outputs cannot approve deployment.

PoUC uses Node's syntax compiler without running submitted code, and stores
only proof metadata, not the raw proposed source. The repair lab touches only
a newly created temporary path and restores a deliberately injected syntax
fault from an independently checksum-pinned known-good source. This does
**not** provide a secure sandbox for hostile runtime execution or allow
unattended patching of a user's real repository.

## Black-box behavioral repair (bounded grammar)

The discover-repair action parses a tightly restricted subset of pure
single-return JavaScript functions using a purpose-built evaluator; arbitrary
JS code is never run, even inside Node's VM. A candidate must satisfy
all supplied development vectors AND a separate non-overlapping holdout
set. Code from normal applications is not accepted unless it fits this
grammar. All candidate file writes are to disposable temporary worktrees.
The API cannot apply a candidate to a user project. A supplied holdout set
is **not** a trusted external oracle. This does not constitute a safe
unrestricted production code-repair sandbox.

## Mini BAKU coding-model runner

The new agentic repair feature only edits two hardcoded, first-party source
files in a copied, disposable fixture. A genuinely configured Ollama or
OpenAI model may propose changes; it cannot choose its own commands or
modify hidden tests. Node Permission Model and subprocess timeouts reduce
risk but are **not a secure sandbox for running hostile model-generated
programs**. Do not expose the Mini server on a public interface or use
this code to test untrusted arbitrary repositories. Provider credentials
are read only from the Node process environment, never returned to the
browser. The repair incident journal may preserve proposed source content
and model diagnosis, so keep its directory private.
