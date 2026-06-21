import { z } from "zod";
import type { SevdeskClient } from "../client.js";

function normalizeContactLookupName(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function unwrapContactObjects(value: unknown): Record<string, unknown>[] {
  const record = asRecord(value);
  const objects = record?.objects;
  if (!Array.isArray(objects)) {
    return [];
  }

  return objects
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined);
}

function extractContactNames(contact: Record<string, unknown>): string[] {
  const values = [
    contact.name,
    contact.name2,
    contact.aliasName,
    [contact.surename, contact.familyname].filter((value) => typeof value === "string").join(" "),
  ];

  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(normalizeContactLookupName);
}

export const contactTools = {
  list_contacts: {
    description:
      "Read-only contact lookup for sevDesk Update 2.0 workflows. Useful for supplier/customer normalization before voucher or document writes.",
    inputSchema: z.object({
      depth: z.number().optional().describe("Defines depth of sub-objects returned"),
      customerNumber: z.string().optional().describe("Filter by customer number"),
      name: z.string().optional().describe("Filter by contact name"),
      categoryId: z.number().optional().describe("Optional category filter, e.g. 4 for suppliers"),
      limit: z.number().optional().describe("Limit the number of results (max 1000)"),
      offset: z.number().optional().describe("Skip a number of results"),
    }),
    handler: async (client: SevdeskClient, params: {
      depth?: number;
      customerNumber?: string;
      name?: string;
      categoryId?: number;
      limit?: number;
      offset?: number;
    }) => {
      const { data, error } = await client.GET("/Contact", {
        params: {
          query: {
            depth: params.depth as "0" | "1" | undefined,
            customerNumber: params.customerNumber,
            name: params.name,
            "category[id]": params.categoryId,
            "category[objectName]": params.categoryId ? "Category" : undefined,
            limit: params.limit,
            offset: params.offset,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_contact: {
    description: "Read one sevDesk contact by ID.",
    inputSchema: z.object({
      contactId: z.number().describe("The ID of the contact to retrieve"),
    }),
    handler: async (client: SevdeskClient, params: { contactId: number }) => {
      const { data, error } = await client.GET("/Contact/{contactId}", {
        params: {
          path: { contactId: params.contactId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  create_contact: {
    description: "Create a new sevDesk contact. Use categoryId=4 for supplier contacts in bookkeeping workflows.",
    inputSchema: z.object({
      name: z.string().optional().describe("The name of the contact (for organizations)"),
      surename: z.string().optional().describe("The surname of the contact person"),
      familyname: z.string().optional().describe("The family name of the contact person"),
      customerNumber: z.string().optional().describe("Customer number"),
      description: z.string().optional().describe("Description of the contact"),
      categoryId: z.number().describe("Category ID (3 = customer, 4 = supplier, 28 = partner)"),
    }),
    handler: async (client: SevdeskClient, params: {
      name?: string;
      surename?: string;
      familyname?: string;
      customerNumber?: string;
      description?: string;
      categoryId: number;
    }) => {
      const { data, error } = await client.POST("/Contact", {
        body: {
          name: params.name,
          surename: params.surename,
          familyname: params.familyname,
          customerNumber: params.customerNumber,
          description: params.description,
          category: {
            id: params.categoryId,
            objectName: "Category",
          },
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  update_contact: {
    description: "Update an existing sevDesk contact.",
    inputSchema: z.object({
      contactId: z.number().describe("The ID of the contact to update"),
      name: z.string().optional().describe("The name of the contact"),
      surename: z.string().optional().describe("The surname"),
      familyname: z.string().optional().describe("The family name"),
      customerNumber: z.string().optional().describe("Customer number"),
      description: z.string().optional().describe("Description"),
    }),
    handler: async (client: SevdeskClient, params: {
      contactId: number;
      name?: string;
      surename?: string;
      familyname?: string;
      customerNumber?: string;
      description?: string;
    }) => {
      const { contactId, ...updateData } = params;
      const { data, error } = await client.PUT("/Contact/{contactId}", {
        params: {
          path: { contactId },
        },
        body: updateData as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  delete_contact: {
    description: "Delete a sevDesk contact.",
    inputSchema: z.object({
      contactId: z.number().describe("The ID of the contact to delete"),
    }),
    handler: async (client: SevdeskClient, params: { contactId: number }) => {
      const { data, error } = await client.DELETE("/Contact/{contactId}", {
        params: {
          path: { contactId: params.contactId },
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data ?? { success: true };
    },
  },

  list_supplier_contacts: {
    description:
      "Read-only helper that lists supplier contacts (category 4 by default). Useful before assigning a voucher supplier.",
    inputSchema: z.object({
      name: z.string().optional().describe("Optional supplier name filter"),
      limit: z.number().optional().describe("Limit the number of results"),
      offset: z.number().optional().describe("Skip a number of results"),
      categoryId: z.number().optional().describe("Override supplier category if your sevDesk setup differs"),
    }),
    handler: async (
      client: SevdeskClient,
      params: { name?: string; limit?: number; offset?: number; categoryId?: number }
    ) => {
      const { data, error } = await client.GET("/Contact", {
        params: {
          query: {
            name: params.name,
            "category[id]": params.categoryId ?? 4,
            "category[objectName]": "Category",
            limit: params.limit,
            offset: params.offset,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  find_contact_by_exact_or_alias_name: {
    description:
      "Read-only helper for supplier/contact normalization. Returns exact matches first and keeps nearby candidates when names differ only slightly.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Name to search for"),
      limit: z.number().optional().describe("Maximum candidates to inspect"),
    }),
    handler: async (client: SevdeskClient, params: { name: string; limit?: number }) => {
      const { data, error } = await client.GET("/Contact", {
        params: {
          query: {
            name: params.name,
            limit: params.limit ?? 25,
          } as any,
        },
      });
      if (error) throw new Error(JSON.stringify(error));

      const needle = normalizeContactLookupName(params.name);
      const contacts = unwrapContactObjects(data);
      const exactMatches = contacts.filter((contact) => extractContactNames(contact).includes(needle));
      const nearbyCandidates = contacts.filter((contact) => !extractContactNames(contact).includes(needle));

      return {
        query: params.name,
        exactMatches,
        nearbyCandidates,
      };
    },
  },
};
