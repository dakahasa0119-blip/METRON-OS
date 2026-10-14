# METRON Mini: BAKU Coding-Agent Workflow

## This is the start of a real BAKU, not a toy expression mutation

\`mini/agentic-runner.mjs\` integrates an actual reasoning model (local Ollama
or the OpenAI Responses API, if authenticated) with tools that read a small
real two-file project, run **real tests in a separate Node.js process**,
record failures, request updated AI patches and independently verify the
result against a test file **never supplied to the model**.

The working model is:

1. Read trusted source and a public reproducer from two files.
2. Run public tests **before repair** and capture an actual failure.
3. Ask the real configured coding LLM to diagnose and suggest full-file edits,
   with all relevant visible source and prior failure evidence.
4. Permit source updates only inside a newly created disposable checkout,
   and only to two explicitly allowlisted source files.
5. Run tests in a child Node process with Node Permission Model restricting
   filesystem reading and denying subprocess/network/fs write by default.
6. If a candidate fails public tests, save the real error/attempt digest and
   provide it to the model to improve the next attempt (up to three).
7. If a candidate passes public tests, run separately held-out acceptance
   tests once. If these fail, **reject and do not ask the model to optimize
   against hidden tests**.
8. Read back the edited files, produce candidate SHA-256, retain an atomic
   JSON incident journal, then delete the disposable checkout.
9. **Never apply to the installed Mini or user files automatically.**

## Included first-party fixture

\`mini/fixtures/pricing/src/pricing.mjs\` and \`src/invoice.mjs\`
contain a deliberately broken discounted-ticket invoice calculation.
The visible reproducer is \`tests/public.test.mjs\`, while
\`tests/holdout.test.mjs\` is read by the test runner only and excluded
from all model prompts.

The model is NOT given a known-good implementation or a fixed patch.

The source fixture is currently the **only project this agent can edit**.
This is deliberate: the application does not yet implement a trusted
sandbox for arbitrary user repositories. A future generalization may accept
user-authorized Git worktrees with independent verification, signed evidence
and explicit integration approvals.

## Running with a real model

Start METRON Mini and visit its \`/experience\` page, chapter 10.

For Ollama, install Ollama separately, pull a code-capable model and set
\`METRON_LOCAL_MODEL\` in the environment that launches METRON Mini.
Choose **Ollama** on the page. The model must actually answer at
\`http://127.0.0.1:11434/api/generate\`. A model-name setting is not proof
of model availability. Absence of the actual model returns **blocked**.

Alternatively set \`OPENAI_API_KEY\` and \`METRON_REPAIR_MODEL\`, choose
**OpenAI** in the UI, and consent to that **specific** external request
before running. Real API usage may incur fees. The tool does not accept
arbitrary URLs or an API key pasted into a browser form.

The current connected PC had **no running Ollama model**, and no confirmed
OpenAI API credentials. Therefore the project cannot honestly claim that
the live model performed an autonomous repair on that PC yet.

## Evidence versus simulation

The actual Node test suite uses a **labelled injected model response**
for regression testing of the orchestration. The fixture responder first
fixes the per-item discount but misses the invoice multiplication, causing
a real public test failure. A second response proposes the companion
module correction; separate Node tests then pass, and the final candidate
is read back and checkpointed.

**This demonstrates the orchestration, iterative tool feedback, actual
source changes in a disposable copy and real test execution. It is not a
demonstration of autonomous reasoning by an authenticated external/local
LLM.** Real model usage is optional and fail-closed.

### Current trust and product limits

- This is a developer demo with one first-party multi-file project, not
  a general software repair service.
- Running model-written JavaScript, even with Node Permission Model enabled,
  is **not a fully secure untrusted-code sandbox**; operate only on
  isolated trusted systems. Do not expose Mini to untrusted local users
  or a public network.
- The source allowlist, denied host/network imports, max test time,
  output bounds, timeout and per-run scratch folder reduce risk but
  cannot establish perfect code execution isolation.
- The incident journal contains diagnosis, test excerpts and hashes.
  Avoid placing sensitive data in test prompts or source files.
- Tests, model output and historical incident evidence have different
  provenance; the model's own statement never approves patch integration.
- Real model may generate incorrect JSON, unsafe source or incomplete fixes.
  Such cases are blocked/unresolved; they are not counted as success.
- No automatic production deployment, cross-machine village federation,
  trusted worker attestation, unknown-fault performance guarantee or
  arbitrary app rewrite is included.
- Local Ollama is supported for independent coding work and final judgment,
  but real external AI three-party consensus requires the separate
  connector settings already described in the main Mini documentation.

This is the smallest original-style **agent-driven closed repair loop**
supported by the currently available architecture. Generalized live BAKU
remains tracked under issue #117.
