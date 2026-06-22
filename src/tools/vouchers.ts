import { z } from "zod";
import { inflateRawSync, inflateSync } from "node:zlib";
import { constants as fsConstants, createReadStream } from "node:fs";
import { access, open, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import NodeFormData from "form-data";
import type { SevdeskClient } from "../client.js";

type EInvoiceCheckResult = {
  isEinvoice: boolean;
  format?: "ZUGFeRD" | "XRechnung";
  data?: { xml: string };
  error?: string;
};

type VoucherResponseData = {
  objects?: Array<{
    document?: {
      id?: number | string | null;
    } | null;
  }>;
  document?: {
    id?: number | string | null;
  } | null;
};

type UntypedClientMethodInit = {
  params?: {
    path?: Record<string, unknown>;
    query?: Record<string, unknown>;
  };
  body?: unknown;
  parseAs?: "json" | "text" | "blob" | "arrayBuffer" | "stream";
};

type UntypedClientMethodResult = Promise<{ data?: unknown; error?: unknown }>;

export type VoucherBookingPlanIssueCode =
  | "VOUCHER_ID_INVALID"
  | "POSITIONS_REQUIRED"
  | "ACCOUNT_DATEV_ID_REQUIRED"
  | "TAX_RATE_REQUIRED"
  | "TAX_RATE_INVALID"
  | "SUM_NET_REQUIRED"
  | "SUM_NET_NEGATIVE"
  | "SUM_GROSS_NEGATIVE"
  | "SUM_GROSS_MISMATCH"
  | "COMMENT_REQUIRED"
  | "ASSET_USEFUL_LIFE_REQUIRED"
  | "ASSET_USEFUL_LIFE_INVALID"
  | "ZERO_TAX_REVIEW_REQUIRED"
  | "SPECIAL_ACCOUNTING_FIELD3_EMPTY"
  | "CATERING_TIP_INVALID"
  | "CATERING_TIP_NEGATIVE"
  | "CATERING_TIP_TAX_REVIEW"
  | "CATERING_TIP_EXCEEDS_GROSS"
  | "EXPECTED_TOTAL_GROSS_MISMATCH"
  | "REUSED_POSITION_NOT_FOUND"
  | "REUSED_POSITION_DUPLICATE"
  | "SURPLUS_POSITIONS_PRESENT"
  | "RECEIPT_GUIDANCE_UNAVAILABLE"
  | "RECEIPT_GUIDANCE_ACCOUNT_NOT_ALLOWED"
  | "RECEIPT_GUIDANCE_TAX_RULE_NOT_ALLOWED"
  | "RECEIPT_GUIDANCE_TAX_RATE_NOT_ALLOWED"
  | "RECEIPT_GUIDANCE_TAX_RULE_AMBIGUOUS"
  | "RECEIPT_GUIDANCE_UNKNOWN_TAX_RATE"
  | "VOUCHER_CONTEXT_READ_FAILED"
  | "WRITE_PHASE_FAILED"
  | "EINVOICE_READ_FAILED"
  | "IMAGE_READ_FAILED"
  | "DOCUMENT_INFO_READ_FAILED"
  | "STATUS_CHANGE_NOT_SUPPORTED"
  | "DOCUMENT_DOWNLOAD_FAILED"
  // PDF-first voucher retrieval specific codes
  | "VOUCHER_NO_DOCUMENT"
  | "ZIP_NO_CONTENT"
  | "ZIP_NO_MATCH"
  | "ZIP_AMBIGUOUS_MATCH"
  | "ZIP_MATCH_NOT_PDF"
  | "FALLBACK_NOT_PDF"
  | "FALLBACK_FAILED"
  // PDF upload-to-voucher specific codes
  | "PDF_PAYLOAD_MISSING"
  | "PDF_BASE64_INVALID"
  | "PDF_NOT_VALID"
  | "FILE_PATH_REQUIRED"
  | "FILE_PATH_NOT_ABSOLUTE"
  | "FILE_NOT_FOUND"
  | "FILE_NOT_READABLE"
  | "FILE_EMPTY"
  | "FILE_NOT_PDF"
  | "UPLOAD_FAILED"
  | "UPLOAD_RESPONSE_INVALID"
  | "PDF_UPLOAD_FAILED"
  | "PDF_ATTACH_FAILED"
  | "PDF_ATTACH_VERIFY_FAILED"
  | "VOUCHER_CREATE_FAILED"
  | "VOUCHER_VERIFY_FAILED";

export type VoucherBookingPlanIssue = {
  code: VoucherBookingPlanIssueCode;
  message: string;
  path?: string;
};

/**
 * Typed error thrown by PDF retrieval internals so that specific failure codes
 * can be surfaced to callers instead of a generic DOCUMENT_DOWNLOAD_FAILED.
 * `zipCause` carries the voucherZip-phase error when a fallback failure occurs,
 * allowing handlers to surface both the voucherZip and fallback codes.
 */
class VoucherPdfRetrievalError extends Error {
  constructor(
    public readonly code: VoucherBookingPlanIssueCode,
    message: string,
    public readonly zipCause?: VoucherPdfRetrievalError
  ) {
    super(message);
    this.name = "VoucherPdfRetrievalError";
  }
}

class VoucherUploadError extends Error {
  constructor(
    public readonly code: VoucherBookingPlanIssueCode,
    message: string
  ) {
    super(message);
    this.name = "VoucherUploadError";
  }
}

export type VoucherPositionSummary = {
  voucherPosIdToReuse?: number;
  accountDatevId: number;
  taxRate: number;
  sumNet: number;
  sumGross: number;
  comment: string;
};

export type VoucherBookingPlanPosition = {
  voucherPosIdToReuse?: number;
  accountDatevId: number;
  accountDatevObjectName?: "AccountDatev";
  taxRate: number;
  sumNet: number;
  sumGross?: number;
  comment: string;
  isAsset?: boolean;
  assetUsefulLife?: number;
  specialAccountingField3?: string;
  cateringTip?: number;
};

export type VoucherBookingPlan = {
  voucherId: number;
  supplierName?: string;
  taxRuleId?: number;
  voucherDate?: string;
  description?: string;
  expectedTotalGross?: number;
  positions: VoucherBookingPlanPosition[];
};

export type VoucherBookingPlanValidationResult = {
  valid: boolean;
  errors: VoucherBookingPlanIssue[];
  warnings: VoucherBookingPlanIssue[];
  normalizedPlan: VoucherBookingPlan;
  computedTotals: {
    totalGross: number;
    totalNet: number;
  };
};

type ReceiptGuidanceRule = {
  id?: number;
  name?: string;
  description?: string;
  taxRates?: string[];
};

type ReceiptGuidanceEntry = {
  accountDatevId?: number;
  accountNumber?: string;
  accountName?: string;
  description?: string;
  allowedTaxRules?: ReceiptGuidanceRule[];
  allowedReceiptTypes?: string[];
};

type VoucherReadResult<T> = {
  ok: boolean;
  data?: T;
  error?: VoucherBookingPlanIssue;
};

type VoucherDocumentInfo = {
  documentId: number;
  fileName: string | null;
  mimeType: string | null;
  hasPdf: boolean;
  hasImagePreview: boolean;
};

type VoucherZipEntry = {
  fileName: string;
  bytes: Buffer;
};

type VoucherOriginalPdfResult = {
  voucherId: number;
  documentId: number;
  source: "voucherZip" | "document-download-fallback";
  fileName: string | null;
  mimeType: "application/pdf";
  contentBase64: string;
  sizeBytes: number;
  warnings: string[];
};

type CreateVoucherFromPdfResult = {
  ok: boolean;
  voucherId: number | null;
  documentId: number | null;
  fileName: string;
  warnings: string[];
  errors: VoucherBookingPlanIssue[];
};

type CreateDraftVoucherResult = {
  ok: boolean;
  voucherId: number | null;
  warnings: string[];
  errors: VoucherBookingPlanIssue[];
};

type AttachPdfToVoucherResult = {
  ok: boolean;
  voucherId: number;
  documentId: number | null;
  fileName: string;
  warnings: string[];
  errors: VoucherBookingPlanIssue[];
};

type UploadVoucherFileResult = {
  ok: boolean;
  filePath: string;
  filename: string | null;
  pages: number | null;
  originMimeType: string | null;
  contentHash: string | null;
  warnings: string[];
  errors: VoucherBookingPlanIssue[];
};

type VoucherBatchResult<T> = {
  voucherId: number;
  ok: boolean;
  data?: T;
  errors: VoucherBookingPlanIssue[];
  warnings: VoucherBookingPlanIssue[];
};

type VoucherBookingContextResult = {
  voucherId: number;
  voucher: unknown;
  positions: unknown;
  einvoice: VoucherReadResult<EInvoiceCheckResult>;
  image: VoucherReadResult<unknown> | null;
  warnings: VoucherBookingPlanIssue[];
};

type ReceiptGuidanceValidationResult = {
  checked: boolean;
  mode: "forExpense";
  errors: VoucherBookingPlanIssue[];
  warnings: VoucherBookingPlanIssue[];
  matches: Array<{
    accountDatevId: number;
    accountNumber?: string;
    accountName?: string;
    matchedTaxRuleIds: number[];
  }>;
};

export type ApplyVoucherBookingPlanResult = {
  ok: boolean;
  dryRun: boolean;
  validation: VoucherBookingPlanValidationResult;
  receiptGuidance: ReceiptGuidanceValidationResult;
  appliedChanges: {
    dryRun: boolean;
    headerUpdated: boolean;
    headerFieldsChanged: string[];
    reusedPositionIds: number[];
    createdPositionIndexes: number[];
    deletedPositionIds: number[];
  };
  writePhase: {
    started: boolean;
    completedSteps: string[];
    // Step identifier where a write failed (for example "updateVoucherPos:77").
    failedAt?: string;
    // Human-readable error message from the failed write step.
    failedMessage?: string;
  };
  finalVoucher: unknown;
  finalPositions: unknown;
  warnings: VoucherBookingPlanIssue[];
  errors: VoucherBookingPlanIssue[];
};

const ZERO_TAX_SPECIAL_CASE_COMMENT_PATTERN = /(trinkgeld|tip|steuerfrei|tax free|ohne\s*ust|reverse|porto|geb[üu]hr)/i;
// ReceiptGuidance tax rates are emitted as symbolic values in the current sevDesk Update 2.0 API.
// The mapping below mirrors the documented German VAT presets exposed by ReceiptGuidance.
const RECEIPT_GUIDANCE_TAX_RATE_MAP: Record<string, number> = {
  ZERO: 0,
  SEVEN: 7,
  NINETEEN: 19,
};
function callUntypedClientMethod(
  client: SevdeskClient,
  method: "GET" | "DELETE" | "PUT" | "POST",
  path: string,
  init: UntypedClientMethodInit
): UntypedClientMethodResult {
  const clientMethod = client[method] as unknown as (
    path: string,
    init: UntypedClientMethodInit
  ) => UntypedClientMethodResult;
  return clientMethod(path, init);
}

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
    const streamBuffer = Buffer.from(streamData, "latin1");

    try {
      const decodedBuffer = /\/FlateDecode\b/.test(objectText) ? inflateSync(streamBuffer) : streamBuffer;
      xmlCandidates.push(...extractXmlCandidates(decodedBuffer.toString("utf8")));
    } catch {
      xmlCandidates.push(...extractXmlCandidates(streamBuffer.toString("utf8")));
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

  const xml = candidateXml.find((entry) => detectEInvoiceFormat(entry, isPdf));
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

function getVoucherDocumentId(voucherResponseData: VoucherResponseData | undefined): number | undefined {
  const voucher = Array.isArray(voucherResponseData?.objects) ? voucherResponseData.objects[0] : voucherResponseData;
  const rawDocumentId = voucher?.document?.id;
  const documentId = Number(rawDocumentId);
  return Number.isFinite(documentId) ? documentId : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getVoucherIdFromError(error: unknown): number | undefined {
  return getNumberValue(asRecord(error)?.voucherId);
}

function getWorkflowPhaseFromError(error: unknown): string | undefined {
  return getStringValue(asRecord(error)?.phase);
}

function createIssue(
  code: VoucherBookingPlanIssueCode,
  message: string,
  path?: string
): VoucherBookingPlanIssue {
  return path ? { code, message, path } : { code, message };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function unwrapFirstObject(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  const objects = record?.objects;
  if (Array.isArray(objects)) {
    return asRecord(objects[0]);
  }
  return record;
}

function unwrapObjectArray(value: unknown): Record<string, unknown>[] {
  const record = asRecord(value);
  const objects = record?.objects;
  if (!Array.isArray(objects)) {
    return [];
  }
  return objects
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined);
}

function getNumberValue(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (trimmedValue.length === 0) {
      return undefined;
    }

    const numericValue = Number(trimmedValue);
    return Number.isFinite(numericValue) ? numericValue : undefined;
  }

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getVoucherPositionId(position: unknown): number | undefined {
  return getNumberValue(asRecord(position)?.id);
}

function getVoucherDateComparable(value: unknown): string | undefined {
  const stringValue = getStringValue(value);
  if (!stringValue) return undefined;
  return stringValue.includes("T") ? stringValue.slice(0, 10) : stringValue;
}

function buildVoucherPositionBody(position: VoucherBookingPlanPosition): Record<string, unknown> {
  const sumNet = roundCurrency(position.sumNet);
  const sumGross = roundCurrency(position.sumGross ?? calculateGross(sumNet, position.taxRate));

  return {
    accountDatev: {
      id: position.accountDatevId,
      objectName: position.accountDatevObjectName ?? "AccountDatev",
    },
    taxRate: position.taxRate,
    net: true,
    sum: String(sumNet),
    sumNet: String(sumNet),
    sumGross: String(sumGross),
    comment: position.comment,
    ...(position.isAsset !== undefined && { isAsset: position.isAsset }),
    ...(position.assetUsefulLife !== undefined && { assetUsefulLife: position.assetUsefulLife }),
    ...(position.specialAccountingField3 !== undefined && {
      specialAccountingField3: position.specialAccountingField3,
    }),
    ...(position.cateringTip !== undefined && { cateringTip: String(roundCurrency(position.cateringTip)) }),
  };
}

async function getReceiptGuidanceForExpense(
  client: SevdeskClient,
  receiptAmount: number,
  receiptTaxAmount: number
): Promise<ReceiptGuidanceEntry[]> {
  const { data, error } = await (client.GET as unknown as (
    path: string,
    init: UntypedClientMethodInit
  ) => UntypedClientMethodResult)("/ReceiptGuidance/forExpense", {
    params: {
      query: {
        receiptAmount,
        receiptTaxAmount,
      },
    },
  });
  if (error) {
    throw new Error(JSON.stringify(error));
  }

  return unwrapObjectArray(data) as ReceiptGuidanceEntry[];
}

function findMatchingTaxRules(
  allowedRules: ReceiptGuidanceRule[],
  taxRuleId: number | undefined,
  taxRate: number
): ReceiptGuidanceRule[] {
  if (taxRuleId !== undefined) {
    return allowedRules.filter((rule) => rule.id === taxRuleId);
  }

  return allowedRules.filter((rule) =>
    Array.isArray(rule.taxRates) &&
    rule.taxRates.some((taxRateName) => RECEIPT_GUIDANCE_TAX_RATE_MAP[taxRateName] === taxRate)
  );
}

async function validateReceiptGuidanceForPlan(
  client: SevdeskClient,
  validation: VoucherBookingPlanValidationResult
): Promise<ReceiptGuidanceValidationResult> {
  const receiptAmount = validation.normalizedPlan.expectedTotalGross ?? validation.computedTotals.totalGross;
  const receiptTaxAmount = roundCurrency(validation.computedTotals.totalGross - validation.computedTotals.totalNet);

  try {
    const guidance = await getReceiptGuidanceForExpense(client, receiptAmount, receiptTaxAmount);
    const errors: VoucherBookingPlanIssue[] = [];
    const warnings: VoucherBookingPlanIssue[] = [];
    const matches: ReceiptGuidanceValidationResult["matches"] = [];
    const unknownTaxRateWarnings = new Set<string>();

    for (const [index, position] of validation.normalizedPlan.positions.entries()) {
      const accountEntry = guidance.find((entry) => entry.accountDatevId === position.accountDatevId);
      const path = `positions[${index}]`;

      if (!accountEntry) {
        errors.push(
          createIssue(
            "RECEIPT_GUIDANCE_ACCOUNT_NOT_ALLOWED",
            `Account ${position.accountDatevId} is not offered by ReceiptGuidance for this receipt amount`,
            `${path}.accountDatevId`
          )
        );
        continue;
      }

      const allowedRules = Array.isArray(accountEntry.allowedTaxRules) ? accountEntry.allowedTaxRules : [];
      for (const rule of allowedRules) {
        for (const taxRateName of Array.isArray(rule.taxRates) ? rule.taxRates : []) {
          if (RECEIPT_GUIDANCE_TAX_RATE_MAP[taxRateName] === undefined) {
            const warningKey = `${position.accountDatevId}:${taxRateName}`;
            if (!unknownTaxRateWarnings.has(warningKey)) {
              unknownTaxRateWarnings.add(warningKey);
              warnings.push(
                createIssue(
                  "RECEIPT_GUIDANCE_UNKNOWN_TAX_RATE",
                  `ReceiptGuidance returned unknown tax rate symbol "${taxRateName}" for account ${position.accountDatevId}`,
                  `${path}.taxRate`
                )
              );
            }
          }
        }
      }
      const taxRuleMatches = findMatchingTaxRules(
        allowedRules,
        validation.normalizedPlan.taxRuleId,
        position.taxRate
      );

      if (validation.normalizedPlan.taxRuleId !== undefined && taxRuleMatches.length === 0) {
        errors.push(
          createIssue(
            "RECEIPT_GUIDANCE_TAX_RULE_NOT_ALLOWED",
            `Tax rule ${validation.normalizedPlan.taxRuleId} is not allowed for account ${position.accountDatevId}`,
            `${path}.taxRate`
          )
        );
        continue;
      }

      if (taxRuleMatches.length === 0) {
        errors.push(
          createIssue(
            "RECEIPT_GUIDANCE_TAX_RATE_NOT_ALLOWED",
            `Tax rate ${position.taxRate}% is not allowed for account ${position.accountDatevId} in ReceiptGuidance`,
            `${path}.taxRate`
          )
        );
        continue;
      }

      if (validation.normalizedPlan.taxRuleId === undefined && taxRuleMatches.length > 1) {
        warnings.push(
          createIssue(
            "RECEIPT_GUIDANCE_TAX_RULE_AMBIGUOUS",
            `ReceiptGuidance allows multiple tax rules for account ${position.accountDatevId} at tax rate ${position.taxRate}%. Provide taxRuleId to remove ambiguity.`,
            `${path}.taxRate`
          )
        );
      }

      const matchingRuleIds = taxRuleMatches
        .map((rule) => rule.id)
        .filter((ruleId): ruleId is number => ruleId !== undefined);
      const taxRateAllowed = taxRuleMatches.some((rule) =>
        Array.isArray(rule.taxRates)
          ? rule.taxRates.some((taxRateName) => RECEIPT_GUIDANCE_TAX_RATE_MAP[taxRateName] === position.taxRate)
          : true
      );

      if (!taxRateAllowed) {
        errors.push(
          createIssue(
            "RECEIPT_GUIDANCE_TAX_RATE_NOT_ALLOWED",
            `Tax rate ${position.taxRate}% is not allowed for account ${position.accountDatevId} with the selected tax rule`,
            `${path}.taxRate`
          )
        );
      }

      matches.push({
        accountDatevId: position.accountDatevId,
        accountNumber: accountEntry.accountNumber,
        accountName: accountEntry.accountName,
        matchedTaxRuleIds: matchingRuleIds,
      });
    }

    if (guidance.length === 0) {
      warnings.push(
        createIssue(
          "RECEIPT_GUIDANCE_UNAVAILABLE",
          "ReceiptGuidance returned no selectable accounts for this receipt amount"
        )
      );
    }

    return {
      checked: true,
      mode: "forExpense",
      errors,
      warnings,
      matches,
    };
  } catch (error) {
    return {
      checked: false,
      mode: "forExpense",
      errors: [],
      warnings: [
        createIssue(
          "RECEIPT_GUIDANCE_UNAVAILABLE",
          `ReceiptGuidance could not be checked: ${getErrorMessage(error)}`
        ),
      ],
      matches: [],
    };
  }
}

async function getVoucherByIdInternal(client: SevdeskClient, voucherId: number): Promise<unknown> {
  const { data, error } = await client.GET("/Voucher/{voucherId}", {
    params: {
      path: { voucherId },
    },
  });
  if (error) throw new Error(JSON.stringify(error));
  return data;
}

async function getVoucherPositionsInternal(client: SevdeskClient, voucherId: number): Promise<unknown> {
  const { data, error } = await client.GET("/VoucherPos", {
    params: {
      query: {
        "voucher[id]": voucherId,
        "voucher[objectName]": "Voucher",
      } as any,
    },
  });
  if (error) throw new Error(JSON.stringify(error));
  return data;
}

async function getVoucherDocumentImageInternal(client: SevdeskClient, voucherId: number): Promise<unknown> {
  const { data, error } = await (client.GET as any)(
    "/Voucher/{voucherId}/getDocumentImage",
    { params: { path: { voucherId } } }
  );
  if (error) throw new Error(JSON.stringify(error));
  return data;
}

async function checkAndExtractEInvoiceInternal(client: SevdeskClient, voucherId: number): Promise<EInvoiceCheckResult> {
  const voucherData = await getVoucherByIdInternal(client, voucherId);
  const documentId = getVoucherDocumentId(voucherData as VoucherResponseData | undefined);
  if (!documentId) {
    return {
      isEinvoice: false,
      error: "Voucher has no document attached",
    };
  }

  const { data: documentData, error: documentError } = await callUntypedClientMethod(
    client,
    "GET",
    "/Document/{documentId}",
    {
      params: {
        path: { documentId },
      },
      parseAs: "arrayBuffer",
    }
  );
  if (documentError) throw new Error(JSON.stringify(documentError));
  if (!(documentData instanceof ArrayBuffer)) {
    throw new Error("Document download did not return raw bytes");
  }

  return extractEInvoiceData(Buffer.from(documentData));
}

async function getVoucherDocumentInfoInternal(
  client: SevdeskClient,
  voucherId: number
): Promise<VoucherDocumentInfo | null> {
  const voucherData = await getVoucherByIdInternal(client, voucherId);
  const documentId = getVoucherDocumentId(voucherData as VoucherResponseData | undefined);
  if (!documentId) {
    return null;
  }

  try {
    const imageData = await getVoucherDocumentImageInternal(client, voucherId);
    const responseRecord = asRecord(imageData);
    const objects = asRecord(responseRecord?.objects);

    const fileName = getStringValue(objects?.filename) ?? null;
    const originMimeType = getStringValue(objects?.originMimeType) ?? null;
    const previewMimeType = getStringValue(objects?.mimeType);

    const hasPdf =
      originMimeType === "application/pdf" ||
      (fileName !== null && fileName.toLowerCase().endsWith(".pdf"));
    const hasImagePreview =
      typeof previewMimeType === "string" && previewMimeType.startsWith("image/");

    return {
      documentId,
      fileName,
      mimeType: originMimeType,
      hasPdf,
      hasImagePreview,
    };
  } catch {
    return {
      documentId,
      fileName: null,
      mimeType: null,
      hasPdf: false,
      hasImagePreview: false,
    };
  }
}

/**
 * Builds the structured errors array from a thrown PDF retrieval error.
 * When a fallback error carries a `zipCause`, both the voucherZip failure code
 * and the fallback failure code are included so callers can distinguish them.
 */
function buildPdfRetrievalErrors(error: unknown): VoucherBookingPlanIssue[] {
  if (!(error instanceof VoucherPdfRetrievalError)) {
    return [createIssue("DOCUMENT_DOWNLOAD_FAILED", getErrorMessage(error))];
  }
  const errors: VoucherBookingPlanIssue[] = [];
  if (error.zipCause) {
    errors.push(createIssue(error.zipCause.code, error.zipCause.message));
  }
  errors.push(createIssue(error.code, error.message));
  return errors;
}

/** Returns the common "Export/voucherZip primary retrieval failed: ..." prefix for fallback error messages. */
function zipPrimaryFailedPrefix(voucherZipError: unknown): string {
  return `Export/voucherZip primary retrieval failed: ${getErrorMessage(voucherZipError)}`;
}

export function decodeAndUnpackVoucherZipPayload(exportData: unknown): { entries: VoucherZipEntry[]; warnings: string[] } {
  const responseRecord = asRecord(exportData);
  const objectsRecord = asRecord(responseRecord?.objects);
  const content = getStringValue(objectsRecord?.content);
  const warnings: string[] = [];

  if (!content || content.trim().length === 0) {
    throw new VoucherPdfRetrievalError("ZIP_NO_CONTENT", "Export/voucherZip did not return a base64 content payload");
  }

  const base64Content = content.trim();
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64Content)) {
    throw new VoucherPdfRetrievalError("ZIP_NO_CONTENT", "Export/voucherZip content is not valid base64");
  }

  let zipBytes: Buffer;
  zipBytes = Buffer.from(base64Content, "base64");
  if (zipBytes.length === 0) {
    throw new VoucherPdfRetrievalError("ZIP_NO_CONTENT", "Export/voucherZip content decoded to empty buffer");
  }

  const entries: VoucherZipEntry[] = [];
  const findNextZipEntryOrFooterOffset = (startOffset: number): number | null => {
    for (let cursor = startOffset; cursor + 4 <= zipBytes.length; cursor++) {
      const marker = zipBytes.readUInt32LE(cursor);
      if (marker === 0x04034b50 || marker === 0x02014b50 || marker === 0x06054b50) {
        return cursor;
      }
    }
    return null;
  };
  let offset = 0;
  while (offset + 4 <= zipBytes.length) {
    const signature = zipBytes.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) {
      break;
    }
    if (signature !== 0x04034b50) {
      warnings.push(
        `Unexpected ZIP signature 0x${signature.toString(16)} at offset ${offset}; payload may be truncated or malformed.`
      );
      break;
    }
    if (offset + 30 > zipBytes.length) {
      warnings.push("Truncated ZIP local file header encountered.");
      break;
    }

    const generalPurposeFlag = zipBytes.readUInt16LE(offset + 6);
    const compressionMethod = zipBytes.readUInt16LE(offset + 8);
    const compressedSize = zipBytes.readUInt32LE(offset + 18);
    const fileNameLength = zipBytes.readUInt16LE(offset + 26);
    const extraLength = zipBytes.readUInt16LE(offset + 28);

    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBytes.length) {
      warnings.push("Truncated ZIP entry payload encountered.");
      break;
    }

    if ((generalPurposeFlag & 0x08) !== 0) {
      warnings.push("ZIP entry uses data descriptor; entry skipped because deterministic parsing is not possible.");
      const nextOffset = findNextZipEntryOrFooterOffset(dataStart);
      if (nextOffset === null) {
        break;
      }
      offset = nextOffset;
      continue;
    }

    const fileName = zipBytes.toString("utf8", fileNameStart, fileNameEnd);
    const compressedData = zipBytes.subarray(dataStart, dataEnd);
    let entryBytes: Buffer | null = null;

    if (compressionMethod === 0) {
      entryBytes = Buffer.from(compressedData);
    } else if (compressionMethod === 8) {
      try {
        entryBytes = inflateRawSync(compressedData);
      } catch (error) {
        warnings.push(
          `Failed to inflate ZIP entry "${fileName}": ${getErrorMessage(error)}`
        );
      }
    } else {
      warnings.push(`Unsupported ZIP compression method (${compressionMethod}) for entry "${fileName}".`);
    }

    if (entryBytes && fileName.length > 0 && !fileName.endsWith("/")) {
      entries.push({ fileName, bytes: entryBytes });
    }

    offset = dataEnd;
  }

  if (entries.length === 0) {
    throw new VoucherPdfRetrievalError("ZIP_NO_CONTENT", "No usable files found in Export/voucherZip payload");
  }

  return { entries, warnings };
}

