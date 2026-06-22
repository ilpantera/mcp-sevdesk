import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeAndUnpackVoucherZipPayload,
  pickVoucherZipEntryForDocument,
  voucherTools,
} from "../src/tools/vouchers.js";
import type { SevdeskClient } from "../src/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadRealPdfWithText(): Buffer {
  return readFileSync(join(__dirname, "fixtures/sample-text.pdf"));
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makeZipWithStoreCompression(entries: Array<{ fileName: string; bytes: Buffer }>): Buffer {
  return Buffer.concat(
    entries.map(({ fileName, bytes }) => {
      const nameBytes = Buffer.from(fileName, "utf8");
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0, 6);
      header.writeUInt16LE(0, 8);
      header.writeUInt32LE(bytes.length, 18);
      header.writeUInt32LE(bytes.length, 22);
      header.writeUInt16LE(nameBytes.length, 26);
      return Buffer.concat([header, nameBytes, bytes]);
    })
  );
}

describe("voucherZip helpers", () => {
  it("decodes and unpacks base64 export payload", () => {
    const pdfBytes = loadRealPdfWithText();
    const zipBytes = makeZipWithStoreCompression([{ fileName: "exports/a1b2.pdf", bytes: pdfBytes }]);

    const result = decodeAndUnpackVoucherZipPayload({
      objects: { content: zipBytes.toString("base64"), base64Encoded: true },
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].fileName).toBe("exports/a1b2.pdf");
    expect(result.entries[0].bytes.equals(pdfBytes)).toBe(true);
  });

  it("fails deterministic matching when basename is ambiguous", () => {
    const { entry, warnings } = pickVoucherZipEntryForDocument(
      [
        { fileName: "one/a1b2.pdf", bytes: Buffer.from("x") },
        { fileName: "two/a1b2.pdf", bytes: Buffer.from("y") },
      ],
      42,
      "a1b2.pdf"
    );

    expect(entry).toBeNull();
    expect(warnings[0]).toMatch(/Multiple ZIP entries matched basename/i);
  });

  it("matches by documentId token when filename is unavailable", () => {
    const { entry, warnings } = pickVoucherZipEntryForDocument(
      [
        { fileName: "exports/147848515.pdf", bytes: Buffer.from("x") },
        { fileName: "exports/other.pdf", bytes: Buffer.from("y") },
      ],
      147848515,
      null
    );

    expect(entry?.fileName).toBe("exports/147848515.pdf");
    expect(warnings[0]).toMatch(/Matched ZIP entry by documentId token/i);
  });
});

