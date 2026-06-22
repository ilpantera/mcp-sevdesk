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

    expect(result.source).toBe("voucherZip");
    expect(Buffer.from(result.contentBase64, "base64").equals(pdfBytes)).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("Export/voucherZip primary path"))).toBe(true);
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

    expect(result.source).toBe("document-download-fallback");
    expect(result.warnings[0]).toMatch(/Export\/voucherZip primary retrieval failed/i);
  });

  it("throws when neither primary path nor fallback returns a PDF", async () => {
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

    await expect(
      voucherTools.get_voucher_original_pdf.handler(
        { GET } as unknown as SevdeskClient,
        { voucherId: 1 }
      )
    ).rejects.toThrow(/not a PDF/i);
  });
});

describe("get_voucher_original_pdf_batch", () => {
  it("returns mixed success/failure entries with DOCUMENT_DOWNLOAD_FAILED error code", async () => {
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
    expect(failure?.errors[0].code).toBe("DOCUMENT_DOWNLOAD_FAILED");
  });
});
