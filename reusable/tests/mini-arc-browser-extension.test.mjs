import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../../mini/arc-browser/",import.meta.url);
const load=p=>readFileSync(new URL(p,root),"utf8");
test("ARC requires user gesture, activeTab, no broad site permissions",()=>{
 const m=JSON.parse(load("manifest.json"));
 assert.equal(m.manifest_version,3);
 assert.ok(m.permissions.includes("activeTab"));
 assert.ok(m.permissions.includes("scripting"));
 assert.deepEqual(m.permissions,["activeTab","scripting"]);
 assert.equal(m.host_permissions,undefined);
 assert.equal(m.content_scripts,undefined);
 assert.match(load("background.js"),/action.onClicked/);
 assert.match(load("background.js"),/chatgpt/);
});
test("ARC picker is ephemeral and has no credential or auto-submit mechanism",()=>{
 const c=load("content.js")+load("reply-state.js");
 assert.match(c,/addEventListener\("click",onClick,true\)/);
 assert.match(c,/type="password"/);
 assert.doesNotMatch(c,/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|chrome\.(?:cookies|storage)|\.submit\(/);
 assert.match(c,/cleanup/);
});

test("ARC send and capture stay explicit while passive reply observation has teardown",()=>{
 const c=load("content.js");
 assert.match(c,/send\.addEventListener\("click"/);
 assert.match(c,/capture\.addEventListener\("click"/);
 assert.match(c,/button\.click\(\)/);
 assert.match(c,/observation\.dispose\(\)/);
 assert.doesNotMatch(load("reply-state.js"),/chrome\.runtime|AndroidBridge|postMessage\(/);
});
