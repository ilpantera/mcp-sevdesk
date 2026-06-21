import { z } from "zod";
import type { SevdeskClient } from "../client.js";

export const accountTools = {
  list_check_accounts: {
    description: "Read-only list of sevDesk check accounts (bank / cash accounts).",
    inputSchema: z.object({
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/CheckAccount", {
        params: {
          query: {
            limit: params.limit,
            offset: params.offset,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_check_account: {
    description: "Read one sevDesk check account by ID.",
    inputSchema: z.object({
      checkAccountId: z.number().describe("The ID of the check account"),
    }),
    handler: async (client: SevdeskClient, params: { checkAccountId: number }) => {
      const { data, error } = await client.GET("/CheckAccount/{checkAccountId}", {
        params: {
          path: { checkAccountId: params.checkAccountId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_check_account_balance: {
    description:
      "Read the balance of a check account at a specific ISO date (YYYY-MM-DD).",
    inputSchema: z.object({
      checkAccountId: z.number().describe("The ID of the check account"),
      date: z.string().optional().describe("Date for the balance in ISO format YYYY-MM-DD. Default: today"),
    }),
    handler: async (client: SevdeskClient, params: {
      checkAccountId: number;
      date?: string;
    }) => {
      const { data, error } = await client.GET("/CheckAccount/{checkAccountId}/getBalanceAtDate", {
        params: {
          path: { checkAccountId: params.checkAccountId },
          query: {
            date: params.date ?? new Date().toISOString().split('T')[0],
          },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  list_transactions: {
    description:
      "Read-only transaction list for a check account. valueDate is the effective bank date; entryDate is the booking/import date when available.",
    inputSchema: z.object({
      checkAccountId: z.number().describe("The ID of the check account"),
      startDate: z.string().optional().describe("Filter by valueDate/entryDate window start (ISO date or date-time)"),
      endDate: z.string().optional().describe("Filter by valueDate/entryDate window end (ISO date or date-time)"),
      paymtPurpose: z.string().optional().describe("Filter by payment purpose"),
      isBooked: z.boolean().optional().describe("Filter by booked status"),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      checkAccountId: number;
      startDate?: string;
      endDate?: string;
      paymtPurpose?: string;
      isBooked?: boolean;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/CheckAccountTransaction", {
        params: {
          query: {
            "checkAccount[id]": params.checkAccountId,
            "checkAccount[objectName]": "CheckAccount",
            startDate: params.startDate,
            endDate: params.endDate,
            paymtPurpose: params.paymtPurpose,
            isBooked: params.isBooked,
            limit: params.limit,
            offset: params.offset,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_transaction: {
    description: "Read one check account transaction by ID.",
    inputSchema: z.object({
      transactionId: z.number().describe("The ID of the transaction"),
    }),
    handler: async (client: SevdeskClient, params: { transactionId: number }) => {
      const { data, error } = await client.GET("/CheckAccountTransaction/{checkAccountTransactionId}", {
        params: {
          path: { checkAccountTransactionId: params.transactionId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  create_transaction: {
    description:
      "Create a new transaction in a check account. valueDate is the effective bank date; entryDate is the booking/import date if known.",
    inputSchema: z.object({
      checkAccountId: z.number().describe("The ID of the check account"),
      amount: z.number().describe("Transaction amount (positive for credit, negative for debit)"),
      valueDate: z.string().describe("Value date (effective bank date, ISO YYYY-MM-DD)"),
      entryDate: z.string().optional().describe("Entry/import date (ISO YYYY-MM-DD)"),
      paymtPurpose: z.string().optional().describe("Payment purpose/description"),
      payeePayerName: z.string().optional().describe("Name of payee or payer"),
      payeePayerAcctNo: z.string().optional().describe("Account number of payee/payer"),
      payeePayerBankCode: z.string().optional().describe("Bank code of payee/payer"),
    }),
    handler: async (client: SevdeskClient, params: {
      checkAccountId: number;
      amount: number;
      valueDate: string;
      entryDate?: string;
      paymtPurpose?: string;
      payeePayerName?: string;
      payeePayerAcctNo?: string;
      payeePayerBankCode?: string;
    }) => {
      const { data, error } = await client.POST("/CheckAccountTransaction", {
        body: {
          checkAccount: {
            id: params.checkAccountId,
            objectName: "CheckAccount",
          },
          amount: params.amount,
          valueDate: params.valueDate,
          entryDate: params.entryDate,
          paymtPurpose: params.paymtPurpose,
          payeePayerName: params.payeePayerName,
          payeePayerAcctNo: params.payeePayerAcctNo,
          payeePayerBankCode: params.payeePayerBankCode,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  update_transaction: {
    description:
      "Update an existing check account transaction (PUT /CheckAccountTransaction/{id}). " +
      "Use to correct amount, valueDate, entryDate, purpose, or status of a transaction.",
    inputSchema: z.object({
      transactionId: z.number().describe("ID of the transaction to update"),
      amount: z.number().optional().describe("Transaction amount (positive=credit, negative=debit)"),
      valueDate: z.string().optional().describe("Value date YYYY-MM-DD"),
      entryDate: z.string().optional().describe("Entry/import date YYYY-MM-DD"),
      paymtPurpose: z.string().optional().describe("Payment purpose/description"),
      payeePayerName: z.string().optional().describe("Name of payee or payer"),
      payeePayerAcctNo: z.string().optional().describe("Account number of payee/payer"),
      payeePayerBankCode: z.string().optional().describe("Bank code of payee/payer"),
      status: z.number().optional().describe("Transaction status: 100=created, 200=linked, 300=private, 400=booked"),
    }),
    handler: async (client: SevdeskClient, params: {
      transactionId: number;
      amount?: number;
      valueDate?: string;
      entryDate?: string;
      paymtPurpose?: string;
      payeePayerName?: string;
      payeePayerAcctNo?: string;
      payeePayerBankCode?: string;
      status?: number;
    }) => {
      const { data, error } = await client.PUT("/CheckAccountTransaction/{checkAccountTransactionId}", {
        params: { path: { checkAccountTransactionId: params.transactionId } },
        body: {
          ...(params.amount !== undefined && { amount: params.amount }),
          ...(params.valueDate && { valueDate: params.valueDate }),
          ...(params.entryDate && { entryDate: params.entryDate }),
          ...(params.paymtPurpose && { paymtPurpose: params.paymtPurpose }),
          ...(params.payeePayerName && { payeePayerName: params.payeePayerName }),
          ...(params.payeePayerAcctNo && { payeePayerAcctNo: params.payeePayerAcctNo }),
          ...(params.payeePayerBankCode && { payeePayerBankCode: params.payeePayerBankCode }),
          ...(params.status !== undefined && { status: params.status }),
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  delete_transaction: {
    description: "Delete a check account transaction (DELETE /CheckAccountTransaction/{id}).",
    inputSchema: z.object({
      transactionId: z.number().describe("ID of the transaction to delete"),
    }),
    handler: async (client: SevdeskClient, params: { transactionId: number }) => {
      const { data, error } = await client.DELETE(
        "/CheckAccountTransaction/{checkAccountTransactionId}",
        { params: { path: { checkAccountTransactionId: params.transactionId } } }
      );
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  enshrine_transaction: {
    description:
      "Irreversible write tool: enshrine a check account transaction (PUT /CheckAccountTransaction/{id}/enshrine). " +
      "Enshrined transactions cannot be changed and this operation cannot be undone.",
    inputSchema: z.object({
      transactionId: z.number().describe("ID of the transaction to enshrine"),
    }),
    handler: async (client: SevdeskClient, params: { transactionId: number }) => {
      const { data, error } = await (client.PUT as any)(
        "/CheckAccountTransaction/{checkAccountTransactionId}/enshrine",
        { params: { path: { checkAccountTransactionId: params.transactionId } } }
      );
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },
};
