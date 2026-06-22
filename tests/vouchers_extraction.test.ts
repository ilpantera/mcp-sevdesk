import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  voucherTools,
  parseInvoiceDateString,
  extractFactsFromPlainText,
  decodeAndUnpackVoucherZipPayload,
  pickVoucherZipEntryForDocument,
} from "../src/tools/vouchers.js";
import type { SevdeskClient } from "../src/client.js";

// ---------------------------------------------------------------------------
// Mock tesseract.js to avoid network language-data downloads during tests.
// Individual tests override recognize() to simulate OCR success or failure.
// ---------------------------------------------------------------------------
import { createWorker as _createWorker } from "tesseract.js";
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(),
}));
const mockedCreateWorker = vi.mocked(_createWorker);

/** Configure the OCR mock to return the given text for one call. */
function mockOcrReturns(text: string): void {
  mockedCreateWorker.mockResolvedValueOnce({
    recognize: vi.fn().mockResolvedValue({ data: { text } }),
    terminate: vi.fn().mockResolvedValue(undefined),
  } as unknown as Awaited<ReturnType<typeof _createWorker>>);
}

/** Configure the OCR mock to throw (simulates a hard OCR error). */
function mockOcrThrows(message: string): void {
  mockedCreateWorker.mockRejectedValueOnce(new Error(message));
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * A real multi-page PDF with a text layer (committed as a test fixture).
 * pdf-parse can extract meaningful text from this file.
 */
function loadRealPdfWithText(): Buffer {
  return readFileSync(join(__dirname, "fixtures/sample-text.pdf"));
}

/** PDF with no text (simulates a scanned image PDF) */
function makePdfWithoutText(): Buffer {
  const pdf = ["%PDF-1.4", "1 0 obj", "<< /Type /Catalog >>", "endobj", "%%EOF"].join("\n");
  return Buffer.from(pdf, "utf8");
}

/** Minimal JPEG header bytes */
function makeJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
}

/**
 * A minimal but complete JPEG with both SOI (FF D8 FF) and EOI (FF D9) markers.
 * extractFirstJpegFromPdf() requires both markers to extract the image.
 */
function makeCompleteJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, // SOI + APP0 marker
    0x00, 0x10,             // APP0 length
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01,             // version
    0x00,                   // aspect ratio units
    0x00, 0x01, 0x00, 0x01, // pixel aspect ratio
    0x00, 0x00,             // thumbnail dimensions
    0xff, 0xd9,             // EOI
  ]);
}

/** A minimal PDF that embeds a complete JPEG image – simulates a phone-scanner PDF. */
function makePdfWithEmbeddedJpeg(): Buffer {
  const jpeg = makeCompleteJpeg();
  const prefix = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Filter /DCTDecode >>\nstream\n", "utf8");
  const suffix = Buffer.from("\nendstream\nendobj\n%%EOF", "utf8");
  return Buffer.concat([prefix, jpeg, suffix]);
}

/** Minimal PNG header bytes */
function makePngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/** Convert a Buffer to the ArrayBuffer slice that the sevDesk client returns for document downloads. */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * Minimal ZIP builder for unit tests:
 * - creates only local file headers (no central directory)
 * - uses STORE compression (method 0) only
 * This is sufficient for testing the local-header parser used by voucherZip fallback logic.
 */
function makeZipWithStoreCompression(entries: Array<{ fileName: string; bytes: Buffer }>): Buffer {
  return Buffer.concat(
    entries.map(({ fileName, bytes }) => {
      const nameBytes = Buffer.from(fileName, "utf8");
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); // local file header signature
      header.writeUInt16LE(20, 4); // version needed
      header.writeUInt16LE(0, 6); // flags
      header.writeUInt16LE(0, 8); // compression method (stored)
      header.writeUInt16LE(0, 10); // mod time
      header.writeUInt16LE(0, 12); // mod date
      header.writeUInt32LE(0, 14); // crc32 (not validated by parser)
      header.writeUInt32LE(bytes.length, 18); // compressed size
      header.writeUInt32LE(bytes.length, 22); // uncompressed size
      header.writeUInt16LE(nameBytes.length, 26); // file name length
      header.writeUInt16LE(0, 28); // extra length
      return Buffer.concat([header, nameBytes, bytes]);
    })
  );
}

