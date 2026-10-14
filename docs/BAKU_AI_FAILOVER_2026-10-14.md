# BAKU provider failover integration

The actual `mini/agentic-runner.mjs` now supports an ordered repair
provider list. If local Ollama is unavailable, an explicitly authorized
OpenAI API model can take over the same repair prompt, code context,
public failure evidence and persisted incident history.

The integration does not manufacture answers, change hidden tests, or
apply a model's code to production. Every provider failure and the
selected provider are recorded. It is possible to resume a pinned incident
after restart using the same provider order.

Current live repair adapters: Ollama and OpenAI Responses API. Other
model roles in the general selector are not automatically repair-capable.
ARC remains the separate ordinary-login browser UI path.

External fallback is subject to per-request consent and may cost money.
No external request is made merely because a local model is absent unless
the user explicitly authorizes external calls.

Automated tests use explicitly labelled HTTP model fixtures, while real
Node subprocesses run public and held-out acceptance tests. A real
authenticated model repair on the observed PC has not yet been proven.
