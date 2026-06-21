import { z } from "zod";
import type { SevdeskClient } from "../client.js";

export const creditNoteTools = {
  list_credit_notes: {
    description:
      "Read-only list of sevDesk credit notes. This tool stays low-level and does not expose deprecated taxType workflows.",
    inputSchema: z.object({
      status: z.enum(["100", "200", "1000"]).optional().describe("Credit note status: 100=Draft, 200=Open, 1000=Booked"),
      startDate: z.string().optional().describe("Filter by start date (Unix timestamp)"),
      endDate: z.string().optional().describe("Filter by end date (Unix timestamp)"),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      status?: "100" | "200" | "1000";
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await (client.GET as any)("/CreditNote", {
        params: {
          query: {
            status: params.status ? Number(params.status) : undefined,
            startDate: params.startDate ? Number(params.startDate) : undefined,
            endDate: params.endDate ? Number(params.endDate) : undefined,
            limit: params.limit,
            offset: params.offset,
          },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_credit_note: {
    description: "Read one sevDesk credit note by ID.",
    inputSchema: z.object({
      creditNoteId: z.number().describe("The ID of the credit note to retrieve"),
    }),
    handler: async (client: SevdeskClient, params: { creditNoteId: number }) => {
      const { data, error } = await (client.GET as any)("/CreditNote/{creditNoteId}", {
        params: {
          path: { creditNoteId: params.creditNoteId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_credit_note_pdf: {
    description: "Read the PDF representation of a credit note.",
    inputSchema: z.object({
      creditNoteId: z.number().describe("The ID of the credit note"),
      download: z.boolean().optional().describe("Whether to download the PDF"),
    }),
    handler: async (client: SevdeskClient, params: {
      creditNoteId: number;
      download?: boolean;
    }) => {
      const { data, error } = await (client.GET as any)("/CreditNote/{creditNoteId}/getPdf", {
        params: {
          path: { creditNoteId: params.creditNoteId },
          query: {
            download: params.download,
          },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  send_credit_note_by_email: {
    description:
      "Write tool that sends a credit note via email. In sevDesk Update 2.0 this can also trigger the corresponding status transition.",
    inputSchema: z.object({
      creditNoteId: z.number().describe("The ID of the credit note to send"),
      toEmail: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      text: z.string().describe("Email body text"),
      ccEmail: z.string().optional().describe("CC email address"),
      bccEmail: z.string().optional().describe("BCC email address"),
      copy: z.boolean().optional().describe("Send a copy to your own email"),
    }),
    handler: async (client: SevdeskClient, params: {
      creditNoteId: number;
      toEmail: string;
      subject: string;
      text: string;
      ccEmail?: string;
      bccEmail?: string;
      copy?: boolean;
    }) => {
      const { data, error } = await (client.POST as any)("/CreditNote/{creditNoteId}/sendViaEmail", {
        params: {
          path: { creditNoteId: params.creditNoteId },
        },
        body: {
          toEmail: params.toEmail,
          subject: params.subject,
          text: params.text,
          ccEmail: params.ccEmail,
          bccEmail: params.bccEmail,
          copy: params.copy,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  book_credit_note: {
    description: "Write tool that books a credit note payment via sevDesk's dedicated payment endpoint.",
    inputSchema: z.object({
      creditNoteId: z.number().describe("The ID of the credit note to book"),
      amount: z.number().describe("Amount to book"),
      date: z.string().describe("Booking date (Unix timestamp)"),
      type: z.enum(["N", "CB", "CF", "O", "OF", "MF", "C"]).describe("Booking type: N=Normal, CB=Cash discount, etc."),
      checkAccountId: z.number().describe("ID of the check account"),
      checkAccountTransactionId: z.number().optional().describe("ID of an existing transaction to link"),
      createFeed: z.boolean().optional().describe("Create a feed entry"),
    }),
    handler: async (client: SevdeskClient, params: {
      creditNoteId: number;
      amount: number;
      date: string;
      type: "N" | "CB" | "CF" | "O" | "OF" | "MF" | "C";
      checkAccountId: number;
      checkAccountTransactionId?: number;
      createFeed?: boolean;
    }) => {
      const { data, error } = await (client.PUT as any)("/CreditNote/{creditNoteId}/bookAmount", {
        params: {
          path: { creditNoteId: params.creditNoteId },
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
};
