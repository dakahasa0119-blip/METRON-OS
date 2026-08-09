const vm = require('vm');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../modules/gas/METRON_OS_B/Watcher.js'), 'utf8');

function runTests() {
  console.log("Running W_safeAnnounce tests...");

  // Test 1: announce is not defined. Should not throw.
  {
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    vm.runInContext('W_safeAnnounce("hello");', sandbox);
    console.log("Test 1 (announce not defined): PASS");
  }

  // Test 2: announce is defined.
  {
    let called = false;
    let calledMsg = null;
    let calledType = null;
    const sandbox = {
      console,
      announce: function(msg, type) {
        called = true;
        calledMsg = msg;
        calledType = type;
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    vm.runInContext('W_safeAnnounce("hello", "TEST");', sandbox);

    if (!called) throw new Error("announce was not called");
    if (calledMsg !== "hello") throw new Error("announce msg mismatch: " + calledMsg);
    if (calledType !== "TEST") throw new Error("announce type mismatch: " + calledType);
    console.log("Test 2 (announce defined with type): PASS");
  }

  // Test 3: default type
  {
    let calledType = null;
    const sandbox = {
      console,
      announce: function(msg, type) {
        calledType = type;
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    vm.runInContext('W_safeAnnounce("hello");', sandbox);

    if (calledType !== "SYSTEM") throw new Error("announce default type mismatch: " + calledType);
    console.log("Test 3 (default type): PASS");
  }

  // Test 4: announce throws an error.
  {
    let called = false;
    const sandbox = {
      console,
      announce: function(msg, type) {
        called = true;
        throw new Error("Fake error");
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    // execution of W_safeAnnounce should not throw
    vm.runInContext('W_safeAnnounce("hello");', sandbox);
    if (!called) throw new Error("announce was not called");
    console.log("Test 4 (announce throws error): PASS");
  }

  console.log("All tests passed!");
}

runTests();
