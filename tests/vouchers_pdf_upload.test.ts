import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { voucherTools } from "../src/tools/vouchers.js";
import type { SevdeskClient } from "../src/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePdfBase64 = readFileSync(join(__dirname, "fixtures/sample-text.pdf")).toString("base64");

describe("create_voucher_from_pdf", () => {
  it("creates a new voucher from a valid uploaded PDF payload", async () => {
    const POST = vi
      .fn()
      .mockResolvedValueOnce({
        data: { objects: { filename: "temp-uploaded-hash.pdf" } },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { voucher: { id: "123", document: { id: "456", objectName: "Document" } } },
        error: undefined,
      });

    const result = await voucherTools.create_voucher_from_pdf.handler(
      { POST } as unknown as SevdeskClient,
      {
        fileName: "receipt.pdf",
        contentBase64: samplePdfBase64,
        voucherDate: "2026-06-22",
        description: "Testbeleg",
        supplierName: "Muster GmbH",
        creditDebit: "D",
      }
    );

    expect(result).toEqual({
      ok: true,
      voucherId: 123,
      documentId: 456,
      fileName: "receipt.pdf",
      warnings: [],
      errors: [],
    });
    expect(POST).toHaveBeenNthCalledWith(
      1,
      "/Voucher/Factory/uploadTempFile",
      expect.objectContaining({
        body: expect.objectContaining({
          filename: "receipt.pdf",
          base64: true,
          creditDebit: "D",
        }),
      })
    );
    expect(POST).toHaveBeenNthCalledWith(
      2,
      "/Voucher/Factory/saveVoucher",
      expect.objectContaining({
        body: expect.objectContaining({
          filename: "temp-uploaded-hash.pdf",
        }),
      })
    );
  });

  it("returns actionable error when base64 payload is invalid", async () => {
    const POST = vi.fn();

    const result = await voucherTools.create_voucher_from_pdf.handler(
      { POST } as unknown as SevdeskClient,
      {
        fileName: "broken.pdf",
        contentBase64: "%%%not-base64%%%",
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("PDF_BASE64_INVALID");
    expect(POST).not.toHaveBeenCalled();
  });

  it("rejects non-PDF payload even when base64 is valid", async () => {
    const POST = vi.fn();

    const result = await voucherTools.create_voucher_from_pdf.handler(
      { POST } as unknown as SevdeskClient,
      {
        fileName: "not-pdf.txt",
        contentBase64: Buffer.from("plain text data").toString("base64"),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("PDF_NOT_VALID");
    expect(POST).not.toHaveBeenCalled();
  });

  it("returns structured failure when upload to sevDesk fails", async () => {
    const POST = vi.fn().mockResolvedValueOnce({
      data: undefined,
      error: { message: "upload failed" },
    });

    const result = await voucherTools.create_voucher_from_pdf.handler(
      { POST } as unknown as SevdeskClient,
      {
        fileName: "receipt.pdf",
        contentBase64: samplePdfBase64,
      }
    );

    expect(result.ok).toBe(false);
    expect(result.voucherId).toBeNull();
    expect(result.documentId).toBeNull();
    expect(result.fileName).toBe("receipt.pdf");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("voucherDate was not provided"),
        expect.stringContaining("creditDebit was not provided"),
      ])
    );
    expect(result.errors).toEqual([expect.objectContaining({ code: "PDF_UPLOAD_FAILED" })]);
  });

  it("returns structured failure when saveVoucher fails after upload", async () => {
    const POST = vi
      .fn()
      .mockResolvedValueOnce({
        data: { objects: { filename: "temp-uploaded-hash.pdf" } },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: undefined,
        error: { message: "save failed" },
      });

    const result = await voucherTools.create_voucher_from_pdf.handler(
      { POST } as unknown as SevdeskClient,
      {
        fileName: "receipt.pdf",
        contentBase64: samplePdfBase64,
      }
    );

    expect(result.ok).toBe(false);
    expect(result.voucherId).toBeNull();
    expect(result.documentId).toBeNull();
    expect(result.errors[0].code).toBe("VOUCHER_CREATE_FAILED");
  });
});
