#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { W_chatHash } = require('../modules/gas/METRON_OS_B/Watcher.js');

function runTests() {
  console.log('Testing W_chatHash...');

  // Happy Path
  assert.strictEqual(
    W_chatHash(['Timestamp', 'USER', 'Hello']),
    'USER::Hello',
    'Happy Path: Standard role and message'
  );

  assert.strictEqual(
    W_chatHash(['2023-10-27T10:00:00Z', 'SYSTEM', 'Initialization complete']),
    'SYSTEM::Initialization complete',
    'Happy Path: SYSTEM message'
  );

  // Edge Cases
  assert.strictEqual(
    W_chatHash(['Timestamp', 123, 456]),
    '123::456',
    'Edge Case: Numbers in role and message'
  );

  assert.strictEqual(
    W_chatHash(['Timestamp', null, undefined]),
    'null::undefined',
    'Edge Case: null and undefined in row array'
  );

  assert.strictEqual(
    W_chatHash(['Timestamp', '', '']),
    '::',
    'Edge Case: Empty strings'
  );

  assert.strictEqual(
    W_chatHash(['Timestamp', 'OnlyRole']),
    'OnlyRole::undefined',
    'Edge Case: Array length 2 (missing message)'
  );

  assert.strictEqual(
    W_chatHash(['Timestamp']),
    'undefined::undefined',
    'Edge Case: Array length 1 (missing role and message)'
  );

  assert.strictEqual(
    W_chatHash([]),
    'undefined::undefined',
    'Edge Case: Empty array'
  );

  // Error Conditions
  // Providing null or undefined triggers a TypeError when trying to access index 1/2
  // which is caught by the try...catch block in W_chatHash, and it returns String(row).
  assert.strictEqual(
    W_chatHash(null),
    'null',
    'Error Condition: null argument'
  );

  assert.strictEqual(
    W_chatHash(undefined),
    'undefined',
    'Error Condition: undefined argument'
  );

  // Other types that throw or don't behave like arrays
  // Numbers or booleans will return undefined for index 1 and 2
  assert.strictEqual(
    W_chatHash(123),
    'undefined::undefined',
    'Error Condition: number argument'
  );

  // Object with explicit toString
  const obj = { toString: () => 'my-custom-object' };
  assert.strictEqual(
    W_chatHash(obj),
    'undefined::undefined',
    'Error Condition: object argument without indexes'
  );

  // Object that throws on indexing
  const throwObj = new Proxy({}, {
    get: function(target, prop) {
      if (prop === '1' || prop === '2') throw new Error('Cannot access index');
      return target[prop];
    }
  });

  assert.strictEqual(
    W_chatHash(throwObj),
    '[object Object]',
    'Error Condition: Object throwing on index access'
  );

  console.log('✅ All W_chatHash tests passed!');
}

runTests();
