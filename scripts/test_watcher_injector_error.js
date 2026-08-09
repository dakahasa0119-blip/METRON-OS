#!/usr/bin/env node
'use strict';

// Mock dependencies
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getSheetByName: (name) => {
      return {
        getLastRow: () => 2,
        getRange: () => ({
          getValues: () => {
            if (name === "Injection_Slot") {
               return [["Timestamp", "Target", "injection_file.js", "Payload", "APPROVED", "ss_id"]];
            } else if (name === "Forge_Staging") {
               return [["Timestamp", "forge_file.js", "解説", "ソースコード", "APPROVED", "URL"]];
            }
            return [[]];
          }
        }),
        insertSheet: () => ({
          appendRow: () => {},
          setFrozenRows: () => {}
        }),
        appendRow: () => {},
        setFrozenRows: () => {}
      };
    },
    getId: () => "ss_id"
  })
};

global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: () => "old_hash",
    setProperty: () => {}
  })
};

let announcements = [];
global.announce = (msg, type) => {
  announcements.push({msg, type});
};

global.applyLatestPatch = () => {
  throw new Error("Simulated patch failure");
};

const originalLog = global.console.log;
global.console.log = () => {};

// Load the module under test using vm to export functions to the current context
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('modules/gas/METRON_OS_B/Watcher.js', 'utf8');

const script = new vm.Script(code);
const context = vm.createContext(global);
script.runInContext(context);

// Run the test
originalLog("Testing W_checkInjectionSlot error path...");
announcements = [];
global.W_checkInjectionSlot();

let passedInjection = false;
for (const a of announcements) {
  if (a.msg === "Watcher Injector Error: Simulated patch failure" && a.type === "ERROR") {
    passedInjection = true;
    break;
  }
}

if (passedInjection) {
  originalLog("PASS: W_checkInjectionSlot correctly handles applyLatestPatch errors.");
} else {
  console.error("FAIL: W_checkInjectionSlot. Announcements:", announcements);
  process.exit(1);
}

originalLog("\nTesting W_checkForgeStaging error path...");
announcements = [];
global.W_checkForgeStaging();

let passedForge = false;
for (const a of announcements) {
  if (a.msg === "Watcher Injector Error: Simulated patch failure" && a.type === "ERROR") {
    passedForge = true;
    break;
  }
}

if (passedForge) {
  originalLog("PASS: W_checkForgeStaging correctly handles applyLatestPatch errors.");
} else {
  console.error("FAIL: W_checkForgeStaging. Announcements:", announcements);
  process.exit(1);
}
