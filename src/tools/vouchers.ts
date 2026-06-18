import { z } from "zod";
import type { SevdeskClient } from "../client.js";

export const voucherTools = {
  list_vouchers: {
    description: "List all vouchers (receipts/expenses) from sevdesk",
    inputSchema: z.object({
      status: z.enum(["50", "100", "1000"]).optional().describe("Voucher status: 50=Draft, 100=Unpaid, 1000=Paid"),
      creditDebit: z.enum(["C", "D"]).optional().describe("C=Credit (income), D=Debit (expense)"),
      descriptionLike: z.string().optional().describe("Filter by description (partial match)"),
      startDate: z.string().optional().describe("Filter by start date (Unix timestamp)"),
      endDate: z.string().optional().describe("Filter by end date (Unix timestamp)"),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      status?: "50" | "100" | "1000";
      creditDebit?: "C" | "D";
      descriptionLike?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/Voucher", {
        params: {
          query: {
            status: params.status ? Number(params.status) : undefined,
            creditDebit: params.creditDebit,
            descriptionLike: params.descriptionLike,
            startDate: params.startDate ? Number(params.startDate) : undefined,
            endDate: params.endDate ? Number(params.endDate) : undefined,
            limit: params.limit,
            offset: params.offset,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_voucher: {
    description: "Get a specific voucher by ID from sevdesk",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher to retrieve"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      const { data, error } = await client.GET("/Voucher/{voucherId}", {
        params: {
          path: { voucherId: params.voucherId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  book_voucher: {
    description: "Book a voucher (mark it as paid)",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher to book"),
      amount: z.number().describe("Amount to book"),
      date: z.string().describe("Booking date (Unix timestamp)"),
      type: z.enum(["N", "CB", "CF", "O", "OF", "MF", "C"]).describe("Booking type: N=Normal, CB=Cash discount, etc."),
      checkAccountId: z.number().describe("ID of the check account"),
      checkAccountTransactionId: z.number().optional().describe("ID of an existing transaction to link"),
      createFeed: z.boolean().optional().describe("Create a feed entry"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherId: number;
      amount: number;
      date: string;
      type: "N" | "CB" | "CF" | "O" | "OF" | "MF" | "C";
      checkAccountId: number;
      checkAccountTransactionId?: number;
      createFeed?: boolean;
    }) => {
      const { data, error } = await client.PUT("/Voucher/{voucherId}/bookAmount", {
        params: {
          path: { voucherId: params.voucherId },
        },
        body: {
          amount: params.amount,
          date: params.date,
          type: params.type,
          checkAccount: {
            id: params.checkAccountId,
            objectName: "CheckAccount",
          },
          checkAccountTransaction: params.checkAccountTransactionId
            ? {
                id: params.checkAccountTransactionId,
                objectName: "CheckAccountTransaction",
              }
            : undefined,
          createFeed: params.createFeed,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_voucher_positions: {
    description: "Get all positions (line items) of a voucher",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      const { data, error } = await client.GET("/VoucherPos", {
        params: {
          query: {
            "voucher[id]": params.voucherId,
            "voucher[objectName]": "Voucher",
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  upload_voucher_file: {
    description: "Upload a file (receipt image/PDF) for a voucher",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher"),
      fileName: z.string().describe("Name of the file"),
      base64Content: z.string().describe("Base64 encoded file content"),
      creditDebit: z.enum(["C", "D"]).optional().describe("C=Credit, D=Debit. Default: D"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherId: number;
      fileName: string;
      base64Content: string;
      creditDebit?: "C" | "D";
    }) => {
      const { data, error } = await client.POST("/Voucher/Factory/uploadTempFile", {
        body: {
          content: params.base64Content,
          filename: params.fileName,
          base64: true,
          creditDebit: params.creditDebit ?? "D",
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  update_voucher: {
    description: "Update an existing voucher's metadata for classification purposes",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher to update"),
      status: z.enum(["50", "100", "1000"]).optional().describe("Voucher status: 50=Draft, 100=Unpaid/Open, 1000=Paid/Booked"),
      taxType: z.enum(["default", "eu", "noteu", "custom", "ss"]).optional().describe("Tax treatment type"),
      taxRule: z.object({
        id: z.number().describe(
          "TaxRule ID: 9=standard deductible VAT, 12=reverse charge with VAT deduction (non-EU services), " +
          "13=reverse charge without VAT deduction"
        ),
        objectName: z.literal("TaxRule"),
      }).optional().describe("Tax rule (API v2). Replaces deprecated taxType."),
      deliveryDate: z.string().optional().describe(
        "Delivery/service date in ISO format YYYY-MM-DDTHH:mm:ss (e.g. '2024-01-15T00:00:00')"
      ),
      taxRate: z.number().optional().describe("Overall tax rate in percent"),
      creditDebit: z.enum(["C", "D"]).optional().describe("C=Credit, D=Debit"),
      description: z.string().optional().describe("Description/memo"),
      supplierId: z.number().optional().describe("Contact ID of the supplier"),
      supplierName: z.string().optional().describe("Supplier name (used when supplierId is set)"),
      voucherDate: z.string().optional().describe("Voucher date as Unix timestamp string"),
      payDate: z.string().optional().describe("Payment date as Unix timestamp string"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherId: number;
      status?: "50" | "100" | "1000";
      taxType?: "default" | "eu" | "noteu" | "custom" | "ss";
      taxRule?: { id: number; objectName: "TaxRule" };
      deliveryDate?: string;
      taxRate?: number;
      creditDebit?: "C" | "D";
      description?: string;
      supplierId?: number;
      supplierName?: string;
      voucherDate?: string;
      payDate?: string;
    }) => {
      const body: Record<string, any> = {};
      if (params.status !== undefined) body.status = Number(params.status);
      if (params.taxType !== undefined) body.taxType = params.taxType;
      if (params.taxRule !== undefined) body.taxRule = { id: params.taxRule.id, objectName: "TaxRule" };
      if (params.deliveryDate !== undefined) body.deliveryDate = params.deliveryDate;
      if (params.taxRate !== undefined) body.taxRate = params.taxRate;
      if (params.creditDebit !== undefined) body.creditDebit = params.creditDebit;
      if (params.description !== undefined) body.description = params.description;
      if (params.supplierId !== undefined) {
        body.supplier = { id: params.supplierId, objectName: "Contact" };
      }
      if (params.supplierName !== undefined) body.supplierName = params.supplierName;
      if (params.voucherDate !== undefined) body.voucherDate = params.voucherDate;
      if (params.payDate !== undefined) body.payDate = params.payDate;

      const { data, error } = await (client.PUT as any)("/Voucher/{voucherId}", {
        params: {
          path: { voucherId: params.voucherId },
        },
        body: body as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  update_voucher_position: {
    description: "Update a single voucher position (line item), especially the DATEV booking account (accountDatev)",
    inputSchema: z.object({
      voucherPosId: z.number().describe("The ID of the voucher position to update"),
      accountDatev: z.object({
        id: z.number().describe("DATEV account number (Buchungskonto, e.g. 4920)"),
        objectName: z.string().describe("SevDesk object name for accountDatev"),
      }).optional().describe("DATEV account as SevDesk object"),
      taxRate: z.number().optional().describe("Tax rate for this position"),
      sum: z.number().optional().describe("Net sum for this position"),
      net: z.boolean().optional().describe(
        "If true, 'sum'/'sumNet' is treated as net amount and gross is calculated. " +
        "If false, 'sumGross' is the base. Defaults to true on most positions."
      ),
      sumNet: z.number().optional().describe(
        "Net amount of the position. Alias for 'sum'. Use this when net=true."
      ),
      sumGross: z.number().optional().describe(
        "Gross amount of the position (net + VAT). Use this to set the gross directly."
      ),
      comment: z.string().optional().describe("Internal comment/note"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherPosId: number;
      accountDatev?: {
        id: number;
        objectName: string;
      };
      taxRate?: number;
      sum?: number;
      net?: boolean;
      sumNet?: number;
      sumGross?: number;
      comment?: string;
    }) => {
      const { data, error } = await (client.PUT as any)("/VoucherPos/{voucherPosId}", {
        params: {
          path: { voucherPosId: params.voucherPosId },
        },
        body: {
          ...(params.accountDatev !== undefined && {
            accountDatev: { id: params.accountDatev.id, objectName: params.accountDatev.objectName },
          }),
          ...(params.taxRate !== undefined && { taxRate: params.taxRate }),
          ...(params.sum !== undefined && { sum: String(params.sum) }),
          ...(params.sumNet !== undefined && { sumNet: String(params.sumNet) }),
          ...(params.sumGross !== undefined && { sumGross: String(params.sumGross) }),
          ...(params.net !== undefined && { net: params.net }),
          ...(params.comment !== undefined && { comment: params.comment }),
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  list_vouchers_by_account: {
    description: "List voucher positions filtered by DATEV booking account (accountDatev). Useful for expense analysis by account.",
    inputSchema: z.object({
      accountDatev: z.number().describe("DATEV account to filter by"),
      startDate: z.string().optional().describe("Filter by start date (Unix timestamp)"),
      endDate: z.string().optional().describe("Filter by end date (Unix timestamp)"),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      accountDatev: number;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/VoucherPos", {
        params: {
          query: {
            "accountDatev[id]": params.accountDatev,
            "accountDatev[objectName]": "AccountDatev",
            startDate: params.startDate ? Number(params.startDate) : undefined,
            endDate: params.endDate ? Number(params.endDate) : undefined,
            limit: params.limit,
            offset: params.offset,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_voucher_summary: {
    description: "Get aggregated voucher totals (net/gross/tax) for a date range",
    inputSchema: z.object({
      startDate: z.string().describe("Filter by start date (Unix timestamp)"),
      endDate: z.string().describe("Filter by end date (Unix timestamp)"),
      creditDebit: z.enum(["C", "D"]).optional().describe("C=Credit (income), D=Debit (expense)"),
      status: z.enum(["50", "100", "1000"]).optional().describe("Voucher status: 50=Draft, 100=Unpaid, 1000=Paid"),
    }),
    handler: async (client: SevdeskClient, params: {
      startDate: string;
      endDate: string;
      creditDebit?: "C" | "D";
      status?: "50" | "100" | "1000";
    }) => {
      const { data, error } = await client.GET("/Voucher", {
        params: {
          query: {
            startDate: Number(params.startDate),
            endDate: Number(params.endDate),
            creditDebit: params.creditDebit,
            status: params.status ? Number(params.status) : undefined,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));

      const objects: any[] = (data as any)?.objects ?? [];
      let sumNet = 0;
      let sumGross = 0;
      let sumTax = 0;

      for (const voucher of objects) {
        sumNet += parseFloat(voucher.sumNet ?? "0") || 0;
        sumGross += parseFloat(voucher.sumGross ?? "0") || 0;
        sumTax += parseFloat(voucher.sumTax ?? "0") || 0;
      }

      return {
        count: objects.length,
        sumNet,
        sumGross,
        sumTax,
        currency: "EUR",
        period: { from: params.startDate, to: params.endDate },
      };
    },
  },

  get_receipt_guidance: {
    description:
      "Get DATEV account guidance for expense booking. Returns accountDatevId (internal SevDesk integer ID) " +
      "and accountNumber (SKR04 account number like '6600') for use with update_voucher_position. " +
      "Use /forAllAccounts to browse all expense accounts, or /forExpense to get guidance for a specific expense type.",
    inputSchema: z.object({
      mode: z.enum(["forAllAccounts", "forExpense"]).describe(
        "forAllAccounts: returns all available expense accounts with their IDs and SKR numbers. " +
        "forExpense: returns guidance for a specific receipt (requires receiptAmount and receiptTaxAmount)."
      ),
      receiptAmount: z.number().optional().describe(
        "Gross receipt amount in EUR. Required for mode=forExpense."
      ),
      receiptTaxAmount: z.number().optional().describe(
        "Tax amount in EUR. Required for mode=forExpense."
      ),
    }),
    handler: async (
      client: SevdeskClient,
      params: { mode: "forAllAccounts" | "forExpense"; receiptAmount?: number; receiptTaxAmount?: number }
    ) => {
      if (params.mode === "forAllAccounts") {
        const { data, error } = await (client.GET as any)("/ReceiptGuidance/forAllAccounts", {});
        if (error) throw new Error(JSON.stringify(error));
        return data;
      } else {
        const { data, error } = await (client.GET as any)("/ReceiptGuidance/forExpense", {
          params: {
            query: {
              receiptAmount: params.receiptAmount,
              receiptTaxAmount: params.receiptTaxAmount,
            },
          },
        });
        if (error) throw new Error(JSON.stringify(error));
        return data;
      }
    },
  },

  create_voucher: {
    description:
      "Create a new voucher (expense receipt) with positions via POST /Voucher/Factory/saveVoucher. " +
      "Use this to create new expense entries. Requires supplier contact ID or name.",
    inputSchema: z.object({
      voucherDate: z.string().describe("Voucher date in ISO format YYYY-MM-DDTHH:mm:ss"),
      deliveryDate: z.string().optional().describe("Delivery/service date in ISO format YYYY-MM-DDTHH:mm:ss"),
      description: z.string().optional().describe("Description / voucher number from supplier"),
      status: z.number().optional().describe("50=Draft, 100=Open. Default: 50"),
      taxType: z.string().optional().describe("Deprecated v1 field, use taxRule instead"),
      taxRule: z.object({
        id: z.number().describe("TaxRule ID: 9=standard, 12=reverse charge with deduction, 13=without"),
        objectName: z.literal("TaxRule"),
      }).optional(),
      supplierId: z.number().optional().describe("SevDesk contact ID of the supplier"),
      supplierName: z.string().optional().describe(
        "Supplier name (used if supplierId is not known). SevDesk will try to match or create."
      ),
      voucherPositions: z.array(z.object({
        accountDatev: z.object({
          id: z.number().describe("Internal SevDesk accountDatev ID (use get_receipt_guidance to find)"),
          objectName: z.literal("AccountDatev"),
        }),
        taxRate: z.number().describe("VAT rate in percent, e.g. 19, 7, or 0"),
        net: z.boolean().describe("If true, sum/sumNet is the net amount"),
        sum: z.number().describe("Net amount if net=true, else gross"),
        sumNet: z.number().optional(),
        sumGross: z.number().optional(),
        comment: z.string().optional().describe("Line item description"),
      })).describe("List of voucher positions (line items)"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherDate: string;
      deliveryDate?: string;
      description?: string;
      status?: number;
      taxRule?: { id: number; objectName: "TaxRule" };
      supplierId?: number;
      supplierName?: string;
      voucherPositions: Array<{
        accountDatev: { id: number; objectName: "AccountDatev" };
        taxRate: number;
        net: boolean;
        sum: number;
        sumNet?: number;
        sumGross?: number;
        comment?: string;
      }>;
    }) => {
      const voucher: Record<string, unknown> = {
        objectName: "Voucher",
        mapAll: true,
        voucherDate: params.voucherDate,
        status: params.status ?? 50,
        ...(params.deliveryDate && { deliveryDate: params.deliveryDate }),
        ...(params.description && { description: params.description }),
        ...(params.taxRule && { taxRule: params.taxRule }),
        ...(params.supplierId && {
          supplier: { id: params.supplierId, objectName: "Contact" },
        }),
        ...(params.supplierName && !params.supplierId && {
          supplierName: params.supplierName,
        }),
      };

      const voucherPosSave = params.voucherPositions.map((pos, i) => ({
        objectName: "VoucherPos",
        mapAll: true,
        sequenceNumber: i + 1,
        accountDatev: { id: pos.accountDatev.id, objectName: "AccountDatev" },
        taxRate: pos.taxRate,
        net: pos.net,
        sum: String(pos.sum),
        ...(pos.sumNet !== undefined && { sumNet: String(pos.sumNet) }),
        ...(pos.sumGross !== undefined && { sumGross: String(pos.sumGross) }),
        ...(pos.comment && { comment: pos.comment }),
      }));

      const { data, error } = await (client.POST as any)("/Voucher/Factory/saveVoucher", {
        body: { voucher, voucherPosSave },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_voucher_document_image: {
    description: "Get the document/receipt image attached to a voucher as base64-encoded data.",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      const { data, error } = await (client.GET as any)(
        "/Voucher/{voucherId}/getDocumentImage",
        { params: { path: { voucherId: params.voucherId } } }
      );
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },
};
