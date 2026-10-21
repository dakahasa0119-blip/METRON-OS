#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assertEq(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name}: expected=${expected} actual=${actual}`);
  }
}

function assertMatch(name, actual, regex) {
  if (!regex.test(actual)) {
    throw new Error(`${name}: expected to match ${regex} actual=${actual}`);
  }
}

(function run() {
  const codePath = path.join(__dirname, '../gateway/System_Evolver.js');
  const code = fs.readFileSync(codePath, 'utf8');

  // Create an isolated sandbox context
  const sandbox = {};
  vm.createContext(sandbox);

  // Load the target file into the sandbox
  vm.runInContext(code, sandbox);

  const isEvolutionPatchSafe = sandbox.isEvolutionPatchSafe;

  if (typeof isEvolutionPatchSafe !== 'function') {
    throw new Error('isEvolutionPatchSafe not found in gateway/System_Evolver.js');
  }

  // --- Tests ---

  // 1. Valid pure code
  const validCode = "const a = 1; function b() { return a; }";
  const resultValid = isEvolutionPatchSafe(validCode);
  assertEq('Valid code should be safe', resultValid.safe, true);

  // 2. Syntax error: missing bracket
  const missingBracket = "function test() {";
  const resultMissing = isEvolutionPatchSafe(missingBracket);
  assertEq('Missing bracket should not be safe', resultMissing.safe, false);
  assertEq('Missing bracket reason check', typeof resultMissing.reason, 'string');

  // 3. Syntax error: unexpected token
  const unexpectedToken = "const a = 1; = 2;";
  const resultUnexpected = isEvolutionPatchSafe(unexpectedToken);
  assertEq('Unexpected token should not be safe', resultUnexpected.safe, false);

  // 4. Empty string
  const emptyString = "";
  const resultEmpty = isEvolutionPatchSafe(emptyString);
  assertEq('Empty string should be safe (creates empty function)', resultEmpty.safe, true);

  // 5. Code with comments only
  const commentOnly = "// just a comment";
  const resultComment = isEvolutionPatchSafe(commentOnly);
  assertEq('Comment only code should be safe', resultComment.safe, true);

  console.log('PASS: gateway isEvolutionPatchSafe edge case checks');
})();
