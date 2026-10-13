/**
 * Read-only Node.js worktree inventory for isolated, trusted checkout roots.
 * Caller authorizes the checkout and controls exclusion; no code execution.
 * Not a race-free sandbox: requires an immutable checkout and trusted OS.
 */
import {
  lstatSync, realpathSync, readdirSync, openSync, readFileSync,
  fstatSync, closeSync, constants
} from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { Buffer } from "node:buffer";

const limits = { maxFiles: 128, maxFileBytes: 1048576, maxTotalBytes: 8388608 };
const reject = reason => { throw new Error(reason); };
function contained(root, candidate) {
  const rest = relative(root, candidate);
  return rest === "" || (rest !== ".." && !rest.startsWith(".." + sep) &&
    !rest.startsWith(sep));
}
function validPathPart(name) {
  if (!name || name === "." || name === ".." || name !== name.trim() ||
      name.endsWith(".") || /[\x00-\x1f\x7f<>:"|?*]/u.test(name) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(name)) return false;
  return true;
}

/**
 * Enumerate all text files under a root, except root .git metadata.
 * Returns a null-prototype object mapping relative POSIX paths to UTF-8 text.
 * Rejects symlinks, nested .git, special nodes, binaries and large trees.
 */
export function readTextWorktree(rootPath, options = {}) {
  if (typeof rootPath !== "string" || !rootPath.trim()) reject("invalid_root");
  const opts = { ...limits, ...options };
  for (const [key, cap] of Object.entries(limits)) {
    if (!Number.isSafeInteger(opts[key]) || opts[key] < 1 || opts[key] > cap)
      reject("invalid_limit_" + key);
  }
  const root = resolve(rootPath);
  if (!lstatSync(root).isDirectory()) reject("root_not_plain_directory");
  const canonicalRoot = realpathSync(root);
  if (!lstatSync(canonicalRoot).isDirectory()) reject("root_invalid");

  const files = Object.create(null);
  const seen = new Set();
  let totalBytes = 0, fileCount = 0;
  function visit(dir, relativeDir = "") {
    if (!contained(canonicalRoot, realpathSync(dir))) reject("directory_escaped_root");
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (!relativeDir && entry.name === ".git") continue;
      if (!validPathPart(entry.name) || entry.name.toLowerCase() === ".git")
        reject("invalid_worktree_path");
      const item = join(dir, entry.name);
      const logical = relativeDir ? relativeDir + "/" + entry.name : entry.name;
      const alias = logical.normalize("NFC").toLowerCase();
      if (seen.has(alias)) reject("duplicate_normalized_path");
      seen.add(alias);
      const st = lstatSync(item);
      if (st.isSymbolicLink()) reject("symlink_not_supported");
      if (!contained(canonicalRoot, realpathSync(item))) reject("file_escaped_root");
      if (st.isDirectory()) {
        visit(item, logical);
        continue;
      }
      if (!st.isFile()) reject("special_file_not_supported");
      if (st.size > opts.maxFileBytes) reject("file_too_large");
      fileCount++;
      if (fileCount > opts.maxFiles) reject("too_many_files");

      // O_NOFOLLOW where supported, plus lstat/fstat/realpath checks;
      // still not a full defense against concurrent tree mutation.
      const fd = openSync(item, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      let bytes;
      try {
        const openStat = fstatSync(fd);
        if (!openStat.isFile() || openStat.size > opts.maxFileBytes ||
            openStat.dev !== st.dev || openStat.ino !== st.ino)
          reject("unstable_file");
        bytes = readFileSync(fd);
        const afterStat = fstatSync(fd);
        if (afterStat.size !== openStat.size ||
            afterStat.mtimeMs !== openStat.mtimeMs ||
            bytes.length !== openStat.size) reject("unstable_file");
      } finally { closeSync(fd); }
      if (bytes.length > opts.maxFileBytes) reject("file_too_large");
      totalBytes += bytes.length;
      if (totalBytes > opts.maxTotalBytes) reject("snapshot_too_large");
      if (bytes.includes(0)) reject("binary_file_not_supported");
      const text = bytes.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(bytes)) reject("invalid_utf8");
      files[logical] = text;
    }
  }
  visit(canonicalRoot);
  return { files, fileCount, totalBytes };
}
