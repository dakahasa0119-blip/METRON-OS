#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');

let watcherCode = fs.readFileSync('modules/gas/METRON_OS_B/Watcher.js', 'utf8');

const context = {
  SpreadsheetApp: {},
  PropertiesService: {},
  console: console,
  announce: undefined,
  _CALL_STACK_GUARD: {}
};

vm.createContext(context);
vm.runInContext(watcherCode, context);

function assertEq(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name}: expected=${expected} actual=${actual}`);
  }
}

(function run() {
  console.log("Starting tests for W_safeAnnounce...");
  let announceCalled = false;
  let announceArgs = [];

  context.announce = function(msg, type) {
    announceCalled = true;
    announceArgs = [msg, type];
  };

  context.W_safeAnnounce("hello", "SYSTEM");
  assertEq("announce should be called", announceCalled, true);
  assertEq("announce should receive correct msg", announceArgs[0], "hello");
  assertEq("announce should receive correct type", announceArgs[1], "SYSTEM");

  announceCalled = false;
  announceArgs = [];
  context.W_safeAnnounce("hello2");
  assertEq("announce should default type to SYSTEM", announceArgs[1], "SYSTEM");

  context.announce = undefined;
  let threwWhenMissing = false;
  try {
    context.W_safeAnnounce("test missing");
  } catch (e) {
    threwWhenMissing = true;
  }
  assertEq("should not throw when announce is undefined", threwWhenMissing, false);

  context.announce = function(msg, type) {
    throw new Error("Mock announce error");
  };

  let threwWhenError = false;
  try {
    context.W_safeAnnounce("test throw", "SYSTEM");
  } catch (e) {
    threwWhenError = true;
  }

  assertEq("should catch error thrown by announce and not bubble up", threwWhenError, false);

  console.log("PASS: Watcher W_safeAnnounce tests");
})();
