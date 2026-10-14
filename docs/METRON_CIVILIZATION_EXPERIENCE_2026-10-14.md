# METRON original-architecture mini implementation — corrected 2026-10-14

## Critical correction: a village is NOT one MotherShip

The first published \`/experience\` incorrectly called MotherShip A and B two
different villages. **This was an implementation/modeling error.** They are
two internal MotherShip cores belonging to the **same user's village**.
Each village contains its own MotherShip cluster (A/B is the minimal pair),
Gateway, interface capabilities (ARC) and preservation capability (BAKU).

Original source: [METRON decentralized architecture Gist, 2026-02-05](https://gist.github.com/dakahasa0119-blip/a5e6fe11fbbcce76ff8957f6d77a2eb9).
It describes villages as independent user environments and Village Square as
the open Drive/Dropbox folder where **Rumor JSON** records are published and
read. The Gateway/Civilization Map indexes villages, routes work, maintains
long-lived memory, and lets users steer filtering. MotherShips do computation,
context and local synthesis. ARC is a low-state external AI interface and
BAKU preserves code/log/memory fragments through failures. External AI
tri-consensus and local-LLM final decision belong to the concept and are
**not implemented by a fake deterministic response**.

## Actual topology in the corrected local reference

\`\`\`text
User village 1 (local process/files)
  MotherShip A  <-->  MotherShip B   [ONE village, internal Gateway]
         |             |
       local Gateway + private knowledge-village-1.json
                   |
           public Rumor JSON
                   v
       Village Square folder  <------->  shared files
                   ^
           read/validate Rumor JSON
                   |
User village 2 (distinct local process-state/files)
  MotherShip A  <-->  MotherShip B   [ONE second village]
         |             |
       own Gateway + private knowledge-village-2.json
\`\`\`

\`mini/civilization-v3.mjs\` uses separate persisted MotherShip and Gateway
checkpoints **per village**. The two villages are emulated by separate file
roots within one trusted local process, because actual network P2P is not yet
implemented. A Rumor is a real versioned JSON file in the distinct local
\`village-square/rumors/\` folder (\`mini/rumor-protocol.mjs\`). JSON's SHA-256
guards against accidental mutation and tampering, **not authentication of its
claimed author**.

### A faithfully reduced functionality path

1. Within the first village, A/B coordination records a task through its
   own Gateway. This is **not** village-to-village traffic.
2. A short Rumor JSON is published into the shared Village Square folder.
   No other village automatically imports or adopts it.
3. The second village's own Gateway **reads** the actual file into its local
   A/B processing path. The user can configure the receiving Gateway's noise
   checking strength (0/1/2) and see advisory warning flags.
4. The user makes the final adopt/quarantine decision. Only adoption adds
   knowledge to the second village, preserving the origin village ID and
   parent Rumor ID. Repeating a receive does not duplicate the local record.
5. BAKU performs real lexical code-card extraction from the **user-provided
   text** (never executes or saves that source). Gateway's actual local
   lease/crash/replay module can be exercised independently.
6. Another Rumor can be published from village 2 back to village 1 by the
   **same format and procedure**, rather than a fabricated "AI reasoned"
   auto-response.

### Not silently replaced by other features

The original multi-model consultation, consensus protocol sheet, local LLM's
final judgment, PoUC mining and autonomous code evolution are not emulated
by fabricated deterministic AI decisions. They remain explicitly marked
\`not_connected\` until the actual interfaces exist. The simplified noise
rule is a labelled provisional heuristic, not a claim to reproduce a complete
historical Gateway filter implementation. ARC can be used only on the
Mini's same-origin local page at this point; this is not an authorized
third-party model interface.

### Backward compatibility

The old \`civilization.json\` file from the incorrectly modeled V1
experience is **preserved, unmodified and never automatically interpreted as
a current village state**. V3 stores village 1 and 2 knowledge separately
in \`village-1-knowledge.json\` and \`village-2-knowledge.json\`, with a new
Village Square files directory. Original Mini's \`mother-A.json\` and
\`mother-B.json\` are still **both part of village 1**, not one village each.
Village 2's separate MotherShip A/B stores live under \`village-2/\`.

### Limits and evidence

The new tests must establish topology, real Rumor serialization,
independent receiving Gateway, user-configurable noise advice,
nonautomatic adoption, provenance, restart persistence and corruption
rejection. They cannot prove real cloud P2P, external AI independent
judgment, authenticated Rumor origin, or historical MotherShip federation.
Do not use these restricted paths for sensitive real messages or production
network exposure.

**Mini is a minimal implementation of the original protocol, not a license
to design a different METRON system just because it is a demo.**