export function pickVoucherZipEntryForDocument(
  entries: VoucherZipEntry[],
  documentId: number,
  documentFileName: string | null
): { entry: VoucherZipEntry | null; warnings: string[] } {
  const warnings: string[] = [];
  const fileName = documentFileName?.trim() ?? "";
  const lowerFileName = fileName.toLowerCase();
  const documentIdText = String(documentId).toLowerCase();

  if (lowerFileName.length > 0) {
    const exactPathMatches = entries.filter((entry) => entry.fileName.toLowerCase() === lowerFileName);
    if (exactPathMatches.length === 1) {
      return { entry: exactPathMatches[0], warnings };
    }
    if (exactPathMatches.length > 1) {
      return {
        entry: null,
        warnings: [`Multiple ZIP entries matched exact filename "${fileName}".`],
      };
    }

    const basenameMatches = entries.filter((entry) => {
      const baseName = entry.fileName.split("/").pop()?.toLowerCase();
      return baseName === lowerFileName;
    });
    if (basenameMatches.length === 1) {
      return { entry: basenameMatches[0], warnings };
    }
    if (basenameMatches.length > 1) {
      return {
        entry: null,
        warnings: [`Multiple ZIP entries matched basename "${fileName}".`],
      };
    }
  }

  const idTokenMatches = entries.filter((entry) => {
    const baseName = entry.fileName.split("/").pop()?.toLowerCase() ?? "";
    const matchIndex = baseName.indexOf(documentIdText);
    if (matchIndex < 0) return false;
    const before = matchIndex === 0 ? "" : baseName[matchIndex - 1];
    const afterIndex = matchIndex + documentIdText.length;
    const after = afterIndex >= baseName.length ? "" : baseName[afterIndex];
    const beforeIsDigit = before >= "0" && before <= "9";
    const afterIsDigit = after >= "0" && after <= "9";
    return !beforeIsDigit && !afterIsDigit;
  });
  if (idTokenMatches.length === 1) {
    warnings.push("Matched ZIP entry by documentId token because exact filename was unavailable.");
    return { entry: idTokenMatches[0], warnings };
  }
  if (idTokenMatches.length > 1) {
    warnings.push(`Multiple ZIP entries matched documentId token "${documentId}".`);
  } else if (fileName.length > 0) {
    warnings.push(`No ZIP entry matched voucher document filename "${fileName}".`);
  } else {
    warnings.push("Voucher document filename is unavailable; ZIP entry cannot be matched deterministically.");
  }

  return { entry: null, warnings };
}

