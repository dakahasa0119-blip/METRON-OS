# BAKU DNA cards

A lightweight **best-effort** extractor for named JavaScript functions, classes, common object-method and arrow-function blocks. Use `inspectCard` for simple review flags and `composeCards` to order explicitly declared dependencies.

```js
import { extractCards, inspectCard } from 'metron-reference-baku-dna';
const cards = extractCards('function hello() { return 1; }', { sourceName: 'demo' });
console.log(cards.map(c => ({ name: c.name, review: inspectCard(c).reviewRequired })));
```

**Not a full JavaScript parser**, not a vulnerability scanner, and not an automatic patch installer. `composeCards` concatenates fragments for inspection; property methods require their original enclosing object. Tested on selected historical BAKU source names and synthetic review labels, **not** on real-world repair outcomes.
