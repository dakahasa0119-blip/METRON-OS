# METRON reusable building blocks / 再利用コンポーネント

**Status:** experimental reference code. Each of the four folders is a dependency-free ES-module package with its own package.json, README and MIT LICENSE. Node.js 20+ is supported.

## Directory

| Module | Exports / use | Limits |
| --- | --- | --- |
| `arc-dom/selector-kit.mjs` | `findDeep`, `stableSelector`, `SelectorMemory`, `startPicker` | Open shadow roots only; works inside authorized DOM context; click picker is a new standalone implementation, not proof the old Android picker was complete |
| `baku-dna/code-cards.mjs` | `extractCards`, `inspectCard`, `composeCards` | Best-effort JavaScript lexical scanner supporting common object-method and arrow-function forms; regex literals, templates and advanced syntax can defeat extraction. **Not a static security analyzer** |
| `gateway-jobs/job-state.mjs` | `JobQueue`, `ExpiringMemory` | In-memory single-process state machine, no durable storage, locks, transport, authentication or distributed exactly-once guarantees |
| `mothership/workflow.mjs` | `classifyWork`, `recommendEngine`, `newPatch`, `transitionPatch` | Heuristic model choice, no model invocation; patch verification requires caller-supplied evidence and does not independently run tests |

## Running tests

```sh
node --test reusable/tests/*.test.mjs
```

Tests include synthetic fixtures, selected archived BAKU source, and a real Chromium DOM/Shadow DOM picker integration test when Chromium is available. This is **not** Android validation or validation against live AI-service interfaces, Apps Script, multiple machines or long-running production workloads. See [validation report](VALIDATION.md).

## Usage example

```js
import { SelectorMemory } from "./arc-dom/selector-kit.mjs";
import { JobQueue } from "./gateway-jobs/job-state.mjs";
import { extractCards } from "./baku-dna/code-cards.mjs";
import { newPatch, transitionPatch } from "./mothership/workflow.mjs";

const selectors = new SelectorMemory();
selectors.observe("example", "input", "#prompt");
selectors.observe("example", "input", "#prompt");
console.log(selectors.get("example", "input"));

const queue = new JobQueue();
queue.enqueue("demo", { prompt: "hello" });
const lease = queue.claim("worker-a");
queue.complete("demo", lease.lease, { reply: "world" });

console.log(extractCards("function hello() { return 1; }"));
const staged = transitionPatch(newPatch("p1", "function hello() {}"), "stage");
console.log(staged.state);
```

## Pack each module separately

Run `npm pack --dry-run ./reusable/arc-dom` (or `baku-dna`, `gateway-jobs`, `mothership`) from the repository root. Real tarballs can be generated with `npm pack`; no npm registry publication or API credentials are required for local packing. These package names have **not** been registered or published to npm. The package-specific README and LICENSE are included in every tarball.

## Licensing

MIT applies to this `reusable/` directory. See [LICENSE](LICENSE). It does not automatically cover existing Android or Apps Script source outside `reusable/`.

## Derivation

This code is a fresh, minimal, portable adaptation of patterns seen in the historical METRON source. It is not a verbatim copy, complete implementation or certified security boundary. The full concepts and historic project files remain independently visible in the repository.