async function downloadDocumentBytesViaVoucherZipInternal(
  client: SevdeskClient,
  voucherId: number,
  documentId: number
): Promise<{ bytes: Buffer; fileName: string; warnings: string[] }> {
  const documentInfo = await getVoucherDocumentInfoInternal(client, voucherId);
  const filterCandidates: Record<string, unknown>[] = [{ id: voucherId }, { id: { "$eq": voucherId } }];
  const attemptErrors: string[] = [];
  let lastTypedError: VoucherPdfRetrievalError | null = null;

  for (const filterCandidate of filterCandidates) {
    try {
      const { data: exportData, error: exportError } = await callUntypedClientMethod(client, "GET", "/Export/voucherZip", {
        params: {
          query: {
            download: false,
            sevQuery: {
              modelName: "Voucher",
              objectName: "SevQuery",
              limit: 1,
              filter: filterCandidate,
            },
          },
        },
      });
      if (exportError) {
        attemptErrors.push(
          `Export/voucherZip request failed for filter ${JSON.stringify(filterCandidate)}: ${JSON.stringify(exportError)}`
        );
        continue;
      }

      // May throw VoucherPdfRetrievalError("ZIP_NO_CONTENT", ...) when content is absent.
      const { entries, warnings } = decodeAndUnpackVoucherZipPayload(exportData);
      const picked = pickVoucherZipEntryForDocument(entries, documentId, documentInfo?.fileName ?? null);
      const combinedWarnings = [...warnings, ...picked.warnings];
      if (!picked.entry) {
        const isAmbiguous = picked.warnings.some((w) => /Multiple ZIP entries/i.test(w));
        const matchCode: VoucherBookingPlanIssueCode = isAmbiguous ? "ZIP_AMBIGUOUS_MATCH" : "ZIP_NO_MATCH";
        const matchMsg = `Export/voucherZip mapping failed for filter ${JSON.stringify(filterCandidate)}: ${combinedWarnings.join("; ")}`;
        lastTypedError = new VoucherPdfRetrievalError(matchCode, matchMsg);
        attemptErrors.push(matchMsg);
        continue;
      }

      return {
        bytes: picked.entry.bytes,
        fileName: picked.entry.fileName.split("/").pop() ?? picked.entry.fileName,
        warnings: [...combinedWarnings, `Document loaded via Export/voucherZip primary path from "${picked.entry.fileName}".`],
      };
    } catch (error) {
      if (error instanceof VoucherPdfRetrievalError) {
        lastTypedError = error;
      }
      attemptErrors.push(getErrorMessage(error));
    }
  }

  const combinedMessage = attemptErrors.join("; ");
  if (lastTypedError) {
    throw new VoucherPdfRetrievalError(lastTypedError.code, combinedMessage);
  }
  throw new Error(combinedMessage);
}

function isPdfBuffer(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "%PDF";
}

function decodeBase64Strict(base64Value: string): Buffer | null {
  const normalized = base64Value.replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    return null;
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length === 0) {
    return null;
  }

  const normalizedWithoutPadding = normalized.replace(/=+$/, "");
  const decodedWithoutPadding = decoded.toString("base64").replace(/=+$/, "");
  return decodedWithoutPadding === normalizedWithoutPadding ? decoded : null;
}

function getUploadedTempFilename(uploadResult: unknown): string | undefined {
  const root = asRecord(uploadResult);
  const objects = root?.objects;
  if (Array.isArray(objects)) {
    return getStringValue(asRecord(objects[0])?.filename);
  }
  if (objects !== undefined) {
    return getStringValue(asRecord(objects)?.filename);
  }
  return getStringValue(root?.filename);
}

function getVoucherIdFromSaveVoucherResult(saveResult: unknown): number | undefined {
  const saveRecord = asRecord(saveResult);
  const voucherRecord = asRecord(saveRecord?.voucher);
  return getNumberValue(voucherRecord?.id);
}

function getDocumentIdFromSaveVoucherResult(saveResult: unknown): number | undefined {
  const saveRecord = asRecord(saveResult);
  const voucherRecord = asRecord(saveRecord?.voucher);
  return getNumberValue(asRecord(voucherRecord?.document)?.id);
}

function normalizeVoucherAmountFields(sum?: number, sumNet?: number): Record<string, string> {
  const normalizedSum = sum !== undefined ? roundCurrency(sum) : undefined;
  const normalizedSumNet = sumNet !== undefined ? roundCurrency(sumNet) : normalizedSum;
  const effectiveSum = normalizedSum ?? normalizedSumNet;
  if (effectiveSum === undefined) {
    return {};
  }

  const serialized = String(effectiveSum);
  return {
    sum: serialized,
    sumNet: String(normalizedSumNet ?? effectiveSum),
  };
}

function validatePdfPayload(
  fileName: string,
  contentBase64: string
): { fileName: string; normalizedBase64: string; decodedBytes: Buffer } | { fileName: string; error: VoucherBookingPlanIssue } {
  const trimmedFileName = fileName.trim();
  if (!trimmedFileName) {
    return {
      fileName,
      error: createIssue("PDF_PAYLOAD_MISSING", "fileName is required"),
    };
  }

  const normalizedBase64 = contentBase64.trim();
  if (!normalizedBase64) {
    return {
      fileName: trimmedFileName,
      error: createIssue("PDF_PAYLOAD_MISSING", "contentBase64 is required"),
    };
  }

  const decodedBytes = decodeBase64Strict(normalizedBase64);
  if (!decodedBytes) {
    return {
      fileName: trimmedFileName,
      error: createIssue("PDF_BASE64_INVALID", "contentBase64 is not valid base64 data"),
    };
  }

  if (!isPdfBuffer(decodedBytes)) {
    return {
      fileName: trimmedFileName,
      error: createIssue("PDF_NOT_VALID", "Decoded payload is not a valid PDF document"),
    };
  }

  return { fileName: trimmedFileName, normalizedBase64, decodedBytes };
}

function buildUploadVoucherFileFailure(
  filePath: string,
  code: VoucherBookingPlanIssueCode,
  message: string
): UploadVoucherFileResult {
  return {
    ok: false,
    filePath,
    filename: null,
    pages: null,
    originMimeType: null,
    contentHash: null,
    warnings: [],
    errors: [createIssue(code, message)],
  };
}

