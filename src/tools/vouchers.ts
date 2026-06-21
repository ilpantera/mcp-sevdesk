import { z } from "zod";
import { inflateSync } from "node:zlib";
import type { SevdeskClient } from "../client.js";

type EInvoiceCheckResult = {
  isEinvoice: boolean;
  format?: "ZUGFeRD" | "XRechnung";
  data?: { xml: string };
  error?: string;
};

function extractXmlCandidates(text: string): string[] {
  const patterns = [
    /<\?xml[\s\S]*?<\/(?:\w+:)?CrossIndustryInvoice>/gi,
    /<\?xml[\s\S]*?<\/(?:\w+:)?Invoice>/gi,
    /<\?xml[\s\S]*?<\/(?:\w+:)?CreditNote>/gi,
    /<(?:\w+:)?CrossIndustryInvoice\b[\s\S]*?<\/(?:\w+:)?CrossIndustryInvoice>/gi,
    /<(?:\w+:)?Invoice\b[\s\S]*?<\/(?:\w+:)?Invoice>/gi,
    /<(?:\w+:)?CreditNote\b[\s\S]*?<\/(?:\w+:)?CreditNote>/gi,
  ];

  return Array.from(
    new Set(
      patterns.flatMap((pattern) => Array.from(text.matchAll(pattern), (match) => match[0].trim()))
    )
  );
}

function extractEmbeddedPdfXmlCandidates(bytes: Buffer): string[] {
  const pdfText = bytes.toString("latin1");
  const streamPattern = /<<[\s\S]*?\/Type\s*\/EmbeddedFile[\s\S]*?stream\r?\n([\s\S]*?)\r?\nendstream/gi;
  const xmlCandidates: string[] = [];

  for (const match of pdfText.matchAll(streamPattern)) {
    const objectText = match[0];
    const streamData = match[1];

    try {
      const streamBuffer = Buffer.from(streamData, "latin1");
      const decodedBuffer = /\/FlateDecode\b/.test(objectText) ? inflateSync(streamBuffer) : streamBuffer;
      xmlCandidates.push(...extractXmlCandidates(decodedBuffer.toString("utf8")));
    } catch {
      // Ignore malformed or non-XML embedded streams.
    }
  }

  return Array.from(new Set(xmlCandidates));
}

function detectEInvoiceFormat(xml: string, isPdf: boolean): "ZUGFeRD" | "XRechnung" | undefined {
  if (/(?:^|<)(?:\w+:)?CrossIndustryInvoice\b/i.test(xml)) {
    return isPdf ? "ZUGFeRD" : "XRechnung";
  }

  if (
    /(?:^|<)(?:\w+:)?(?:Invoice|CreditNote)\b/i.test(xml) ||
    /urn:oasis:names:specification:ubl:schema:xsd:(?:Invoice|CreditNote)-2/i.test(xml)
  ) {
    return "XRechnung";
  }

  return undefined;
}

function extractEInvoiceData(bytes: Buffer): EInvoiceCheckResult {
  const isPdf = bytes.subarray(0, 4).toString("ascii") === "%PDF";
  const utf8Text = bytes.toString("utf8");
  const candidateXml = Array.from(
    new Set([
      ...extractXmlCandidates(utf8Text),
      ...(isPdf ? extractXmlCandidates(bytes.toString("latin1")) : []),
      ...(isPdf ? extractEmbeddedPdfXmlCandidates(bytes) : []),
    ])
  );

  const xml = candidateXml.find((entry) => detectEInvoiceFormat(entry, isPdf)) ?? candidateXml[0];
  const format = xml ? detectEInvoiceFormat(xml, isPdf) : undefined;

  if (!xml || !format) {
    return {
      isEinvoice: false,
      error: "No ZUGFeRD/XRechnung XML found in voucher document",
    };
  }

  return {
    isEinvoice: true,
    format,
    data: { xml },
  };
}

