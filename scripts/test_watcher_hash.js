#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const assertEq = (name, actual, expected) => {
  if (actual !== expected) {
    throw new Error(`${name}: expected=${expected} actual=${actual}`);
  }
};

(function run() {
  const code = fs.readFileSync(path.join(__dirname, '../modules/gas/METRON_OS_B/Watcher.js'), 'utf8');
  const context = {
    console: console,
    SpreadsheetApp: {},
    PropertiesService: {}
  };
  vm.createContext(context);
  vm.runInContext(code, context);

  const W_hash = context.W_hash;

  if (typeof W_hash !== 'function') {
    throw new Error('W_hash function not found in context.');
  }

  // Test 1: Simple object
  assertEq('Simple object', W_hash({ a: 1, b: 'test' }), '{"a":1,"b":"test"}');

  // Test 2: Array
  assertEq('Array', W_hash([1, 2, 'three']), '[1,2,"three"]');

  // Test 3: String
  assertEq('String', W_hash('hello'), '"hello"');

  // Test 4: Number
  assertEq('Number', W_hash(123), '123');

  // Test 5: null
  assertEq('null', W_hash(null), 'null');

  // Test 6: Circular reference (should fall back to String())
  let circularObj = {};
  circularObj.self = circularObj;
  assertEq('Circular reference', W_hash(circularObj), '[object Object]');

  console.log('PASS: W_hash tests (loaded from Watcher.js)');
})();