async function validateVoucherUploadFilePath(
  filePath: string
): Promise<{ filePath: string }> {
  if (!filePath.trim()) {
    throw new VoucherUploadError("FILE_PATH_REQUIRED", "filePath is required");
  }
  if (!isAbsolute(filePath)) {
    throw new VoucherUploadError("FILE_PATH_NOT_ABSOLUTE", "filePath must be an absolute path");
  }

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (error) {
    const errorCode = asRecord(error)?.code;
    if (errorCode === "ENOENT") {
      throw new VoucherUploadError("FILE_NOT_FOUND", `File not found: ${filePath}`);
    }
    throw new VoucherUploadError("FILE_NOT_READABLE", `File could not be accessed: ${filePath}`);
  }

  if (!fileStats.isFile()) {
    throw new VoucherUploadError("FILE_NOT_READABLE", `Path is not a readable file: ${filePath}`);
  }

  try {
    await access(filePath, fsConstants.R_OK);
  } catch {
    throw new VoucherUploadError("FILE_NOT_READABLE", `File is not readable: ${filePath}`);
  }

  if (fileStats.size <= 0) {
    throw new VoucherUploadError("FILE_EMPTY", `File is empty: ${filePath}`);
  }

  const fileHandle = await open(filePath, "r");
  try {
    const headerBuffer = Buffer.alloc(4);
    const { bytesRead } = await fileHandle.read(headerBuffer, 0, headerBuffer.length, 0);
    if (!isPdfBuffer(headerBuffer.subarray(0, bytesRead))) {
      throw new VoucherUploadError("FILE_NOT_PDF", `File is not a valid PDF document: ${filePath}`);
    }
  } finally {
    await fileHandle.close();
  }

  return { filePath };
}

