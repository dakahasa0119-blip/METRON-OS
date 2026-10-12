/**
 * BAKU DNA cards — dependency-free extraction and composition helpers.
 * Original BAKU tracks code fragments, dependencies, risk flags and quarantine.
 * This library is deliberately conservative and is NOT a security scanner.
 */

/** Find matching braces, skipping JS comments and quoted strings. Regex literals are not parsed. */
export function findMatchingBrace(source, opening) {
  if (source[opening] !== "{") return -1;
  let depth = 0, quote = "", escaped = false, comment = "";
  for (let i = opening; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (comment === "line") { if (c === "\n") comment = ""; continue; }
    if (comment === "block") { if (c === "*" && n === "/") { i++; comment = ""; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && n === "/") { comment = "line"; i++; continue; }
    if (c === "/" && n === "*") { comment = "block"; i++; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Extract named function declarations and classes with source ranges. Best-effort, not an AST parser. */
export function extractCards(source, { sourceName = "unknown" } = {}) {
  if (typeof source !== "string") throw new TypeError("source must be text");
  const regex = /\b(function\s+([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{|class\s+([a-zA-Z_$][\w$]*)\s*\{|([a-zA-Z_$][\w$]*)\s*:\s*function\s*\([^)]*\)\s*\{|(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*\{)/g;
  const cards = [];
  for (const match of source.matchAll(regex)) {
    const start = match.index;
    const begin = start + match[0].lastIndexOf("{");
    const end = findMatchingBrace(source, begin);
    if (end < begin) continue;
    const name = match[2] || match[3] || match[4] || match[5];
    if (cards.some(card => card.start <= start && start < card.end)) continue;
    cards.push({
      id: sourceName + ":" + name + ":" + start,
      name, kind: match[2] ? "function" : match[3] ? "class" : match[4] ? "object-method" : "arrow-function",
      sourceName, start, end: end + 1,
      code: source.slice(start, end + 1)
    });
  }
  return cards;
}

/** Flag code needing manual review; never interpret an empty flag list as safety approval. */
export function inspectCard(card) {
  const code = String(card?.code || "");
  const patterns = {
    "dynamic-evaluation": /\beval\s*\(|\bnew\s+Function\s*\(/,
    "network-access": /\b(?:UrlFetchApp\.fetch|fetch)\s*\(/,
    "drive-mutation": /\bDriveApp\.|\bsetTrashed\s*\(/,
    "script-mutation": /\bScriptApp\.deleteTrigger\s*\(|\bscript\.googleapis\.com/,
    "property-access": /\bPropertiesService\./
  };
  const flags = Object.entries(patterns).filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
  return { name: card?.name || "", flags, reviewRequired: flags.length > 0 };
}

/**
 * Compose named cards after resolving explicit dependencies.
 * Reject missing dependencies and cycles; never evaluate or install code.
 */
export function composeCards(cards, dependencies = {}) {
  const index = new Map();
  for (const card of cards) {
    if (!card?.name || typeof card.code !== "string") throw new Error("invalid card");
    if (index.has(card.name)) throw new Error("duplicate card: " + card.name);
    index.set(card.name, card);
  }
  const output = [], visiting = new Set(), visited = new Set();
  const visit = name => {
    if (!index.has(name)) throw new Error("missing dependency: " + name);
    if (visiting.has(name)) throw new Error("dependency cycle at " + name);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dep of dependencies[name] || []) visit(dep);
    visiting.delete(name);
    visited.add(name);
    output.push(index.get(name));
  };
  for (const name of index.keys()) visit(name);
  return { order: output.map(card => card.name), source: output.map(card => card.code).join("\n\n") };
}
