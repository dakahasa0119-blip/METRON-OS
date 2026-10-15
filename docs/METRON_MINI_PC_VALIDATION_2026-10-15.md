# METRON Mini — ARC and local persistence validation (2026-10-15)

This work starts from public main `d10e87c80c0aa5dfcfa01ac1a8b2a5aea02b97f3`.
The [completion criteria](METRON_MINI_COMPLETION_CRITERIA_2026-10-14.md) distinguish
real-service integration from local tests with artificial inputs.

**The normally signed-in ChatGPT → ARC extension E2E remains unverified.**
The browser control runtime provided on the user's PC failed during initialization,
before it could enumerate tabs or inspect UI. This does not establish that the PC's
browser or `chrome://extensions` rejects access. No login, extension installation,
permission change, or real ChatGPT test submission was performed.

## What was observed locally

Tests used Windows, Node.js `v24.18.0`, a separate checkout and isolated data roots.
Existing operational data was not changed.
Credentials, private conversations and the user's browser profile were not used.
Raw diagnostics, machine identifiers, personal paths and local evidence files are
excluded from the public repository.

Artificial response text passed through real Mini HTTP servers, Gateway queues,
mothership files and a child Node process stop/restart. It was not an AI response.

| Operation | Observation |
| --- | --- |
| Start two Mini instances with separate data roots | Different OS-assigned ports and isolated files |
| Omit required headers or use an external Origin | HTTP 403 |
| Transfer artificial text with a one-time handoff session | Accepted, Gateway done, matching body SHA-256 |
| Read persisted mothership records | One matching OBSERVE in B and corresponding ACK in A |
| Replay the used session | HTTP 400, `arc_session_expired_or_used` |
| Read the other village | Motherships and Gateway unchanged |
| Stop the test-owned child Node process, restart with the same root | API state and three persisted files match before/after restart |
| Submit the recorded task ID/body again | Deduplicated; no additional mailbox record or job |
| Reference the record in a later local task | Delivery completed |

The restart was a test-owned Node process restart. It was not an OS, user browser,
or external AI restart, and does not prove continuity of external AI reasoning.
Sandbox loopback and atomic-rename restrictions caused initial test failures;
authorized normal Windows execution was used for the local checks. Security
settings were not changed.

## ARC correction and regression tests

Previously, an old response selector could survive an explicit prompt submission,
allowing the old answer to be captured and forwarded again. A successful explicit
send now invalidates response selection and requires selecting the response again.
The pre-send DOM node with unchanged text is rejected. A distinct new node with
identical text, or a reused node with changed text, can be captured after reselection.

Duplicate suppression uses the explicit-send generation and captured text. Repeated
capture for the same send is suppressed; an identical answer after a new explicit
send is allowed. Asynchronous forwarding callbacks retain the original capture key.
The capture button is labeled `選択した回答を取得`.

The ARC change passed 19 targeted tests and **200 total local Windows tests,
0 failures, 0 skips**. Some tests mock browser APIs and DOM. This is neither a CI
result nor successful real-service E2E. The later village-work changes and their
tests are described in the [Windows execution record](METRON_MINI_WORK_EXECUTION_2026-10-15.md).

The correction does not authenticate prompt/answer correspondence, detect every
different old answer a user might select, or establish streaming completion.
The user must still inspect the page and capture preview.

## Remaining real-service procedure

1. Restore a formally supported browser control tool and inspect the user's PC tabs and ARC installation state.
2. If ARC is absent, obtain specific approval for loading `mini/arc-browser` unpacked and its required permissions.
3. Use a new harmless test conversation in the user's normally signed-in `https://chatgpt.com/`; the user handles login if needed.
4. Confirm destination, text and authorization before explicitly sending, for example, `Reply with exactly: METRON_ARC_LIVE_TEST_01` through ARC.
5. Inspect the completed answer, explicitly select its new element, and match the marker in the preview.
6. Explicitly forward to an isolated Mini port; obtain approval for optional `http://127.0.0.1/*` permission if requested.
7. Match message ID, body hash, B's OBSERVE, A's ACK and Gateway done.
8. Save context and next steps, restart the test Mini, and read persisted records without reusing the old ARC session.

Do not bypass a real service refusal or security boundary through another route.
Real AI replacement, knowledge sharing between users and BAKU repair of unknown
real failures remain unverified. Local success is not completion of METRON.
