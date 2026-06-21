import { describe, expect, it } from "vitest";
import {
  calculateGross,
  roundCurrency,
  validateBookingPlanInternal,
  type VoucherBookingPlan,
} from "../src/tools/vouchers.js";

describe("voucher booking plan helpers", () => {
  it("roundCurrency rounds commercial to 2 decimals", () => {
    expect(roundCurrency(1.005)).toBe(1.01);
    expect(roundCurrency(12.344)).toBe(12.34);
  });

  it("calculateGross supports standard and generic tax rates", () => {
    expect(calculateGross(100, 19)).toBe(119);
    expect(calculateGross(100, 7)).toBe(107);
    expect(calculateGross(100, 0)).toBe(100);
    expect(calculateGross(100, 5)).toBe(105);
  });

  it("validateBookingPlanInternal returns valid result for a valid plan", () => {
    const plan: VoucherBookingPlan = {
      voucherId: 10,
      expectedTotalGross: 119,
      positions: [
        {
          accountDatevId: 555,
          taxRate: 19,
          sumNet: 100,
          comment: "Büromaterial",
        },
      ],
    };

    const result = validateBookingPlanInternal(plan);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.computedTotals).toEqual({ totalNet: 100, totalGross: 119 });
    expect(result.normalizedPlan.positions[0].sumGross).toBe(119);
  });

  it("validateBookingPlanInternal reports missing accountDatevId", () => {
    const result = validateBookingPlanInternal({
      voucherId: 10,
      positions: [
        {
          accountDatevId: 0,
          taxRate: 19,
          sumNet: 100,
          comment: "Büromaterial",
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("positions[0].accountDatevId is required");
  });

  it("validateBookingPlanInternal reports asset without useful life", () => {
    const result = validateBookingPlanInternal({
      voucherId: 10,
      positions: [
        {
          accountDatevId: 555,
          taxRate: 19,
          sumNet: 100,
          comment: "Laptop",
          isAsset: true,
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("positions[0].assetUsefulLife is required when isAsset is true");
  });

  it("validateBookingPlanInternal reports gross mismatch against expectedTotalGross", () => {
    const result = validateBookingPlanInternal({
      voucherId: 10,
      expectedTotalGross: 120,
      positions: [
        {
          accountDatevId: 555,
          taxRate: 19,
          sumNet: 100,
          comment: "Büromaterial",
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("expectedTotalGross mismatch");
  });
});
