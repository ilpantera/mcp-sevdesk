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
};
