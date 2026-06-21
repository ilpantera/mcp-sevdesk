import { z } from "zod";
import type { SevdeskClient } from "../client.js";

export const partTools = {
  list_parts: {
    description:
      "Read-only lookup for sevDesk parts/articles. Useful for Update 2.0 sales and purchasing workflows before writing invoices or orders.",
    inputSchema: z.object({
      partNumber: z.string().optional().describe("Filter by part number"),
      name: z.string().optional().describe("Filter by part name"),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      partNumber?: string;
      name?: string;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/Part", {
        params: {
          query: {
            partNumber: params.partNumber,
            name: params.name,
            limit: params.limit,
            offset: params.offset,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_part: {
    description: "Read one sevDesk part/article by ID.",
    inputSchema: z.object({
      partId: z.number().describe("The ID of the part to retrieve"),
    }),
    handler: async (client: SevdeskClient, params: { partId: number }) => {
      const { data, error } = await client.GET("/Part/{partId}", {
        params: {
          path: { partId: params.partId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  create_part: {
    description:
      "Create a sevDesk part/article. The tool accepts unitId as a convenience wrapper and writes the sevDesk unity object internally.",
    inputSchema: z.object({
      name: z.string().describe("Name of the part"),
      partNumber: z.string().optional().describe("Part number"),
      stock: z.number().optional().describe("Current stock quantity"),
      stockEnabled: z.boolean().optional().describe("Enable stock tracking"),
      unitId: z.number().optional().describe("sevDesk unity ID (the API field is named unity)"),
      priceGross: z.number().optional().describe("Gross sales price"),
      priceNet: z.number().optional().describe("Net sales price"),
      taxRate: z.number().optional().describe("Tax rate in percent (e.g. 19)"),
      text: z.string().optional().describe("Optional long description"),
    }),
    handler: async (client: SevdeskClient, params: {
      name: string;
      partNumber?: string;
      stock?: number;
      stockEnabled?: boolean;
      unitId?: number;
      priceGross?: number;
      priceNet?: number;
      taxRate?: number;
      text?: string;
    }) => {
      const { data, error } = await client.POST("/Part", {
        body: {
          name: params.name,
          partNumber: params.partNumber,
          stock: params.stock,
          stockEnabled: params.stockEnabled,
          unity: params.unitId
            ? { id: params.unitId, objectName: "Unity" }
            : { id: 1, objectName: "Unity" },
          priceGross: params.priceGross?.toString(),
          priceNet: params.priceNet?.toString(),
          taxRate: params.taxRate?.toString(),
          text: params.text,
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  update_part: {
    description:
      "Update an existing sevDesk part/article. Use unitId for the sevDesk unity object and numeric prices in normal decimal form.",
    inputSchema: z.object({
      partId: z.number().describe("The ID of the part to update"),
      name: z.string().optional().describe("Name of the part"),
      partNumber: z.string().optional().describe("Part number"),
      stock: z.number().optional().describe("Current stock quantity"),
      stockEnabled: z.boolean().optional().describe("Enable stock tracking"),
      priceGross: z.number().optional().describe("Gross price"),
      priceNet: z.number().optional().describe("Net price"),
      taxRate: z.number().optional().describe("Tax rate in percent"),
      text: z.string().optional().describe("Description/long text"),
      priceNet2: z.number().optional().describe("Second net price tier"),
      priceNet3: z.number().optional().describe("Third net price tier"),
      priceNet4: z.number().optional().describe("Fourth net price tier"),
      priceNet5: z.number().optional().describe("Fifth net price tier"),
      category: z.string().optional().describe("Product category name"),
      unitId: z.number().optional().describe("sevDesk unity ID (written to the unity field)"),
    }),
    handler: async (client: SevdeskClient, params: {
      partId: number;
      name?: string;
      partNumber?: string;
      stock?: number;
      stockEnabled?: boolean;
      priceGross?: number;
      priceNet?: number;
      taxRate?: number;
      text?: string;
      priceNet2?: number;
      priceNet3?: number;
      priceNet4?: number;
      priceNet5?: number;
      category?: string;
      unitId?: number;
    }) => {
      const { partId, ...updateData } = params;
      const body: Record<string, any> = {};
      if (updateData.name) body.name = updateData.name;
      if (updateData.partNumber) body.partNumber = updateData.partNumber;
      if (updateData.stock !== undefined) body.stock = updateData.stock;
      if (updateData.stockEnabled !== undefined) body.stockEnabled = updateData.stockEnabled;
      if (updateData.priceGross !== undefined) body.priceGross = updateData.priceGross.toString();
      if (updateData.priceNet !== undefined) body.priceNet = updateData.priceNet.toString();
      if (updateData.taxRate !== undefined) body.taxRate = updateData.taxRate.toString();
      if (updateData.text !== undefined) body.text = updateData.text;
      if (updateData.priceNet2 !== undefined) body.priceNet2 = updateData.priceNet2.toString();
      if (updateData.priceNet3 !== undefined) body.priceNet3 = updateData.priceNet3.toString();
      if (updateData.priceNet4 !== undefined) body.priceNet4 = updateData.priceNet4.toString();
      if (updateData.priceNet5 !== undefined) body.priceNet5 = updateData.priceNet5.toString();
      if (updateData.category !== undefined) body.category = updateData.category;
      if (updateData.unitId !== undefined) body.unity = { id: updateData.unitId, objectName: "Unity" };

      const { data, error } = await client.PUT("/Part/{partId}", {
        params: {
          path: { partId },
        },
        body: body as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_part_stock: {
    description: "Read the current stock level of a part/article.",
    inputSchema: z.object({
      partId: z.number().describe("The ID of the part"),
    }),
    handler: async (client: SevdeskClient, params: { partId: number }) => {
      const { data, error } = await client.GET("/Part/{partId}/getStock", {
        params: {
          path: { partId: params.partId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  delete_part: {
    description: "Delete a sevDesk part/article.",
    inputSchema: z.object({
      partId: z.number().describe("The ID of the part to delete"),
    }),
    handler: async (client: SevdeskClient, params: { partId: number }) => {
      const { data, error } = await (client.DELETE as any)("/Part/{partId}", {
        params: {
          path: { partId: params.partId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  find_part_by_number_or_name: {
    description:
      "Read-only helper for article lookup. Tries partNumber and name filters and returns both result sets in one response.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Part number or part name"),
      limit: z.number().optional().describe("Maximum results per lookup"),
    }),
    handler: async (client: SevdeskClient, params: { query: string; limit?: number }) => {
      const [partNumberResult, nameResult] = await Promise.all([
        client.GET("/Part", {
          params: {
            query: {
              partNumber: params.query,
              limit: params.limit ?? 20,
            } as any,
          },
        }),
        client.GET("/Part", {
          params: {
            query: {
              name: params.query,
              limit: params.limit ?? 20,
            } as any,
          },
        }),
      ]);

      if (partNumberResult.error) throw new Error(JSON.stringify(partNumberResult.error));
      if (nameResult.error) throw new Error(JSON.stringify(nameResult.error));

      return {
        query: params.query,
        byPartNumber: partNumberResult.data,
        byName: nameResult.data,
      };
    },
  },
};
