# ARC DOM toolkit

A portable reference extracted from the ARC AutoDom concept. Designed for **pages you own or are authorized to automate**.

It provides `findDeep(root, selector)`, `stableSelector(element)`, `SelectorMemory`, and `startPicker(document, { role, onPick })`.

```js
import { startPicker, SelectorMemory } from 'metron-reference-arc-dom';
const memory = new SelectorMemory();
startPicker(document, { role: 'send', onPick({ selector, role }) { memory.setManual(location.origin, role, selector); } });
```

Works in browsers/WebViews on **open** Shadow DOM; not cross-origin frames or closed roots. The picker shipped here is a new independent reference implementation, **not** proof the original ARC Android picker completed its wiring. Browser integration test is in the parent repository. This package does not log into services or bypass access controls.
