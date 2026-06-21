import { z } from "zod";
import type { SevdeskClient } from "../client.js";

function normalizeInvoiceDateFilter(value: string | undefined, fieldName: "startDate" | "endDate"): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  // Date-only strings are normalized to midnight UTC so server-side filtering is deterministic.
  const parsedMs = Date.parse(trimmed.includes("T") ? trimmed : `${trimmed}T00:00:00Z`); // date-only inputs are normalized to UTC midnight
  if (Number.isNaN(parsedMs)) {
    throw new Error(`${fieldName} must be a Unix timestamp string or ISO date string (YYYY-MM-DD)`);
  }
  return Math.floor(parsedMs / 1000);
}

export const invoiceTools = {
  list_invoices: {
    description:
      "Read-only list of sevDesk invoices. This tool is intentionally low-level and does not model taxRule workflows directly.",
    inputSchema: z.object({
      status: z.enum(["100", "200", "1000"]).optional().describe("Invoice status: 100=Draft, 200=Open, 1000=Paid"),
      invoiceNumber: z.string().optional().describe("Filter by invoice number"),
      startDate: z.string().optional().describe(
        "Filter start date. Accepts Unix timestamp string or ISO date (YYYY-MM-DD); MCP normalizes ISO input to Unix seconds (ISO dates are interpreted as 00:00:00 UTC)."
      ),
      endDate: z.string().optional().describe(
        "Filter end date. Accepts Unix timestamp string or ISO date (YYYY-MM-DD); MCP normalizes ISO input to Unix seconds (ISO dates are interpreted as 00:00:00 UTC)."
      ),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      status?: "100" | "200" | "1000";
      invoiceNumber?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/Invoice", {
        params: {
          query: {
            status: params.status ? Number(params.status) : undefined,
            invoiceNumber: params.invoiceNumber,
            startDate: normalizeInvoiceDateFilter(params.startDate, "startDate"),
            endDate: normalizeInvoiceDateFilter(params.endDate, "endDate"),
            limit: params.limit,
            offset: params.offset,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_invoice: {
    description: "Read one sevDesk invoice by ID.",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to retrieve"),
    }),
    handler: async (client: SevdeskClient, params: { invoiceId: number }) => {
      const { data, error } = await client.GET("/Invoice/{invoiceId}", {
        params: {
          path: { invoiceId: params.invoiceId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_invoice_pdf: {
    description: "Read the PDF representation of an invoice.",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice"),
      download: z.boolean().optional().describe("Whether to download the PDF"),
      preventSendBy: z.boolean().optional().describe("Prevent setting sendBy date"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      download?: boolean;
      preventSendBy?: boolean;
    }) => {
      const { data, error } = await client.GET("/Invoice/{invoiceId}/getPdf", {
        params: {
          path: { invoiceId: params.invoiceId },
          query: {
            download: params.download,
            preventSendBy: params.preventSendBy,
          },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  send_invoice_by_email: {
    description:
      "Write tool that sends an invoice via email. In sevDesk Update 2.0 this can also trigger the corresponding status transition.",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to send"),
      toEmail: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      text: z.string().describe("Email body text"),
      copy: z.boolean().optional().describe("Send a copy to your own email"),
      additionalAttachments: z.string().optional().describe("Additional attachment IDs, comma-separated"),
      ccEmail: z.string().optional().describe("CC email address"),
      bccEmail: z.string().optional().describe("BCC email address"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      toEmail: string;
      subject: string;
      text: string;
      copy?: boolean;
      additionalAttachments?: string;
      ccEmail?: string;
      bccEmail?: string;
    }) => {
      const { data, error } = await client.POST("/Invoice/{invoiceId}/sendViaEmail", {
        params: {
          path: { invoiceId: params.invoiceId },
        },
        body: {
          toEmail: params.toEmail,
          subject: params.subject,
          text: params.text,
          copy: params.copy,
          additionalAttachments: params.additionalAttachments,
          ccEmail: params.ccEmail,
          bccEmail: params.bccEmail,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  mark_invoice_as_sent: {
    description:
      "Write tool that marks/sends an invoice via sevDesk's dedicated sendBy workflow. Use this instead of trying to set invoice status manually.",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice"),
      sendType: z.enum(["VPR", "VPDF", "VM", "VP"]).optional().describe("Send type: VPR=Print, VPDF=PDF, VM=Email, VP=Post"),
      sendDraft: z.boolean().optional().describe("Send draft invoice"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      sendType?: "VPR" | "VPDF" | "VM" | "VP";
      sendDraft?: boolean;
    }) => {
      const { data, error } = await client.PUT("/Invoice/{invoiceId}/sendBy", {
        params: {
          path: { invoiceId: params.invoiceId },
          query: {
            sendType: params.sendType ?? "VM",
            sendDraft: params.sendDraft,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  book_invoice: {
    description: "Write tool that books an invoice payment via sevDesk's dedicated payment endpoint.",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to book"),
      amount: z.number().describe("Amount to book"),
      date: z.string().describe(
        "Booking date passed through to sevDesk. Prefer YYYY-MM-DD; Unix timestamp strings are accepted when required by your sevDesk setup."
      ),
      type: z.enum(["N", "CB", "CF", "O", "OF", "MF", "C"]).describe("Booking type: N=Normal, CB=Cash discount, etc."),
      checkAccountId: z.number().describe("ID of the check account"),
      checkAccountTransactionId: z.number().optional().describe("ID of an existing transaction to link"),
      createFeed: z.boolean().optional().describe("Create a feed entry"),
    }),
    handler: async (client: SevdeskClient, params: {
      invoiceId: number;
      amount: number;
      date: string;
      type: "N" | "CB" | "CF" | "O" | "OF" | "MF" | "C";
      checkAccountId: number;
      checkAccountTransactionId?: number;
      createFeed?: boolean;
    }) => {
      const { data, error } = await client.PUT("/Invoice/{invoiceId}/bookAmount", {
        params: {
          path: { invoiceId: params.invoiceId },
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

  cancel_invoice: {
    description: "Write tool that cancels an invoice by creating the appropriate cancellation document.",
    inputSchema: z.object({
      invoiceId: z.number().describe("The ID of the invoice to cancel"),
    }),
    handler: async (client: SevdeskClient, params: { invoiceId: number }) => {
      const { data, error } = await client.POST("/Invoice/{invoiceId}/cancelInvoice", {
        params: {
          path: { invoiceId: params.invoiceId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },
};
