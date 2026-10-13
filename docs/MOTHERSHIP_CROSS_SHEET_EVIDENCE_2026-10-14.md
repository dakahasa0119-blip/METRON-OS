# MotherShip A/B: spreadsheet communication evidence (read-only audit)

Date: 2026-10-14 (JST)

## Question

Were the historic MotherShip A and B communicating **between two distinct Google spreadsheets**, or were the observed messages only routed between tabs inside a single spreadsheet?

The developer recalls a two-spreadsheet design. This audit preserves that possibility rather than treating a tab-local source snapshot as proof that cross-spreadsheet transport never existed.

## Evidence inspected

1. **Two distinct original Drive spreadsheet files exist**, titled `METRON OS_A` and `METRON OS_B` (not merely two tabs of the same file). Both were inspected read-only through their spreadsheet metadata.
2. Each file has tabs named `Dispatcher`, `METRON-A`, and `METRON-B`. Bounded reads of the corresponding tabs show historical `OBSERVE`, `ACK`, `STATE` and `PROPOSE` rows, with processed inbox entries. The entries include repeated templates and timestamps; the same logical ship names are used *inside both files*. This establishes stored message-like records in both artifacts, **not their provenance or transport mechanism**.
3. In the published snapshot [Communication_Manager.js](../modules/gas/METRON_OS_B/Communication_Manager.js), `getSS()` derives the ID from `SpreadsheetApp.getActive().getId()`. `getDispatcherSheet()`, `deliverToMotherShipInbox()`, and `sendFromMotherShip()` then operate on tabs of that active spreadsheet. Thus **this particular code path is tab-local**. It does not implement an explicit cross-spreadsheet transfer.
4. [METRON_GATEWAY_BRIDGE.js](../modules/gas/METRON_OS_B/METRON_GATEWAY_BRIDGE.js) posts to the Gateway URL and submits ARC jobs, but does not by itself establish a two-MotherShip sheet-to-sheet forwarding path.
5. The Gateway's [code.js](../modules/gas/METRON_GATEWAY/code.js) contains a configured default MotherShip spreadsheet ID and a per-user active-target switch. This demonstrates that the Gateway can identify/switch a target spreadsheet; it is **not proof that the MotherShip A/B conversation rows were transmitted between those two files**.

## Dispatcher log comparison (2026-10-14 bounded full-tab read)

A full scan of the populated `Dispatcher!A:E` records in each source file produced **32 data rows in OS_A** and **146 in OS_B**, excluding their headers (both fit inside the first 1,000 rows). Matching all five fields `from, to, type, payload, timestamp` found **zero identical rows across the two files**. Ignoring the timestamp yielded **six matching A rows**, which may simply be repeated canned message content. The message distributions were A: 1 OBSERVE, 16 ACK, 4 STATE, 11 PROPOSE; B: 1 OBSERVE, 73 ACK, 7 STATE, 65 PROPOSE.

The zero exact matches do **not** disprove a relay: a receiver could stamp messages at a different time or transform envelopes. Conversely, similar payloads without a shared message ID, correlated source/destination event, or forwarding code do **not** establish cross-file delivery. In the preserved GAS source tree, the only inspected explicit spreadsheet ID matching these two source files was the OS_B default in the Gateway `code.js`. This is a scoped source observation, not an exhaustive historical revision search.

## Current conclusion

- **Confirmed:** Two distinct MotherShip spreadsheets exist, both with message-like historical records.
- **Confirmed:** The preserved `Communication_Manager.js` dispatcher performs communication *within its active spreadsheet*.
- **Not yet independently verified:** The exact historical cross-spreadsheet forwarding function, successful end-to-end transmission, or whether a different source revision / Gateway / trigger performed the forwarding.
- **Not disproven:** A separate A-to-B transport may have existed outside the preserved code path. Absence of a matching function in the investigated snapshot is not evidence of historical nonexistence.

## What would establish historical sheet-to-sheet transport?

A read-only artifact linking **source spreadsheet ID -> send action -> destination spreadsheet ID -> destination row or ACK**, preferably with a unique message/trace identifier and independently recorded timestamps. Historical Apps Script revisions, trigger history, deployment versions, or an archived Gateway forwarding script may contain this evidence. Repeated `hello` rows or similarly named tabs alone are insufficient.

## Safety and scope

No rows were changed; no synthetic message was inserted; no GAS script was executed. The private Drive message bodies, user context, IDs, and direct sheet URLs are intentionally not republished here. This audit does not claim AI-to-AI autonomy, deployed P2P federation, or real-world repair success.
