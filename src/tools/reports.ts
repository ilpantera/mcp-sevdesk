import { z } from "zod";
import type { SevdeskClient } from "../client.js";

export const reportTools = {
  get_profit_and_loss: {
    description: "Get profit and loss report for a date range",
    inputSchema: z.object({
      startDate: z.string().describe("Start date (Unix timestamp)"),
      endDate: z.string().describe("End date (Unix timestamp)"),
      taxRule: z.enum(["taxRule", "notaxRule"]).optional().describe("Tax rule filter"),
    }),
    handler: async (client: SevdeskClient, params: {
      startDate: string;
      endDate: string;
      taxRule?: "taxRule" | "notaxRule";
    }) => {
      const { data, error } = await (client.GET as any)("/Report/profitAndLoss", {
        params: {
          query: {
            startDate: params.startDate,
            endDate: params.endDate,
            taxRule: params.taxRule,
          },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_asset_report: {
    description: "Get asset (balance sheet) report from sevdesk",
    inputSchema: z.object({
      startDate: z.string().describe("Start date (Unix timestamp)"),
      endDate: z.string().describe("End date (Unix timestamp)"),
    }),
    handler: async (client: SevdeskClient, params: {
      startDate: string;
      endDate: string;
    }) => {
      const { data, error } = await (client.GET as any)("/Report/asset", {
        params: {
          query: {
            startDate: params.startDate,
            endDate: params.endDate,
          },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },
};