describe("get_voucher_original_pdf", () => {
  it("uses Export/voucherZip as primary retrieval path", async () => {
    const pdfBytes = loadRealPdfWithText();
    const zipBytes = makeZipWithStoreCompression([{ fileName: "exports/a1b2c3d4e5.pdf", bytes: pdfBytes }]);

    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 1, document: { id: 42, objectName: "Document" } }] },
          error: undefined,
        });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        return Promise.resolve({
          data: { objects: { filename: "a1b2c3d4e5.pdf", originMimeType: "application/pdf", mimeType: "image/jpeg" } },
          error: undefined,
        });
      }
      if (path === "/Export/voucherZip") {
        return Promise.resolve({ data: { objects: { content: zipBytes.toString("base64"), base64Encoded: true } }, error: undefined });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.get_voucher_original_pdf.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.ok).toBe(true);
    expect(result.data?.source).toBe("voucherZip");
    expect(Buffer.from(result.data!.contentBase64, "base64").equals(pdfBytes)).toBe(true);
    expect(result.data?.warnings.some((warning) => warning.includes("Export/voucherZip primary path"))).toBe(true);
  });

  it("falls back to /Document when voucherZip retrieval fails", async () => {
    const pdfBytes = loadRealPdfWithText();
    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 1, document: { id: 42, objectName: "Document" } }] },
          error: undefined,
        });
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
      if (path === "/Document/{documentId}") {
        return Promise.resolve({ data: toArrayBuffer(pdfBytes), error: undefined });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.get_voucher_original_pdf.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.ok).toBe(true);
    expect(result.data?.source).toBe("document-download-fallback");
    expect(result.data?.warnings[0]).toMatch(/Export\/voucherZip primary retrieval failed/i);
  });

  it("returns ZIP_NO_MATCH + FALLBACK_NOT_PDF when voucherZip has no matching PDF entry for the document and fallback is an image", async () => {
    // Real-world case: hasPdf=false, document is an image; voucherZip ZIP contains no matching PDF entry
    const zipBytes = makeZipWithStoreCompression([{ fileName: "exports/a1b2c3d4e5.pdf", bytes: Buffer.from("not-pdf") }]);
    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 1, document: { id: 42, objectName: "Document" } }] },
          error: undefined,
        });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        return Promise.resolve({
          data: { objects: { filename: "a1b2c3d4e5.jpg", originMimeType: "image/jpeg", mimeType: "image/jpeg" } },
          error: undefined,
        });
      }
      if (path === "/Export/voucherZip") {
        return Promise.resolve({ data: { objects: { content: zipBytes.toString("base64"), base64Encoded: true } }, error: undefined });
      }
      if (path === "/Document/{documentId}") {
        return Promise.resolve({ data: toArrayBuffer(Buffer.from("JFIF\x00still-an-image")), error: undefined });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.get_voucher_original_pdf.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.ok).toBe(false);
    // Both errors surfaced: voucherZip cause (ZIP_NO_MATCH) and fallback failure (FALLBACK_NOT_PDF)
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].code).toBe("ZIP_NO_MATCH");
    expect(result.errors[1].code).toBe("FALLBACK_NOT_PDF");
    expect(result.errors[1].message).toMatch(/failed PDF format validation.*image/i);
  });

  it("returns FALLBACK_FAILED when fallback request itself fails", async () => {
    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 1, document: { id: 42, objectName: "Document" } }] },
          error: undefined,
        });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        return Promise.resolve({
          data: { objects: { filename: "doc.pdf", originMimeType: "application/pdf", mimeType: "image/jpeg" } },
          error: undefined,
        });
      }
      if (path === "/Export/voucherZip") {
        return Promise.resolve({ data: undefined, error: { message: "zip failed" } });
      }
      if (path === "/Document/{documentId}") {
        return Promise.resolve({ data: undefined, error: { message: "document 403 forbidden" } });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.get_voucher_original_pdf.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("FALLBACK_FAILED");
    expect(result.errors[0].message).toMatch(/fallback.*also failed/i);
  });

  it("returns VOUCHER_NO_DOCUMENT when voucher has no document attached", async () => {
    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 1 }] }, // no document field
          error: undefined,
        });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.get_voucher_original_pdf.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("VOUCHER_NO_DOCUMENT");
  });

  it("returns ZIP_MATCH_NOT_PDF + FALLBACK_NOT_PDF when ZIP entry is found but not a PDF and fallback is also not a PDF", async () => {
    const zipBytes = makeZipWithStoreCompression([{ fileName: "exports/a1b2c3d4e5.pdf", bytes: Buffer.from("not-a-pdf") }]);
    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 1, document: { id: 42, objectName: "Document" } }] },
          error: undefined,
        });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        return Promise.resolve({
          data: { objects: { filename: "a1b2c3d4e5.pdf", originMimeType: "application/pdf", mimeType: "image/jpeg" } },
          error: undefined,
        });
      }
      if (path === "/Export/voucherZip") {
        return Promise.resolve({ data: { objects: { content: zipBytes.toString("base64"), base64Encoded: true } }, error: undefined });
      }
      if (path === "/Document/{documentId}") {
        return Promise.resolve({ data: toArrayBuffer(Buffer.from("still-not-pdf")), error: undefined });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.get_voucher_original_pdf.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.ok).toBe(false);
    // Both errors are surfaced: voucherZip cause and the final fallback failure
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].code).toBe("ZIP_MATCH_NOT_PDF");
    expect(result.errors[0].message).toMatch(/failed PDF format validation/i);
    expect(result.errors[1].code).toBe("FALLBACK_NOT_PDF");
    expect(result.errors[1].message).toMatch(/failed PDF format validation.*image/i);
  });

  it("returns ZIP_NO_CONTENT + FALLBACK_NOT_PDF when voucherZip returns empty content and fallback is also not a PDF", async () => {
    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 1, document: { id: 42, objectName: "Document" } }] },
          error: undefined,
        });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        return Promise.resolve({
          data: { objects: { filename: "doc.pdf", originMimeType: "application/pdf", mimeType: "image/jpeg" } },
          error: undefined,
        });
      }
      if (path === "/Export/voucherZip") {
        // Simulates download=false with content: null
        return Promise.resolve({ data: { objects: { content: null, base64Encoded: true } }, error: undefined });
      }
      if (path === "/Document/{documentId}") {
        return Promise.resolve({ data: toArrayBuffer(Buffer.from("not-a-pdf")), error: undefined });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.get_voucher_original_pdf.handler(
      { GET } as unknown as SevdeskClient,
      { voucherId: 1 }
    );

    expect(result.ok).toBe(false);
    // Both errors are surfaced: voucherZip cause and the final fallback failure
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].code).toBe("ZIP_NO_CONTENT");
    expect(result.errors[0].message).toMatch(/did not return a base64 content payload/i);
    expect(result.errors[1].code).toBe("FALLBACK_NOT_PDF");
    expect(result.errors[1].message).toMatch(/failed PDF format validation.*image/i);
  });
});

