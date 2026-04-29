#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');

// 1. Mock dependencies
let sendToMainChatMock = () => false;
let routeChatNowMock = () => false;
let sendToMainChatCalls = [];
let routeChatNowCalls = 0;

global.sendToMainChat = function(text) {
  sendToMainChatCalls.push(text);
  return sendToMainChatMock(text);
};

global.routeChatNow = function() {
  routeChatNowCalls++;
  return routeChatNowMock();
};

// Also mock SpreadsheetApp or any other globals used in gateway/code.js to compile without ReferenceError
global.SpreadsheetApp = {};
global.PropertiesService = {};
global.HtmlService = {};
global.Logger = {};

// 2. Load the file.
const codeStr = fs.readFileSync('gateway/code.js', 'utf8');

// The file exports `submitGatewayChatBatch` in the module.exports block
// However, since we run via VM without `require`, we need to define `module` in context
global.module = { exports: {} };

const context = vm.createContext(global);
vm.runInContext(codeStr, context);

// Now because `gateway/code.js` defines `function sendToMainChat(text) { ... }`,
// it overwrites `global.sendToMainChat` inside the context.
// To use standard testing practices without fragile string replace,
// we will just override the function *after* evaluation but before testing.
context.sendToMainChat = function(text) {
  sendToMainChatCalls.push(text);
  return sendToMainChatMock(text);
};

context.routeChatNow = function() {
  routeChatNowCalls++;
  return routeChatNowMock();
};

const submitGatewayChatBatch = context.module.exports.submitGatewayChatBatch;

// 3. Test cases
function assertEq(name, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name}:\n expected=${JSON.stringify(expected)}\n actual=${JSON.stringify(actual)}`);
  }
}

function resetMocks() {
  sendToMainChatCalls = [];
  routeChatNowCalls = 0;
  sendToMainChatMock = () => false;
  routeChatNowMock = () => false;
}

(function run() {
  console.log('Testing submitGatewayChatBatch...');

  // Test 1: Empty input
  resetMocks();
  assertEq('Empty array input', submitGatewayChatBatch([]), { status: "error", error: "send_failed" });
  assertEq('Empty array input (calls)', sendToMainChatCalls.length, 0);

  // Test 2: Non-array input
  resetMocks();
  assertEq('Null input', submitGatewayChatBatch(null), { status: "error", error: "send_failed" });
  assertEq('Null input (calls)', sendToMainChatCalls.length, 0);

  // Test 3: Array with empty/whitespace strings
  resetMocks();
  assertEq('Whitespace array input', submitGatewayChatBatch(["", "   ", null, undefined]), { status: "error", error: "send_failed" });
  assertEq('Whitespace array input (calls)', sendToMainChatCalls.length, 0);

  // Test 4: Array with valid strings, but sendToMainChat fails
  resetMocks();
  sendToMainChatMock = () => false;
  assertEq('Send fails', submitGatewayChatBatch(["hello", "world"]), { status: "error", error: "send_failed" });
  assertEq('Send fails (calls)', sendToMainChatCalls, ["hello", "world"]);
  assertEq('Send fails (route calls)', routeChatNowCalls, 0); // shouldn't route if 0 accepted

  // Test 5: Array with valid strings, sendToMainChat succeeds
  resetMocks();
  sendToMainChatMock = () => true;
  routeChatNowMock = () => "mocked_routed";
  assertEq('Send succeeds', submitGatewayChatBatch(["hello", "world"]), { status: "ok", accepted: 2, routed: "mocked_routed" });
  assertEq('Send succeeds (calls)', sendToMainChatCalls, ["hello", "world"]);
  assertEq('Send succeeds (route calls)', routeChatNowCalls, 1);

  // Test 6: Partial success
  resetMocks();
  sendToMainChatMock = (text) => text === "world"; // Only world succeeds
  routeChatNowMock = () => "mocked_routed";
  assertEq('Partial success', submitGatewayChatBatch(["hello", "world", "  ", "again"]), { status: "ok", accepted: 1, routed: "mocked_routed" });
  assertEq('Partial success (calls)', sendToMainChatCalls, ["hello", "world", "again"]);
  assertEq('Partial success (route calls)', routeChatNowCalls, 1);

  console.log('PASS: gateway submitGatewayChatBatch checks');
})();