function getVoucherDocumentId(voucherResponse: any): number | undefined {
  const voucher = Array.isArray(voucherResponse?.objects) ? voucherResponse.objects[0] : voucherResponse;
  const rawDocumentId = voucher?.document?.id;
  const documentId = Number(rawDocumentId);
  return Number.isFinite(documentId) ? documentId : undefined;
}

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
      taxType: z.enum(["default", "eu", "noteu", "custom", "ss"]).optional().describe("Deprecated v1 tax treatment type. API v2 may ignore this; prefer taxRule."),
      taxRule: z.object({
        id: z.number().describe(
          "TaxRule ID for expenses: " +
          "9=standard deductible (Deutschland), " +
          "8=innergemeinschaftlicher Erwerb (EU), " +
          "14=Reverse Charge EU §13b Abs.1, " +
          "12=Reverse Charge non-EU §13b Abs.2 MIT Vorsteuerabzug (z.B. USA, UK), " +
          "13=Reverse Charge non-EU OHNE Vorsteuerabzug, " +
          "10=nicht vorsteuerabziehbar"
        ),
        objectName: z.literal("TaxRule"),
      }).optional().describe("Tax rule (API v2). Replaces deprecated taxType."),
      deliveryDate: z.string().optional().describe(
        "Delivery/service date in ISO format YYYY-MM-DDTHH:mm:ss"
      ),
      paymentDeadline: z.string().optional().describe(
        "Payment deadline in ISO format YYYY-MM-DDTHH:mm:ss"
      ),
      supplierCountry: z.enum(["DE", "EU", "NON_EU"]).optional().describe(
        "Helper: supplier country origin. DE=Deutschland, EU=within EU, NON_EU=outside EU (e.g. USA). " +
        "When provided and taxRule is not set, auto-selects the correct taxRule: " +
        "DE→9, EU→14, NON_EU→12"
      ),
      taxRate: z.number().optional().describe("Overall tax rate in percent"),
      creditDebit: z.enum(["C", "D"]).optional().describe("C=Credit, D=Debit"),
      description: z.string().optional().describe("Description/memo"),
      supplierId: z.number().optional().describe("Contact ID of the supplier"),
      supplierName: z.string().optional().describe("Supplier name (used when supplierId is not set)"),
      voucherDate: z.string().optional().describe("Voucher date as Unix timestamp string"),
      payDate: z.string().optional().describe("Payment date as Unix timestamp string"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherId: number;
      status?: "50" | "100" | "1000";
      taxType?: "default" | "eu" | "noteu" | "custom" | "ss";
      taxRule?: { id: number; objectName: "TaxRule" };
      deliveryDate?: string;
      paymentDeadline?: string;
      supplierCountry?: "DE" | "EU" | "NON_EU";
      taxRate?: number;
      creditDebit?: "C" | "D";
      description?: string;
      supplierId?: number;
      supplierName?: string;
      voucherDate?: string;
      payDate?: string;
    }) => {
      let taxRule = params.taxRule;
      if (!taxRule && params.supplierCountry) {
        const countryMap: Record<string, number> = { DE: 9, EU: 14, NON_EU: 12 };
        taxRule = { id: countryMap[params.supplierCountry], objectName: "TaxRule" };
      }

      const body: Record<string, any> = {};
      if (params.status !== undefined) body.status = Number(params.status);
      if (params.taxType !== undefined) body.taxType = params.taxType;
      if (taxRule !== undefined) body.taxRule = { id: taxRule.id, objectName: "TaxRule" };
      if (params.deliveryDate !== undefined) body.deliveryDate = params.deliveryDate;
      if (params.paymentDeadline !== undefined) body.paymentDeadline = params.paymentDeadline;
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
        id: z.number().describe("Internal SevDesk accountDatev ID (not the SKR04 account number itself)"),
        objectName: z.string().describe("SevDesk object name for accountDatev"),
      }).optional().describe("DATEV account as SevDesk object"),
      taxRate: z.number().optional().describe("Tax rate for this position"),
      sum: z.number().optional().describe("Net sum for this position"),
      net: z.boolean().optional().describe(
        "If true, sum/sumNet is net amount and gross is calculated. Default: true on most positions."
      ),
      sumNet: z.number().optional().describe("Net amount. Use when net=true."),
      sumGross: z.number().optional().describe("Gross amount (net + VAT). Use to set gross directly."),
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
          ...(params.net !== undefined && { net: params.net }),
          ...(params.sumNet !== undefined && { sumNet: String(params.sumNet) }),
          ...(params.sumGross !== undefined && { sumGross: String(params.sumGross) }),
          ...(params.comment !== undefined && { comment: params.comment }),
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  delete_voucher_position: {
    description:
      "Deletes a single voucher position (line item) by ID. " +
      "Use this to remove surplus positions after consolidating multiple positions " +
      "into one per tax rate. Call update_voucher_position on the position to keep first, " +
      "then delete all remaining ones.",
    inputSchema: z.object({
      voucherPosId: z.number().describe("The ID of the voucher position to delete"),
    }),
    handler: async (client: SevdeskClient, params: { voucherPosId: number }) => {
      const { data, error } = await (client.DELETE as any)("/VoucherPos/{voucherPosId}", {
        params: { path: { voucherPosId: params.voucherPosId } },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data ?? { success: true };
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
      "Get DATEV account guidance for expense booking. Returns accountDatevId (internal SevDesk integer) " +
      "and accountNumber (SKR04, e.g. '6600') for use in update_voucher_position/create_voucher. " +
      "Use mode='forAllAccounts' to list all accounts, 'forExpense' for a specific receipt.",
    inputSchema: z.object({
      mode: z.enum(["forAllAccounts", "forExpense"]).describe(
        "forAllAccounts: all expense accounts with IDs, SKR numbers and allowed taxRules. " +
        "forExpense: guidance for a receipt (requires receiptAmount + receiptTaxAmount)."
      ),
      receiptAmount: z.number().optional().describe("Gross amount in EUR. Required for forExpense."),
      receiptTaxAmount: z.number().optional().describe("Tax amount in EUR. Required for forExpense."),
    }),
    handler: async (client: SevdeskClient, params: {
      mode: "forAllAccounts" | "forExpense";
      receiptAmount?: number;
      receiptTaxAmount?: number;
    }) => {
      if (params.mode === "forAllAccounts") {
        const { data, error } = await (client.GET as any)("/ReceiptGuidance/forAllAccounts", {});
        if (error) throw new Error(JSON.stringify(error));
        return data;
      }
      const { data, error } = await (client.GET as any)("/ReceiptGuidance/forExpense", {
        params: { query: { receiptAmount: params.receiptAmount, receiptTaxAmount: params.receiptTaxAmount } },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  create_voucher: {
    description:
      "Create a new expense voucher (receipt) with positions via POST /Voucher/Factory/saveVoucher.",
    inputSchema: z.object({
      voucherDate: z.string().describe("Voucher date ISO format YYYY-MM-DDTHH:mm:ss"),
      deliveryDate: z.string().optional(),
      paymentDeadline: z.string().optional(),
      description: z.string().optional().describe("Voucher number or description"),
      status: z.number().optional().describe("50=Draft, 100=Open"),
      taxRule: z.object({
        id: z.number().describe("9=DE standard, 14=EU Reverse Charge, 12=non-EU Reverse Charge mit Vorsteuerabzug, 13=without"),
        objectName: z.literal("TaxRule"),
      }).optional(),
      supplierCountry: z.enum(["DE", "EU", "NON_EU"]).optional().describe(
        "Auto-selects taxRule: DE→9, EU→14, NON_EU→12. Ignored if taxRule is set explicitly."
      ),
      supplierId: z.number().optional().describe("SevDesk contact ID of supplier"),
      supplierName: z.string().optional().describe("Supplier name if ID unknown"),
      voucherPositions: z.array(z.object({
        accountDatev: z.object({
          id: z.number().describe("Internal SevDesk accountDatev ID (from get_receipt_guidance, not the SKR04 number)"),
          objectName: z.literal("AccountDatev"),
        }),
        taxRate: z.number().describe("VAT rate: 19, 7, or 0"),
        net: z.boolean().describe("true=sum is net; false=sumGross is base"),
        sum: z.number().describe("Net amount if net=true"),
        sumNet: z.number().optional(),
        sumGross: z.number().optional(),
        comment: z.string().optional(),
      })).describe("Line items"),
    }),
    handler: async (client: SevdeskClient, params: any) => {
      let taxRule = params.taxRule;
      if (!taxRule && params.supplierCountry) {
        const map: Record<string, number> = { DE: 9, EU: 14, NON_EU: 12 };
        taxRule = { id: map[params.supplierCountry], objectName: "TaxRule" };
      }

      const voucher: Record<string, unknown> = {
        objectName: "Voucher",
        mapAll: true,
        voucherDate: params.voucherDate,
        status: params.status ?? 50,
        creditDebit: "D",
        voucherType: "VOU",
        ...(params.deliveryDate && { deliveryDate: params.deliveryDate }),
        ...(params.paymentDeadline && { paymentDeadline: params.paymentDeadline }),
        ...(params.description && { description: params.description }),
        ...(taxRule && { taxRule }),
        ...(params.supplierId && { supplier: { id: params.supplierId, objectName: "Contact" } }),
        ...(params.supplierName && !params.supplierId && { supplierName: params.supplierName }),
      };

      const voucherPosSave = params.voucherPositions.map((pos: any, i: number) => ({
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

  create_voucher_position: {
    description:
      "Add a new position to an existing voucher via POST /VoucherPos. " +
      "Use this to add extra line items, e.g. Trinkgeld (tip at 0% VAT) to an existing receipt voucher.",
    inputSchema: z.object({
      voucherId: z.number().describe("ID of the existing voucher"),
      accountDatev: z.object({
        id: z.number().describe("Internal SevDesk accountDatev ID (from get_receipt_guidance, not the SKR04 number)"),
        objectName: z.literal("AccountDatev"),
      }),
      taxRate: z.number().describe("VAT rate: 19, 7, or 0"),
      net: z.boolean().describe("true=sum is net amount"),
      sum: z.number().describe("Net amount if net=true, else gross"),
      sumNet: z.number().optional(),
      sumGross: z.number().optional(),
      comment: z.string().optional().describe("e.g. 'Trinkgeld'"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherId: number;
      accountDatev: { id: number; objectName: "AccountDatev" };
      taxRate: number;
      net: boolean;
      sum: number;
      sumNet?: number;
      sumGross?: number;
      comment?: string;
    }) => {
      const { data, error } = await (client.POST as any)("/VoucherPos", {
        body: {
          objectName: "VoucherPos",
          mapAll: true,
          voucher: { id: params.voucherId, objectName: "Voucher" },
          accountDatev: { id: params.accountDatev.id, objectName: "AccountDatev" },
          taxRate: params.taxRate,
          net: params.net,
          sum: String(params.sum),
          ...(params.sumNet !== undefined && { sumNet: String(params.sumNet) }),
          ...(params.sumGross !== undefined && { sumGross: String(params.sumGross) }),
          ...(params.comment && { comment: params.comment }),
        } as any,
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  get_voucher_document_image: {
    description: "Get the receipt/document image attached to a voucher as base64-encoded data.",
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

  check_and_extract_einvoice: {
    description:
      "Checks whether a voucher document is a ZUGFeRD/XRechnung e-invoice and extracts its XML data internally.",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      const { data: voucherData, error: voucherError } = await client.GET("/Voucher/{voucherId}", {
        params: {
          path: { voucherId: params.voucherId },
        },
      });
      if (voucherError) throw new Error(JSON.stringify(voucherError));

      const documentId = getVoucherDocumentId(voucherData);
      if (!documentId) {
        return {
          isEinvoice: false,
          error: "Voucher has no document attached",
        };
      }

      const { data: documentData, error: documentError } = await (client.GET as any)("/Document/{documentId}", {
        params: {
          path: { documentId },
        },
        parseAs: "arrayBuffer",
      });
      if (documentError) throw new Error(JSON.stringify(documentError));

      return extractEInvoiceData(Buffer.from(documentData));
    },
  },
};