function buildGetMock(documentId: number, documentBytes: Buffer) {
  return vi.fn().mockImplementation((path: string) => {
    if (path === "/Voucher/{voucherId}") {
      return Promise.resolve({
        data: { objects: [{ id: 1, document: { id: documentId, objectName: "Document" } }] },
        error: undefined,
      });
    }
    if (path === "/Document/{documentId}") {
      return Promise.resolve({
        data: toArrayBuffer(documentBytes),
        error: undefined,
      });
    }
    return Promise.resolve({ data: undefined, error: `Unexpected path: ${path}` });
  });
}

// ---------------------------------------------------------------------------
// extract_voucher_document_text
// ---------------------------------------------------------------------------

describe("extract_voucher_document_text", () => {
  it("extracts text from a PDF with a text layer", async () => {
    const pdfBytes = loadRealPdfWithText();
    const GET = buildGetMock(42, pdfBytes);

    const result = await voucherTools.extract_voucher_document_text.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.voucherId).toBe(1);
    expect(result.documentId).toBe(42);
    expect(result.source).toBe("pdf-text");
    expect(result.text.length).toBeGreaterThan(20);
    expect(result.pages).toBeGreaterThan(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns source=none with warning for PDF with no text layer", async () => {
    const pdfBytes = makePdfWithoutText();
    const GET = buildGetMock(55, pdfBytes);

    const result = await voucherTools.extract_voucher_document_text.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.voucherId).toBe(1);
    expect(result.documentId).toBe(55);
    expect(result.source).toBe("none");
    expect(result.text).toBe("");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/no text layer|text extraction/i);
  });

  it("returns source=none with OCR warning for JPEG document when OCR yields no text", async () => {
    mockOcrReturns(""); // OCR produces nothing → source stays "none"
    const GET = buildGetMock(77, makeJpegBuffer());

    const result = await voucherTools.extract_voucher_document_text.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toBe("none");
    expect(result.text).toBe("");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => /ocr|image/i.test(w))).toBe(true);
  });

  it("returns source=ocr with text for JPEG document when OCR succeeds", async () => {
    const ocrText = "Lieferant GmbH\nRechnungsnummer: RE-2024-001\nGesamtbetrag 119,00 EUR";
    mockOcrReturns(ocrText);
    const GET = buildGetMock(77, makeJpegBuffer());

    const result = await voucherTools.extract_voucher_document_text.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toBe("ocr");
    expect(result.text).toBe(ocrText);
    expect(result.pages).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns source=none with OCR warning for PNG document when OCR yields no text", async () => {
    mockOcrReturns(""); // OCR produces nothing
    const GET = buildGetMock(78, makePngBuffer());

    const result = await voucherTools.extract_voucher_document_text.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toBe("none");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns source=ocr for scanned PDF with embedded JPEG when OCR succeeds", async () => {
    const ocrText = "Lieferant GmbH\nRechnungsnummer: RE-2024-099\nGesamtbetrag 238,00 EUR";
    mockOcrReturns(ocrText);
    const GET = buildGetMock(56, makePdfWithEmbeddedJpeg());

    const result = await voucherTools.extract_voucher_document_text.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toBe("ocr");
    expect(result.text).toBe(ocrText);
    // pdf-parse fails on this synthetic PDF, so the PDF-related warning (either parse failure
    // or "no text layer") should still be present alongside the successful OCR result
    expect(result.warnings.some((w) => /pdf|text layer|extraction failed/i.test(w))).toBe(true);
  });

  it("returns source=none with warning when OCR throws a hard error", async () => {
    mockOcrThrows("WASM init failed");
    const GET = buildGetMock(79, makeJpegBuffer());

    const result = await voucherTools.extract_voucher_document_text.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toBe("none");
    expect(result.warnings.some((w) => /OCR failed/i.test(w))).toBe(true);
  });

  it("throws when voucher has no document attached", async () => {
    const GET = vi.fn().mockResolvedValueOnce({
      data: { objects: [{ id: 1 }] },
      error: undefined,
    });

    await expect(
      voucherTools.extract_voucher_document_text.handler(
        { GET } as unknown as SevdeskClient,
        { voucherId: 1 }
      )
    ).rejects.toThrow("no document attached");
  });

  it("falls back to Export/voucherZip when direct document download fails", async () => {
    const pdfBytes = loadRealPdfWithText();
    const zipBytes = makeZipWithStoreCompression([{ fileName: "exports/a1b2c3d4e5.pdf", bytes: pdfBytes }]);
    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 1, document: { id: 42, objectName: "Document" } }] },
          error: undefined,
        });
      }
      if (path === "/Document/{documentId}") {
        return Promise.resolve({ data: undefined, error: { message: "forbidden" } });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        // sevDesk preview mimeType can be image/* while originMimeType stays the uploaded PDF type.
        return Promise.resolve({
          data: { objects: { filename: "a1b2c3d4e5.pdf", originMimeType: "application/pdf", mimeType: "image/jpeg" } },
          error: undefined,
        });
      }
      if (path === "/Export/voucherZip") {
        return Promise.resolve({
          data: {
            objects: {
              filename: "Belege.zip",
              mimetype: "application/zip",
              base64Encoded: true,
              content: zipBytes.toString("base64"),
            },
          },
          error: undefined,
        });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.extract_voucher_document_text.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toBe("pdf-text");
    expect(result.text.length).toBeGreaterThan(20);
    expect(result.warnings.some((warning) => warning.includes("Document loaded via Export/voucherZip fallback"))).toBe(
      true
    );
  });

  it("throws when Export/voucherZip request fails during fallback", async () => {
    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 1, document: { id: 42, objectName: "Document" } }] },
          error: undefined,
        });
      }
      if (path === "/Document/{documentId}") {
        return Promise.resolve({ data: undefined, error: { message: "forbidden" } });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        return Promise.resolve({
          data: { objects: { filename: "a1b2c3d4e5.pdf", originMimeType: "application/pdf", mimeType: "image/jpeg" } },
          error: undefined,
        });
      }
      if (path === "/Export/voucherZip") {
        return Promise.resolve({ data: undefined, error: { message: "export failed" } });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    await expect(
      voucherTools.extract_voucher_document_text.handler(
        { GET } as unknown as SevdeskClient,
        { voucherId: 1 }
      )
    ).rejects.toThrow(/Export\/voucherZip request failed/i);
  });

  it("throws when voucherZip fallback cannot map a file deterministically", async () => {
    const zipBytes = makeZipWithStoreCompression([{ fileName: "exports/not-matching.pdf", bytes: Buffer.from("dummy") }]);
    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 1, document: { id: 42, objectName: "Document" } }] },
          error: undefined,
        });
      }
      if (path === "/Document/{documentId}") {
        return Promise.resolve({ data: undefined, error: { message: "forbidden" } });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        return Promise.resolve({
          data: { objects: { filename: "a1b2c3d4e5.pdf", originMimeType: "application/pdf", mimeType: "image/jpeg" } },
          error: undefined,
        });
      }
      if (path === "/Export/voucherZip") {
        return Promise.resolve({
          data: { objects: { content: zipBytes.toString("base64"), base64Encoded: true } },
          error: undefined,
        });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    await expect(
      voucherTools.extract_voucher_document_text.handler(
        { GET } as unknown as SevdeskClient,
        { voucherId: 1 }
      )
    ).rejects.toThrow(/No ZIP entry matched voucher document filename/i);
  });
});