function buildClientUrl(client: SevdeskClient, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${client.baseUrl}${normalizedPath}`;
}

function getVoucherUploadResponseObject(uploadResult: unknown): Record<string, unknown> | undefined {
  const root = asRecord(uploadResult);
  const objects = root?.objects;
  if (Array.isArray(objects)) {
    return asRecord(objects[0]);
  }
  if (objects !== undefined) {
    return asRecord(objects);
  }
  return root;
}

async function uploadVoucherFileFromPathInternal(
  client: SevdeskClient,
  filePath: string
): Promise<{
  filename: string;
  pages: number | null;
  originMimeType: string | null;
  contentHash: string | null;
}> {
  const form = new NodeFormData();
  form.append("file", createReadStream(filePath), {
    filename: basename(filePath),
    contentType: "application/pdf",
  });

  let response: Response;
  try {
    const requestBody = form as unknown as BodyInit;
    response = await fetch(buildClientUrl(client, "/Voucher/Factory/uploadTempFile"), {
      method: "POST",
      headers: {
        ...client.defaultHeaders,
        ...form.getHeaders(),
      },
      // `form-data` exposes a Node Readable stream, so we cast to BodyInit for Node's fetch runtime.
      body: requestBody,
      // Node fetch requires duplex for streamed request bodies such as form-data's Readable stream.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch (error) {
    throw new VoucherUploadError("UPLOAD_FAILED", `Upload request failed: ${getErrorMessage(error)}`);
  }

  const responseText = await response.text();
  if (response.status !== 201) {
    throw new VoucherUploadError(
      "UPLOAD_FAILED",
      `Upload failed with ${response.status}${response.statusText ? ` ${response.statusText}` : ""}: ${responseText || "(empty response body)"}`
    );
  }

  if (!responseText) {
    throw new VoucherUploadError("UPLOAD_RESPONSE_INVALID", "Upload succeeded but sevDesk returned an empty response body");
  }

  let uploadData: unknown;
  try {
    uploadData = JSON.parse(responseText);
  } catch (error) {
    throw new VoucherUploadError(
      "UPLOAD_RESPONSE_INVALID",
      `Upload succeeded but sevDesk returned invalid JSON: ${getErrorMessage(error)}`
    );
  }

  const uploadObject = getVoucherUploadResponseObject(uploadData);
  const filename = getStringValue(uploadObject?.filename)?.trim();
  if (!filename) {
    throw new VoucherUploadError(
      "UPLOAD_RESPONSE_INVALID",
      "Upload succeeded but sevDesk response did not include objects.filename"
    );
  }

  return {
    filename,
    pages: getNumberValue(uploadObject?.pages) ?? null,
    originMimeType: getStringValue(uploadObject?.originMimeType) ?? null,
    contentHash: getStringValue(uploadObject?.contentHash) ?? null,
  };
}

function buildDraftVoucherBody(params: {
  voucherDate: string;
  description?: string;
  supplierName?: string;
  creditDebit: "C" | "D";
  voucherId?: number;
}): Record<string, unknown> {
  return {
    ...(params.voucherId !== undefined && { id: params.voucherId }),
    objectName: "Voucher",
    mapAll: true,
    voucherDate: params.voucherDate,
    status: 50,
    creditDebit: params.creditDebit,
    voucherType: "VOU",
    ...(params.description && { description: params.description }),
    ...(params.supplierName && { supplierName: params.supplierName }),
  };
}

async function verifyVoucherReadableInternal(
  client: SevdeskClient,
  voucherId: number
): Promise<Record<string, unknown>> {
  const voucherData = await getVoucherByIdInternal(client, voucherId);
  const voucherRecord = unwrapFirstObject(voucherData);
  const visibleVoucherId = getNumberValue(voucherRecord?.id);
  if (!voucherRecord || visibleVoucherId !== voucherId) {
    throw new Error(`Voucher ${voucherId} could not be re-read after saveVoucher`);
  }
  return voucherRecord;
}

async function createDraftVoucherInternal(
  client: SevdeskClient,
  params: {
    voucherDate: string;
    description?: string;
    supplierName?: string;
    creditDebit: "C" | "D";
  }
): Promise<{ voucherId: number; voucherRecord: Record<string, unknown> }> {
  const { data: saveData, error: saveError } = await callUntypedClientMethod(
    client,
    "POST",
    "/Voucher/Factory/saveVoucher",
    {
      body: {
        voucher: buildDraftVoucherBody(params),
        voucherPosSave: [],
      },
    }
  );
  if (saveError) {
    throw new Error(`Voucher creation failed: ${JSON.stringify(saveError)}`);
  }

  const voucherId = getVoucherIdFromSaveVoucherResult(saveData);
  if (!voucherId) {
    throw new Error("Voucher creation succeeded but sevDesk did not return a numeric voucherId");
  }

  try {
    const voucherRecord = await verifyVoucherReadableInternal(client, voucherId);
    return { voucherId, voucherRecord };
  } catch (error) {
    throw Object.assign(new Error(getErrorMessage(error)), { voucherId, phase: "verify" });
  }
}

function buildVoucherAttachBody(
  voucherId: number,
  voucherRecord: Record<string, unknown>,
  fallbackCreditDebit?: "C" | "D"
): Record<string, unknown> {
  const supplier = asRecord(voucherRecord.supplier);
  const supplierId = getNumberValue(supplier?.id);
  const supplierObjectName = getStringValue(supplier?.objectName);
  const supplierName = getStringValue(voucherRecord.supplierName);
  const creditDebit = getStringValue(voucherRecord.creditDebit);

  return {
    id: voucherId,
    objectName: "Voucher",
    mapAll: true,
    voucherDate: getStringValue(voucherRecord.voucherDate) ?? new Date().toISOString().slice(0, 10),
    status: getNumberValue(voucherRecord.status) ?? 50,
    creditDebit: creditDebit === "C" || creditDebit === "D" ? creditDebit : (fallbackCreditDebit ?? "D"),
    voucherType: getStringValue(voucherRecord.voucherType) ?? "VOU",
    ...(getStringValue(voucherRecord.description) && { description: getStringValue(voucherRecord.description) }),
    ...(supplierId !== undefined
      ? {
          supplier: {
            id: supplierId,
            objectName: supplierObjectName ?? "Contact",
          },
        }
      : supplierName
        ? { supplierName }
        : {}),
  };
}

async function uploadVoucherTempFileInternal(
  client: SevdeskClient,
  params: { fileName: string; decodedBytes: Buffer }
): Promise<string> {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([Uint8Array.from(params.decodedBytes)], { type: "application/pdf" }),
    params.fileName
  );

  const { data: uploadData, error: uploadError } = await callUntypedClientMethod(
    client,
    "POST",
    "/Voucher/Factory/uploadTempFile",
    { body: formData }
  );
  if (uploadError) {
    throw new Error(`PDF attach upload failed: ${JSON.stringify(uploadError)}`);
  }

  const uploadedFileName = getUploadedTempFilename(uploadData);
  if (!uploadedFileName) {
    throw new Error("PDF attach upload succeeded but sevDesk did not return a temporary filename");
  }

  return uploadedFileName;
}

async function attachPdfToVoucherInternal(
  client: SevdeskClient,
  params: {
    voucherId: number;
    fileName: string;
    decodedBytes: Buffer;
    voucherRecord?: Record<string, unknown>;
    creditDebit?: "C" | "D";
  }
): Promise<{ documentId: number; voucherRecord: Record<string, unknown> }> {
  const voucherRecord = params.voucherRecord ?? (await verifyVoucherReadableInternal(client, params.voucherId));
  const uploadedFileName = await uploadVoucherTempFileInternal(client, {
    fileName: params.fileName,
    decodedBytes: params.decodedBytes,
  });

  const { error: attachError } = await callUntypedClientMethod(client, "POST", "/Voucher/Factory/saveVoucher", {
    body: {
      voucher: buildVoucherAttachBody(params.voucherId, voucherRecord, params.creditDebit),
      filename: uploadedFileName,
    },
  });
  if (attachError) {
    throw new Error(`PDF attach failed: ${JSON.stringify(attachError)}`);
  }

  const verifiedVoucher = await verifyVoucherReadableInternal(client, params.voucherId);
  const documentId = getVoucherDocumentId(verifiedVoucher as VoucherResponseData | undefined);
  if (!documentId) {
    throw Object.assign(
      new Error(`Voucher ${params.voucherId} could not be re-read with an attached document after upload`),
      { voucherId: params.voucherId, phase: "attach-verify" }
    );
  }

  return { documentId, voucherRecord: verifiedVoucher };
}

async function downloadVoucherOriginalPdfInternal(
  client: SevdeskClient,
  voucherId: number
): Promise<VoucherOriginalPdfResult> {
  const voucherData = await getVoucherByIdInternal(client, voucherId);
  const documentId = getVoucherDocumentId(voucherData as VoucherResponseData | undefined);
  if (!documentId) {
    throw new VoucherPdfRetrievalError("VOUCHER_NO_DOCUMENT", "Voucher has no document attached");
  }
  const documentInfo = await getVoucherDocumentInfoInternal(client, voucherId);

  try {
    const voucherZipResult = await downloadDocumentBytesViaVoucherZipInternal(client, voucherId, documentId);
    if (!isPdfBuffer(voucherZipResult.bytes)) {
      throw new VoucherPdfRetrievalError(
        "ZIP_MATCH_NOT_PDF",
        `Export/voucherZip mapping succeeded but selected file "${voucherZipResult.fileName}" failed PDF format validation`
      );
    }

    return {
      documentId,
      voucherId,
      source: "voucherZip",
      fileName: voucherZipResult.fileName,
      mimeType: "application/pdf",
      contentBase64: voucherZipResult.bytes.toString("base64"),
      sizeBytes: voucherZipResult.bytes.length,
      warnings: voucherZipResult.warnings,
    };
  } catch (voucherZipError) {
    // Preserve the typed voucherZip error so handlers can surface its code alongside the fallback code.
    const zipCause = voucherZipError instanceof VoucherPdfRetrievalError ? voucherZipError : undefined;

    const { data: documentData, error: documentError } = await callUntypedClientMethod(
      client,
      "GET",
      "/Document/{documentId}",
      {
        params: { path: { documentId } },
        parseAs: "arrayBuffer",
      }
    );
    if (documentError) {
      throw new VoucherPdfRetrievalError(
        "FALLBACK_FAILED",
        `${zipPrimaryFailedPrefix(voucherZipError)}; fallback /Document/{documentId} request also failed: ${JSON.stringify(documentError)}`,
        zipCause
      );
    }
    if (!(documentData instanceof ArrayBuffer)) {
      throw new VoucherPdfRetrievalError(
        "FALLBACK_FAILED",
        "Fallback /Document download did not return raw bytes",
        zipCause
      );
    }
    const bytes = Buffer.from(documentData);
    if (!isPdfBuffer(bytes)) {
      throw new VoucherPdfRetrievalError(
        "FALLBACK_NOT_PDF",
        `${zipPrimaryFailedPrefix(voucherZipError)}; fallback /Document/{documentId} download succeeded but failed PDF format validation — document is likely an image`,
        zipCause
      );
    }

    const fileName = documentInfo?.fileName ?? `document-${documentId}.pdf`;
    return {
      voucherId,
      documentId,
      source: "document-download-fallback",
      fileName,
      mimeType: "application/pdf",
      contentBase64: bytes.toString("base64"),
      sizeBytes: bytes.length,
      warnings: [
        zipPrimaryFailedPrefix(voucherZipError),
        "Original PDF returned from fallback /Document/{documentId} download.",
      ],
    };
  }
}

async function getVoucherBookingContextInternal(
  client: SevdeskClient,
  voucherId: number,
  includeImage?: boolean
): Promise<VoucherBookingContextResult> {
  const voucher = await getVoucherByIdInternal(client, voucherId);
  const positions = await getVoucherPositionsInternal(client, voucherId);
  const warnings: VoucherBookingPlanIssue[] = [];

  let einvoice: VoucherReadResult<EInvoiceCheckResult>;
  try {
    einvoice = { ok: true, data: await checkAndExtractEInvoiceInternal(client, voucherId) };
  } catch (error) {
    const issue = createIssue(
      "EINVOICE_READ_FAILED",
      `E-invoice extraction failed: ${getErrorMessage(error)}`
    );
    warnings.push(issue);
    einvoice = { ok: false, error: issue };
  }

  let image: VoucherReadResult<unknown> | null = null;
  if (includeImage) {
    try {
      image = { ok: true, data: await getVoucherDocumentImageInternal(client, voucherId) };
    } catch (error) {
      const issue = createIssue(
        "IMAGE_READ_FAILED",
        `Voucher image could not be loaded: ${getErrorMessage(error)}`
      );
      warnings.push(issue);
      image = { ok: false, error: issue };
    }
  }

  return {
    voucherId,
    voucher,
    positions,
    einvoice,
    image,
    warnings,
  };
}

export function roundCurrency(value: number): number {
  const sign = Math.sign(value);
  return sign * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
}

export function calculateGross(sumNet: number, taxRate: number): number {
  if (taxRate === 19) return roundCurrency(sumNet * 1.19);
  if (taxRate === 7) return roundCurrency(sumNet * 1.07);
  if (taxRate === 0) return roundCurrency(sumNet);
  return roundCurrency(sumNet * (1 + taxRate / 100));
}

export function normalizeBookingPlan(plan: VoucherBookingPlan): VoucherBookingPlan {
  return {
    ...plan,
    expectedTotalGross:
      plan.expectedTotalGross === undefined ? undefined : roundCurrency(plan.expectedTotalGross),
    positions: plan.positions.map((position) => {
      const sumNet = roundCurrency(position.sumNet);
      const sumGross = position.sumGross === undefined
        ? calculateGross(sumNet, position.taxRate)
        : roundCurrency(position.sumGross);
      return {
        ...position,
        accountDatevObjectName: position.accountDatevObjectName ?? "AccountDatev",
        sumNet,
        sumGross,
      };
    }),
  };
}

export function validateBookingPlanInternal(plan: VoucherBookingPlan): VoucherBookingPlanValidationResult {
  const normalizedPlan = normalizeBookingPlan(plan);
  const errors: VoucherBookingPlanIssue[] = [];
  const warnings: VoucherBookingPlanIssue[] = [];

  if (!Number.isFinite(normalizedPlan.voucherId) || normalizedPlan.voucherId <= 0) {
    errors.push(createIssue("VOUCHER_ID_INVALID", "voucherId must be greater than 0", "voucherId"));
  }

  if (normalizedPlan.positions.length === 0) {
    errors.push(createIssue("POSITIONS_REQUIRED", "at least one position is required", "positions"));
  }

  for (const [index, position] of normalizedPlan.positions.entries()) {
    const label = `positions[${index}]`;
    if (!Number.isFinite(position.accountDatevId) || position.accountDatevId <= 0) {
      errors.push(
        createIssue("ACCOUNT_DATEV_ID_REQUIRED", `${label}.accountDatevId is required`, `${label}.accountDatevId`)
      );
    }
    if (!Number.isFinite(position.taxRate)) {
      errors.push(createIssue("TAX_RATE_REQUIRED", `${label}.taxRate is required`, `${label}.taxRate`));
    } else if (position.taxRate < 0 || position.taxRate > 100) {
      errors.push(createIssue("TAX_RATE_INVALID", `${label}.taxRate must be between 0 and 100`, `${label}.taxRate`));
    }
    if (!Number.isFinite(position.sumNet)) {
      errors.push(createIssue("SUM_NET_REQUIRED", `${label}.sumNet is required`, `${label}.sumNet`));
    }
    if (typeof position.comment !== "string" || position.comment.trim().length === 0) {
      errors.push(createIssue("COMMENT_REQUIRED", `${label}.comment is required`, `${label}.comment`));
    }
    if (position.sumNet < 0) {
      errors.push(createIssue("SUM_NET_NEGATIVE", `${label}.sumNet must not be negative`, `${label}.sumNet`));
    }
    if (position.sumGross !== undefined && position.sumGross < 0) {
      errors.push(createIssue("SUM_GROSS_NEGATIVE", `${label}.sumGross must not be negative`, `${label}.sumGross`));
    }

    if (position.sumGross !== undefined) {
      const expectedGross = calculateGross(position.sumNet, position.taxRate);
      if (Math.abs(position.sumGross - expectedGross) > 0.01) {
        errors.push(
          createIssue(
            "SUM_GROSS_MISMATCH",
            `${label}.sumGross does not match sumNet + taxRate (expected ${expectedGross.toFixed(2)})`,
            `${label}.sumGross`
          )
        );
      }
    }

    const usefulLife = position.assetUsefulLife;
    const hasValidUsefulLife = Number.isFinite(usefulLife) && (usefulLife as number) > 0;
    if (position.isAsset && !hasValidUsefulLife) {
      errors.push(
        createIssue(
          "ASSET_USEFUL_LIFE_REQUIRED",
          `${label}.assetUsefulLife (months) is required when isAsset is true`,
          `${label}.assetUsefulLife`
        )
      );
    } else if (usefulLife !== undefined && !hasValidUsefulLife) {
      errors.push(
        createIssue(
          "ASSET_USEFUL_LIFE_INVALID",
          `${label}.assetUsefulLife (months) must be greater than 0 when provided`,
          `${label}.assetUsefulLife`
        )
      );
    }

    if (position.taxRate === 0) {
      if (!ZERO_TAX_SPECIAL_CASE_COMMENT_PATTERN.test(position.comment)) {
        warnings.push(
          createIssue(
            "ZERO_TAX_REVIEW_REQUIRED",
            `${label} has taxRate 0 without an obvious special-case comment`,
            `${label}.taxRate`
          )
        );
      }
    }

    if (
      position.specialAccountingField3 !== undefined &&
      position.specialAccountingField3.trim().length === 0
    ) {
      errors.push(
        createIssue(
          "SPECIAL_ACCOUNTING_FIELD3_EMPTY",
          `${label}.specialAccountingField3 must not be empty when provided`,
          `${label}.specialAccountingField3`
        )
      );
    }

    if (position.cateringTip !== undefined) {
      if (!Number.isFinite(position.cateringTip)) {
        errors.push(
          createIssue("CATERING_TIP_INVALID", `${label}.cateringTip must be a finite number`, `${label}.cateringTip`)
        );
      } else if (position.cateringTip < 0) {
        errors.push(
          createIssue("CATERING_TIP_NEGATIVE", `${label}.cateringTip must not be negative`, `${label}.cateringTip`)
        );
      } else {
        // sevDesk hospitality tips are typically 0%-positions. Non-zero tax rates are not rejected
        // outright, but we surface a review warning so callers can confirm the accounting treatment.
        if (position.taxRate !== 0) {
          warnings.push(
            createIssue(
              "CATERING_TIP_TAX_REVIEW",
              `${label}.cateringTip is set although the position tax rate is not 0%`,
              `${label}.cateringTip`
            )
          );
        }
        if (position.sumGross !== undefined && position.cateringTip - position.sumGross > 0.01) {
          warnings.push(
            createIssue(
              "CATERING_TIP_EXCEEDS_GROSS",
              `${label}.cateringTip is greater than sumGross`,
              `${label}.cateringTip`
            )
          );
        }
      }
    }
  }

  const totalNet = roundCurrency(
    normalizedPlan.positions.reduce((accumulator, position) => accumulator + position.sumNet, 0)
  );
  const totalGross = roundCurrency(
    normalizedPlan.positions.reduce(
      (accumulator, position) =>
        accumulator + (position.sumGross === undefined ? calculateGross(position.sumNet, position.taxRate) : position.sumGross),
      0
    )
  );

  if (normalizedPlan.expectedTotalGross !== undefined) {
    const diff = Math.abs(totalGross - normalizedPlan.expectedTotalGross);
    if (diff > 0.01) {
      errors.push(
        createIssue(
          "EXPECTED_TOTAL_GROSS_MISMATCH",
          `expectedTotalGross mismatch: expected ${normalizedPlan.expectedTotalGross.toFixed(2)}, computed ${totalGross.toFixed(2)}`,
          "expectedTotalGross"
        )
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedPlan,
    computedTotals: {
      totalGross,
      totalNet,
    },
  };
}

async function applyVoucherBookingPlanInternal(
  client: SevdeskClient,
  params: VoucherBookingPlan & {
    dryRun?: boolean;
    deleteSurplusPositions?: boolean;
  }
): Promise<ApplyVoucherBookingPlanResult> {
  const dryRun = params.dryRun ?? false;
  const deleteSurplusPositions = params.deleteSurplusPositions ?? false;
  const validation = validateBookingPlanInternal(params);
  const receiptGuidance = await validateReceiptGuidanceForPlan(client, validation);
  const errors = [...validation.errors, ...receiptGuidance.errors];
  const warnings = [...validation.warnings, ...receiptGuidance.warnings];
  const writePhase: ApplyVoucherBookingPlanResult["writePhase"] = {
    started: false,
    completedSteps: [],
  };

  let currentVoucher: unknown;
  let currentPositions: unknown;
  try {
    currentVoucher = await getVoucherByIdInternal(client, params.voucherId);
    currentPositions = await getVoucherPositionsInternal(client, params.voucherId);
  } catch (error) {
    const contextError = createIssue(
      "VOUCHER_CONTEXT_READ_FAILED",
      `Voucher context could not be loaded: ${getErrorMessage(error)}`
    );
    return {
      ok: false,
      dryRun,
      validation,
      receiptGuidance,
      appliedChanges: {
        dryRun,
        headerUpdated: false,
        headerFieldsChanged: [],
        reusedPositionIds: [],
        createdPositionIndexes: [],
        deletedPositionIds: [],
      },
      writePhase,
      finalVoucher: null,
      finalPositions: [],
      warnings,
      errors: [...errors, contextError],
    };
  }

  const currentVoucherObject = unwrapFirstObject(currentVoucher);
  const existingPositions = unwrapObjectArray(currentPositions);
  const availablePositionIds = existingPositions
    .map((position) => getVoucherPositionId(position))
    .filter((positionId): positionId is number => positionId !== undefined);
  const assignedPositionIds = new Set<number>();
  const reusedPositionIds: number[] = [];
  const createdPositionIndexes: number[] = [];

  const positionsToUpdate = validation.normalizedPlan.positions.map((position, index) => {
    const requestedId = position.voucherPosIdToReuse;

    if (requestedId !== undefined) {
      if (!availablePositionIds.includes(requestedId)) {
        errors.push(
          createIssue(
            "REUSED_POSITION_NOT_FOUND",
            `Requested voucher position ${requestedId} does not exist on voucher ${params.voucherId}`,
            `positions[${index}].voucherPosIdToReuse`
          )
        );
      } else if (assignedPositionIds.has(requestedId)) {
        errors.push(
          createIssue(
            "REUSED_POSITION_DUPLICATE",
            `Voucher position ${requestedId} is referenced more than once`,
            `positions[${index}].voucherPosIdToReuse`
          )
        );
      } else {
        assignedPositionIds.add(requestedId);
        reusedPositionIds.push(requestedId);
        return { index, position, voucherPosId: requestedId };
      }
    }

    const nextReusableId = availablePositionIds.find((positionId) => !assignedPositionIds.has(positionId));
    if (nextReusableId !== undefined) {
      assignedPositionIds.add(nextReusableId);
      reusedPositionIds.push(nextReusableId);
      return { index, position, voucherPosId: nextReusableId };
    }

    createdPositionIndexes.push(index);
    return { index, position };
  });

  const deletedPositionIds = availablePositionIds.filter((positionId) => !assignedPositionIds.has(positionId));
  if (deletedPositionIds.length > 0 && !deleteSurplusPositions) {
    warnings.push(
      createIssue(
        "SURPLUS_POSITIONS_PRESENT",
        `Voucher currently has ${deletedPositionIds.length} surplus position(s); rerun with deleteSurplusPositions=true to remove them`
      )
    );
  }

  const currentTaxRuleId = getNumberValue(asRecord(currentVoucherObject?.taxRule)?.id);
  const currentDescription = getStringValue(currentVoucherObject?.description);
  const currentVoucherDate = getVoucherDateComparable(currentVoucherObject?.voucherDate);
  const currentSupplierName =
    getStringValue(currentVoucherObject?.supplierName) ??
    getStringValue(asRecord(currentVoucherObject?.supplier)?.name);

  const headerBody: Record<string, unknown> = {};
  const headerFieldsChanged: string[] = [];

  if (
    validation.normalizedPlan.taxRuleId !== undefined &&
    validation.normalizedPlan.taxRuleId !== currentTaxRuleId
  ) {
    headerBody.taxRule = { id: validation.normalizedPlan.taxRuleId, objectName: "TaxRule" };
    headerFieldsChanged.push("taxRule");
  }
  if (
    validation.normalizedPlan.description !== undefined &&
    validation.normalizedPlan.description !== currentDescription
  ) {
    headerBody.description = validation.normalizedPlan.description;
    headerFieldsChanged.push("description");
  }
  if (
    validation.normalizedPlan.voucherDate !== undefined &&
    getVoucherDateComparable(validation.normalizedPlan.voucherDate) !== currentVoucherDate
  ) {
    headerBody.voucherDate = validation.normalizedPlan.voucherDate;
    headerFieldsChanged.push("voucherDate");
  }
  if (
    validation.normalizedPlan.supplierName !== undefined &&
    validation.normalizedPlan.supplierName !== currentSupplierName
  ) {
    headerBody.supplierName = validation.normalizedPlan.supplierName;
    headerFieldsChanged.push("supplierName");
  }

  if (errors.length > 0) {
    return {
      ok: false,
      dryRun,
      validation,
      receiptGuidance,
      appliedChanges: {
        dryRun,
        headerUpdated: headerFieldsChanged.length > 0,
        headerFieldsChanged,
        reusedPositionIds,
        createdPositionIndexes,
        deletedPositionIds: deleteSurplusPositions ? deletedPositionIds : [],
      },
      writePhase,
      finalVoucher: currentVoucher,
      finalPositions: currentPositions,
      warnings,
      errors,
    };
  }

  const predictedVoucher = { ...(currentVoucherObject ?? {}), ...headerBody };
  const predictedPositions = [
    ...positionsToUpdate.map((action) => {
      const existingPosition = action.voucherPosId === undefined
        ? undefined
        : existingPositions.find((position) => getVoucherPositionId(position) === action.voucherPosId);
      return {
        ...(existingPosition ?? {}),
        ...(action.voucherPosId !== undefined && { id: action.voucherPosId }),
        ...buildVoucherPositionBody(action.position),
        voucher: { id: params.voucherId, objectName: "Voucher" },
      };
    }),
    ...(!deleteSurplusPositions
      ? existingPositions.filter((position) => {
          const positionId = getVoucherPositionId(position);
          return positionId !== undefined && deletedPositionIds.includes(positionId);
        })
      : []),
  ];

  if (!dryRun) {
    writePhase.started = true;
    let currentStep = "start";
    try {
      if (headerFieldsChanged.length > 0) {
        currentStep = "updateVoucherHeader";
        const { error } = await (client.PUT as unknown as (
          path: string,
          init: UntypedClientMethodInit
        ) => UntypedClientMethodResult)("/Voucher/{voucherId}", {
          params: {
            path: {
              voucherId: params.voucherId,
            },
          },
          body: headerBody,
        });
        if (error) throw new Error(JSON.stringify(error));
        writePhase.completedSteps.push(currentStep);
      }

      for (const action of positionsToUpdate) {
        const body = buildVoucherPositionBody(action.position);

        if (action.voucherPosId !== undefined) {
          currentStep = `updateVoucherPos:${action.voucherPosId}`;
          const { error } = await (client.PUT as unknown as (
            path: string,
            init: UntypedClientMethodInit
          ) => UntypedClientMethodResult)("/VoucherPos/{voucherPosId}", {
            params: {
              path: {
                voucherPosId: action.voucherPosId,
              },
            },
            body,
          });
          if (error) throw new Error(JSON.stringify(error));
          writePhase.completedSteps.push(currentStep);
          continue;
        }

        currentStep = `createVoucherPos:${action.index}`;
        const { error } = await (client.POST as unknown as (
          path: string,
          init: UntypedClientMethodInit
        ) => UntypedClientMethodResult)("/VoucherPos", {
          body: {
            objectName: "VoucherPos",
            mapAll: true,
            voucher: { id: params.voucherId, objectName: "Voucher" },
            sequenceNumber: action.index + 1,
            ...body,
          },
        });
        if (error) throw new Error(JSON.stringify(error));
        writePhase.completedSteps.push(currentStep);
      }

      if (deleteSurplusPositions) {
        for (const voucherPosId of deletedPositionIds) {
          currentStep = `deleteVoucherPos:${voucherPosId}`;
          const { error } = await callUntypedClientMethod(client, "DELETE", "/VoucherPos/{voucherPosId}", {
            params: {
              path: {
                voucherPosId,
              },
            },
          });
          if (error) throw new Error(JSON.stringify(error));
          writePhase.completedSteps.push(currentStep);
        }
      }

      currentStep = "refetchFinalState";
      currentVoucher = await getVoucherByIdInternal(client, params.voucherId);
      currentPositions = await getVoucherPositionsInternal(client, params.voucherId);
      writePhase.completedSteps.push(currentStep);
    } catch (error) {
      writePhase.failedAt = currentStep;
      writePhase.failedMessage = getErrorMessage(error);
      try {
        currentVoucher = await getVoucherByIdInternal(client, params.voucherId);
      } catch {
        currentVoucher = null;
      }
      try {
        currentPositions = await getVoucherPositionsInternal(client, params.voucherId);
      } catch {
        currentPositions = [];
      }
      return {
        ok: false,
        dryRun,
        validation,
        receiptGuidance,
        appliedChanges: {
          dryRun,
          headerUpdated: headerFieldsChanged.length > 0,
          headerFieldsChanged,
          reusedPositionIds,
          createdPositionIndexes,
          deletedPositionIds: deleteSurplusPositions ? deletedPositionIds : [],
        },
        writePhase,
        finalVoucher: currentVoucher,
        finalPositions: currentPositions,
        warnings,
        errors: [
          ...errors,
          createIssue(
            "WRITE_PHASE_FAILED",
            `Write phase failed at "${currentStep}": ${getErrorMessage(error)}`
          ),
        ],
      };
    }
  }

  return {
    ok: true,
    dryRun,
    validation,
    receiptGuidance,
    appliedChanges: {
      dryRun,
      headerUpdated: headerFieldsChanged.length > 0,
      headerFieldsChanged,
      reusedPositionIds,
      createdPositionIndexes,
      deletedPositionIds: deleteSurplusPositions ? deletedPositionIds : [],
    },
    writePhase,
    finalVoucher: dryRun ? predictedVoucher : currentVoucher,
    finalPositions: dryRun ? predictedPositions : currentPositions,
    warnings,
    errors: [],
  };
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
      date: z.string().describe(
        "Booking date passed through to sevDesk. Prefer YYYY-MM-DD; Unix timestamp strings are accepted when required by your sevDesk setup."
      ),
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
    handler: async (client: SevdeskClient, params: { voucherId: number }) =>
      getVoucherPositionsInternal(client, params.voucherId),
  },

  get_voucher_positions_batch: {
    description:
      "Read-only batch helper for voucher positions. Returns one structured result per voucherId and never hides per-voucher read errors.",
    inputSchema: z.object({
      voucherIds: z.array(z.number().int().positive()).min(1).max(100),
    }),
    handler: async (client: SevdeskClient, params: { voucherIds: number[] }) => {
      const results: Array<VoucherBatchResult<unknown>> = await Promise.all(
        params.voucherIds.map(async (voucherId) => {
          try {
            const data = await getVoucherPositionsInternal(client, voucherId);
            return { voucherId, ok: true, data, errors: [], warnings: [] };
          } catch (error) {
            return {
              voucherId,
              ok: false,
              errors: [
                createIssue(
                  "VOUCHER_CONTEXT_READ_FAILED",
                  `Voucher positions could not be loaded: ${getErrorMessage(error)}`
                ),
              ],
              warnings: [],
            };
          }
        })
      );
      return {
        ok: results.every((result) => result.ok),
        results,
      };
    },
  },

  create_draft_voucher: {
    description:
      "Write tool: create a new sevDesk draft voucher first, then verify it can be read back before any file attachment is attempted.",
    inputSchema: z.object({
      voucherDate: z.string().optional().describe("Voucher date. Prefer YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss"),
      description: z.string().optional().describe("Optional voucher description"),
      supplierName: z.string().optional().describe("Optional supplier name"),
      creditDebit: z.enum(["C", "D"]).optional().describe("Voucher direction: C=credit, D=debit (default D)"),
    }).strict(),
    handler: async (client: SevdeskClient, params: {
      voucherDate?: string;
      description?: string;
      supplierName?: string;
      creditDebit?: "C" | "D";
    }): Promise<CreateDraftVoucherResult> => {
      const warnings: string[] = [];
      const voucherDate = params.voucherDate ?? new Date().toISOString().slice(0, 10);
      if (!params.voucherDate) {
        warnings.push("voucherDate was not provided. Defaulted to current date.");
      }
      const creditDebit = params.creditDebit ?? "D";
      if (!params.creditDebit) {
        warnings.push("creditDebit was not provided. Defaulted to D (debit expense voucher).");
      }

      try {
        const { voucherId } = await createDraftVoucherInternal(client, {
          voucherDate,
          description: params.description,
          supplierName: params.supplierName,
          creditDebit,
        });
        return {
          ok: true,
          voucherId,
          warnings,
          errors: [],
        };
      } catch (error) {
        const message = getErrorMessage(error);
        const voucherId = getVoucherIdFromError(error) ?? null;
        return {
          ok: false,
          voucherId,
          warnings,
          errors: [
            createIssue(
              getWorkflowPhaseFromError(error) === "verify" ? "VOUCHER_VERIFY_FAILED" : "VOUCHER_CREATE_FAILED",
              message
            ),
          ],
        };
      }
    },
  },

  attach_pdf_to_voucher: {
    description:
      "Write tool: attach an uploaded PDF payload to an existing sevDesk voucher. Validates the PDF, uploads it as multipart/form-data, attaches it to the voucher, and verifies the document is visible afterwards.",
    inputSchema: z.object({
      voucherId: z.number().int().positive().describe("The ID of the existing voucher"),
      fileName: z.string().min(1).describe("Original PDF file name from the client"),
      contentBase64: z.string().min(1).describe("Base64-encoded PDF bytes"),
      creditDebit: z.enum(["C", "D"]).optional().describe("Optional fallback when the existing voucher has no creditDebit"),
    }).strict(),
    handler: async (client: SevdeskClient, params: {
      voucherId: number;
      fileName: string;
      contentBase64: string;
      creditDebit?: "C" | "D";
    }): Promise<AttachPdfToVoucherResult> => {
      const warnings: string[] = [];
      const payload = validatePdfPayload(params.fileName, params.contentBase64);
      if ("error" in payload) {
        return {
          ok: false,
          voucherId: params.voucherId,
          documentId: null,
          fileName: payload.fileName,
          warnings,
          errors: [payload.error],
        };
      }

      try {
        const { documentId } = await attachPdfToVoucherInternal(client, {
          voucherId: params.voucherId,
          fileName: payload.fileName,
          decodedBytes: payload.decodedBytes,
          creditDebit: params.creditDebit,
        });
        return {
          ok: true,
          voucherId: params.voucherId,
          documentId,
          fileName: payload.fileName,
          warnings,
          errors: [],
        };
      } catch (error) {
        const message = getErrorMessage(error);
        return {
          ok: false,
          voucherId: params.voucherId,
          documentId: null,
          fileName: payload.fileName,
          warnings,
          errors: [
            createIssue(
              getWorkflowPhaseFromError(error) === "attach-verify" ? "PDF_ATTACH_VERIFY_FAILED" : "PDF_ATTACH_FAILED",
              message
            ),
          ],
        };
      }
    },
  },

  upload_voucher_file: {
    description:
      "Write tool: upload a local PDF file to sevDesk via multipart/form-data and return the temporary filename hash required for later voucher save/attach flows.",
    inputSchema: z.object({
      filePath: z.string().describe("Absolute path to a local PDF file that should be uploaded to sevDesk"),
    }).strict(),
    handler: async (
      client: SevdeskClient,
      params: { filePath: string }
    ): Promise<UploadVoucherFileResult> => {
      try {
        await validateVoucherUploadFilePath(params.filePath);
      } catch (error) {
        if (error instanceof VoucherUploadError) {
          return buildUploadVoucherFileFailure(params.filePath, error.code, error.message);
        }
        return buildUploadVoucherFileFailure(params.filePath, "FILE_NOT_READABLE", getErrorMessage(error));
      }

      try {
        const uploadResult = await uploadVoucherFileFromPathInternal(client, params.filePath);
        return {
          ok: true,
          filePath: params.filePath,
          filename: uploadResult.filename,
          pages: uploadResult.pages,
          originMimeType: uploadResult.originMimeType,
          contentHash: uploadResult.contentHash,
          warnings: [],
          errors: [],
        };
      } catch (error) {
        if (error instanceof VoucherUploadError) {
          return buildUploadVoucherFileFailure(params.filePath, error.code, error.message);
        }
        return buildUploadVoucherFileFailure(params.filePath, "UPLOAD_FAILED", getErrorMessage(error));
      }
    },
  },

  create_voucher_from_pdf: {
    description:
      "Write tool: create a new sevDesk draft voucher first, verify it exists, then attach an uploaded PDF payload. " +
      "Validates base64 input and PDF signature before the attach phase and returns phase-specific errors.",
    inputSchema: z.object({
      fileName: z.string().min(1).describe("Original PDF file name from the client"),
      contentBase64: z.string().min(1).describe("Base64-encoded PDF bytes"),
      voucherDate: z.string().optional().describe("Voucher date. Prefer YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss"),
      description: z.string().optional().describe("Optional voucher description"),
      supplierName: z.string().optional().describe("Optional supplier name"),
      creditDebit: z.enum(["C", "D"]).optional().describe("Voucher direction: C=credit, D=debit (default D)"),
    }).strict(),
    handler: async (client: SevdeskClient, params: {
      fileName: string;
      contentBase64: string;
      voucherDate?: string;
      description?: string;
      supplierName?: string;
      creditDebit?: "C" | "D";
    }): Promise<CreateVoucherFromPdfResult> => {
      const warnings: string[] = [];
      const payload = validatePdfPayload(params.fileName, params.contentBase64);
      if ("error" in payload) {
        return {
          ok: false,
          voucherId: null,
          documentId: null,
          fileName: payload.fileName,
          warnings,
          errors: [payload.error],
        };
      }

      const voucherDate = params.voucherDate ?? new Date().toISOString().slice(0, 10);
      if (!params.voucherDate) {
        warnings.push("voucherDate was not provided. Defaulted to current date.");
      }
      const creditDebit = params.creditDebit ?? "D";
      if (!params.creditDebit) {
        warnings.push("creditDebit was not provided. Defaulted to D (debit expense voucher).");
      }

      let voucherId: number | null = null;
      let voucherRecord: Record<string, unknown> | undefined;
      try {
        const draftVoucher = await createDraftVoucherInternal(client, {
          voucherDate,
          description: params.description,
          supplierName: params.supplierName,
          creditDebit,
        });
        voucherId = draftVoucher.voucherId;
        voucherRecord = draftVoucher.voucherRecord;
      } catch (error) {
        const message = getErrorMessage(error);
        voucherId = getVoucherIdFromError(error) ?? voucherId;
        return {
          ok: false,
          voucherId,
          documentId: null,
          fileName: payload.fileName,
          warnings,
          errors: [
            createIssue(
              getWorkflowPhaseFromError(error) === "verify" ? "VOUCHER_VERIFY_FAILED" : "VOUCHER_CREATE_FAILED",
              message
            ),
          ],
        };
      }

      try {
        const attachResult = await attachPdfToVoucherInternal(client, {
          voucherId: voucherId!,
          fileName: payload.fileName,
          decodedBytes: payload.decodedBytes,
          voucherRecord,
          creditDebit,
        });
        return {
          ok: true,
          voucherId,
          documentId: attachResult.documentId,
          fileName: payload.fileName,
          warnings,
          errors: [],
        };
      } catch (error) {
        const message = getErrorMessage(error);
        return {
          ok: false,
          voucherId: voucherId!,
          documentId: null,
          fileName: payload.fileName,
          warnings,
          errors: [
            createIssue(
              getWorkflowPhaseFromError(error) === "attach-verify" ? "PDF_ATTACH_VERIFY_FAILED" : "PDF_ATTACH_FAILED",
              message
            ),
          ],
        };
      }
    },
  },

  update_voucher: {
    description:
      "Low-level write tool for voucher header metadata only. Not for status changes. Use reset_voucher_to_draft, reset_voucher_to_open or enshrine_voucher for status/enshrine transitions.",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher to update"),
      taxRule: z.object({
        id: z.number().describe(
          "sevDesk Update 2.0 taxRule ID. Pass an explicit taxRule from your accounting workflow or ReceiptGuidance output."
        ),
        objectName: z.literal("TaxRule"),
      }).optional().describe("Explicit sevDesk Update 2.0 taxRule. Do not use deprecated taxType."),
      deliveryDate: z.string().optional().describe(
        "Delivery/service date passed through to sevDesk. Prefer YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss."
      ),
      paymentDeadline: z.string().optional().describe(
        "Payment deadline passed through to sevDesk. Prefer YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss."
      ),
      taxRate: z.number().optional().describe("Overall tax rate in percent"),
      creditDebit: z.enum(["C", "D"]).optional().describe("C=Credit, D=Debit"),
      description: z.string().optional().describe("Description/memo"),
      supplierId: z.number().optional().describe("Contact ID of the supplier"),
      supplierName: z.string().optional().describe("Supplier name (used when supplierId is not set)"),
      voucherDate: z.string().optional().describe(
        "Voucher date passed through to sevDesk. Prefer YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss."
      ),
      payDate: z.string().optional().describe(
        "Payment date passed through to sevDesk. Prefer YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss."
      ),
    }).strict(),
    handler: async (client: SevdeskClient, params: {
      voucherId: number;
      taxRule?: { id: number; objectName: "TaxRule" };
      deliveryDate?: string;
      paymentDeadline?: string;
      taxRate?: number;
      creditDebit?: "C" | "D";
      description?: string;
      supplierId?: number;
      supplierName?: string;
      voucherDate?: string;
      payDate?: string;
    }) => {
      const body: Record<string, unknown> = {};
      if (params.taxRule !== undefined) body.taxRule = { id: params.taxRule.id, objectName: "TaxRule" };
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

  reset_voucher_to_draft: {
    description:
      "Status tool: lower a voucher to Draft (50). This can unlink payments and reset asset depreciation. Not possible for enshrined vouchers.",
    inputSchema: z.object({
      voucherId: z.number().int().positive().describe("Voucher ID"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      const { data, error } = await callUntypedClientMethod(client, "PUT", "/Voucher/{voucherId}/resetToDraft", {
        params: { path: { voucherId: params.voucherId } },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  reset_voucher_to_open: {
    description:
      "Status tool: lower a voucher to Open (100). This can unlink payments and reset asset depreciation. It is not a way to promote a draft voucher.",
    inputSchema: z.object({
      voucherId: z.number().int().positive().describe("Voucher ID"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      const { data, error } = await callUntypedClientMethod(client, "PUT", "/Voucher/{voucherId}/resetToOpen", {
        params: { path: { voucherId: params.voucherId } },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  enshrine_voucher: {
    description:
      "Irreversible write tool: enshrine a voucher. Enshrined vouchers can no longer be changed.",
    inputSchema: z.object({
      voucherId: z.number().int().positive().describe("Voucher ID"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      const { data, error } = await callUntypedClientMethod(client, "PUT", "/Voucher/{voucherId}/enshrine", {
        params: { path: { voucherId: params.voucherId } },
      });
      if (error) throw new Error(JSON.stringify(error));
      return data;
    },
  },

  update_voucher_position: {
    description:
      "Low-level write tool for a single voucher position. Prefer apply_voucher_booking_plan for complete Update 2.0 expense-booking workflows.",
    inputSchema: z.object({
      voucherPosId: z.number().describe("The ID of the voucher position to update"),
      accountDatev: z.object({
        id: z.number().describe("Internal SevDesk accountDatev ID (not the SKR04 account number itself)"),
        objectName: z.literal("AccountDatev").describe("SevDesk object name for accountDatev"),
      }).optional().describe("DATEV account as SevDesk object"),
      taxRate: z.number().optional().describe("Tax rate for this position"),
      sum: z.number().optional().describe("Net sum for this position"),
      net: z.boolean().optional().describe(
        "If true, sum/sumNet is net amount and gross is calculated. Default: true on most positions."
      ),
      sumNet: z.number().optional().describe("Net amount. Use when net=true."),
      sumGross: z.number().optional().describe("Gross amount (net + VAT). Use to set gross directly."),
      comment: z.string().optional().describe("Internal comment/note"),
      isAsset: z.boolean().optional().describe("Mark the position as a depreciable asset"),
      assetUsefulLife: z.number().optional().describe("Useful life in months for asset positions"),
      specialAccountingField3: z.string().optional().describe("Optional special accounting field"),
      cateringTip: z.number().optional().describe("Optional tip amount for hospitality receipts"),
    }),
    handler: async (client: SevdeskClient, params: {
      voucherPosId: number;
      accountDatev?: {
        id: number;
        objectName: "AccountDatev";
      };
      taxRate?: number;
      sum?: number;
      net?: boolean;
      sumNet?: number;
      sumGross?: number;
      comment?: string;
      isAsset?: boolean;
      assetUsefulLife?: number;
      specialAccountingField3?: string;
      cateringTip?: number;
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
          ...(params.net !== undefined && { net: params.net }),
          ...normalizeVoucherAmountFields(params.sum, params.sumNet),
          ...(params.sumGross !== undefined && { sumGross: String(params.sumGross) }),
          ...(params.comment !== undefined && { comment: params.comment }),
          ...(params.isAsset !== undefined && { isAsset: params.isAsset }),
          ...(params.assetUsefulLife !== undefined && { assetUsefulLife: params.assetUsefulLife }),
          ...(params.specialAccountingField3 !== undefined && {
            specialAccountingField3: params.specialAccountingField3,
          }),
          ...(params.cateringTip !== undefined && { cateringTip: String(roundCurrency(params.cateringTip)) }),
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
      const { data, error } = await callUntypedClientMethod(client, "DELETE", "/VoucherPos/{voucherPosId}", {
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
      "Read-only helper for sevDesk Update 2.0 ReceiptGuidance. Use mode='forExpense' before writing voucher positions so you can validate allowed account/taxRule/taxRate combinations up front.",
    inputSchema: z.object({
      mode: z.enum(["forAllAccounts", "forExpense"]).describe(
        "forAllAccounts: list all selectable expense accounts with allowed tax rules. " +
        "forExpense: validate a concrete receipt amount/tax amount combination before booking."
      ),
      receiptAmount: z.number().optional().describe("Gross receipt amount in EUR. Required for forExpense."),
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
      "Create a new expense voucher with sevDesk Update 2.0 semantics. Pass an explicit taxRule when needed; no supplier-country tax heuristics are applied.",
    inputSchema: z.object({
      voucherDate: z.string().describe("Voucher date. Prefer YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss"),
      deliveryDate: z.string().optional(),
      paymentDeadline: z.string().optional(),
      description: z.string().optional().describe("Voucher number or description"),
      status: z.number().optional().describe("50=Draft, 100=Open"),
      taxRule: z.object({
        id: z.number().describe("Explicit sevDesk Update 2.0 taxRule ID"),
        objectName: z.literal("TaxRule"),
      }).optional(),
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
        isAsset: z.boolean().optional(),
        assetUsefulLife: z.number().optional().describe("Useful life in months for asset positions"),
        specialAccountingField3: z.string().optional(),
        cateringTip: z.number().optional(),
      })).describe("Line items"),
    }),
    handler: async (client: SevdeskClient, params: any) => {
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
        ...(params.taxRule && { taxRule: params.taxRule }),
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
        ...normalizeVoucherAmountFields(pos.sum, pos.sumNet),
        ...(pos.sumGross !== undefined && { sumGross: String(pos.sumGross) }),
        ...(pos.comment && { comment: pos.comment }),
        ...(pos.isAsset !== undefined && { isAsset: pos.isAsset }),
        ...(pos.assetUsefulLife !== undefined && { assetUsefulLife: pos.assetUsefulLife }),
        ...(pos.specialAccountingField3 !== undefined && {
          specialAccountingField3: pos.specialAccountingField3,
        }),
        ...(pos.cateringTip !== undefined && { cateringTip: String(roundCurrency(pos.cateringTip)) }),
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
      "Low-level write tool to add a voucher position. Prefer apply_voucher_booking_plan when multiple positions or header changes must stay consistent.",
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
      isAsset: z.boolean().optional(),
      assetUsefulLife: z.number().optional().describe("Useful life in months for asset positions"),
      specialAccountingField3: z.string().optional(),
      cateringTip: z.number().optional(),
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
      isAsset?: boolean;
      assetUsefulLife?: number;
      specialAccountingField3?: string;
      cateringTip?: number;
    }) => {
      const { data, error } = await (client.POST as any)("/VoucherPos", {
        body: {
          objectName: "VoucherPos",
          mapAll: true,
          voucher: { id: params.voucherId, objectName: "Voucher" },
          accountDatev: { id: params.accountDatev.id, objectName: "AccountDatev" },
          taxRate: params.taxRate,
          net: params.net,
          ...normalizeVoucherAmountFields(params.sum, params.sumNet),
          ...(params.sumGross !== undefined && { sumGross: String(params.sumGross) }),
          ...(params.comment && { comment: params.comment }),
          ...(params.isAsset !== undefined && { isAsset: params.isAsset }),
          ...(params.assetUsefulLife !== undefined && { assetUsefulLife: params.assetUsefulLife }),
          ...(params.specialAccountingField3 !== undefined && {
            specialAccountingField3: params.specialAccountingField3,
          }),
          ...(params.cateringTip !== undefined && { cateringTip: String(roundCurrency(params.cateringTip)) }),
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
    handler: async (client: SevdeskClient, params: { voucherId: number }) =>
      getVoucherDocumentImageInternal(client, params.voucherId),
  },

  get_voucher_document_info: {
    description:
      "Read-only tool that returns document metadata for a single voucher. Returns documentId, fileName, mimeType (of the original document), hasPdf, and hasImagePreview. " +
      "Useful for PDF-first review workflows where Claude reads the original PDF directly while MCP handles sevDesk state and writeback. " +
      "Returns null for the document field when no document is attached. " +
      "fileName/mimeType are null and hasPdf/hasImagePreview are false when document metadata cannot be retrieved.",
    inputSchema: z.object({
      voucherId: z.number().int().positive().describe("The ID of the voucher"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      const document = await getVoucherDocumentInfoInternal(client, params.voucherId);
      return { voucherId: params.voucherId, document };
    },
  },

  get_voucher_document_info_batch: {
    description:
      "Read-only batch variant of get_voucher_document_info. Returns document metadata for up to 50 vouchers. " +
      "Each result contains voucherId and the document field (documentId, fileName, mimeType, hasPdf, hasImagePreview). " +
      "Useful for quickly mapping a list of draft vouchers to their PDF documents before starting a review workflow. " +
      "Per-voucher errors are reported in the errors array; the top-level ok is false if any voucher hard-failed.",
    inputSchema: z.object({
      voucherIds: z.array(z.number().int().positive()).min(1).max(50),
    }),
    handler: async (client: SevdeskClient, params: { voucherIds: number[] }) => {
      const results: Array<VoucherBatchResult<{ document: VoucherDocumentInfo | null }>> =
        await Promise.all(
          params.voucherIds.map(async (voucherId) => {
            try {
              const document = await getVoucherDocumentInfoInternal(client, voucherId);
              return { voucherId, ok: true, data: { document }, errors: [], warnings: [] };
            } catch (error) {
              return {
                voucherId,
                ok: false,
                errors: [
                  createIssue(
                    "DOCUMENT_INFO_READ_FAILED",
                    `Voucher document info could not be loaded: ${getErrorMessage(error)}`
                  ),
                ],
                warnings: [],
              };
            }
          })
        );
      return {
        ok: results.every((result) => result.ok),
        results,
      };
    },
  },

  get_voucher_original_pdf: {
    description:
      "Read-only PDF-first tool that returns the original voucher PDF as base64 for Claude/Cowork review. " +
      "The MCP downloads GET /Export/voucherZip, decodes and unpacks ZIP payloads server-side, then matches the PDF deterministically. " +
      "If voucherZip retrieval fails, /Document/{documentId} is used as explicit fallback with warnings. " +
      "On failure, a structured error object is returned with a specific error code: " +
      "VOUCHER_NO_DOCUMENT (no document attached), ZIP_NO_CONTENT (no usable ZIP payload), " +
      "ZIP_NO_MATCH (no entry matched the document), ZIP_AMBIGUOUS_MATCH (multiple candidates), " +
      "ZIP_MATCH_NOT_PDF (matched entry is not a PDF), FALLBACK_NOT_PDF (fallback content is not a PDF — document is likely an image), " +
      "FALLBACK_FAILED (fallback request itself failed).",
    inputSchema: z.object({
      voucherId: z.number().int().positive().describe("The ID of the voucher"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) => {
      try {
        const data = await downloadVoucherOriginalPdfInternal(client, params.voucherId);
        return { ok: true as const, voucherId: params.voucherId, data, errors: [], warnings: [] };
      } catch (error) {
        return {
          ok: false as const,
          voucherId: params.voucherId,
          data: null,
          errors: buildPdfRetrievalErrors(error),
          warnings: [],
        };
      }
    },
  },

  get_voucher_original_pdf_batch: {
    description:
      "Read-only batch variant of get_voucher_original_pdf. Returns PDF-first original PDF payloads for up to 20 vouchers. " +
      "Per-voucher errors are returned in result items with specific error codes; top-level ok=false when at least one voucher fails.",
    inputSchema: z.object({
      voucherIds: z.array(z.number().int().positive()).min(1).max(20),
    }),
    handler: async (client: SevdeskClient, params: { voucherIds: number[] }) => {
      const results: Array<VoucherBatchResult<VoucherOriginalPdfResult>> = await Promise.all(
        params.voucherIds.map(async (voucherId) => {
          try {
            const data = await downloadVoucherOriginalPdfInternal(client, voucherId);
            return { voucherId, ok: true, data, errors: [], warnings: [] };
          } catch (error) {
            return {
              voucherId,
              ok: false,
              errors: buildPdfRetrievalErrors(error),
              warnings: [],
            };
          }
        })
      );
      return {
        ok: results.every((result) => result.ok),
        results,
      };
    },
  },

  check_and_extract_einvoice: {
    description:
      "Read-only helper that checks whether a voucher document contains a ZUGFeRD/XRechnung e-invoice and, if so, returns the extracted XML payload.",
    inputSchema: z.object({
      voucherId: z.number().describe("The ID of the voucher"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number }) =>
      checkAndExtractEInvoiceInternal(client, params.voucherId),
  },

  check_and_extract_einvoice_batch: {
    description:
      "Read-only batch helper for e-invoice extraction. Voucher-level read failures are returned per result; a missing XML payload is reported softly inside data.",
    inputSchema: z.object({
      voucherIds: z.array(z.number().int().positive()).min(1).max(50),
    }),
    handler: async (client: SevdeskClient, params: { voucherIds: number[] }) => {
      const results: Array<VoucherBatchResult<EInvoiceCheckResult>> = await Promise.all(
        params.voucherIds.map(async (voucherId) => {
          try {
            const data = await checkAndExtractEInvoiceInternal(client, voucherId);
            const warnings = data.isEinvoice || !data.error
              ? []
              : [createIssue("EINVOICE_READ_FAILED", data.error)];
            return { voucherId, ok: true, data, errors: [], warnings };
          } catch (error) {
            return {
              voucherId,
              ok: false,
              errors: [
                createIssue(
                  "VOUCHER_CONTEXT_READ_FAILED",
                  `Voucher or document could not be read: ${getErrorMessage(error)}`
                ),
              ],
              warnings: [],
            };
          }
        })
      );
      return {
        ok: results.every((result) => result.ok),
        results,
      };
    },
  },

  get_voucher_booking_context: {
    description:
      "Read-only booking context for one voucher. Hard-fails only if voucher header/positions are unreadable; e-invoice and image problems are returned as structured soft warnings.",
    inputSchema: z.object({
      voucherId: z.number().int().positive().describe("The ID of the voucher"),
      includeImage: z.boolean().optional().describe("Include voucher image data"),
    }),
    handler: async (client: SevdeskClient, params: { voucherId: number; includeImage?: boolean }) =>
      getVoucherBookingContextInternal(client, params.voucherId, params.includeImage),
  },

  get_voucher_booking_context_batch: {
    description:
      "Read-only batch booking context for vouchers. Each result contains voucher header, positions and soft auxiliary-read warnings where possible.",
    inputSchema: z.object({
      voucherIds: z.array(z.number().int().positive()).min(1).max(50),
      includeImage: z.boolean().optional(),
    }),
    handler: async (client: SevdeskClient, params: { voucherIds: number[]; includeImage?: boolean }) => {
      const results: Array<VoucherBatchResult<VoucherBookingContextResult>> = await Promise.all(
        params.voucherIds.map(async (voucherId) => {
          try {
            const data = await getVoucherBookingContextInternal(client, voucherId, params.includeImage);
            return { voucherId, ok: true, data, errors: [], warnings: data.warnings };
          } catch (error) {
            return {
              voucherId,
              ok: false,
              errors: [
                createIssue(
                  "VOUCHER_CONTEXT_READ_FAILED",
                  `Voucher header or positions could not be loaded: ${getErrorMessage(error)}`
                ),
              ],
              warnings: [],
            };
          }
        })
      );
      return {
        ok: results.every((result) => result.ok),
        results,
      };
    },
  },

  validate_voucher_booking_plan: {
    description:
      "Read-only validator for sevDesk Update 2.0 voucher booking plans. Performs strict amount checks and can optionally enrich the result with ReceiptGuidance validation.",
    inputSchema: z.object({
      voucherId: z.number().int().positive(),
      supplierName: z.string().optional(),
      taxRuleId: z.number().int().positive().optional(),
      voucherDate: z.string().optional().describe("Optional voucher date update (prefer YYYY-MM-DD)"),
      description: z.string().optional(),
      expectedTotalGross: z.number().optional(),
      checkReceiptGuidance: z.boolean().optional(),
      positions: z.array(z.object({
        voucherPosIdToReuse: z.number().int().positive().optional(),
        accountDatevId: z.number().int().positive(),
        accountDatevObjectName: z.literal("AccountDatev").optional(),
        taxRate: z.number(),
        sumNet: z.number(),
        sumGross: z.number().optional(),
        comment: z.string(),
        isAsset: z.boolean().optional(),
        assetUsefulLife: z.number().optional().describe("Useful life in months for asset positions"),
        specialAccountingField3: z.string().optional(),
        cateringTip: z.number().optional(),
      })).min(1),
    }),
    handler: async (
      client: SevdeskClient,
      params: VoucherBookingPlan & { checkReceiptGuidance?: boolean }
    ) => {
      const validation = validateBookingPlanInternal(params);
      const receiptGuidance = params.checkReceiptGuidance
        ? await validateReceiptGuidanceForPlan(client, validation)
        : {
            checked: false,
            mode: "forExpense" as const,
            errors: [],
            warnings: [],
            matches: [],
          };

      return {
        ...validation,
        errors: [...validation.errors, ...receiptGuidance.errors],
        warnings: [...validation.warnings, ...receiptGuidance.warnings],
        receiptGuidance,
      };
    },
  },

  apply_voucher_booking_plan: {
    description:
      "High-level write tool for sevDesk Update 2.0 expense booking. Loads the current voucher, validates the target plan, optionally checks ReceiptGuidance, applies consistent header/position changes, and returns the final state.",
    inputSchema: z.object({
      voucherId: z.number().int().positive(),
      supplierName: z.string().optional().describe("Optional supplier name update for the voucher header"),
      taxRuleId: z.number().int().positive().optional().describe("Explicit sevDesk Update 2.0 taxRule ID"),
      voucherDate: z.string().optional().describe("Optional voucher date update (prefer YYYY-MM-DD)"),
      description: z.string().optional().describe("Optional voucher description update"),
      expectedTotalGross: z.number().describe("Expected gross total of all final positions"),
      dryRun: z.boolean().optional().describe("Validate and plan changes without writing anything"),
      deleteSurplusPositions: z.boolean().optional().describe(
        "Delete existing voucher positions that are not reused by the final plan"
      ),
      positions: z.array(z.object({
        voucherPosIdToReuse: z.number().int().positive().optional(),
        accountDatevId: z.number().int().positive(),
        accountDatevObjectName: z.literal("AccountDatev").optional(),
        taxRate: z.number(),
        sumNet: z.number(),
        sumGross: z.number().optional(),
        comment: z.string(),
        isAsset: z.boolean().optional(),
        assetUsefulLife: z.number().optional().describe("Useful life in months for asset positions"),
        specialAccountingField3: z.string().optional(),
        cateringTip: z.number().optional(),
      })).min(1),
    }),
    handler: async (
      client: SevdeskClient,
      params: VoucherBookingPlan & { dryRun?: boolean; deleteSurplusPositions?: boolean }
    ) => applyVoucherBookingPlanInternal(client, params),
  },

};
