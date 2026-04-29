const assert = require('assert');

// Mock GAS classes
class MockRange {
    constructor() {
        this.values = [];
    }
    setValues(vals) {
        this.values = vals;
        return this;
    }
}

class MockSheet {
    constructor(data) {
        this.data = data;
        this.ranges = [];
    }
    getLastRow() {
        return this.data.length;
    }
    getDataRange() {
        return {
            getValues: () => this.data
        };
    }
    getRange(row, col, numRows, numCols) {
        const range = new MockRange();
        this.ranges.push({ row, col, numRows, numCols, range });
        return range;
    }
}

class MockProperties {
    constructor() {
        this.props = {};
    }
    setProperty(key, val) {
        this.props[key] = val;
    }
}

global.SpreadsheetApp = {
    getActiveSpreadsheet: () => {
        return {
            getSheetByName: (name) => {
                if (name === "Injection_Slot") {
                    return global.mockSlotSheet;
                } else if (name === "Forge_Staging") {
                    return global.mockForgeSheet;
                }
                return null;
            }
        };
    }
};

global.PropertiesService = {
    getScriptProperties: () => new MockProperties()
};

global.DriveApp = {
    getFoldersByName: (name) => {
        return {
            hasNext: () => true,
            next: () => ({
                createFile: (name, content) => {}
            })
        };
    }
};

global.Utilities = {
    formatDate: () => "20230101"
};

global.announce = () => {};

// Read script to test
const fs = require('fs');
const code = fs.readFileSync('modules/gas/METRON_OS_B/Universal_Receiver.js', 'utf8');

// evaluate the function declarations
eval(code);

// Test processPendingInjectionsV305
global.mockSlotSheet = new MockSheet([
    ["Timestamp", "Source", "Filename", "Code", "Status"],
    ["2023-01-01", "GATEWAY", "test1.js", "1+1", "PENDING"],
    ["2023-01-01", "GATEWAY", "test2.js", "2+2", "DONE"],
    ["2023-01-01", "GATEWAY", "test3.js", "throw new Error('fail')", "ERROR"]
]);

processPendingInjectionsV305();

// Verify ranges set
assert.strictEqual(global.mockSlotSheet.ranges.length, 1);
const r1 = global.mockSlotSheet.ranges[0];
assert.strictEqual(r1.row, 1);
assert.strictEqual(r1.col, 5);
assert.strictEqual(r1.numRows, 4); // Includes header row since map is 1:1
assert.strictEqual(r1.numCols, 1);
assert.strictEqual(r1.range.values[1][0], "DONE: 内部受肉成功 (API回避)");
assert.strictEqual(r1.range.values[2][0], "DONE");
assert.strictEqual(r1.range.values[3][0], "EXEC_ERROR: fail");

console.log("processPendingInjectionsV305 tests passed!");

// Test exportForgeToFolder
global.mockForgeSheet = new MockSheet([
    ["Timestamp", "Filename", "Desc", "Code", "Status"],
    ["2023-01-01", "test1", "desc", "code1", "STAGED"],
    ["2023-01-01", "test2", "desc", "code2", "EXPORTED"],
    ["2023-01-01", "test3", "desc", "code3", "STAGED"]
]);

exportForgeToFolder();
assert.strictEqual(global.mockForgeSheet.ranges.length, 1);
const r2 = global.mockForgeSheet.ranges[0];
assert.strictEqual(r2.row, 1);
assert.strictEqual(r2.col, 5);
assert.strictEqual(r2.numRows, 4);
assert.strictEqual(r2.numCols, 1);
assert.strictEqual(r2.range.values[1][0], "EXPORTED");
assert.strictEqual(r2.range.values[2][0], "EXPORTED");
assert.strictEqual(r2.range.values[3][0], "EXPORTED");

console.log("exportForgeToFolder tests passed!");
