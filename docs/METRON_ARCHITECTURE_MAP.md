# METRON Architecture Map (ARC Workspace)

Source DNA gist:
- https://gist.github.com/dakahasa0119-blip/a5e6fe11fbbcce76ff8957f6d77a2eb9
- BAKU concept gist:
  - https://gist.github.com/dakahasa0119-blip/5480137dde654c83b263b7c04b430c41

## Official Names

- METRON OS_B: Self-evolving Mothership
- METRON_GATEWAY: GAS gateway / civilization map
- ARC (Proxy-hand): Linux worker and browser/automation executor
- BAKU: Salvage and recovery module

## Layer Mapping

1. Compute Layer (Mothership Core)
- Runtime: GAS project (METRON OS_B)
- Role: task generation, context accumulation, evolution requests

2. Communication Layer (Village Square)
- Runtime: Drive/Spreadsheet/json exchange points
- Role: rumor/state propagation and archive/salvage sharing

3. Map Layer (Gateway)
- Runtime: GAS project (METRON_GATEWAY)
- Role: routing, protocol sheet, long-term memory index, orchestration

## Control Priority

1. METRON_GATEWAY is the primary command center.
2. ARC executes tasks as a proxy/worker for API-limit bypass and UI automation.
3. METRON OS_B provides autonomous planning/evolution logic through Gateway.
4. BAKU is activated after ARC/Gateway stabilization for salvage/recovery workflows.

## ARC Responsibilities

- Execute gateway-issued jobs on Linux worker
- Provide browser UI automation path for external AI interaction
- Return structured results to Gateway
- Keep autorepair/autodom flows deterministic and auditable
- Do not own global command authority; Gateway remains the control plane.

## Current GAS Project IDs

- METRON_GATEWAY
  - 16k5v6CauVT61sS8na3tK5o50eE2T_qBCJFTaxEhkX_l7gBJRVolAjMLN
- BAKU
  - 1_CIZpOUoqfFl3bJpiPwQXQeLGPJ2-5bfpKSpRKxzUsXUQid1me_GvlrY
- METRON OS_B
  - 1mcJxx9xLzKNY0AuTvxTJILvOFC1xWJUUPVE-QJLbtIchmQPl_cSUlD-w

## Integration Notes

- ARC is the execution worker, not the command center.
- Gateway is the operator-facing command center and map memory.
- Heartbeat/screen-on logic should be treated as optional health telemetry,
  not a mandatory precondition when browser operation already implies screen-on.

## Zero-Touch Strengthening (Proposed)

1. Bootstrap manifest
- Keep a single machine-readable manifest for GAS Script IDs, WebApp URL,
  and ARC worker endpoint.

2. Handshake contract
- Define `registerWorker`, `leaseJob`, `reportResult`, `reportHealth` endpoints
  with strict request/response schema and version field.

3. Idempotent deployment
- Make gateway deployment script update properties and version tags first,
  then deploy; reject mixed-version worker calls.

4. Safe autorepair gate
- Require dry-run patch + semantic checks + rollback pointer before apply.

5. Audit trail
- Persist all orchestration decisions with `traceId` so ARC and Gateway logs
  can be correlated for regression analysis.
