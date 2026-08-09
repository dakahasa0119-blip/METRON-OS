#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Read SetupTemplates.js
const setupTemplatesPath = path.join(__dirname, '..', 'modules', 'gas', 'METRON_OS_B', 'SetupTemplates.js');
const fileContent = fs.readFileSync(setupTemplatesPath, 'utf8');

// Use VM context to execute setupTemplates() and capture the extracted template
const templates = {};
const context = {
    updateTemplate: function(name, content) {
        templates[name] = content;
    },
    Logger: {
        log: () => {}
    }
};

vm.createContext(context);
vm.runInContext(fileContent, context);
vm.runInContext("setupTemplates();", context);

// Extract the TEMPLATE_DATA contents where loadDataDynamic is defined
const dataTemplate = templates["TEMPLATE_DATA"];
if (!dataTemplate || !dataTemplate.includes("function loadDataDynamic")) {
    console.error("Could not find loadDataDynamic function in TEMPLATE_DATA");
    process.exit(1);
}

// Create a new VM context for testing the function
const templateContext = {
    DATA_SHEET: 'Data',
    getUIFieldsLocal: function() {
        return templateContext.mockFields;
    },
    SpreadsheetApp: {
        getActive: function() {
            return {
                getSheetByName: function(name) {
                    if (name === templateContext.DATA_SHEET) {
                        return templateContext.mockSheet;
                    }
                    return null;
                }
            };
        },
        getActiveSpreadsheet: function() {
             return {
                getSheetByName: function(name) {
                    if (name === templateContext.DATA_SHEET) {
                        return templateContext.mockSheet;
                    }
                    return null;
                }
            };
        }
    },
    Utilities: {
        getUuid: function() { return 'mock-uuid'; }
    },
    TEMPLATE_LEVEL: 1,
    updateDashboard: function() {},
    mockSheet: null,
    mockFields: []
};

vm.createContext(templateContext);
// Load all functions from the template into our context
vm.runInContext(dataTemplate, templateContext);

function assertEq(name, actual, expected) {
  const aStr = JSON.stringify(actual);
  const eStr = JSON.stringify(expected);
  if (aStr !== eStr) {
    throw new Error(`${name}: expected=${eStr} actual=${aStr}`);
  }
}

(function runTests() {
  console.log('Running loadDataDynamic tests...');

  // Test case 1: No sheet found
  templateContext.mockSheet = null;
  templateContext.mockFields = [];
  const result1 = vm.runInContext("loadDataDynamic();", templateContext);
  assertEq('Test Case 1 (No sheet): should return empty array', result1, []);

  // Test case 2: Empty sheet (last row < 2)
  templateContext.mockSheet = { getLastRow: () => 1 };
  const result2 = vm.runInContext("loadDataDynamic();", templateContext);
  assertEq('Test Case 2 (Empty sheet, lastRow=1): should return empty array', result2, []);

  // Test case 3: Sheet with valid data rows
  templateContext.mockFields = [
    { field_key: 'userName' },
    { field_key: 'userAge' }
  ];

  const mockValues = [
    ['uuid-123', '2023-01-01T10:00:00Z', '2023-01-02T10:00:00Z', 'Alice', 30],
    ['uuid-456', '2023-01-03T10:00:00Z', '2023-01-04T10:00:00Z', 'Bob', 25]
  ];

  templateContext.mockSheet = {
    getLastRow: () => 3,
    getRange: function(row, col, numRows, numCols) {
      if (row !== 2 || col !== 1 || numRows !== 2 || numCols !== 5) {
        throw new Error(`Mock error: Invalid getRange arguments: row=${row}, col=${col}, numRows=${numRows}, numCols=${numCols}`);
      }
      return {
        getValues: () => mockValues
      };
    },
    getDataRange: function() {
        return {
            getValues: () => [
                ['ID', '作成日時', '更新日時', 'userName', 'userAge'], // Header row
                ['uuid-123', '2023-01-01T10:00:00Z', '2023-01-02T10:00:00Z', 'Alice', 30],
                ['uuid-456', '2023-01-03T10:00:00Z', '2023-01-04T10:00:00Z', 'Bob', 25]
            ]
        }
    }
  };

  const expectedResult3 = [
    { id: 'uuid-123', created: '2023-01-01T10:00:00Z', updated: '2023-01-02T10:00:00Z', userName: 'Alice', userAge: 30 },
    { id: 'uuid-456', created: '2023-01-03T10:00:00Z', updated: '2023-01-04T10:00:00Z', userName: 'Bob', userAge: 25 }
  ];

  const result3 = vm.runInContext("loadDataDynamic();", templateContext);
  assertEq('Test Case 3 (Valid data rows): should parse data into objects correctly', result3, expectedResult3);

  console.log('PASS: All loadDataDynamic tests passed successfully');
})();
