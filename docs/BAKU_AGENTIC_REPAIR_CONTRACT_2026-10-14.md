# BAKU — Agentic Repair Contract (2026-10-14)

## Core correction

**BAKU's target repair behavior is the same work a capable coding assistant
performs with authorized tools**. It is not a limited expression-mutation
algorithm, a hard-coded patch template, or a known-good-copy recovery.

BAKU must use a real reasoning-capable AI with the ability, through guarded
tools, to investigate, edit, test, critique failures and iterate. The AI
model is the **repair reasoner**; source control, IDE, local worktrees,
independent testing, memory, authorization and Gateway transport are its
tooling and safety infrastructure.

The original METRON concept includes collaboration among MotherShip,
Gateway, ARC and BAKU. They must not be substituted with differently named
synthetic functionality just because the release is called "Mini".

## Required closed loop

1. **Detect and reproduce** a real fault: user symptom, monitor, failing
   runtime behavior, logs, commit or deployment reference. Establish an
   authorized source scope and pinned baseline.
2. **Inspect and understand** all relevant code, dependencies, existing
   tests, Git history and integration assumptions. Record evidence from
   actual filesystem/tool reads, not from a model's memory or claims.
3. **Reason** using a real AI agent. Investigate alternative root causes,
   include prior failed attempts and ask other models when appropriate.
   No fixed string rule substitutes for this reasoning stage.
4. **Write a proposed repair** to an *isolated, version-pinned* branch or
   worktree. Change the necessary files, including regression tests.
   Never let an LLM directly mutate the active production workspace.
5. **Independently verify** the actual build, reproducer, unit/integration
   and separate regression tests. Read back the candidate, compare the
   real diff and check changed-file scope, dependencies and rollback.
6. **Retry based on real failures:** feed actual exit codes, exceptions,
   logs, test deltas and previous hypotheses back into the model.
   Bound attempts and preserve the entire evidence history; failure,
   timeout and unsupported issues must remain honest non-success states.
7. **Integrate safely** only after the required evidence and explicit
   project-owner authorization, followed by real post-apply readback,
   behavior checks and a trustworthy rollback policy.
8. **Retain reusable knowledge:** salvage DNA, diagnosed failure mode,
   source digests, tested candidates, rejected hypotheses, known limits,
   restoration details and evidence lineage in BAKU's memory/vault.

This is one repair **incident**, regardless of how many model retries or
patch variants are attempted.

## Original-source evidence

- `modules/gas/BAKU/BAKU_SalvageEngine.js` has DNA extraction,
  dependency ordering and core reconstruction.
- `modules/gas/BAKU/METRON_EVO.js` includes AI-prompted patch/JSON repair,
  patch handling, self-rebuild and code update paths.
- `modules/gas/BAKU/METRON_AutoPatrol.js` links scanning, DNA installation,
  self-rebuild, evolution and patrol.
- Old GAS API success codes and discarded invalid patches do **not**
  independently establish a functional repair.

## Roles and evidence

| Stage | Responsible layer | Required real evidence |
| --- | --- | --- |
| Intake and supervision | BAKU + Gateway | Incident ID, owner, baseline revision, failing behavior |
| Long-term continuity | MotherShip + BAKU vault | Scope, context, prior attempts, causal hypotheses |
| Candidate generation | Real coding agent (LLM) | Authenticated model invocation, proposed diff |
| File operations | Authorized ARC/PC/IDE adapter | Actual tool receipts, workspace and file digests |
| Test execution | Independent trusted verifier | Reproducer, regression, build, readback and rollback checks |
| Correction and iteration | AI agent + BAKU loop | Real failed test output and next change |
| Deployment | Independent authorization gate | Explicit approval, exact commit, post-apply verification |
| Preservation | BAKU DNA/knowledge store | Cause, rejected variants, verified result, provenance |

The actual AI agent needs authenticated tool access. A plain chatbot
response is not a completed file edit, and a passing self-authored test
is not independent evidence. Model-provided scripts must not be executed
unrestricted on the user's host.

## What existing Mini code really supplies

- `mini/behavioral-repair.mjs`: a narrowly scoped, nonexecuting
  pure-function candidate heuristic; **not the BAKU agent**.
- `mini/isolated-repair.mjs`: actual known-good restoration within a
  disposable workspace; a fallback/rollback component.
- `mini/pouc.mjs`: bounded useful computation receipts, not reasoning.
- `mini/ai-consensus.mjs`: optional real-model API adapters with provider
  setup and local LLM still required for live verdicts.
- `reusable/gateway-jobs`: persisted jobs, leases, worktree hashes,
  signed-check reference receipts and replay state.
- `reusable/baku-dna`: cards/salvage and honest incident benchmarking.

These helpers support the real BAKU architecture but **do not themselves
perform an end-to-end agentic repair**.

## Correct minimum usable BAKU

A true BAKU Mini is an actual *small-scope deployment of the same loop*,
not a different algorithm. Limit it to one authorized disposable Git
project and one real coding agent initially, but preserve these essentials:

- The reporter gives a failing problem without a supplied correct patch.
- The agent actually reads multiple relevant files and source history.
- The agent makes and tests a candidate in an isolated workspace.
- If that candidate fails, actual test feedback drives a revised patch.
- Independent validation checks both the reproduction and regressions,
  identifies unsupported/unsafe cases, and never conflates HTTP 200 with
  deployment success.
- Restart does not lose the incident context or repeat a dangerous action.
- BAKU records hypotheses, source fingerprints and traceable evidence.
- Authorizing application and validating live post-apply behavior are
  separate from model-generated "completed" text.

A meaningful test must use independently chosen, previously unseen
bugs in at least two small repositories with sealed acceptance tests;
count every distinct incident, including failure and refusal, and
separately report post-apply observations.

## Current status (no fabricated success)

BAKU in the released Mini does **not yet** have this complete agent
control loop. Recent METRON repository edits were actually completed by
the ChatGPT assistant through authenticated GitHub/PC tools, not by Mini
BAKU acting independently. That working *human-supervised workflow* is the
functional model that BAKU must embody.

Never describe limited operator mutation, example rollback or fixed
strings as "BAKU's complete autonomous self-repair". Preserve them as
narrow supporting components with explicit evidence limits.
