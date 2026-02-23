# Gateway Tag Routing

Gateway is the primary control plane.  
Chat commands in `MAIN_CHAT` are routed by tags to either ARC or MOTHERSHIP.

## Input Sheet

- `MAIN_CHAT` columns:
  - `Timestamp`, `User`, `Content`, `Status`, `Response`, `MissionID`

## Route Tags

- ARC route:
  - `#arc`, `@arc`, `[ARC]`, `#proxy`, `#baku`, `@baku`
- MOTHERSHIP route:
  - `#mother`, `@mother`, `#metron`, `#osb`
- If no ARC tag exists, default route is `MOTHERSHIP`.

## ARC Target Tags

- `#gemini` / `@gemini` -> `gemini`
- `#chatgpt` / `@chatgpt` -> `chatgpt`
- `#copilot` / `@copilot` -> `copilot`
- `#all` / `@all` -> `ALL`

## ARC Operation Tags

- `#refresh` -> `arc_refresh`
- `#screenshot`, `#shot` -> `arc_screenshot`
- JS block:
  - use ```js ... ``` in chat content -> `arc_execute_js`
- default operation -> `request_arc`

## Executor Tags

- `#arc` / `@arc` -> executor `ARC`
- `#baku` / `@baku` -> executor `BAKU`
- no executor tag -> executor `AUTO`

## State Flow

1. New chat row is added with `Status=NEW` (or `PENDING`).
2. Gateway routes row:
  - ARC -> enqueue row in `ARC_JOBS`, `Status=QUEUED_ARC`
  - MOTHERSHIP -> append to `MOTHERSHIP_QUEUE`, `Status=ROUTED_MOTHERSHIP`
3. ARC heartbeat/lease receives next `instruction`.
4. ARC result/error updates:
  - `ARC_RESULTS` / `ARC_ERRORS`
  - matching `MAIN_CHAT` row changes to `ARC_DONE` or `ARC_ERROR`.
  - matching `ARC_JOBS` row changes to `done` or `error`.

## API Modes

- `submit_chat`: append one chat row to `MAIN_CHAT`
- `route_chat`: route pending chat rows immediately
- `arc_heartbeat` / `register_worker`: worker keepalive + lease
- `worker_id` is used as stable ARC node identity for leasing
- `lease_job`: pull one pending job
- `arc_result` / `report_result`: report success
- `arc_error` / `report_error`: report error
- `arc_learning`: learning feedback
- `arc_consult`: optional advisory path