// ---------------------------------------------------------------------------
// extract_voucher_document_text_batch
// ---------------------------------------------------------------------------

describe("extract_voucher_document_text_batch", () => {
  it("returns ok:false per result when document download fails", async () => {
    const GET = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await voucherTools.extract_voucher_document_text_batch.handler(
      { GET } as unknown as SevdeskClient,
      { voucherIds: [10] }
    );

    expect(result.ok).toBe(false);
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].errors[0].code).toBe("DOCUMENT_TEXT_EXTRACTION_FAILED");
  });

  it("processes multiple vouchers and returns combined ok status", async () => {
    const pdfBytes1 = loadRealPdfWithText();
    const pdfBytes2 = makePdfWithoutText();

    let callIndex = 0;
    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        callIndex++;
        const docId = callIndex <= 1 ? 101 : 102;
        return Promise.resolve({
          data: { objects: [{ id: callIndex, document: { id: docId, objectName: "Document" } }] },
          error: undefined,
        });
      }
      if (path === "/Document/{documentId}") {
        const bytes = callIndex <= 1 ? pdfBytes1 : pdfBytes2;
        return Promise.resolve({ data: toArrayBuffer(bytes), error: undefined });
      }
      return Promise.resolve({ data: undefined, error: "unexpected" });
    });

    const result = await voucherTools.extract_voucher_document_text_batch.handler(
      { GET } as unknown as SevdeskClient,
      { voucherIds: [1, 2] }
    );

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Parsing helpers (exported via voucherTools for integration testing)
// ---------------------------------------------------------------------------

