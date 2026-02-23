# BAKU Module

This IntelliJ module tracks the canonical BAKU GAS project and salvage-related metadata.

- Name: `BAKU`
- GAS Project URL:
  - `https://script.google.com/u/0/home/projects/1_CIZpOUoqfFl3bJpiPwQXQeLGPJ2-5bfpKSpRKxzUsXUQid1me_GvlrY/edit`
- GAS Script ID:
  - `1_CIZpOUoqfFl3bJpiPwQXQeLGPJ2-5bfpKSpRKxzUsXUQid1me_GvlrY`
- Shared Drive folder (archive/salvage assets):
  - `https://drive.google.com/drive/folders/1QoKF4eF53Sf3yfgqTyLDgmzYXihCiCOK?usp=sharing`

## Purpose

Provide salvage and recovery modules that can be coordinated with METRON OS_B,
METRON_GATEWAY, and ARC (Proxy-hand) in a single project workspace.

## Gateway Integration (Implemented)

BAKU now has a Gateway bridge worker in:

- `modules/gas/BAKU/BAKU_GATEWAY_BRIDGE.js`

Core functions:

- `BAKU_GatewayHeartbeat()`
- `BAKU_ProcessGatewayJob()`
- `BAKU_RunGatewayLoop()`
- `BAKU_SetupGatewayTrigger()`

Domain coverage:

- ARC repair lane (Gateway `lease_job` as `executor=BAKU`)
- MOTHERSHIP queue lane (Gateway `mothership_pull`)
- Drive salvage lane (BAKU full scan / DNA analysis / system map)

Playbook:

- Sheet `BAKU_PLAYBOOK` is auto-created in BAKU spreadsheet.
- Columns:
  - `Enabled`, `Priority`, `Domain`, `Pattern`, `Actions`, `Notes`
- `Actions` example:
  - `scan_drive,analyze_dna,system_map,patrol,rebuild`

Required Script Properties in BAKU GAS:

- `GATEWAY_WEBAPP_URL`:
  - `https://script.google.com/macros/s/AKfycbyTZSv_X625o7T27_hQQ6eP_BztvrBDLx6kU_8cVLcmbvjWnhNYGFA2e8Wo7E0m7A/exec`
- `ARC_AUTH_KEY`:
  - same key as Gateway `ARC_AUTH_KEY`
- `BAKU_WORKER_ID` (recommended):
  - example: `baku-node-01`
- `BAKU_WORKER_KEY` (recommended for signature mode):
  - per-worker key used by Gateway signature verification
- `BAKU_USE_SIGNATURE`:
  - `true` when Gateway `ARC_REQUIRE_SIGNATURE=true`
- `BAKU_ALLOW_REBUILD`:
  - `true` only if you allow `METRON_EVO.selfRebuildOS()` execution
- `BAKU_MAX_LOOP_JOBS`:
  - per run loop upper limit (default `6`)
- `BAKU_PLAYBOOK`:
  - managed in sheet, no property needed

Recommended first run:

1. Run `BAKU_GatewayHeartbeat()`
2. Run `BAKU_ProcessGatewayJob()`
3. Run `BAKU_SetupGatewayTrigger()` for 1-minute polling

## Notes

- `BAKU_GATEWAY_BRIDGE.js` is now multi-domain by design.
- BAKU is not ARC-only; it can process MOTHERSHIP + Drive salvage tasks through Gateway orchestration.
- If Gateway `ARC_AUTONOMY_PAUSED=true`, BAKU loop enters paused mode and does not lease jobs.
