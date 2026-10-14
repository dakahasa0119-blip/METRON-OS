# Experience METRON's original idea — 2026-10-14

## Why the Mini console was not enough

Sending one message from MotherShip A through Gateway to MotherShip B proves a
piece of delivery infrastructure, but it does not show what **METRON** is
trying to create. The historical concept described an architecture where
independent AI communities retain context and distinct identities, communicate
through a Village Square, share knowledge subject to local policies, and
survive system failures with help from ARC, Gateway and BAKU.

Relevant project evidence:
- [METRON architecture notes](../METRON_ARCHITECTURE_NOTES.md):
  independent MotherShip cores, Village Square exchanging Rumor JSON,
  Gateway civilization map/long memory, stateless ARC hands, BAKU salvage.
- [Historical implementation evidence](IMPLEMENTATION_STATUS.md): legacy
  components are real, but multi-MotherShip autonomous P2P is not proven.
- [Portable Mini](../mini/README.md): working loopback delivery and readback,
  which is a platform for (not the entirety of) civilization experiences.

## New guided experience — playable locally

Launch \`node mini/start.mjs\`, then visit
**http://127.0.0.1:8766/experience**.

1. **Meet A and B:** two village identities and distinct starting knowledge
   are displayed. Existing Mini A/B transport inboxes use separate persisted
   JSON files. The new educational knowledge policies are logically
   partitioned in a local civilization ledger.
2. **Share a Rumor:** A submits knowledge to the Village Square. A real
   Gateway \`PersistentGateway\` queue routes the message to B's persisted
   inbox, and a reverse ACK is recorded in A's inbox. The knowledge is a
   *proposal*, not automatically trusted.
3. **Adopt or quarantine:** the participant acts as the receiving village's
   human reviewer. The decision is recorded; adoption adds a new knowledge
   entry to the recipient, retaining the original message ID as provenance.
   Quarantining does not modify the recipient's knowledge.
4. **Pass the knowledge back:** after B adopts an A proposal, a **fixed,
   deterministic demonstration rule** constructs a derived proposal from B
   back to A. A then independently decides whether to adopt it. The parent
   Rumor ID is preserved to show lineage; **this is not original AI insight**.
5. **Salvage and continuity:** BAKU lexically extracts a named code card from
   a *synthetic* unsafe snippet and quarantines it, without executing or
   fixing code. A separate real local Gateway crash/replay fixture demonstrates
   deduplicated delivery after an ACK is lost.

The real state is persisted to the local, gitignored
\`.metron-mini-data/civilization.json\`; it works with the original Mini's
separately persisted MotherShip and Gateway JSON files. No AI provider,
third-party website, private Drive resource, Android session or GAS
deployment is accessed.

## What the participant is meant to understand

- **Independent communities:** sharing does not automatically overwrite
  another village's knowledge.
- **Civilization:** knowledge may flow, be reviewed, inherited and given
  explicit provenance rather than merely generating text in one session.
- **Gateway:** an interface and transportation/recovery layer between
  humans and communities, not proof of direct, fully autonomous peer-to-peer
  AI-to-AI messages.
- **Stateless ARC:** actions should be isolated from durable, policy-bearing
  long-term memory, limiting input contamination.
- **BAKU:** salvage, quarantine and restoration come before unverified
  self-modification.
- **Trust boundary:** deterministic steps are clearly shown as an educational
  simulation; there is no pretend autonomous intelligence or functional
  unknown-bug self-repair.

## Validation and next step

The new contract tests check distinct village identity/knowledge, real
Gateway+ACK delivery, human adoption/quarantine, parent lineage for derived
proposals, restart persistence, isolated recovery, static BAKU salvage,
non-authorization of cross-origin API requests and real Chromium rendering.

To progress from this concept experience to a convincing autonomous METRON
pilot, separately integrate a legitimately authenticated AI engine as one
village's **reasoner** with strict memory/proposal isolation. Let an independent
trusted host review tests, evidence and proposed state updates. Do not
fabricate an AI decision by selecting a hard-coded rule or by treating a
200 OK as verified AI behavior.

This is a first playable educational slice of the METRON concept, **not** a
claim that a self-organizing AI civilization already exists.
