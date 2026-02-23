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
5. Audit/trace:
  - `trace_id` is attached to ARC jobs.
  - Gateway writes operation logs to `ARC_AUDIT`.

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
- `mothership_submit`: enqueue one MOTHERSHIP message
- `mothership_heartbeat`: upsert mothership node + lease one message
- `mothership_pull`: lease one pending MOTHERSHIP message
- `mothership_result`: mark leased message done
- `mothership_error`: mark leased message error
- `admin_status`: return queue/node/dead-letter counters
- `admin_cleanup`: force audit archive cleanup run
- `admin_pause`: set `ARC_AUTONOMY_PAUSED=true`
- `admin_resume`: set `ARC_AUTONOMY_PAUSED=false`

## Reliability and Safety

- Lease lock:
  - `claimNextInstruction` uses script lock to avoid double-lease races.
- Lease timeout recovery:
  - `leased` jobs older than timeout are moved back to `pending`.
  - Timeout is configured by Script Property `ARC_LEASE_TIMEOUT_SEC` (default: `300`).
- Audit trail:
  - `ARC_AUDIT` captures enqueue/lease/complete/error/heartbeat events.
- Optional submit auth:
  - If Script Property `SUBMIT_AUTH_KEY` is set, `submit_chat` requires matching `submit_key`.
- Worker allowlist:
  - `ARC_WORKER_ALLOWLIST` (comma-separated worker IDs)
  - `MOTHERSHIP_WORKER_ALLOWLIST` (comma-separated worker IDs)
- Optional request signature:
  - Enable with `ARC_REQUIRE_SIGNATURE=true`
  - Required fields on protected modes:
    - `worker_id`, `request_ts`, `nonce`, `signature`
  - Signature canonical string:
    - `mode|worker_id|request_ts|nonce`
  - Signature algorithm:
    - `sha256_hex(canonical + "|" + worker_key)`
  - Replay protection:
    - nonce cache TTL via `ARC_NONCE_TTL_SEC` (default `300`)
  - Allowed clock drift:
    - `ARC_SIGNATURE_WINDOW_SEC` (default `180`)
- Per-worker auth maps:
  - `ARC_WORKER_AUTH_MAP` (JSON map)
  - `MOTHERSHIP_WORKER_AUTH_MAP` (JSON map)
- Dead-letter queue:
  - Jobs that exceed retry limit move to `ARC_DEAD_JOBS` with full payload snapshot.
- Auto retry:
  - On `arc_error`, Gateway schedules retry with backoff.
  - Retry policy uses Script Properties:
    - `ARC_MAX_RETRY` (default `2`)
    - `ARC_RETRY_BACKOFF_SEC` (default `30`)
    - `ARC_REPAIR_EXECUTOR` (default `BAKU`)
  - Retry path reuses ARC job pipeline and can hand failed jobs to BAKU automatically.
- Retry wait gate:
  - `next_retry_at` is honored at lease time; jobs are not leased before backoff expires.
- Structured BAKU report:
  - If `arc_result.text` starts with `BAKU_REPORT_JSON:`, Gateway parses it.
  - When `ARC_ENABLE_BAKU_FOLLOWUP=true`, Gateway can auto-enqueue follow-up jobs from report payload.
- Emergency stop:
  - `ARC_AUTONOMY_PAUSED=true` pauses autonomous leasing/routing loops.
- Alert thresholds:
  - `ARC_DEAD_JOB_ALERT_THRESHOLD` (default `20`)
  - `ARC_LEASED_ALERT_THRESHOLD` (default `50`)
  - Alerts are recorded to `ARC_ALERTS`.
- Daily cleanup:
  - `ARC_AUDIT` old rows are archived to `ARC_AUDIT_ARCHIVE`.
  - Retention uses `ARC_AUDIT_RETENTION_DAYS` (default `14`).
  - Last run date is tracked by `ARC_LAST_DAILY_CLEANUP`.

## Admin APIs

- `admin_status` (requires `auth_key`):
  - returns queue counters, node count, dead-letter count, audit count, and policy settings.
- `admin_cleanup` (requires `auth_key`):
  - runs immediate audit archive cleanup and returns archive stats.

## ARC Maximization Policy

- Default route can be switched to ARC:
  - `ARC_DEFAULT_ROUTE=ARC`
- Default executor/target can be set:
  - `ARC_DEFAULT_EXECUTOR` in `ARC|BAKU|AUTO`
  - `ARC_DEFAULT_TARGET` in `gemini|chatgpt|copilot|all`
- With these settings, non-tagged chat requests are routed to ARC by default, reducing direct API dependence.

## BAKU Through ARC

BAKU can use the same Gateway job pipeline as ARC by setting `executor=BAKU`.

1. Operator sends a chat command with `#baku` (example: `#baku #chatgpt ...`).
2. Gateway parses tags and enqueues in `ARC_JOBS` with payload `executor: "BAKU"`.
3. BAKU worker calls `arc_heartbeat` or `lease_job` with:
   - `executor: "BAKU"`
   - stable `worker_id`
   - `auth_key`
4. Gateway leases only jobs where `executor` is `BAKU` (or `AUTO`).
5. BAKU reports via `arc_result` / `arc_error` using the same `mission_id` or `qid`.

### Example heartbeat payload (BAKU worker)

```json
{
  "mode": "arc_heartbeat",
  "executor": "BAKU",
  "worker_id": "baku-node-01",
  "ip": "192.168.1.10",
  "port": "8080",
  "status": "online",
  "version": "baku-1.0",
  "auth_key": "..."
}
```
