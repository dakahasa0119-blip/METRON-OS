import test from "node:test";
import assert from "node:assert/strict";
import { invoiceTotal } from "../src/invoice.mjs";

test("holdout: four units preserve correct multiplier", () => {
  assert.equal(invoiceTotal(9, 1, 4), 32);
});
test("holdout: zero discount must not change the invoice", () => {
  assert.equal(invoiceTotal(7, 0, 2), 14);
});
