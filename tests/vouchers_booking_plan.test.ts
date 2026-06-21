import { describe, expect, it, vi } from "vitest";
import {
  calculateGross,
  roundCurrency,
  validateBookingPlanInternal,
  voucherTools,
  type VoucherBookingPlan,
} from "../src/tools/vouchers.js";
import type { SevdeskClient } from "../src/client.js";

describe("voucher booking plan helpers", () => {
  it("roundCurrency rounds commercial to 2 decimals", () => {
    expect(roundCurrency(1.005)).toBe(1.01);
    expect(roundCurrency(12.344)).toBe(12.34);
  });

  it("calculateGross supports 19%, 7%, 0% and generic tax rates", () => {
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
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ACCOUNT_DATEV_ID_REQUIRED",
          path: "positions[0].accountDatevId",
        }),
      ])
    );
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
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ASSET_USEFUL_LIFE_REQUIRED",
          path: "positions[0].assetUsefulLife",
        }),
      ])
    );
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
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EXPECTED_TOTAL_GROSS_MISMATCH",
          path: "expectedTotalGross",
        }),
      ])
    );
  });

  it("validateBookingPlanInternal reports explicit sumGross mismatches", () => {
    const result = validateBookingPlanInternal({
      voucherId: 10,
      positions: [
        {
          accountDatevId: 555,
          taxRate: 7,
          sumNet: 100,
          sumGross: 100,
          comment: "Fachliteratur",
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SUM_GROSS_MISMATCH",
          path: "positions[0].sumGross",
        }),
      ])
    );
  });

  it("validateBookingPlanInternal warns for zero-tax positions without a justification", () => {
    const result = validateBookingPlanInternal({
      voucherId: 10,
      positions: [
        {
          accountDatevId: 555,
          taxRate: 0,
          sumNet: 10,
          comment: "Bewirtung",
        },
      ],
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ZERO_TAX_REVIEW_REQUIRED",
          path: "positions[0].taxRate",
        }),
      ])
    );
  });

  it("apply_voucher_booking_plan supports dryRun without mutating sevDesk", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          objects: [
            {
              accountDatevId: 555,
              accountNumber: "6600",
              accountName: "Büromaterial",
              allowedTaxRules: [
                {
                  id: 9,
                  taxRates: ["NINETEEN"],
                },
              ],
            },
          ],
        },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: {
          objects: [
            {
              id: 10,
              taxRule: { id: 9, objectName: "TaxRule" },
              description: "Alter Beleg",
            },
          ],
        },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: {
          objects: [
            {
              id: 77,
              objectName: "VoucherPos",
            },
          ],
        },
        error: undefined,
      });
    const PUT = vi.fn();
    const POST = vi.fn();
    const DELETE = vi.fn();

    const result = await voucherTools.apply_voucher_booking_plan.handler(
      { GET, PUT, POST, DELETE } as unknown as SevdeskClient,
      {
        voucherId: 10,
        description: "Neuer Beleg",
        expectedTotalGross: 119,
        dryRun: true,
        positions: [
          {
            voucherPosIdToReuse: 77,
            accountDatevId: 555,
            taxRate: 19,
            sumNet: 100,
            comment: "Büromaterial",
          },
        ],
      }
    );

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.appliedChanges.reusedPositionIds).toEqual([77]);
    expect(result.appliedChanges.createdPositionIndexes).toEqual([]);
    expect(GET).toHaveBeenCalledTimes(3);
    expect(PUT).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
    expect(DELETE).not.toHaveBeenCalled();
  });

  it("apply_voucher_booking_plan returns structured validation errors without writing", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          objects: [
            {
              accountDatevId: 555,
              allowedTaxRules: [{ id: 9, taxRates: ["NINETEEN"] }],
            },
          ],
        },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { objects: [{ id: 10 }] },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { objects: [] },
        error: undefined,
      });
    const PUT = vi.fn();
    const POST = vi.fn();
    const DELETE = vi.fn();

    const result = await voucherTools.apply_voucher_booking_plan.handler(
      { GET, PUT, POST, DELETE } as unknown as SevdeskClient,
      {
        voucherId: 10,
        expectedTotalGross: 119,
        dryRun: true,
        positions: [
          {
            accountDatevId: 555,
            taxRate: 19,
            sumNet: 100,
            comment: "Laptop",
            isAsset: true,
          },
        ],
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ASSET_USEFUL_LIFE_REQUIRED" }),
      ])
    );
    expect(PUT).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
    expect(DELETE).not.toHaveBeenCalled();
  });

  it("apply_voucher_booking_plan reports ReceiptGuidance mismatches", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          objects: [
            {
              accountDatevId: 999,
              allowedTaxRules: [{ id: 9, taxRates: ["NINETEEN"] }],
            },
          ],
        },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { objects: [{ id: 10 }] },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { objects: [] },
        error: undefined,
      });

    const result = await voucherTools.apply_voucher_booking_plan.handler(
      { GET, PUT: vi.fn(), POST: vi.fn(), DELETE: vi.fn() } as unknown as SevdeskClient,
      {
        voucherId: 10,
        expectedTotalGross: 119,
        dryRun: true,
        positions: [
          {
            accountDatevId: 555,
            taxRate: 19,
            sumNet: 100,
            comment: "Büromaterial",
          },
        ],
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "RECEIPT_GUIDANCE_ACCOUNT_NOT_ALLOWED" }),
      ])
    );
  });

  it("apply_voucher_booking_plan returns a structured voucher context read error", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          objects: [
            {
              accountDatevId: 555,
              allowedTaxRules: [{ id: 9, taxRates: ["NINETEEN"] }],
            },
          ],
        },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: undefined,
        error: { message: "voucher unavailable" },
      });

    const result = await voucherTools.apply_voucher_booking_plan.handler(
      { GET, PUT: vi.fn(), POST: vi.fn(), DELETE: vi.fn() } as unknown as SevdeskClient,
      {
        voucherId: 10,
        expectedTotalGross: 119,
        dryRun: true,
        positions: [
          {
            accountDatevId: 555,
            taxRate: 19,
            sumNet: 100,
            comment: "Büromaterial",
          },
        ],
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "VOUCHER_CONTEXT_READ_FAILED" }),
      ])
    );
  });
});
