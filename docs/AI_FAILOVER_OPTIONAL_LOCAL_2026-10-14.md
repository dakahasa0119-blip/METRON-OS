# METRON AI substitution policy

Local LLM is **optional**. An available capable AI can serve as the
final-judgment advisor. No AI output is authority to apply production patches.

- ARC continues to use the ordinary logged-in browser UI for ChatGPT and
  other services. CLI/API support in BAKU/METRON does not replace ARC.
- Gateway chooses among healthy providers based on the requested capability,
  declared availability, user preference and per-request external consent.
- A provider may substitute only if its adapter actually implements the
  requested role. Browser conversation capability does not imply file-editing
  or repair-tool capability.
- Failed model requests can fall through to the next eligible provider.
  The attempts and selected provider are returned; missing providers never
  produce fake model responses.
- If no capable provider exists, the task is blocked and must retain its
  pending context for later resumption.
- Human/project policy and independent test evidence remain required for
  deployment even when an AI makes a final recommendation.

Implementation: `mini/ai-failover.mjs` and
`optionalFinalDecision` in `mini/ai-consensus.mjs`.

**Current integration boundary:** The new selector and optional-decision
adapter are executable and tested. They are not yet connected to every
historical MotherShip, ARC browser, or production BAKU route. In particular,
the existing three-provider consultation function still has its own
three-response requirement; this change does not pretend that a failed
three-way consultation is automatically a successful consensus. An actual
final-answer provider adapter must be authenticated and connected before
the optional decision path can produce a live model answer.
