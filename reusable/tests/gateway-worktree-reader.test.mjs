import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTextWorktree } from "../gateway-jobs/worktree-reader.mjs";

function temp(fn) {
  const root = mkdtempSync(join(tmpdir(),"metron-reader-"));
  try { return fn(root); }
  finally { rmSync(root,{recursive:true,force:true}); }
}
test("real filesystem inventory reads UTF-8 nested sources without modifying them",()=>temp(root=>{
  mkdirSync(join(root,"src"));
  mkdirSync(join(root,".git"));
  writeFileSync(join(root,".git","HEAD"),"ref: main");
  writeFileSync(join(root,"src","index.js"),"日本語🎏\n");
  writeFileSync(join(root,"README.md"),"hello");
  const got=readTextWorktree(root);
  assert.equal(got.fileCount,2);
  assert.equal(got.totalBytes,Buffer.byteLength("日本語🎏\n")+5);
  assert.equal(got.files["src/index.js"],"日本語🎏\n");
  assert.equal(got.files["README.md"],"hello");
  assert.equal(Object.hasOwn(got.files,".git/HEAD"),false);
}));

test("refuses nontext content, malformed UTF-8 and size limits",()=>temp(root=>{
  writeFileSync(join(root,"x.dat"),Buffer.from([0,2,3]));
  assert.throws(()=>readTextWorktree(root),/binary_file_not_supported/);
  rmSync(join(root,"x.dat"));
  writeFileSync(join(root,"x.dat"),Buffer.from([255,254]));
  assert.throws(()=>readTextWorktree(root),/invalid_utf8/);
  rmSync(join(root,"x.dat"));
  writeFileSync(join(root,"huge.js"),"a".repeat(100));
  assert.throws(()=>readTextWorktree(root,{maxFileBytes:30}),/file_too_large/);
  assert.throws(()=>readTextWorktree(root,{maxFiles:0}),/invalid_limit/);
}));

test("symlinks never become secretly included sources",()=>temp(root=>{
  const target=join(root,"actual.js");
  writeFileSync(target,"ok");
  try { symlinkSync(target,join(root,"alias.js"),"file"); }
  catch (error) {
    if (!["EPERM","EACCES","ENOTSUP"].includes(error.code)) throw error;
    assert.equal(readTextWorktree(root).fileCount,1);
    return;
  }
  assert.throws(()=>readTextWorktree(root),/symlink_not_supported/);
}));

test("limits fail closed",()=>temp(root=>{
  writeFileSync(join(root,"a.js"),"1");
  writeFileSync(join(root,"b.js"),"2");
  assert.throws(()=>readTextWorktree(root,{maxFiles:1}),/too_many_files/);
  assert.throws(()=>readTextWorktree(root,{maxTotalBytes:1}),/snapshot_too_large/);
}));

test("rejects roots that are not directories",()=>temp(root=>{
  writeFileSync(join(root,"a.js"),"text");
  assert.throws(()=>readTextWorktree(join(root,"a.js")),/root_not_plain_directory/);
}));
