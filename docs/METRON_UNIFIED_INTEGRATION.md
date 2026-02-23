# METRON Unified Integration Map

Reference blueprints:
- https://gist.github.com/dakahasa0119-blip/d7cb8714fc5c576689eff0edc0c3bdf7
- https://gist.github.com/dakahasa0119-blip/5480137dde654c83b263b7c04b430c41
- https://gist.github.com/dakahasa0119-blip/a5e6fe11fbbcce76ff8957f6d77a2eb9

## Canonical topology

- MOTHERSHIP <-> GATEWAY <-> ARC
- BAKU -> GATEWAY -> ARC (repair/salvage lane)
- Gateway is the control plane and long-term map.

## Implemented in this workspace

1. ARC control lane
- Tag routing from `MAIN_CHAT` to `ARC_JOBS`
- ARC/BAKU executor split (`executor=ARC|BAKU|AUTO`)
- Lease lock + timeout recovery
- Retry + dead-letter queue + audit trail

2. BAKU salvage lane
- Failed ARC jobs are auto-rerouted to `ARC_REPAIR_EXECUTOR` (default `BAKU`)
- Retry policy and backoff are configurable by Script Properties
- BAKU bridge is multi-domain:
  - ARC repair queue
  - MOTHERSHIP queue
  - Drive salvage operations
- BAKU playbook sheet:
  - `BAKU_PLAYBOOK` controls pattern -> actions mapping without code edits
- Structured report:
  - BAKU emits `BAKU_REPORT_JSON:` envelope for machine-readable salvage outputs
- Optional follow-up enqueue:
  - Gateway can auto-enqueue follow-up ARC jobs from BAKU report when `ARC_ENABLE_BAKU_FOLLOWUP=true`

3. MOTHERSHIP control lane (new)
- `mothership_submit`
- `mothership_heartbeat`
- `mothership_pull`
- `mothership_result`
- `mothership_error`
- Node table: `MOTHERSHIP_NODES`

## API contract summary

### ARC/BAKU workers
- heartbeat: `arc_heartbeat`
- pull: `lease_job`
- done: `arc_result`
- error: `arc_error`

### MOTHERSHIP worker
- submit to queue: `mothership_submit`
- heartbeat/pull: `mothership_heartbeat` or `mothership_pull`
- done: `mothership_result`
- error: `mothership_error`

### Admin
- `admin_status`
- `admin_cleanup`

## Security posture

Current:
- Shared `ARC_AUTH_KEY` auth
- Optional `SUBMIT_AUTH_KEY`
- Queue leasing lock and audit logging
- Optional worker-level allowlist (`ARC_WORKER_ALLOWLIST`, `MOTHERSHIP_WORKER_ALLOWLIST`)
- Optional per-worker key maps (`ARC_WORKER_AUTH_MAP`, `MOTHERSHIP_WORKER_AUTH_MAP`)
- Optional signed request verification (`ARC_REQUIRE_SIGNATURE=true`)
- Replay guard with nonce cache and request timestamp window

Recommended next hardening:
1. Make signature mode mandatory after worker rollout
2. Rotate worker keys periodically
3. Narrow allowlists to production nodes only

## Required Script Properties

- `ARC_AUTH_KEY` (required)
- `ARC_LEASE_TIMEOUT_SEC` (optional, default 300)
- `ARC_MAX_RETRY` (optional, default 2)
- `ARC_RETRY_BACKOFF_SEC` (optional, default 30)
- `ARC_REPAIR_EXECUTOR` (optional, default BAKU)
- `ARC_AUDIT_RETENTION_DAYS` (optional, default 14)
- `SUBMIT_AUTH_KEY` (optional)
- `ARC_DEFAULT_ROUTE` (`ARC` or `MOTHERSHIP`, optional)
- `ARC_DEFAULT_EXECUTOR` (`ARC|BAKU|AUTO`, optional)
- `ARC_DEFAULT_TARGET` (`gemini|chatgpt|copilot|all`, optional)
- `ARC_WORKER_ALLOWLIST` (optional)
- `MOTHERSHIP_WORKER_ALLOWLIST` (optional)
- `ARC_REQUIRE_SIGNATURE` (`true|false`, optional)
- `ARC_SIGNATURE_WINDOW_SEC` (optional, default 180)
- `ARC_NONCE_TTL_SEC` (optional, default 300)
- `ARC_WORKER_AUTH_MAP` (optional JSON map)
- `MOTHERSHIP_WORKER_AUTH_MAP` (optional JSON map)
