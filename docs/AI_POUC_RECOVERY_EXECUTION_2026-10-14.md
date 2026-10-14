# METRON AI Consensus, PoUC and BAKU Recovery — 2026-10-14

This Mini OS extension follows the **original** METRON architectural boundaries:
each village has its own MotherShip A/B and Gateway; Village Square uses Rumor JSON.
These capabilities add to the original architecture, not alternative demo features.

## External AI three-party consultation

The module at mini/ai-consensus.mjs uses three **real supported provider API
endpoints**: OpenAI Responses API, Gemini GenerateContent, Anthropic Messages.
Each receives a separate protocol-sheet consultation and produces a provider
and model-labelled answer. If one provider fails, the result is BLOCKED, not a
fabricated consensus. No provider is given another provider's answer before
generating its own. No model reply has execution/deployment authority.

Environment configuration, never committed:
- OPENAI_API_KEY with METRON_OPENAI_MODEL
- GEMINI_API_KEY with METRON_GEMINI_MODEL
- ANTHROPIC_API_KEY with METRON_CLAUDE_MODEL

The Mini user must give **per-request explicit consent** before contacting
real provider APIs, which may incur usage fees. Consumer product subscriptions
do not automatically authorize provider API billing. Keys are read from the
Node process environment and never returned or persisted by Mini. API
questions and replies remain transient in Mini's memory (the providers
receive the submitted prompt according to their own service terms).

## Independent local LLM final judgment

Only after all three authentic provider responses exist does Mini request a
separate final nonbinding recommendation from **Ollama** using localhost
http://127.0.0.1:11434/api/generate and the METRON_LOCAL_MODEL environment
setting. If Ollama or the selected model is unavailable, the verdict is
BLOCKED, with no heuristic or fictional AI answer. The model is not allowed
to approve or apply code repairs.

Observed on the connected Windows host: Ollama, Gemini CLI and standalone
llama-server were absent/not serving; the Claude Code executable existed.
No actual complete three-provider and local final-decision run was possible
without separate model installation/authentication. Test-fixture HTTP
responses validate protocol wiring only and **are not claimed as actual AI
reasoning**.

## PoUC — Proof of Useful Computation

The mini/pouc.mjs module performs bounded useful candidate-source work:
syntax compilation without executing the code, BAKU DNA extraction and risk
flag classification. It creates a SHA-256 receipt and **recomputes** the
complete result before accepting a contribution into an atomic local ledger.
Duplicate receipts do not earn another credit.

No currency, token payout, third-party mining workload, peer-node consensus
or distributed trust protocol is implemented. This provides a real *class
of useful work* for later PoUC federation; it does not prove the candidate
functionally fixed a defect. Production repair success remains false.

## BAKU bounded automatic repair/recovery

The mini/isolated-repair.mjs module runs a real recovery sequence inside an
ephemeral isolated directory only:

1. Record a pinned and syntax-checked known-good source backup.
2. Actually corrupt a synthetic source file.
3. Detect a real compilation/syntax failure.
4. Restore from the verified original source.
5. Recompile, hash, read back, and independently compare the target.
6. Persist a recovery receipt, then remove only its own disposable test files.

No original user projects or active GAS/Android sources are changed. This is
verified **known-good recovery** on an isolated target, not safe unattended
repair of arbitrary unknown application bugs. Such general self-repair requires
isolated trusted execution, behavioral tests, authenticated evidence and an
authorization policy before any production deployment.

## UI and boundary

Start: node mini/start.mjs, visit http://127.0.0.1:8766/experience
and use chapters 06–08.

- GET /api/advanced/status returns configuration availability (no keys).
- POST /api/advanced/action supports consult (requires explicit consent),
  pouc (performs and independently rechecks bounded useful work), and repair
  (isolated real known-good recovery).
- All writes are within Mini's disposable/test environment or its own PoUC
  local ledger. No arbitrary network URLs, shell tools, cross-origin API calls
  or unattended source application.

Full genuine tri-model + local-model evaluation and generalized fully
autonomous repair are **NOT complete** on the observed host. No fixture result
is presented as a real external AI verdict.
