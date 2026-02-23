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

Recommended next hardening:
1. Per-worker key map (`worker_id -> worker_key`)
2. HMAC signature with nonce/timestamp
3. Mandatory auth for all write endpoints

## Required Script Properties

- `ARC_AUTH_KEY` (required)
- `ARC_LEASE_TIMEOUT_SEC` (optional, default 300)
- `ARC_MAX_RETRY` (optional, default 2)
- `ARC_RETRY_BACKOFF_SEC` (optional, default 30)
- `ARC_REPAIR_EXECUTOR` (optional, default BAKU)
- `ARC_AUDIT_RETENTION_DAYS` (optional, default 14)
- `SUBMIT_AUTH_KEY` (optional)

