import { unitPrice } from "./pricing.mjs";

/** Discount applies to one item, then quantity multiplies the result. */
export function invoiceTotal(base, discount, quantity) {
  return unitPrice(base, discount) + quantity;
}
