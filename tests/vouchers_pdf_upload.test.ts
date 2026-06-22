import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { voucherTools } from "../src/tools/vouchers.js";
import type { SevdeskClient } from "../src/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePdfBase64 = readFileSync(join(__dirname, "fixtures/sample-text.pdf")).toString("base64");
const samplePdfBytes = readFileSync(join(__dirname, "fixtures/sample-text.pdf"));

function createMockClient(overrides: Partial<SevdeskClient> = {}) {
  return {
    GET: vi.fn(),
    POST: vi.fn(),
    PUT: vi.fn(),
    baseUrl: "https://my.sevdesk.de/api/v1",
    defaultHeaders: {
      Authorization: "test-token",
      Accept: "application/json",
    },
    ...overrides,
  } as unknown as SevdeskClient;
}

const tempDirectories: string[] = [];

function createTempUploadFile(fileName: string, bytes: Buffer): string {
  const directory = mkdtempSync(join(tmpdir(), "mcp-sevdesk-upload-"));
  tempDirectories.push(directory);
  const filePath = join(directory, fileName);
  writeFileSync(filePath, bytes);
  return filePath;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("create_draft_voucher", () => {
  it("creates a draft voucher first and verifies it can be re-read", async () => {
    const POST = vi.fn().mockResolvedValueOnce({
      data: { voucher: { id: "123" } },
      error: undefined,
    });
    const GET = vi.fn().mockResolvedValueOnce({
      data: {
        objects: [{ id: "123", voucherDate: "2026-06-22", status: "50", creditDebit: "D", voucherType: "VOU" }],
      },
      error: undefined,
    });

    const result = await voucherTools.create_draft_voucher.handler(createMockClient({ GET, POST }), {
      voucherDate: "2026-06-22",
      description: "Testbeleg",
      supplierName: "Muster GmbH",
      creditDebit: "D",
    });

    expect(result).toEqual({
      ok: true,
      voucherId: 123,
      warnings: [],
      errors: [],
    });
    expect(POST).toHaveBeenCalledWith(
      "/Voucher/Factory/saveVoucher",
      expect.objectContaining({
        body: {
          voucher: expect.objectContaining({
            voucherDate: "2026-06-22",
            status: 50,
            creditDebit: "D",
            voucherType: "VOU",
            description: "Testbeleg",
            supplierName: "Muster GmbH",
          }),
          voucherPosSave: [],
        },
      })
    );
    expect(GET).toHaveBeenCalledWith("/Voucher/{voucherId}", expect.objectContaining({
      params: { path: { voucherId: 123 } },
    }));
  });
});

describe("attach_pdf_to_voucher", () => {
  it("uploads PDFs as multipart form-data and verifies the document is attached", async () => {
    const POST = vi
      .fn()
      .mockResolvedValueOnce({
        data: { objects: { filename: "temp-uploaded-hash.pdf" } },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { voucher: { id: "123", document: { id: "456" } } },
        error: undefined,
      });
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          objects: [{ id: "123", voucherDate: "2026-06-22", status: "50", creditDebit: "D", voucherType: "VOU" }],
        },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: {
          objects: [
            {
              id: "123",
              voucherDate: "2026-06-22",
              status: "50",
              creditDebit: "D",
              voucherType: "VOU",
              document: { id: "456" },
            },
          ],
        },
        error: undefined,
      });

    const result = await voucherTools.attach_pdf_to_voucher.handler(createMockClient({ GET, POST }), {
      voucherId: 123,
      fileName: "receipt.pdf",
      contentBase64: samplePdfBase64,
    });

    expect(result).toEqual({
      ok: true,
      voucherId: 123,
      documentId: 456,
      fileName: "receipt.pdf",
      warnings: [],
      errors: [],
    });
    const uploadCall = POST.mock.calls[0];
    expect(uploadCall[0]).toBe("/Voucher/Factory/uploadTempFile");
    const uploadForm = uploadCall[1].body as FormData;
    expect(uploadForm).toBeInstanceOf(FormData);
    const uploadedFile = uploadForm.get("file");
    expect(uploadedFile).toBeTruthy();
    expect((uploadedFile as File).name).toBe("receipt.pdf");
    expect((uploadedFile as File).type).toBe("application/pdf");
    expect(POST).toHaveBeenNthCalledWith(
      2,
      "/Voucher/Factory/saveVoucher",
      expect.objectContaining({
        body: expect.objectContaining({
          voucher: expect.objectContaining({
            id: 123,
            voucherDate: "2026-06-22",
            status: 50,
            creditDebit: "D",
            voucherType: "VOU",
          }),
          filename: "temp-uploaded-hash.pdf",
        }),
      })
    );
  });

  it("returns actionable errors when the payload is not valid base64", async () => {
    const client = createMockClient();

    const result = await voucherTools.attach_pdf_to_voucher.handler(client, {
      voucherId: 123,
      fileName: "broken.pdf",
      contentBase64: "%%%not-base64%%%",
    });

    expect(result.ok).toBe(false);
    expect(result.documentId).toBeNull();
    expect(result.errors[0].code).toBe("PDF_BASE64_INVALID");
    expect((client.POST as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("create_voucher_from_pdf", () => {
  it("creates, verifies, attaches, and re-verifies the voucher in two phases", async () => {
    const POST = vi
      .fn()
      .mockResolvedValueOnce({
        data: { voucher: { id: "123" } },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { objects: { filename: "temp-uploaded-hash.pdf" } },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { voucher: { id: "123", document: { id: "456", objectName: "Document" } } },
        error: undefined,
      });
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          objects: [
            {
              id: "123",
              voucherDate: "2026-06-22",
              status: "50",
              creditDebit: "D",
              voucherType: "VOU",
              description: "Testbeleg",
              supplierName: "Muster GmbH",
            },
          ],
        },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: {
          objects: [
            {
              id: "123",
              voucherDate: "2026-06-22",
              status: "50",
              creditDebit: "D",
              voucherType: "VOU",
              document: { id: "456" },
            },
          ],
        },
        error: undefined,
      });

    const result = await voucherTools.create_voucher_from_pdf.handler(createMockClient({ GET, POST }), {
      fileName: "receipt.pdf",
      contentBase64: samplePdfBase64,
      voucherDate: "2026-06-22",
      description: "Testbeleg",
      supplierName: "Muster GmbH",
      creditDebit: "D",
    });

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
      "/Voucher/Factory/saveVoucher",
      expect.objectContaining({
        body: expect.objectContaining({
          voucher: expect.objectContaining({
            voucherDate: "2026-06-22",
            description: "Testbeleg",
            supplierName: "Muster GmbH",
          }),
          voucherPosSave: [],
        }),
      })
    );
    expect(POST).toHaveBeenNthCalledWith(
      3,
      "/Voucher/Factory/saveVoucher",
      expect.objectContaining({
        body: expect.objectContaining({
          voucher: expect.objectContaining({ id: 123 }),
          filename: "temp-uploaded-hash.pdf",
        }),
      })
    );
  });

  it("returns structured failure when the voucher cannot be re-read after creation", async () => {
    const POST = vi.fn().mockResolvedValueOnce({
      data: { voucher: { id: "123" } },
      error: undefined,
    });
    const GET = vi.fn().mockResolvedValueOnce({
      data: undefined,
      error: { message: "not found" },
    });

    const result = await voucherTools.create_voucher_from_pdf.handler(createMockClient({ GET, POST }), {
      fileName: "receipt.pdf",
      contentBase64: samplePdfBase64,
    });

    expect(result.ok).toBe(false);
    expect(result.voucherId).toBe(123);
    expect(result.documentId).toBeNull();
    expect(result.fileName).toBe("receipt.pdf");
    expect(result.errors).toEqual([expect.objectContaining({ code: "VOUCHER_VERIFY_FAILED" })]);
    expect(POST).toHaveBeenCalledTimes(1);
  });

  it("returns structured failure when PDF attach fails after voucher creation", async () => {
    const POST = vi
      .fn()
      .mockResolvedValueOnce({
        data: { voucher: { id: "123" } },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { objects: { filename: "temp-uploaded-hash.pdf" } },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: undefined,
        error: { message: "attach failed" },
      });
    const GET = vi.fn().mockResolvedValueOnce({
      data: {
        objects: [{ id: "123", voucherDate: "2026-06-22", status: "50", creditDebit: "D", voucherType: "VOU" }],
      },
      error: undefined,
    });

    const result = await voucherTools.create_voucher_from_pdf.handler(createMockClient({ GET, POST }), {
      fileName: "receipt.pdf",
      contentBase64: samplePdfBase64,
    });

    expect(result.ok).toBe(false);
    expect(result.voucherId).toBe(123);
    expect(result.documentId).toBeNull();
    expect(result.errors).toEqual([expect.objectContaining({ code: "PDF_ATTACH_FAILED" })]);
  });

  it("rejects non-PDF payload even when base64 is valid", async () => {
    const client = createMockClient();

    const result = await voucherTools.create_voucher_from_pdf.handler(client, {
      fileName: "not-pdf.txt",
      contentBase64: Buffer.from("plain text data").toString("base64"),
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("PDF_NOT_VALID");
    expect((client.POST as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("upload_voucher_file", () => {
  it("uploads a local PDF via multipart form-data and returns the temp filename metadata", async () => {
    const filePath = createTempUploadFile("receipt.pdf", samplePdfBytes);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          objects: {
            filename: "temp-uploaded-hash.pdf",
            pages: 1,
            originMimeType: "application/pdf",
            contentHash: "sha256:abc123",
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await voucherTools.upload_voucher_file.handler(createMockClient(), { filePath });

    expect(result).toEqual({
      ok: true,
      filePath,
      filename: "temp-uploaded-hash.pdf",
      pages: 1,
      originMimeType: "application/pdf",
      contentHash: "sha256:abc123",
      warnings: [],
      errors: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://my.sevdesk.de/api/v1/Voucher/Factory/uploadTempFile",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "test-token",
          Accept: "application/json",
        }),
        body: expect.anything(),
      })
    );
  });

  it("returns FILE_NOT_FOUND without sending a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const filePath = join(tmpdir(), "mcp-sevdesk-missing", "missing.pdf");

    const result = await voucherTools.upload_voucher_file.handler(createMockClient(), { filePath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([expect.objectContaining({ code: "FILE_NOT_FOUND" })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-PDF files before any request is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const filePath = createTempUploadFile("not-a-pdf.txt", Buffer.from("plain text data"));

    const result = await voucherTools.upload_voucher_file.handler(createMockClient(), { filePath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([expect.objectContaining({ code: "FILE_NOT_PDF" })]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns UPLOAD_FAILED with status and body when sevDesk rejects the upload", async () => {
    const filePath = createTempUploadFile("receipt.pdf", samplePdfBytes);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("upload exploded", { status: 500, statusText: "Server Error" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await voucherTools.upload_voucher_file.handler(createMockClient(), { filePath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "UPLOAD_FAILED",
        message: expect.stringContaining("500 Server Error"),
      }),
    ]);
    expect(result.errors[0]?.message).toContain("upload exploded");
  });

  it("returns UPLOAD_RESPONSE_INVALID when sevDesk omits objects.filename", async () => {
    const filePath = createTempUploadFile("receipt.pdf", samplePdfBytes);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ objects: { pages: 1 } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await voucherTools.upload_voucher_file.handler(createMockClient(), { filePath });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([expect.objectContaining({ code: "UPLOAD_RESPONSE_INVALID" })]);
  });
});

describe("create_voucher", () => {
  it("normalizes sum and sumNet internally for sevDesk compatibility", async () => {
    const POST = vi.fn().mockResolvedValueOnce({
      data: { voucher: { id: "123" } },
      error: undefined,
    });

    await voucherTools.create_voucher.handler(createMockClient({ POST }), {
      voucherDate: "2026-06-22",
      voucherPositions: [
        {
          accountDatev: { id: 555, objectName: "AccountDatev" },
          taxRate: 19,
          net: true,
          sum: 100,
          comment: "Bürobedarf",
        },
      ],
    });

    expect(POST).toHaveBeenCalledWith(
      "/Voucher/Factory/saveVoucher",
      expect.objectContaining({
        body: expect.objectContaining({
          voucherPosSave: [
            expect.objectContaining({
              sum: "100",
              sumNet: "100",
            }),
          ],
        }),
      })
    );
  });
});