describe("get_voucher_original_pdf_batch", () => {
  it("returns mixed success/failure entries with specific error codes per failure mode", async () => {
    const pdfBytes = loadRealPdfWithText();
    const zipBytes = makeZipWithStoreCompression([{ fileName: "exports/a1b2c3d4e5.pdf", bytes: pdfBytes }]);

    const GET = vi.fn().mockImplementation((path: string, options: { params?: { path?: { voucherId?: number } } }) => {
      const voucherId = options?.params?.path?.voucherId;
      if (path === "/Voucher/{voucherId}") {
        if (voucherId === 1) {
          return Promise.resolve({
            data: { objects: [{ id: 1, document: { id: 42, objectName: "Document" } }] },
            error: undefined,
          });
        }
        // voucher 2 has no document — should produce VOUCHER_NO_DOCUMENT
        return Promise.resolve({ data: { objects: [{ id: 2 }] }, error: undefined });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        return Promise.resolve({
          data: { objects: { filename: "a1b2c3d4e5.pdf", originMimeType: "application/pdf", mimeType: "image/jpeg" } },
          error: undefined,
        });
      }
      if (path === "/Export/voucherZip") {
        return Promise.resolve({ data: { objects: { content: zipBytes.toString("base64"), base64Encoded: true } }, error: undefined });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.get_voucher_original_pdf_batch.handler(
      { GET } as unknown as SevdeskClient,
      { voucherIds: [1, 2] }
    );

    expect(result.ok).toBe(false);
    const success = result.results.find((entry) => entry.voucherId === 1);
    const failure = result.results.find((entry) => entry.voucherId === 2);
    expect(success?.ok).toBe(true);
    expect(failure?.ok).toBe(false);
    expect(failure?.errors[0].code).toBe("VOUCHER_NO_DOCUMENT");
  });

  it("returns FALLBACK_NOT_PDF code when document is an image (real-world hasPdf=false case)", async () => {
    // Reproduces the reported production failure:
    // voucherZip returned no matching PDF entry; /Document fallback returned an image.
    const zipBytes = makeZipWithStoreCompression([{ fileName: "exports/unrelated.pdf", bytes: Buffer.from("not-pdf") }]);

    const GET = vi.fn().mockImplementation((path: string) => {
      if (path === "/Voucher/{voucherId}") {
        return Promise.resolve({
          data: { objects: [{ id: 147848515, document: { id: 999, objectName: "Document" } }] },
          error: undefined,
        });
      }
      if (path === "/Voucher/{voucherId}/getDocumentImage") {
        return Promise.resolve({
          data: { objects: { filename: "belege.jpg", originMimeType: "image/jpeg", mimeType: "image/jpeg" } },
          error: undefined,
        });
      }
      if (path === "/Export/voucherZip") {
        return Promise.resolve({ data: { objects: { content: zipBytes.toString("base64"), base64Encoded: true } }, error: undefined });
      }
      if (path === "/Document/{documentId}") {
        // Fallback returns JPEG bytes
        return Promise.resolve({ data: toArrayBuffer(Buffer.from("\xFF\xD8\xFF\xE0")), error: undefined });
      }
      return Promise.resolve({ data: undefined, error: "unexpected call" });
    });

    const result = await voucherTools.get_voucher_original_pdf_batch.handler(
      { GET } as unknown as SevdeskClient,
      { voucherIds: [147848515] }
    );

    expect(result.ok).toBe(false);
    const entry = result.results[0];
    expect(entry.ok).toBe(false);
    // Both errors are surfaced: voucherZip cause (ZIP_NO_MATCH) and fallback failure (FALLBACK_NOT_PDF)
    expect(entry.errors).toHaveLength(2);
    expect(entry.errors[0].code).toBe("ZIP_NO_MATCH");
    expect(entry.errors[1].code).toBe("FALLBACK_NOT_PDF");
    expect(entry.errors[1].message).toMatch(/failed PDF format validation.*image/i);
  });
});
