import { z } from "zod";
import type { SevdeskClient } from "../client.js";

export const orderTools = {
  list_orders: {
    description:
      "Read-only list of sevDesk orders. This tool is intentionally low-level and does not attempt Update 2.0 taxRule orchestration.",
    inputSchema: z.object({
      status: z.enum(["100", "200", "300", "1000"]).optional().describe("Order status: 100=Draft, 200=Delivered, 300=Partially delivered, 1000=Completed"),
      orderNumber: z.string().optional().describe("Filter by order number"),
      startDate: z.string().optional().describe("Filter by start date (Unix timestamp)"),
      endDate: z.string().optional().describe("Filter by end date (Unix timestamp)"),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      status?: "100" | "200" | "300" | "1000";
      orderNumber?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await (client.GET as any)("/Order", {
        params: {
          query: {
            status: params.status ? Number(params.status) : undefined,
            orderNumber: params.orderNumber,
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

  get_order: {
    description: "Read one sevDesk order by ID.",
    inputSchema: z.object({
      orderId: z.number().describe("The ID of the order to retrieve"),
    }),
    handler: async (client: SevdeskClient, params: { orderId: number }) => {
      const { data, error } = await (client.GET as any)("/Order/{orderId}", {
        params: {
          path: { orderId: params.orderId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_order_pdf: {
    description: "Read the PDF representation of an order.",
    inputSchema: z.object({
      orderId: z.number().describe("The ID of the order"),
      download: z.boolean().optional().describe("Whether to download the PDF"),
    }),
    handler: async (client: SevdeskClient, params: {
      orderId: number;
      download?: boolean;
    }) => {
      const { data, error } = await (client.GET as any)("/Order/{orderId}/getPdf", {
        params: {
          path: { orderId: params.orderId },
          query: {
            download: params.download,
          },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  send_order_by_email: {
    description:
      "Write tool that sends an order via email. Prefer sevDesk's dedicated send workflows over manual status assumptions.",
    inputSchema: z.object({
      orderId: z.number().describe("The ID of the order to send"),
      toEmail: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      text: z.string().describe("Email body text"),
      copy: z.boolean().optional().describe("Send a copy to your own email"),
      additionalAttachments: z.string().optional().describe("Additional attachment IDs, comma-separated"),
      ccEmail: z.string().optional().describe("CC email address"),
      bccEmail: z.string().optional().describe("BCC email address"),
    }),
    handler: async (client: SevdeskClient, params: {
      orderId: number;
      toEmail: string;
      subject: string;
      text: string;
      copy?: boolean;
      additionalAttachments?: string;
      ccEmail?: string;
      bccEmail?: string;
    }) => {
      const { data, error } = await (client.POST as any)("/Order/{orderId}/sendViaEmail", {
        params: {
          path: { orderId: params.orderId },
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
};
