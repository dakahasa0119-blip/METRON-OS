# METRON / BAKU Behavioral Repair — 2026-10-14

## Why the previous automatic recovery was insufficient

The earlier **isolated-repair** demonstration intentionally corrupted a
fixture then copied back a supplied known-good file. That proves restart/
restoration plumbing, **not** discovery and correction of a new bug.

The new **behavioral-repair** subsystem adds the first actual proposal search.
The system is NOT provided a correct source version. It receives a broken
function plus development input/output examples, generates source changes,
and evaluates them against behavior rather than comparing to a stored fixed
file.

## What genuinely runs

1. Parse a bounded, pure JavaScript single-return-expression function with a
   purpose-written limited expression interpreter. **Arbitrary JS is never
   executed**, and this is not a complete JavaScript parser.
2. Confirm that at least one development example fails on the original source.
3. Enumerate and individually test bounded single-edit mutation candidates:
   arithmetic, comparisons, Boolean operators and numeric literals.
4. **Select using development tests only**. Then independently score a
   separately supplied, non-overlapping holdout test set. The algorithm NEVER
   uses holdout results to rank candidates or retry until one passes.
5. If and only if the selected patch satisfies all separate holdout tests,
   write that source to a temporary disposable file, read the bytes back,
   recompute its SHA-256, and re-run the verification procedure. No user
   project file is changed.
6. Report the full candidate source and its exact mutation, digest, attempts,
   test denominators, and explicit \`applyAllowed:false\`.
7. If the bug cannot be reproduced, no candidate is found, the parser does
   not support the code, or holdout tests fail, report that state without a
   success claim. **Holdout rejection returns no patch to apply.**

## Coverage observed (bounded synthetic faults)

Tests deliberately provide faulty sources without supplying fixed versions:

| Previously unseen example | Discovered mutation | Status |
| --- | --- | --- |
| \`remaining(total,used)\` returns \`total + used\` | \`+\` to \`-\` | All supplied development + separate holdout examples passed |
| \`threshold(age)\` uses \`age > 18\` | \`>\` to \`>=\` | Passed supplied tests |
| \`permissive(owner,approved)\` uses \`&&\` | \`&&\` to \`||\` | Passed supplied tests |
| \`increment(x)\` uses wrong numeric literal \`+ 2\` | \`2\` to \`1\` | Passed supplied tests |
| \`minimum(a,b)\` uses opposite comparator | \`>\` to \`<\` | Passed supplied tests |

Additional negative tests demonstrate rejecting a development-only false
positive when the held-out vectors fail, returning \`unresolved\` for an
unsupported fix, leaving already passing programs unchanged, refusing
unsupported or potentially hostile code, and rejecting reused holdout vectors.

**These five cases are an initial functional validation of the repair search
method, NOT a measured real-world unknown-bug repair success rate.** The tests
are supplied by the evaluator/caller; there is not yet an authenticated,
independently controlled hidden oracle or distributed repair executor.

## Restricted domain

Source must be a **single JavaScript function** of the form:

\`\`\`js
function remaining(total, used) {
  return total + used;
}
\`\`\`

Its return expression may contain finite numbers, booleans, null, parameters,
parentheses, unary \`!\` / \`+\` / \`-\`, comparisons, arithmetic, logical operators
and ternary conditionals. No loops, external calls, properties, object
mutation, I/O, runtime eval, files, imports, arrow closures, or arbitrary
multi-statement code. Max 2200 characters of source, up to 4 arguments,
40 distinct development test vectors, 40 non-overlapping holdout vectors,
400 candidate edits and an operation budget per evaluation.

Only primitive arguments and results are accepted. These restrictions are
essential to keep the interpreter **non-executing**, rather than pretending
that Node's \`vm\` is a secure general sandbox for hostile JavaScript.

## What remains to reach the full METRON self-repair vision

- An actual unrestricted candidate generator using an authenticated local
  LLM and/or independently consulted external AIs, with a trustworthy
  transport and bounded memory/task policy.
- A dedicated isolated **real-code** test runner with deny-by-default
  capabilities, independent compiled/behavioral/regression tests, signed
  evidence, rollback controls and clean-room source ownership.
- Error intake from authorized live projects with structured diagnosis,
  long-lived knowledge of previous failures, and lineage of hypotheses.
- A rollback-capable application stage with explicit user/owner authorization
  and post-apply proof. No source changes occur without a validated policy.
- A diverse, independently labelled held-out corpus of real software
  faults rather than the five toy cases above.

Never equate the existence of a mutation engine with **complete** general
self-repair. The current implementation resolves a real, tightly bounded
class of previously unspecified defects; the broad vision remains open.

## Try it

With \`node mini/start.mjs\` running, open
\`http://127.0.0.1:8766/experience\` and use chapter 09:
**未知の不具合から修正候補を探索する**.

Alternatively call localhost POST \`/api/advanced/action\` with
\`X-Metron-Mini: 1\` and JSON:
\`\`\`json
{
  "action": "discover-repair",
  "source": "function remaining(total,used){return total + used;}",
  "developmentTests": [
    {"args":[10,3],"expected":7},
    {"args":[6,4],"expected":2}
  ],
  "holdoutTests": [
    {"args":[17,2],"expected":15},
    {"args":[3,9],"expected":-6}
  ]
}
\`\`\`

The response includes \`productionSourceUpdated:false\`. Never use a
candidate in a production project without independent review.