describe("extract_voucher_facts – e-invoice path (ZUGFeRD)", () => {
  const zugferdXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ' +
    'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" ' +
    'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">' +
    "<rsm:ExchangedDocument>" +
    "<ram:ID>RE-2024-001</ram:ID>" +
    "<ram:IssueDateTime><udt:DateTimeString format=\"102\">20240115</udt:DateTimeString></ram:IssueDateTime>" +
    "</rsm:ExchangedDocument>" +
    "<rsm:SupplyChainTradeTransaction>" +
    "<ram:ApplicableHeaderTradeAgreement>" +
    "<ram:SellerTradeParty><ram:Name>Lieferant GmbH</ram:Name></ram:SellerTradeParty>" +
    "</ram:ApplicableHeaderTradeAgreement>" +
    "<ram:ApplicableHeaderTradeSettlement>" +
    "<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>" +
    "<ram:SpecifiedTradeSettlementHeaderMonetarySummation>" +
    "<ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>" +
    "<ram:TaxTotalAmount>19.00</ram:TaxTotalAmount>" +
    "<ram:GrandTotalAmount>119.00</ram:GrandTotalAmount>" +
    "</ram:SpecifiedTradeSettlementHeaderMonetarySummation>" +
    "</ram:ApplicableHeaderTradeSettlement>" +
    "</rsm:SupplyChainTradeTransaction>" +
    "</rsm:CrossIndustryInvoice>";

  function buildPdfWithZUGFeRD(): Buffer {
    const streamStr = `<< /Type /EmbeddedFile /Subtype /text#2Fxml >>\nstream\n${zugferdXml}\nendstream`;
    const pdf = `%PDF-1.4\n1 0 obj\n${streamStr}\nendobj\n%%EOF`;
    return Buffer.from(pdf, "utf8");
  }

  it("extracts supplier, invoiceNumber, invoiceDate, currency, and totals from ZUGFeRD", async () => {
    const pdfBytes = buildPdfWithZUGFeRD();
    const GET = buildGetMock(99, pdfBytes);

    const result = await voucherTools.extract_voucher_facts.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toMatch(/einvoice|mixed/);
    expect(result.supplier).toBe("Lieferant GmbH");
    expect(result.invoiceNumber).toBe("RE-2024-001");
    expect(result.invoiceDate).toBe("2024-01-15");
    expect(result.currency).toBe("EUR");
    expect(result.totals.net).toBeCloseTo(100);
    expect(result.totals.tax).toBeCloseTo(19);
    expect(result.totals.gross).toBeCloseTo(119);
  });
});

describe("extract_voucher_facts – text heuristic path", () => {
  it("returns source=pdf-text for a real PDF with text (and no e-invoice)", async () => {
    const pdfBytes = loadRealPdfWithText();
    const GET = buildGetMock(88, pdfBytes);

    const result = await voucherTools.extract_voucher_facts.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toBe("pdf-text");
  });

  it("returns nulls and warnings when PDF has no text layer", async () => {
    const pdfBytes = makePdfWithoutText();
    const GET = buildGetMock(33, pdfBytes);

    const result = await voucherTools.extract_voucher_facts.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toBe("none");
    expect(result.supplier).toBeNull();
    expect(result.invoiceNumber).toBeNull();
    expect(result.invoiceDate).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns nulls and warnings for image documents when OCR yields no text", async () => {
    mockOcrReturns(""); // OCR produces nothing → no facts can be extracted
    const GET = buildGetMock(34, makeJpegBuffer());

    const result = await voucherTools.extract_voucher_facts.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toBe("none");
    expect(result.supplier).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns source=ocr with extracted facts for image document when OCR succeeds", async () => {
    const ocrText = "Lieferant GmbH\nRechnungsnummer: RE-2024-007\nRechnungsdatum: 15.01.2024\nGesamtbetrag 119,00 EUR";
    mockOcrReturns(ocrText);
    const GET = buildGetMock(35, makeJpegBuffer());

    const result = await voucherTools.extract_voucher_facts.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.source).toBe("ocr");
    expect(result.supplier).toContain("GmbH");
    expect(result.invoiceNumber).toBe("RE-2024-007");
    expect(result.currency).toBe("EUR");
    expect(result.totals.gross).toBeCloseTo(119);
  });
});

// ---------------------------------------------------------------------------
// parseInvoiceDateString unit tests
// ---------------------------------------------------------------------------

