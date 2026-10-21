const assert = require('assert');

function simulateDelay(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {}
}

class MockRange {
    constructor() {
        this.values = [];
    }
    setValue(val) {
        simulateDelay(50); // Simulate ~50ms delay for GAS setValue
        this.values.push(val);
        return this;
    }
    setValues(vals) {
        simulateDelay(50); // Simulate ~50ms delay for GAS setValues
        this.values = vals;
        return this;
    }
}

class MockSheet {
    getRange() {
        return new MockRange();
    }
}

function testUnoptimized(N) {
    const sheet = new MockSheet();
    const start = Date.now();
    for (let i = 0; i < N; i++) {
        sheet.getRange().setValue("DONE");
    }
    return Date.now() - start;
}

function testOptimized(N) {
    const sheet = new MockSheet();
    const start = Date.now();
    const statuses = [];
    for (let i = 0; i < N; i++) {
        statuses.push(["DONE"]);
    }
    sheet.getRange().setValues(statuses);
    return Date.now() - start;
}

const N = 10;
const unoptTime = testUnoptimized(N);
const optTime = testOptimized(N);

console.log(`Unoptimized (${N} items): ${unoptTime}ms`);
console.log(`Optimized (${N} items): ${optTime}ms`);
console.log(`Improvement: ${(unoptTime / optTime).toFixed(2)}x faster`);
