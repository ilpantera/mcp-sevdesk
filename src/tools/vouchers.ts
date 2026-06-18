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
      accountDatev: z.union([
        z.number().describe("DATEV account number (Buchungskonto, e.g. 4920)"),
        z.object({
          id: z.number().describe("DATEV account number (Buchungskonto, e.g. 4920)"),
          objectName: z.literal("AccountDatev").describe("SevDesk object name for accountDatev in Update 2.0"),
        }),
      ]).optional().describe("DATEV account as account number or SevDesk object"),
      taxRate: z.number().optional().describe("Tax rate for this position"),
      sum: z.number().optional().describe("Net sum for this position"),
      comment: z.string().optional().describe("Internal comment/note"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherPosId: number;
      accountDatev?: number | {
        id: number;
        objectName: "AccountDatev";
      };
      taxRate?: number;
      sum?: number;
      comment?: string;
    }) => {
      const body: Record<string, any> = {};
      if (params.accountDatev !== undefined) {
        body.accountDatev = typeof params.accountDatev === "number"
          ? {
              id: params.accountDatev,
              objectName: "AccountDatev",
            }
          : {
              id: params.accountDatev.id,
              objectName: "AccountDatev",
            };
      }
      if (params.taxRate !== undefined) body.taxRate = params.taxRate;
      if (params.sum !== undefined) body.sum = params.sum;
      if (params.comment !== undefined) body.comment = params.comment;

      const { data, error } = await (client.PUT as any)("/VoucherPos/{voucherPosId}", {
        params: {
          path: { voucherPosId: params.voucherPosId },
        },
        body: body as any,
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
};
