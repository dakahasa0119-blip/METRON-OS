# MotherShip workflow

A small reference for deterministic task classification and careful patch-state transitions. A patch submitted to a worker is **not** automatically considered installed.

```js
import { newPatch, transitionPatch } from 'metron-reference-mothership-workflow';
let patch = transitionPatch(newPatch('p-1', 'function test() {}'), 'stage');
patch = transitionPatch(patch, 'submit');
// Verification requires independently produced evidence before transition to 'verified'.
```

Model recommendation is heuristic, not measured AI quality. Evidence values are provided by the caller; this package does not perform independent readback or actual smoke tests.