describe("parseInvoiceDateString", () => {
  it("parses ZUGFeRD compact date 20240115 → 2024-01-15", () => {
    expect(parseInvoiceDateString("20240115")).toBe("2024-01-15");
  });

  it("passes through ISO date 2024-01-15 unchanged", () => {
    expect(parseInvoiceDateString("2024-01-15")).toBe("2024-01-15");
  });

  it("parses German date 15.01.2024 → 2024-01-15", () => {
    expect(parseInvoiceDateString("15.01.2024")).toBe("2024-01-15");
  });

  it("parses slash date 15/01/2024 → 2024-01-15", () => {
    expect(parseInvoiceDateString("15/01/2024")).toBe("2024-01-15");
  });

  it("returns null for unrecognized format", () => {
    expect(parseInvoiceDateString("not-a-date")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseInvoiceDateString(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractFactsFromPlainText unit tests
// ---------------------------------------------------------------------------

describe("extractFactsFromPlainText", () => {
  const sampleInvoiceText = [
    "Muster GmbH",
    "Musterstraße 1, 12345 Musterstadt",
    "",
    "Rechnungsnummer: RE-2024-007",
    "Rechnungsdatum: 15.01.2024",
    "",
    "Nettobetrag 84,03 EUR",
    "MwSt. 19% 15,97 EUR",
    "Gesamtbetrag 100,00 EUR",
  ].join("\n");

  it("extracts invoice number from Rechnungsnummer pattern", () => {
    const result = extractFactsFromPlainText(sampleInvoiceText);
    expect(result.invoiceNumber).toBe("RE-2024-007");
  });

  it("extracts and normalises invoice date", () => {
    const result = extractFactsFromPlainText(sampleInvoiceText);
    expect(result.invoiceDate).toBe("2024-01-15");
  });

  it("detects EUR currency", () => {
    const result = extractFactsFromPlainText(sampleInvoiceText);
    expect(result.currency).toBe("EUR");
  });

  it("extracts gross total", () => {
    const result = extractFactsFromPlainText(sampleInvoiceText);
    expect(result.totals?.gross).toBeCloseTo(100);
  });

  it("extracts net total", () => {
    const result = extractFactsFromPlainText(sampleInvoiceText);
    expect(result.totals?.net).toBeCloseTo(84.03);
  });

  it("extracts supplier from company line", () => {
    const result = extractFactsFromPlainText(sampleInvoiceText);
    expect(result.supplier).toContain("GmbH");
  });

  it("returns nulls and warnings for too-short text", () => {
    const result = extractFactsFromPlainText("Hi");
    expect(result.invoiceNumber).toBeNull();
    expect(result.invoiceDate).toBeNull();
    expect(result.warnings?.length).toBeGreaterThan(0);
  });
});

describe("extract_voucher_facts_batch", () => {
  it("returns ok:false per result when extraction fails", async () => {
    const GET = vi.fn().mockRejectedValue(new Error("timeout"));

    const result = await voucherTools.extract_voucher_facts_batch.handler(
      { GET } as unknown as SevdeskClient,
      { voucherIds: [5] }
    );

    expect(result.ok).toBe(false);
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].errors[0].code).toBe("DOCUMENT_TEXT_EXTRACTION_FAILED");
  });

  describe("voucherZip helpers", () => {
    it("decodes and unpacks base64 ZIP content", () => {
      const zipBytes = makeZipWithStoreCompression([
        { fileName: "one.pdf", bytes: Buffer.from("%PDF-1.4\n%%EOF", "utf8") },
        { fileName: "two.txt", bytes: Buffer.from("hello", "utf8") },
      ]);

      const result = decodeAndUnpackVoucherZipPayload({
        objects: { content: zipBytes.toString("base64"), base64Encoded: true },
      });

      expect(result.entries.map((entry) => entry.fileName)).toEqual(["one.pdf", "two.txt"]);
      expect(result.warnings).toHaveLength(0);
    });

    it("returns explicit warning when deterministic filename mapping is impossible", () => {
      const entries = [
        { fileName: "a/receipt.pdf", bytes: Buffer.from("1") },
        { fileName: "b/receipt.pdf", bytes: Buffer.from("2") },
      ];
      const result = pickVoucherZipEntryForDocument(entries, 99, "receipt.pdf");

      expect(result.entry).toBeNull();
      expect(result.warnings[0]).toMatch(/Multiple ZIP entries matched basename/i);
    });

    it("throws for missing ZIP base64 content", () => {
      expect(() => decodeAndUnpackVoucherZipPayload({ objects: { content: "   " } })).toThrow(
        /did not return a base64 content payload/i
      );
    });

    it("throws for invalid ZIP base64 content", () => {
      expect(() => decodeAndUnpackVoucherZipPayload({ objects: { content: "***not-base64***" } })).toThrow(
        /not valid base64/i
      );
    });
  });
});
