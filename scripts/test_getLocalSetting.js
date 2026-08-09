const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock PropertiesService globally
const mockProperties = {
  myKey: 'myValue',
  emptyKey: ''
};

global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => mockProperties.hasOwnProperty(key) ? mockProperties[key] : null
  })
};

// We also mock SpreadsheetApp globally as SetupTemplates.js relies on it at load time
global.SpreadsheetApp = {
  getActive: () => null
};

// Also mock other globals needed by SetupTemplates.js
global.TEMPLATE_LEVEL = 1;
global.METRON_MODE = 'STANDALONE';
global.DATA_SHEET = 'Data';
global.SETTINGS_SHEET = 'Settings';
global.LOG_SHEET = 'Log';
global.DASHBOARD_SHEET = 'Dashboard';
global.MOTHERSHIP_ID = '';
global.APP_NAME = 'TestApp';
global.Utilities = { getUuid: () => 'uuid' };
global.Logger = { log: console.log };
global.UrlFetchApp = {};
global.ScriptApp = {};

// We need to test the implementation inside SetupTemplates.js.
// SetupTemplates.js contains getLocalSetting inside a template string, let's extract it.
const setupTemplatesPath = path.join(__dirname, '../modules/gas/METRON_OS_B/SetupTemplates.js');
const fileContent = fs.readFileSync(setupTemplatesPath, 'utf8');

// Use a regex to extract getLocalSetting block.
const funcRegex = /function getLocalSetting\s*\([^\)]*\)\s*\{([\s\S]*?)\n\}/;
const match = fileContent.match(funcRegex);

if (!match) {
  console.error("Could not find getLocalSetting in SetupTemplates.js");
  process.exit(1);
}

// Evaluate the extracted function into global scope
eval(match[0]);

function testGetLocalSetting() {
  console.log("Running getLocalSetting tests (PropertiesService implementation from SetupTemplates.js)...");

  // Scenario 1: Key exists
  assert.strictEqual(getLocalSetting('myKey', 'defaultVal'), 'myValue', "Should return 'myValue' when 'myKey' exists");
  console.log("  ✅ Scenario 1: Key exists passed.");

  // Scenario 2: Key does not exist, uses default
  assert.strictEqual(getLocalSetting('missingKey', 'defaultVal'), 'defaultVal', "Should return default when key does not exist");
  console.log("  ✅ Scenario 2: Key does not exist passed.");

  // Scenario 3: Key exists but is empty string (truthiness check in p ? p : defaultValue)
  assert.strictEqual(getLocalSetting('emptyKey', 'defaultVal'), 'defaultVal', "Should return default when key is empty string due to 'p ? p : defaultValue'");
  console.log("  ✅ Scenario 3: Empty string key passed.");

  console.log("All getLocalSetting tests passed!");
}

testGetLocalSetting();
