import test from "node:test";
import assert from "node:assert/strict";
import { invoiceTotal } from "../src/invoice.mjs";

test("customer charged for three discounted tickets", () => {
  assert.equal(invoiceTotal(10, 2, 3), 24);
});
test("customer charged for two discounted tickets", () => {
  assert.equal(invoiceTotal(8, 3, 2), 10);
});
