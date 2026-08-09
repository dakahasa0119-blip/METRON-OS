#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Basic assert function
function assertEq(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name}: expected=${expected} actual=${actual}`);
  }
}

// Mock Globals
const mockLogger = {
  logs: [],
  log: function(msg) {
    this.logs.push(msg);
  }
};

const mockUpdateTemplateCalls = [];
function mockUpdateTemplate(name, content) {
  mockUpdateTemplateCalls.push({ name, content });
}

// Create a VM context
const context = vm.createContext({
  Logger: mockLogger,
  updateTemplate: mockUpdateTemplate
});

// Load the target script
const scriptPath = path.join(__dirname, '../modules/gas/METRON_OS_B/SetupTemplates.js');
const code = fs.readFileSync(scriptPath, 'utf8');

// Evaluate the script in the context
vm.runInContext(code, context);

(function run() {
  console.log('Running test for setupTemplates...');

  // Execute the target function from the context
  context.setupTemplates();

  // Verifications
  assertEq('Should call updateTemplate 4 times', mockUpdateTemplateCalls.length, 4);

  const expectedNames = [
    'TEMPLATE_CORE',
    'TEMPLATE_INTEGRATION',
    'TEMPLATE_STANDALONE',
    'TEMPLATE_CSS'
  ];

  const actualNames = mockUpdateTemplateCalls.map(c => c.name);

  for (let i = 0; i < expectedNames.length; i++) {
    assertEq(`Template call ${i} name check`, actualNames[i], expectedNames[i]);
  }

  assertEq('Should call Logger.log once', mockLogger.logs.length, 1);
  assertEq('Logger.log message check', mockLogger.logs[0], "テンプレート初期登録 / 更新が完了しました。");

  console.log('PASS: setupTemplates tests completed successfully.');
})();
