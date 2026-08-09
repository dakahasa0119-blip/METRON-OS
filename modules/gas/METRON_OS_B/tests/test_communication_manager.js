const rewire = require('rewire');
const assert = require('assert');

// We use rewire so we can load the GAS module and it can access our globals
global.SpreadsheetApp = {
  getActive: function() {
    return {
      getId: function() { return "mock_id"; }
    };
  },
  openById: function(id) {
    return mockSpreadsheet;
  }
};

global.LockService = {
  getScriptLock: function() {
    return {
      tryLock: function(time) { return true; },
      releaseLock: function() {}
    };
  }
};

let getSheetByNameResult = null;
let insertedSheetName = null;
let appendedRows = [];

let mockSpreadsheet = {
  getSheetByName: function(name) { return getSheetByNameResult; },
  insertSheet: function(name) {
    insertedSheetName = name;
    return mockSheet;
  }
};

let mockSheet = {
  appendRow: function(row) {
    appendedRows.push(row);
  }
};

const comms = rewire('../Communication_Manager.js');
const getDispatcherSheet = comms.getDispatcherSheet;

function runTests() {
  console.log("Running getDispatcherSheet tests...");

  // Test 1: getSheetByName returns null (sheet doesn't exist)
  getSheetByNameResult = null;
  insertedSheetName = null;
  appendedRows = [];

  let sheet = getDispatcherSheet();

  assert.strictEqual(insertedSheetName, "Dispatcher", "Should insert Dispatcher sheet");
  assert.strictEqual(appendedRows.length, 1, "Should append one row for headers");
  assert.deepStrictEqual(appendedRows[0], ["Timestamp", "Target", "Type", "Payload", "Status"], "Should append correct headers");
  console.log("Test 1 (fallback) passed!");

  // Test 2: getSheetByName returns a mock sheet (sheet exists)
  getSheetByNameResult = mockSheet;
  insertedSheetName = null;
  appendedRows = [];

  sheet = getDispatcherSheet();

  assert.strictEqual(insertedSheetName, null, "Should not insert sheet if it already exists");
  assert.strictEqual(appendedRows.length, 0, "Should not append headers if sheet already exists");
  console.log("Test 2 (existing sheet) passed!");

  console.log("All tests passed successfully.");
}

runTests();
