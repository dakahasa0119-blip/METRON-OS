# METRON implementation status and evidence notes

These claims distinguish **design**, **source exists**, **observable historical output**, and **fully validated deployment**. A status log is not by itself proof of independent successful execution. Historical Drive logs are intentionally not republished: they may contain user conversations, scripts, endpoints or sensitive context.

| Area | Code or archive | Observed evidence | Limits and discrepancies |
| --- | --- | --- | --- |
| Yume Engine predecessor | December 2025 planning Docs and GAS spreadsheets | A transport sample stored 10 assigned users across two vehicles, with a constrained output; execution logs show repairs and failures | Snapshot only. No general correctness proof or complete original revision provenance |
| MotherShip A/B | `modules/gas/METRON_OS_B/Communication_Manager.js`, `Strategic_AI.js` | OBSERVE, ACK, STATE and PROPOSE rows saved in MotherShip A/B sheets (2026-01-31) | This code dispatches within tabs of its own spreadsheet. A and B exist as separate spreadsheets but the cross-spreadsheet transport path has **not** yet been independently reproduced. Messages shown are mostly fixed-response templates and repeats |
| MotherShip evolution | `Core_Evolution_Engine.js`, `METRON_GATEWAY_BRIDGE.js` | Staged candidates and timeline state transitions | One code path marks `PATCH_APPLIED` after asking ARC to apply; no readback proof at that point. The portable workflow module fixes this conceptual distinction |
| Gateway → ARC | `gateway/ARC_Gateway_doPost.js`, routing docs, `ARC_JOBS`/`ARC_RESULTS` | 4,222 job rows included 1,364 done and 2,252 pending when counted during research; archived result bodies | Not an E2E success-rate measurement: many queued jobs remained unresolved or were duplicated |
| ARC AutoDom | `app/src/main/assets/arc_core.js`, `AutoDom.kt` | Source implementing selectors, Shadow DOM traversal and two-observation gating | Only source-level verification; original Android picker has UI/result callbacks but its full mode-handling path was not established |
| BAKU code salvage | `modules/gas/BAKU/BAKU_SalvageEngine.js` | Extracts function/class DNA; builds cards/decks; canary, quarantine and canonical update paths | Historic BAKU repair evidence had 2,904 unresolved records among 2,908 examined; 575 API HTTP-200 update records referred to the same script target and do not mean 575 distinct faults were resolved |
| Fully autonomous P2P AI villages | Original METRON Gist | Design and component analogues | Not independently demonstrated or deployed end-to-end |

## Reading the evidence responsibly

- Existing Google Sheets often reserve thousands of empty rows: reserved rows ≠ observations.
- Same-state repeated logs ≠ distinct functional improvements.
- API HTTP 200 ≠ deployed behavior; a submitted patch ≠ a verified patch.
- External-AI model responses sometimes describe success without checking system state.
- The historical project stopped before integration was completed; API usage cost was stated as an important reason by the original developer. The precise financial record and stop date have not been independently verified.

## Reproducibility

New standalone modules are under `reusable/` with isolated tests. These prove only the documented local behavior; reproducing the complete historical system requires independent access to Apps Script deployments, Android runtime and authorized original logs.

## 2026-10-13 reusable toolkit verification (separate from the historical runtime)

The four portable reference components were packaged independently as npm-compatible tarballs and successfully installed/imported in a clean temporary consumer folder on Windows. The shared tests passed 17/17, including a real desktop Chromium DOM/Shadow DOM picker test and selected archived BAKU source extraction checks.

These findings prove the **new reference modules** can be packaged and demonstrate their documented narrow behaviors. They are **not** evidence that the old Android ARC picker worked end-to-end, that BAKU repaired unknown faults reliably, or that METRON's four historic systems were fully integrated.

Full details and commands: [Reusable toolkit validation](../reusable/VALIDATION.md).
